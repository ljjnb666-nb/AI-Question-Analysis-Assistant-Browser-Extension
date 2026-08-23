import type { MediaAssetRef, QuestionBlock } from "@/shared/types";
import type { QuestionPackageBuildResult, SolverMediaPart } from "@/shared/ai/questionPackage";
import { buildPreferredQuestionText } from "@/shared/ai/questionPromptText";
import { runtimeMediaPayloadStore, type MediaPayloadStore } from "../media/mediaPayloadStore";
import { runtimeMediaSourceLocatorStore, type MediaSourceLocatorStore } from "../media/mediaSourceLocatorStore";

const MAX_IMAGES = 8;
const MAX_SINGLE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);

export type QuestionPackageBuilderDeps = {
  payloadStore?: MediaPayloadStore;
  locatorStore?: MediaSourceLocatorStore;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  screenshotFallbackDataUrl?: string;
};

/**
 * Turns serializable media references into a request-local package. URLs and bytes
 * never get attached to QuestionBlock or persisted history.
 */
export async function buildSolverQuestionPackage(
  block: QuestionBlock,
  deps: QuestionPackageBuilderDeps = {},
): Promise<QuestionPackageBuildResult> {
  const payloadStore = deps.payloadStore ?? runtimeMediaPayloadStore;
  const locatorStore = deps.locatorStore ?? runtimeMediaSourceLocatorStore;
  const assets = orderAssets(block.mediaAssets ?? []).filter((asset) =>
    (asset.ownership.role === "stem" || asset.ownership.role === "option")
    && !asset.ownership.reasons.includes("CROSS_QUESTION_OWNER"),
  );
  const unique = dedupeAssets(assets);
  const media: SolverMediaPart[] = [];
  let totalBytes = 0;

  for (const asset of unique) {
    const part = await materialize(asset, payloadStore, locatorStore, deps);
    if (!part.ok) {
      if (deps.screenshotFallbackDataUrl && isDataImage(deps.screenshotFallbackDataUrl)) {
        return fallbackPackage(block, deps.screenshotFallbackDataUrl);
      }
      return part;
    }
    const size = estimatePartBytes(part.media);
    if (media.length >= MAX_IMAGES || size > MAX_SINGLE_BYTES || totalBytes + size > MAX_TOTAL_BYTES) {
      return { ok: false, code: "MEDIA_BUDGET_EXCEEDED", assetId: asset.assetId };
    }
    totalBytes += size;
    media.push(part.media);
  }

  // Legacy/manual capture remains compatible. It has no canonical media refs.
  if (!media.length && block.imageDataUrl) {
    if (!isDataImage(block.imageDataUrl)) return { ok: false, code: "MEDIA_SOURCE_UNAVAILABLE" };
    media.push({ assetId: "legacy-screenshot", role: "stem", contentFingerprint: "legacy-screenshot", mimeType: mimeFromDataUrl(block.imageDataUrl), source: { kind: "data-url", dataUrl: block.imageDataUrl } });
  }

  return {
    ok: true,
    package: {
      schemaVersion: 1,
      questionId: block.identity?.stableId ?? block.id,
      contentFingerprint: block.identity?.contentFingerprint ?? block.id,
      questionType: block.questionTypeGuess,
      text: buildPreferredQuestionText(block),
      media,
    },
  };
}

