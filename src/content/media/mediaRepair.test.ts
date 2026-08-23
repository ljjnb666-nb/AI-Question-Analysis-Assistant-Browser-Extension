import { beforeEach, describe, expect, it } from "vitest";
import type { MediaAssetRef, QuestionBlock } from "@/shared/types";
import { toProgressBlock } from "../autoSolveFlow";
import { getAutomaticQuestionEligibility } from "../automaticQuestionEligibility";
import { evaluateQuestionCompleteness } from "../detector/questionCompleteness";
import { mergeAdjacentQuestionBlocks } from "../detector/domDetectorPostprocess";
import { sanitizeBlockForHistory } from "@/shared/utils/storage";
import { collectMediaAssets, mergeQuestionMediaEvidence, projectLegacyMedia } from "./mediaDiscovery";
import { MediaPayloadStore } from "./mediaPayloadStore";
import { MediaSourceLocatorStore } from "./mediaSourceLocatorStore";

const bbox = { x: 0, y: 0, width: 200, height: 100 };
const block = (overrides: Partial<QuestionBlock> = {}): QuestionBlock => ({ id: "q", bbox, previewText: "根据下图选择 A. a B. b C. c D. d", hasImage: false, questionTypeGuess: "single_choice", confidence: 1, source: "auto_dom", ...overrides });
const asset = (id: string, role: MediaAssetRef["ownership"]["role"], availability: MediaAssetRef["availability"], optionKey?: string): MediaAssetRef => ({ schemaVersion: 1, assetId: id, contentFingerprint: `fp-${id}`, kind: "image", sourceKind: "img-src", availability, ownership: { role, optionKey, confidence: 1, reasons: ["SAME_QUESTION_OWNER"] } });
function rect(element: Element, width = 100, height = 50) { Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height }) }); }

