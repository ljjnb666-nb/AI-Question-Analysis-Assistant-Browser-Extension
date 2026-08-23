import type { MediaAssetRef, MediaAvailability, MediaAssetKind, MediaSourceKind, QuestionBlock } from "@/shared/types";
import { canonicalizeQuestionImageUrl, stableHash } from "../questionIdentity";
import { sanitizeMediaUrlForSerialization } from "@/shared/utils/mediaUrlPrivacy";
import { runtimeMediaPayloadStore, type MediaPayloadStore } from "./mediaPayloadStore";
import { runtimeMediaSourceLocatorStore, type MediaSourceLocatorStore } from "./mediaSourceLocatorStore";
import { isFormulaMediaRepresentation, resolveMediaOwnership } from "./mediaOwnership";

const DATA_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const LAZY_ATTRIBUTES = ["data-src", "data-original", "data-lazy-src", "data-url", "data-image", "data-actualsrc"];

const MAX_COMPUTED_STYLE_NODES = 256;

export function collectMediaAssets(owner: Element, store: MediaPayloadStore = runtimeMediaPayloadStore, locatorStore: MediaSourceLocatorStore = runtimeMediaSourceLocatorStore): MediaAssetRef[] {
  const assets: MediaAssetRef[] = [];
  const nodes = [owner, ...Array.from(owner.querySelectorAll("img,canvas,svg,picture,figure"))];
  const seen = new Set<Element>();
  for (const node of nodes) {
    if (seen.has(node)) continue;
    seen.add(node);
    if (node.tagName.toLowerCase() === "picture" || node.tagName.toLowerCase() === "figure") continue;
    const asset = discoverMediaAsset(node, owner, assets.length, store, locatorStore);
    if (asset && asset.ownership.role !== "decoration") assets.push(asset);
  }
  for (const node of [owner, ...Array.from(owner.querySelectorAll("*"))].slice(0, MAX_COMPUTED_STYLE_NODES)) {
    if (seen.has(node) || ["img", "canvas", "svg", "picture", "figure"].includes(node.tagName.toLowerCase())) continue;
    const asset = backgroundAsset(node as HTMLElement, assets.length, store, locatorStore, resolveMediaOwnership(node, owner));
    if (asset && asset.ownership.role !== "decoration") assets.push(asset);
  }
  return assets;
}

export function discoverMediaAsset(element: Element, owner: Element, semanticOrder: number, store: MediaPayloadStore, locatorStore: MediaSourceLocatorStore = runtimeMediaSourceLocatorStore): MediaAssetRef | null {
  if (isFormulaMediaRepresentation(element)) return null;
  const tag = element.tagName.toLowerCase();
  const ownership = resolveMediaOwnership(element, owner);
  if (ownership.role === "decoration") return null;
  if (tag === "img") return imageAsset(element as HTMLImageElement, owner, semanticOrder, store, locatorStore, ownership);
  if (tag === "canvas") return canvasAsset(element as HTMLCanvasElement, semanticOrder, store, ownership);
  if (tag === "svg") return svgAsset(element as SVGElement, semanticOrder, store, ownership);
  return backgroundAsset(element as HTMLElement, semanticOrder, store, locatorStore, ownership);
}

function imageAsset(img: HTMLImageElement, _owner: Element, order: number, store: MediaPayloadStore, locatorStore: MediaSourceLocatorStore, ownership: MediaAssetRef["ownership"]): MediaAssetRef | null {
  const current = String(img.currentSrc || "").trim();
  const src = String(img.getAttribute("src") || "").trim();
  const lazy = LAZY_ATTRIBUTES.map((name) => img.getAttribute(name)).find(Boolean)?.trim() || "";
  const source = current || src || lazy;
  if (!source) return null;
  const sourceKind: MediaSourceKind = current ? "img-current-src" : src ? "img-src" : "lazy-src";
  const picture = img.closest("picture");
  const effectiveKind = picture && current ? "picture" : sourceKind;
  return refForUrl(source, "image", effectiveKind, img, order, store, locatorStore, ownership);
}