function orderAssets(assets: MediaAssetRef[]): MediaAssetRef[] {
  return [...assets].sort((a, b) => roleRank(a) - roleRank(b) || optionRank(a.ownership.optionKey) - optionRank(b.ownership.optionKey) || (a.semanticOrder ?? 0) - (b.semanticOrder ?? 0));
}
function roleRank(asset: MediaAssetRef): number { return asset.ownership.role === "stem" ? 0 : 1; }
function optionRank(key?: string): number { return key ? "ABCDEF".indexOf(key.toUpperCase()) : -1; }
function dedupeAssets(assets: MediaAssetRef[]): MediaAssetRef[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = `${asset.contentFingerprint}\u001f${asset.ownership.role}\u001f${asset.ownership.optionKey ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function materialize(asset: MediaAssetRef, payloadStore: MediaPayloadStore, locatorStore: MediaSourceLocatorStore, deps: QuestionPackageBuilderDeps): Promise<{ ok: true; media: SolverMediaPart } | { ok: false; code: "MEDIA_SOURCE_UNAVAILABLE" | "MEDIA_BLOCKED"; assetId: string }> {
  if (asset.availability === "blocked" || asset.availability === "tainted") return { ok: false, code: "MEDIA_BLOCKED", assetId: asset.assetId };
  const payload = payloadStore.get(asset.assetId);
  if (payload?.dataUrl && isDataImage(payload.dataUrl)) return { ok: true, media: part(asset, { kind: "data-url", dataUrl: payload.dataUrl }, payload.mimeType ?? mimeFromDataUrl(payload.dataUrl)) };
  if (payload?.serializedSvg) return { ok: true, media: part(asset, { kind: "serialized-svg", svg: payload.serializedSvg }, "image/svg+xml") };
  const url = payload?.sourceUrl ?? locatorStore.get(asset.assetId)?.sourceUrl;
  if (!url) return { ok: false, code: "MEDIA_SOURCE_UNAVAILABLE", assetId: asset.assetId };
  if (/^https?:/i.test(url)) return { ok: true, media: part(asset, { kind: "remote-url", url }, asset.mimeType) };
  if (!/^blob:/i.test(url)) return { ok: false, code: "MEDIA_SOURCE_UNAVAILABLE", assetId: asset.assetId };
  try {
    const response = await (deps.fetch ?? globalThis.fetch)(url, { signal: deps.signal, credentials: "omit" });
    if (!response.ok) return { ok: false, code: "MEDIA_SOURCE_UNAVAILABLE", assetId: asset.assetId };
    const blob = await response.blob();
    const mimeType = blob.type.toLowerCase();
    if (!IMAGE_MIMES.has(mimeType) || blob.size > MAX_SINGLE_BYTES) return { ok: false, code: "MEDIA_SOURCE_UNAVAILABLE", assetId: asset.assetId };
    return { ok: true, media: part(asset, { kind: "data-url", dataUrl: await blobToDataUrl(blob) }, mimeType) };
  } catch {
    return { ok: false, code: "MEDIA_SOURCE_UNAVAILABLE", assetId: asset.assetId };
  }
}
function part(asset: MediaAssetRef, source: SolverMediaPart["source"], mimeType?: string): SolverMediaPart {
  return { assetId: asset.assetId, role: asset.ownership.role as "stem" | "option", optionKey: asset.ownership.optionKey, contentFingerprint: asset.contentFingerprint, mimeType, source };
}
function fallbackPackage(block: QuestionBlock, dataUrl: string): QuestionPackageBuildResult {
  return { ok: true, package: { schemaVersion: 1, questionId: block.identity?.stableId ?? block.id, contentFingerprint: block.identity?.contentFingerprint ?? block.id, questionType: block.questionTypeGuess, text: buildPreferredQuestionText(block), mediaFallbackUsed: true, media: [{ assetId: "question-screenshot-fallback", role: "stem", contentFingerprint: "question-screenshot-fallback", mimeType: mimeFromDataUrl(dataUrl), source: { kind: "data-url", dataUrl } }] } };
}
function isDataImage(value: string): boolean { return /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,/i.test(value); }
function mimeFromDataUrl(value: string): string | undefined { return value.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase(); }
function estimatePartBytes(media: SolverMediaPart): number { return media.source.kind === "data-url" ? Math.ceil(media.source.dataUrl.length * .75) : media.source.kind === "serialized-svg" ? new TextEncoder().encode(media.source.svg).byteLength : 0; }
function blobToDataUrl(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob); }); }