describe("Phase 3 review repair", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("VC1-VC5 propagates unresolved visual evidence and handles image options", () => {
    const tainted = evaluateQuestionCompleteness(block({ mediaAssets: [asset("stem", "stem", "tainted")] }));
    expect(tainted).toMatchObject({ visualComplete: "unknown", state: "unknown" });
    expect(getAutomaticQuestionEligibility({ ...block(), completeness: tainted })).toBe("withhold-unknown");
    expect(evaluateQuestionCompleteness(block({ mediaAssets: [asset("stem", "stem", "url-only")] })).visualComplete).toBe(true);
    const choices = ["A", "B", "C", "D"].map((key) => asset(`opt-${key}`, "option", "url-only", key));
    const completeOptions = evaluateQuestionCompleteness(block({ previewText: "Which image is correct? A. a B. b C. c D. d", mediaAssets: choices }));
    const missingOption = evaluateQuestionCompleteness(block({ previewText: "Which image is correct? A. a B. b C. c D. d", mediaAssets: choices.slice(0, 3) }));
    expect(completeOptions).toMatchObject({ visualComplete: true, state: "complete" });
    expect(missingOption.state).not.toBe("complete");
  });

  it("L1-L5 stores remote, option, and blob locators without serializing them", () => {
    document.body.innerHTML = `<div class="questionBox"><div class="questionContent"><img src="https://example.com/stem.png"></div><ul>${["A", "B", "C", "D"].map((key) => `<li class="option-item">${key}.<img src="https://example.com/${key}.png"></li>`).join("")}<img src="blob:https://example.com/id"></ul></div>`;
    document.querySelectorAll("img").forEach((node) => rect(node));
    const locators = new MediaSourceLocatorStore(6);
    const assets = collectMediaAssets(document.querySelector(".questionBox")!, new MediaPayloadStore(), locators);
    expect(locators.get(assets.find((item) => item.ownership.role === "stem")!.assetId)?.sourceUrl).toContain("stem.png");
    expect(assets.filter((item) => item.ownership.role === "option").every((item) => Boolean(locators.get(item.assetId)?.sourceUrl))).toBe(true);
    const blob = assets.find((item) => item.sourceKind === "blob-url")!;
    expect(blob.availability).toBe("unresolved");
    expect(locators.get(blob.assetId)?.sourceUrl).toMatch(/^blob:/);
    expect(JSON.stringify(block({ mediaAssets: assets }))).not.toContain("stem.png");
    locators.put("x", { sourceUrl: "x" }); locators.put("y", { sourceUrl: "y" });
    expect(locators.get(assets[0].assetId)).toBeUndefined();
  });

  it("XO1-XO3 fails closed for broad owners while preserving a concrete question owner", () => {
    document.body.innerHTML = `<div id="wrapper"><div class="questionBox" id="q12"><div class="questionContent"><img src="/12.png"></div></div><div class="questionBox" id="q13"><img src="/13.png"></div></div></div>`;
    document.querySelectorAll("img").forEach((node) => rect(node));
    const wrapper = collectMediaAssets(document.getElementById("wrapper")!, new MediaPayloadStore(), new MediaSourceLocatorStore());
    expect(wrapper.every((item) => item.ownership.role === "unknown")).toBe(true);
    const q12 = collectMediaAssets(document.getElementById("q12")!, new MediaPayloadStore(), new MediaSourceLocatorStore());
    expect(q12).toHaveLength(1);
    expect(q12[0].ownership.role).toBe("stem");
  });

  it("BG1-BG4 discovers inline and computed backgrounds, but ignores gradients and icons", () => {
    document.head.innerHTML = `<style>.diagram { background-image: url('/class.png'); } .icon { background-image: url('/icon.png'); }</style>`;
    document.body.innerHTML = `<div class="questionBox"><div class="questionContent"><div id="inline" style="background-image:url('/inline.png')"></div><div class="diagram"></div><div style="background-image:linear-gradient(red,blue)"></div><div class="icon"></div></div></div>`;
    document.querySelectorAll("div").forEach((node) => rect(node));
    const assets = collectMediaAssets(document.querySelector(".questionBox")!, new MediaPayloadStore(), new MediaSourceLocatorStore());
    expect(assets.filter((item) => item.kind === "background-image")).toHaveLength(2);
  });

  it("PRIV1-PRIV5 retains raw signed URLs only in the locator", () => {
    const signed = "https://example.com/a.png?id=3&X-Amz-Signature=SECRET&Expires=999";
    document.body.innerHTML = `<div class="questionBox"><div class="questionContent"><img src="${signed}"></div></div>`;
    const image = document.querySelector("img")!; rect(image);
    const locators = new MediaSourceLocatorStore(); const owner = document.querySelector(".questionBox")!;
    const assets = collectMediaAssets(owner, new MediaPayloadStore(), locators);
    const projected = projectLegacyMedia(block({ displaySegments: [{ type: "image", url: signed }] }), assets, owner);
    expect(locators.get(assets[0].assetId)?.sourceUrl).toContain("SECRET");
    for (const value of [assets, projected, toProgressBlock(projected), sanitizeBlockForHistory(projected)]) expect(JSON.stringify(value)).not.toContain("SECRET");
    expect(projected.questionImageUrl).toContain("id=3");
  });

  it("MM1-MM4 dedupes, recomputes primary projection, and updates identity inputs", () => {
    const stem = asset("stem", "stem", "url-only");
    const a = block({ previewText: "1. stem A. a B. b", mediaAssets: [], hasImage: false });
    const b = block({ id: "q2", previewText: "C. c D. d", mediaAssets: [stem, asset("same", "option", "url-only", "A"), asset("same", "option", "url-only", "A"), asset("b", "option", "url-only", "B")], primaryMediaAssetId: "stem", questionImageUrl: "https://example.com/stem.png" });
    const merged = mergeQuestionMediaEvidence(a, b);
    expect(merged).toMatchObject({ hasImage: true, primaryMediaAssetId: "stem", questionImageUrl: "https://example.com/stem.png" });
    expect(merged.mediaAssets?.map((item) => item.assetId)).toEqual(["stem", "same", "b"]);
    const joined = mergeAdjacentQuestionBlocks([
      block({ id: "first", runtimeOwnerKey: "same", bbox: { ...bbox, y: 0 }, previewText: "14. Which image? A. a B. b", mediaAssets: [] }),
      block({ id: "second", runtimeOwnerKey: "same", bbox: { ...bbox, y: 104 }, previewText: "14. C. c D. d", mediaAssets: [stem], primaryMediaAssetId: "stem", questionImageUrl: "https://example.com/stem.png" }),
    ]);
    expect(joined).toHaveLength(1);
    expect(joined[0].identity?.signals.media).toBe(true);
  });

  it("DEC1-DEC2 excludes a tiny SVG icon but retains a diagram", () => {
    document.body.innerHTML = `<div class="questionBox"><div class="questionContent"><svg id="icon"><path/></svg><svg id="diagram"><path/></svg></div></div>`;
    rect(document.getElementById("icon")!, 16, 16); rect(document.getElementById("diagram")!, 200, 100);
    const assets = collectMediaAssets(document.querySelector(".questionBox")!, new MediaPayloadStore(), new MediaSourceLocatorStore());
    expect(assets.filter((item) => item.kind === "svg")).toHaveLength(1);
  });
});
