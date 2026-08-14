import type { QuestionBlock, QuestionIdentity, QuestionType } from "@/shared/types";

const IDENTITY_VERSION = 1 as const;
const STRONG_NATIVE_ID_ATTRIBUTES = ["data-question-id", "data-questionid", "data-problem-id", "data-problemid", "data-item-id"];
const WEAK_NATIVE_ID_ATTRIBUTES = ["data-id"];
const GENERIC_CONTAINER_ID_RE = /^(?:question(?:box|content)?|problem|item|card|main|root|app|options?|answer)$/i;

export type QuestionIdentityInput = {
  text: string;
  questionType: QuestionType;
  questionImageUrl?: string;
  element?: Element | null;
  nativeQuestionId?: string;
};

export function canonicalizeQuestionText(raw: string): string {
  return String(raw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[，]/g, ",")
    .replace(/[？]/g, "?")
    .replace(/[：]/g, ":")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function canonicalizeQuestionImageUrl(raw?: string): string {
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.href);
    const cacheParams = new Set(["timestamp", "ts", "cache", "cachebust", "cache_bust", "cb", "_"]);
    const retained = Array.from(url.searchParams.entries())
      .filter(([key]) => !cacheParams.has(key.toLowerCase()) && !key.toLowerCase().startsWith("utm_"))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    const query = retained.length ? `?${new URLSearchParams(retained).toString()}` : "";
    return `${url.origin}${url.pathname}${query}`;
  } catch {
    return String(raw).split(/[?#]/, 1)[0];
  }
}

export function extractOrdinalHint(text: string): number | undefined {
  const match = canonicalizeQuestionText(text).match(/^(\d{1,4})\s*[.、.)]/);
  const ordinal = Number(match?.[1]);
  return Number.isFinite(ordinal) && ordinal > 0 ? ordinal : undefined;
}

function removeLeadingOrdinal(text: string): string {
  return text.replace(/^\d{1,4}\s*[.、.)]\s*/, "");
}

export function isLikelyStableNativeQuestionId(value: string | null | undefined): boolean {
  const normalized = String(value || "").trim();
  if (normalized.length < 2 || normalized.length > 160) return false;
  if (/^(?:react|auto|css|vite|webpack|jsx|mui|radix)[-_]/i.test(normalized)) return false;
  if (/^\d{10,}$/.test(normalized)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(normalized);
}

function isLikelyStrongNativeQuestionId(value: string | null | undefined): boolean {
  const normalized = String(value || "").trim();
  if (normalized.length < 1 || normalized.length > 160) return false;
  if (/^(?:react|auto|css|vite|webpack|jsx|mui|radix)[-_]/i.test(normalized)) return false;
  if (/^\d{10,}$/.test(normalized)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(normalized);
}

function isLikelyQuestionInstanceElementId(value: string | null | undefined): boolean {
  const normalized = String(value || "").trim();
  if (!isLikelyStableNativeQuestionId(normalized) || GENERIC_CONTAINER_ID_RE.test(normalized)) return false;
  return /^(?:question|problem|q)[_-](?:[A-Za-z0-9-]*\d[A-Za-z0-9-]*)$/i.test(normalized)
    || /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(normalized);
}

function isLikelyWeakNativeQuestionId(value: string | null | undefined): boolean {
  const normalized = String(value || "").trim();
  return isLikelyStableNativeQuestionId(normalized) && (/[0-9]/.test(normalized) || /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(normalized));
}

export function extractNativeQuestionId(element?: Element | null): string | undefined {
  if (!element) return undefined;
  for (const attribute of STRONG_NATIVE_ID_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (isLikelyStrongNativeQuestionId(value)) return String(value).trim();
  }
  for (const attribute of WEAK_NATIVE_ID_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (isLikelyWeakNativeQuestionId(value)) return String(value).trim();
  }
  const elementId = element.getAttribute("id");
  if (isLikelyQuestionInstanceElementId(elementId)) return String(elementId).trim();
  return undefined;
}

export function buildQuestionIdentity(input: QuestionIdentityInput): QuestionIdentity {
  const text = canonicalizeQuestionText(input.text);
  const ordinalHint = extractOrdinalHint(text);
  const nativeQuestionId = input.nativeQuestionId ?? extractNativeQuestionId(input.element);
  const imageHint = canonicalizeQuestionImageUrl(input.questionImageUrl);
  const optionSignal = /(?:^|\n|\s)[A-F][.):、]/.test(text);
  const structureHint = input.element?.tagName.toLowerCase() || "";
  const contentText = removeLeadingOrdinal(text);
  const contentFingerprint = `cf_v${IDENTITY_VERSION}_${stableHash([input.questionType, contentText, imageHint].join("\u001f"))}`;
  const strategy = nativeQuestionId
    ? "native-id"
    : ordinalHint !== undefined
      ? "content+ordinal"
      : structureHint
        ? "content+structure"
        : "content-only";
  const stableInput = nativeQuestionId
    ? `native:${nativeQuestionId}|content:${contentFingerprint}`
    : ordinalHint !== undefined
      ? `${contentFingerprint}|ordinal:${ordinalHint}`
      : structureHint
        ? `${contentFingerprint}|structure:${structureHint}`
        : contentFingerprint;
  return {
    stableId: `q_v${IDENTITY_VERSION}_${stableHash(stableInput)}`,
    contentFingerprint,
    identityVersion: IDENTITY_VERSION,
    strategy,
    nativeQuestionId,
    ordinalHint,
    signals: {
      nativeId: Boolean(nativeQuestionId),
      content: Boolean(text),
      options: optionSignal,
      media: Boolean(imageHint),
      structure: Boolean(structureHint),
    },
  };
}

export function attachQuestionIdentity<T extends QuestionBlock>(
  block: T,
  element?: Element | null,
  options?: { identityText?: string; nativeQuestionId?: string },
): T & { identity: QuestionIdentity } {
  return {
    ...block,
    identity: buildQuestionIdentity({
      text: options?.identityText ?? block.previewText,
      questionType: block.questionTypeGuess,
      questionImageUrl: block.questionImageUrl,
      element,
      nativeQuestionId: options?.nativeQuestionId,
    }),
  };
}