function backgroundAsset(element: HTMLElement, order: number, store: MediaPayloadStore, locatorStore: MediaSourceLocatorStore, ownership: MediaAssetRef["ownership"]): MediaAssetRef | null {
  const value = getComputedStyle(element).backgroundImage || "";
  const match = value.match(/^\s*url\(\s*["']?(.+?)["']?\s*\)\s*$/i);
  if (!match || /gradient\(/i.test(value)) return null;
  return refForUrl(match[1], "background-image", "css-background", element, order, store, locatorStore, ownership);
}

function svgAsset(svg: SVGElement, order: number, store: MediaPayloadStore, ownership: MediaAssetRef["ownership"]): MediaAssetRef | null {
  const serializedSvg = new XMLSerializer().serializeToString(svg);
  if (!serializedSvg || serializedSvg.length > 2 * 1024 * 1024) return null;
  return makeRef({ kind: "svg", sourceKind: "inline-svg", availability: "available", fingerprint: `bytes_${stableHash(serializedSvg)}`, element: svg, order, ownership, payload: { serializedSvg, mimeType: "image/svg+xml" }, store });
}

function canvasAsset(canvas: HTMLCanvasElement, order: number, store: MediaPayloadStore, ownership: MediaAssetRef["ownership"]): MediaAssetRef | null {
  if (canvas.width < 8 || canvas.height < 8 || canvas.width * canvas.height > 12_000_000) return null;
  try {
    const dataUrl = canvas.toDataURL("image/png");
    return makeRef({ kind: "canvas", sourceKind: "canvas-snapshot", availability: "available", fingerprint: `bytes_${stableHash(dataUrl)}`, element: canvas, order, ownership, payload: { dataUrl, mimeType: "image/png" }, store });
  } catch {
    return makeRef({ kind: "canvas", sourceKind: "canvas-snapshot", availability: "tainted", fingerprint: `canvas_${stableHash(`${canvas.width}x${canvas.height}`)}`, element: canvas, order, ownership, store });
  }
}

function refForUrl(source: string, kind: MediaAssetKind, sourceKind: MediaSourceKind, element: Element, order: number, store: MediaPayloadStore, locatorStore: MediaSourceLocatorStore, ownership: MediaAssetRef["ownership"]): MediaAssetRef | null {
  if (/^data:/i.test(source)) {
    const mimeType = source.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase();
    if (!mimeType || !DATA_MIME.has(mimeType)) return null;
    return makeRef({ kind, sourceKind: "data-url", availability: "available", mimeType, fingerprint: `bytes_${stableHash(source)}`, element, order, ownership, payload: { dataUrl: source, mimeType }, store });
  }
  if (/^blob:/i.test(source)) {
    return makeRef({ kind, sourceKind: "blob-url", availability: "unresolved", fingerprint: `blob_${stableHash(source)}`, element, order, ownership, payload: { sourceUrl: source }, store, locatorStore });
  }
  const canonical = canonicalizeQuestionImageUrl(source);
  if (!canonical) return null;
  return makeRef({ kind, sourceKind, availability: "url-only", fingerprint: `url_${stableHash(canonical)}`, element, order, ownership, payload: { sourceUrl: source }, store, locatorStore });
}

function makeRef(input: { kind: MediaAssetKind; sourceKind: MediaSourceKind; availability: MediaAvailability; mimeType?: string; fingerprint: string; element: Element; order: number; ownership: MediaAssetRef["ownership"]; payload?: { sourceUrl?: string; dataUrl?: string; serializedSvg?: string; mimeType?: string }; store: MediaPayloadStore; locatorStore?: MediaSourceLocatorStore }): MediaAssetRef {
  const assetId = `media_v1_${stableHash([input.fingerprint, input.ownership.role, input.ownership.optionKey ?? "", input.order].join("\u001f"))}`;
  const availability = input.payload && input.availability === "available" && !input.store.put(assetId, input.payload) ? "blocked" : input.availability;
  if (input.payload?.sourceUrl) input.locatorStore?.put(assetId, { sourceUrl: input.payload.sourceUrl });
  const rect = (input.element as HTMLElement).getBoundingClientRect?.();
  return { schemaVersion: 1, assetId, contentFingerprint: input.fingerprint, kind: input.kind, sourceKind: input.sourceKind, availability, mimeType: input.mimeType, width: rect?.width || undefined, height: rect?.height || undefined, altText: input.element.getAttribute("alt") || undefined, ariaLabel: input.element.getAttribute("aria-label") || undefined, captionText: input.element.closest("figure")?.querySelector("figcaption")?.textContent?.trim() || undefined, semanticOrder: input.order, ownership: input.ownership };
}

export function projectLegacyMedia(block: QuestionBlock, mediaAssets: MediaAssetRef[], owner: Element): QuestionBlock {
  const primary = [...mediaAssets].sort((a, b) => priority(a) - priority(b) || ((b.width ?? 0) * (b.height ?? 0)) - ((a.width ?? 0) * (a.height ?? 0)) || (a.semanticOrder ?? 0) - (b.semanticOrder ?? 0))[0];
  const sourceById = new Map<string, string>();
  for (const image of Array.from(owner.querySelectorAll("img")) as HTMLImageElement[]) {
    const source = image.currentSrc || image.getAttribute("src") || LAZY_ATTRIBUTES.map((name) => image.getAttribute(name)).find(Boolean) || "";
    const ref = mediaAssets.find((asset) => asset.kind === "image" && asset.contentFingerprint === `url_${stableHash(canonicalizeQuestionImageUrl(source))}`);
    if (ref && source && !source.startsWith("data:") && !source.startsWith("blob:")) sourceById.set(ref.assetId, source);
  }
  const displaySegments = block.displaySegments?.map((segment) => {
    if (segment.type !== "image") return segment;
    const fingerprint = segment.url.startsWith("data:") ? `bytes_${stableHash(segment.url)}` : `url_${stableHash(canonicalizeQuestionImageUrl(segment.url))}`;
    const asset = mediaAssets.find((item) => item.contentFingerprint === fingerprint);
    return asset
      ? { ...segment, url: /^(?:data:|blob:)/i.test(segment.url) ? `media://${asset.assetId}` : sanitizeMediaUrlForSerialization(segment.url) ?? `media://${asset.assetId}`, mediaAssetId: asset.assetId }
      : segment;
  });
  return { ...block, displaySegments, mediaAssets, primaryMediaAssetId: primary?.assetId, hasImage: mediaAssets.length > 0, questionImageUrl: primary ? sanitizeMediaUrlForSerialization(sourceById.get(primary.assetId)) : sanitizeMediaUrlForSerialization(block.questionImageUrl) };
}
function priority(asset: MediaAssetRef): number { return asset.ownership.role === "stem" ? 0 : asset.ownership.role === "option" ? 1 : 2; }

/** Pure block-level merge: refs remain metadata and locators remain runtime-only. */
export function mergeQuestionMediaEvidence(a: QuestionBlock, b: QuestionBlock): Pick<QuestionBlock, "mediaAssets" | "primaryMediaAssetId" | "hasImage" | "questionImageUrl"> {
  const deduped = new Map<string, MediaAssetRef>();
  for (const asset of [...(a.mediaAssets ?? []), ...(b.mediaAssets ?? [])]) {
    if (!deduped.has(asset.assetId)) deduped.set(asset.assetId, asset);
  }
  const mediaAssets = Array.from(deduped.values()).map((asset, semanticOrder) => ({ ...asset, semanticOrder }));
  const primary = [...mediaAssets].sort((left, right) => priority(left) - priority(right) || ((right.width ?? 0) * (right.height ?? 0)) - ((left.width ?? 0) * (left.height ?? 0)) || (left.semanticOrder ?? 0) - (right.semanticOrder ?? 0))[0];
  const fallback = primary?.assetId === a.primaryMediaAssetId ? a.questionImageUrl : primary?.assetId === b.primaryMediaAssetId ? b.questionImageUrl : undefined;
  const source = primary ? runtimeMediaSourceLocatorStore.get(primary.assetId)?.sourceUrl ?? fallback : undefined;
  return { mediaAssets, primaryMediaAssetId: primary?.assetId, hasImage: mediaAssets.length > 0, questionImageUrl: sanitizeMediaUrlForSerialization(source) };
}
