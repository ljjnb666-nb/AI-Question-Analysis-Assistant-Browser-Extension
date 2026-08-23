import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectMediaAssets, projectLegacyMedia } from "./mediaDiscovery";
import { MediaPayloadStore } from "./mediaPayloadStore";

function store() { return new MediaPayloadStore(20, 1024 * 1024, 512 * 1024); }
function rect(node: Element, width = 120, height = 60) { Object.defineProperty(node, "getBoundingClientRect", { configurable: true, value: () => ({ width, height, top: 20, left: 20, right: 20 + width, bottom: 20 + height }) }); }

describe("media discovery", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("preserves two stem images and A/B/C/D option images", () => {
    document.body.innerHTML = `<div class="questionBox"><div class="questionContent"><img src="/one.png"><img src="/two.png"></div><ul>${["A", "B", "C", "D"].map((key) => `<li class="option-item">${key}. <img src="/${key}.png"></li>`).join("")}</ul></div>`;
    const owner = document.querySelector(".questionBox")!;
    owner.querySelectorAll("img").forEach((node) => rect(node));
    const assets = collectMediaAssets(owner, store());
    expect(assets).toHaveLength(6);
    expect(assets.filter((asset) => asset.ownership.role === "stem")).toHaveLength(2);
    expect(assets.filter((asset) => asset.ownership.role === "option").map((asset) => asset.ownership.optionKey)).toEqual(["A", "B", "C", "D"]);
  });

  it("supports data URLs without putting raw base64 into a ref", () => {
    const data = "data:image/png;base64,aGVsbG8=";
    document.body.innerHTML = `<div class="questionBox"><div class="questionContent"><img src="${data}"></div></div>`;
    const image = document.querySelector("img")!; rect(image);
    const payloads = store(); const asset = collectMediaAssets(document.querySelector(".questionBox")!, payloads)[0];
    expect(asset.contentFingerprint).toMatch(/^bytes_/);
    expect(JSON.stringify(asset)).not.toContain("aGVsbG8=");
    expect(payloads.has(asset.assetId)).toBe(true);
    const block = projectLegacyMedia({ id: "q", bbox: { x: 0, y: 0, width: 1, height: 1 }, previewText: "根据下图", displaySegments: [{ type: "image", url: data }], hasImage: false, questionTypeGuess: "unknown", confidence: 1, source: "auto_dom" }, [asset], document.querySelector(".questionBox")!);
    expect(JSON.stringify(block)).not.toContain("aGVsbG8=");
    expect(JSON.stringify(block)).not.toContain("Blob");
  });

  it("marks blob URLs unresolved and ignores unsupported data MIME", () => {
    document.body.innerHTML = `<div class="questionBox"><div class="questionContent"><img src="blob:https://example.com/id"><img src="data:text/html,nope"></div></div>`;
    document.querySelectorAll("img").forEach((node) => rect(node));
    const assets = collectMediaAssets(document.querySelector(".questionBox")!, store());
    expect(assets).toHaveLength(1);
    expect(assets[0].availability).toBe("unresolved");
  });

  it("prefers rendered currentSrc and falls back to lazy source only when src is absent", () => {
    document.body.innerHTML = `<div class="questionBox"><div class="questionContent"><picture><source srcset="/large.webp"><img id="responsive" src="/small.png"></picture><img id="lazy" data-src="/lazy.png"></div></div>`;
    const responsive = document.getElementById("responsive") as HTMLImageElement;
    Object.defineProperty(responsive, "currentSrc", { configurable: true, value: "https://example.com/rendered.webp" });
    document.querySelectorAll("img").forEach((node) => rect(node));
    const assets = collectMediaAssets(document.querySelector(".questionBox")!, store());
    expect(assets.map((asset) => asset.sourceKind)).toEqual(expect.arrayContaining(["picture", "lazy-src"]));
    expect(assets.map((asset) => asset.contentFingerprint)).toContain("url_" + assets.find((asset) => asset.sourceKind === "picture")!.contentFingerprint.slice(4));
  });

  it("excludes formula SVG and decorative icons, while preserving equal bytes as distinct option instances", () => {
    document.body.innerHTML = `<div class="questionBox"><div class="questionContent"><svg data-latex="x^2"><path/></svg><img class="iconfont" src="/icon.png"></div><ul><li class="option-item">A. <img src="/same.png"></li><li class="option-item">B. <img src="/same.png"></li></ul></div>`;
    document.querySelectorAll("img,svg").forEach((node) => rect(node));
    const assets = collectMediaAssets(document.querySelector(".questionBox")!, store());
    expect(assets).toHaveLength(2);
    expect(assets[0].contentFingerprint).toBe(assets[1].contentFingerprint);
    expect(assets[0].assetId).not.toBe(assets[1].assetId);
  });

  it("collects CSS backgrounds, inline SVG and permitted or tainted canvas explicitly", () => {
    document.body.innerHTML = `<div class="questionBox"><div class="questionContent"><div id="bg" style="background-image:url('/diagram.png')"></div><svg><path d="M0 0"/></svg><canvas width="20" height="20"></canvas></div></div>`;
    const owner = document.querySelector(".questionBox")!;
    owner.querySelectorAll("div,svg,canvas").forEach((node) => rect(node));
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    vi.spyOn(canvas, "toDataURL").mockImplementation(() => "data:image/png;base64,aGVsbG8=");
    const assets = collectMediaAssets(owner, store());
    expect(assets.map((asset) => asset.kind)).toEqual(expect.arrayContaining(["background-image", "svg", "canvas"]));
    vi.spyOn(canvas, "toDataURL").mockImplementation(() => { throw new DOMException("tainted", "SecurityError"); });
    expect(collectMediaAssets(owner, store()).find((asset) => asset.kind === "canvas")?.availability).toBe("tainted");
  });
});
