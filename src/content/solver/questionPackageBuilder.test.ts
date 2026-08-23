import { describe, expect, it, vi } from "vitest";
import { MediaPayloadStore } from "../media/mediaPayloadStore";
import { MediaSourceLocatorStore } from "../media/mediaSourceLocatorStore";
import { buildSolverQuestionPackage } from "./questionPackageBuilder";
import type { MediaAssetRef, QuestionBlock } from "@/shared/types";

const png = "data:image/png;base64,aGVsbG8=";
function block(assets: MediaAssetRef[] = []): QuestionBlock {
  return { id: "q1", bbox: { x: 0, y: 0, width: 10, height: 10 }, previewText: "Which image is correct? A B C D", hasImage: assets.length > 0, questionTypeGuess: "single_choice", confidence: 1, source: "auto_dom", completeness: { state: "complete", boundaryComplete: true, stemComplete: true, optionsComplete: true, visualComplete: true, controlsComplete: true, confidence: 1, reasons: [] }, mediaAssets: assets };
}
function asset(id: string, role: "stem" | "option", availability: MediaAssetRef["availability"] = "available", optionKey?: string): MediaAssetRef {
  return { schemaVersion: 1, assetId: id, contentFingerprint: `fp-${id}`, kind: "image", sourceKind: "data-url", availability, semanticOrder: Number(id.replace(/\D/g, "")) || 0, ownership: { role, optionKey, confidence: 1, reasons: [role === "stem" ? "STEM_ANCESTRY" : "OPTION_ANCESTRY"] } };
}
describe("buildSolverQuestionPackage", () => {
  it("P4-1 builds text-only package", async () => {
    const result = await buildSolverQuestionPackage(block());
    expect(result).toMatchObject({ ok: true, package: { media: [] } });
  });
  it("P4-2 through P4-5 preserve stem and A-D ownership in deterministic order", async () => {
    const store = new MediaPayloadStore();
    const assets = [asset("b", "option", "available", "B"), asset("stem2", "stem"), asset("a", "option", "available", "A"), asset("stem1", "stem"), asset("c", "option", "available", "C"), asset("d", "option", "available", "D")];
    for (const item of assets) store.put(item.assetId, { dataUrl: png, mimeType: "image/png" });
    const result = await buildSolverQuestionPackage(block(assets), { payloadStore: store });
    expect(result.ok && result.package.media.map((item) => `${item.role}:${item.optionKey ?? ""}`)).toEqual(["stem:", "stem:", "option:A", "option:B", "option:C", "option:D"]);
  });
  it("P4-6 through P4-9 retains data MIME, SVG and remote locator", async () => {
    const store = new MediaPayloadStore(); const locators = new MediaSourceLocatorStore();
    const data = asset("jpeg", "stem"); const svg = asset("svg", "stem"); const remote = asset("remote", "stem", "url-only");
    store.put(data.assetId, { dataUrl: "data:image/jpeg;base64,aGVsbG8=", mimeType: "image/jpeg" }); store.put(svg.assetId, { serializedSvg: "<svg/>" }); locators.put(remote.assetId, { sourceUrl: "https://example.test/a.jpg" });
    const result = await buildSolverQuestionPackage(block([data, svg, remote]), { payloadStore: store, locatorStore: locators });
    expect(result.ok && result.package.media.map((item) => [item.mimeType, item.source.kind])).toEqual([["image/jpeg", "data-url"], ["image/svg+xml", "serialized-svg"], [undefined, "remote-url"]]);
  });
  it("P4-10 acquires a blob and P4-11 fails closed when it cannot", async () => {
    const store = new MediaPayloadStore(); const locators = new MediaSourceLocatorStore(); const item = asset("blob", "stem", "unresolved"); locators.put(item.assetId, { sourceUrl: "blob:https://page/1" });
    const ok = await buildSolverQuestionPackage(block([item]), { payloadStore: store, locatorStore: locators, fetch: vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }))) });
    expect(ok.ok).toBe(true);
    const failed = await buildSolverQuestionPackage(block([item]), { payloadStore: store, locatorStore: new MediaSourceLocatorStore(), fetch: vi.fn() });
    expect(failed).toMatchObject({ ok: false, code: "MEDIA_SOURCE_UNAVAILABLE" });
  });
  it("P4-12 through P4-15 fail or omit tainted, blocked, unknown and cross-question media", async () => {
    const store = new MediaPayloadStore(); const bad = asset("bad", "stem", "tainted");
    expect(await buildSolverQuestionPackage(block([bad]), { payloadStore: store })).toMatchObject({ ok: false, code: "MEDIA_BLOCKED" });
    const unknown = { ...asset("unknown", "stem"), ownership: { role: "unknown" as const, confidence: 1, reasons: ["CROSS_QUESTION_OWNER" as const] } }; store.put(unknown.assetId, { dataUrl: png });
    const result = await buildSolverQuestionPackage(block([unknown]), { payloadStore: store });
    expect(result).toMatchObject({ ok: true, package: { media: [] } });
  });
  it("P4-19 fails rather than silently truncating over-budget required media", async () => {
    const store = new MediaPayloadStore(32, 20 * 1024 * 1024, 3 * 1024 * 1024); const items = Array.from({ length: 9 }, (_, i) => asset(`a${i}`, "stem"));
    for (const item of items) store.put(item.assetId, { dataUrl: `data:image/png;base64,${"a".repeat(20)}` });
    expect(await buildSolverQuestionPackage(block(items), { payloadStore: store })).toMatchObject({ ok: false, code: "MEDIA_BUDGET_EXCEEDED" });
  });
  it("P4-20 preserves legacy manual screenshot", async () => {
    const result = await buildSolverQuestionPackage({ ...block(), source: "manual_capture", imageDataUrl: png });
    expect(result).toMatchObject({ ok: true, package: { media: [{ assetId: "legacy-screenshot" }] } });
  });
});
