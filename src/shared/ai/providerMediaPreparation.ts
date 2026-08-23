import type { ProviderConfig } from "./providers";
import type { QuestionPackageBuildResult, QuestionScreenshotFallback, SolverMediaPart, SolverQuestionPackage } from "./questionPackage";

export type ProviderMediaPreparationContext = { signal?: AbortSignal; fetch?: typeof globalThis.fetch; screenshotFallback?: QuestionScreenshotFallback; isQuestionRevisionCurrent?: (identity: { questionId: string; contentFingerprint: string }) => boolean };
const MAX_IMAGES = 8; const MAX_SINGLE = 2 * 1024 * 1024; const MAX_TOTAL = 6 * 1024 * 1024;
const MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export function isProviderSupportedImageMime(mimeType: string | undefined): boolean { return Boolean(mimeType && MIME.has(mimeType.toLowerCase())); }

export async function prepareQuestionPackageForProvider(input: SolverQuestionPackage, provider: ProviderConfig, context: ProviderMediaPreparationContext = {}): Promise<QuestionPackageBuildResult> {
  if (context.signal?.aborted) return { ok: false, code: "STALE_QUESTION_REVISION" };
  if (!provider.supportsVision) return { ok: false, code: "MEDIA_REQUIRES_VISION" };
  if (input.media.length > MAX_IMAGES || (!provider.supportsMultipleImages && input.media.length > 1)) return { ok: false, code: "MEDIA_BUDGET_EXCEEDED" };
  if (!provider.supportsInlineBase64 && input.media.some((part) => part.source.kind !== "remote-url" || !provider.supportsRemoteImageUrl)) return { ok: false, code: "MEDIA_REQUIRES_VISION" };
  try {
    const media: SolverMediaPart[] = [];
    for (const part of input.media) {
      const mimeType = part.mimeType ?? mimeFromSource(part);
      if ((part.source.kind !== "remote-url" || mimeType) && !isProviderSupportedImageMime(mimeType)) return fallbackOrFailure(input, context, "MEDIA_SOURCE_UNAVAILABLE");
      if (part.source.kind === "remote-url" && !provider.supportsRemoteImageUrl) media.push({ ...part, source: { kind: "data-url", dataUrl: await acquire(part.source.url, context) } });
      else media.push(part);
    }
    let total = 0;
    for (const part of media) {
      const bytes = part.source.kind === "data-url" ? Math.ceil(part.source.dataUrl.length * .75) : 0;
      if (bytes > MAX_SINGLE || total + bytes > MAX_TOTAL) return { ok: false, code: "MEDIA_BUDGET_EXCEEDED", assetId: part.assetId };
      total += bytes;
    }
    if (context.signal?.aborted || context.isQuestionRevisionCurrent?.({ questionId: input.questionId, contentFingerprint: input.contentFingerprint }) === false) return { ok: false, code: "STALE_QUESTION_REVISION" };
    return { ok: true, package: { ...input, media } };
  } catch {
    if (isStale(input, context)) return { ok: false, code: "STALE_QUESTION_REVISION" };
    return fallbackOrFailure(input, context, "MEDIA_SOURCE_UNAVAILABLE");
  }
}
function isStale(input: SolverQuestionPackage, context: ProviderMediaPreparationContext): boolean { return Boolean(context.signal?.aborted || context.isQuestionRevisionCurrent?.({ questionId: input.questionId, contentFingerprint: input.contentFingerprint }) === false); }
function fallbackOrFailure(input: SolverQuestionPackage, context: ProviderMediaPreparationContext, code: "MEDIA_SOURCE_UNAVAILABLE"): QuestionPackageBuildResult {
  if (isStale(input, context)) return { ok: false, code: "STALE_QUESTION_REVISION" };
  const fallback = context.screenshotFallback;
  if (fallback && fallback.questionId === input.questionId && fallback.contentFingerprint === input.contentFingerprint && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(fallback.dataUrl)) return { ok: true, package: { ...input, mediaFallbackUsed: true, media: [{ assetId: "question-screenshot-fallback", role: "stem", contentFingerprint: input.contentFingerprint, mimeType: fallback.dataUrl.match(/^data:([^;,]+)/i)?.[1], source: { kind: "data-url", dataUrl: fallback.dataUrl } }] } };
  return { ok: false, code };
}
async function acquire(url: string, context: ProviderMediaPreparationContext): Promise<string> {
  const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(), 10_000); const signal = mergeSignals(context.signal, timeout.signal);
  try { const res = await (context.fetch ?? fetch)(url, { credentials: "omit", signal }); if (!res.ok) throw new Error("media"); const blob = await res.blob(); if (!isProviderSupportedImageMime(blob.type) || blob.size > MAX_SINGLE) throw new Error("media"); return await blobToDataUrl(blob); } finally { clearTimeout(timer); }
}
function mimeFromSource(part: SolverMediaPart): string | undefined { return part.source.kind === "data-url" ? part.source.dataUrl.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase() : part.source.kind === "serialized-svg" ? "image/svg+xml" : undefined; }
function mergeSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined { if (!a) return b; if (!b) return a; const c = new AbortController(); const abort = () => c.abort(); a.addEventListener("abort", abort, { once: true }); b.addEventListener("abort", abort, { once: true }); return c.signal; }
function blobToDataUrl(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob); }); }
