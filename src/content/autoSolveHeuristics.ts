import type { HistoryEntry, ParseResult, QuestionBlock, QuestionType } from "@/shared/types";
import { hasHighCoveragePreviewText, inferVisualNeed, looksFormulaOrDiagramHeavy } from "@/shared/ai/routeDecision";
import { getProvider } from "@/shared/utils/parseRouter";
import type { parseQuestion } from "@/shared/utils/parseRouter";
import { splitAnswerParts } from "./answerText";

const INCOMPLETE_SIGNAL_RE =
  /(missing stem|incomplete question|missing options|insufficient options|无法作答|无法判断|无法确定|题干不完整|信息不足)/i;
const LOW_QUALITY_SIGNAL_RE =
  /(missing|incomplete|insufficient|无法|不确定|看不清|题干不完整|信息不足)/i;
const CHOICE_REVIEW_WARNING_RE =
  /(结构化选项结论|需人工确认|无法|不确定|看不清|信息不足|题干不完整|missing|incomplete|insufficient)/i;
const CHOICE_RETRY_WARNING_RE =
  /(需人工确认|结构化选项结论|缺少选项|题干不完整|信息不足|missing|incomplete|insufficient)/i;

export function isLikelyIncompleteStem(result: Awaited<ReturnType<typeof parseQuestion>>): boolean {
  if (result.confidence < 0.45) return true;
  const warningText = `${result.warning ?? ""} ${result.briefExplanation ?? ""}`.toLowerCase();
  return INCOMPLETE_SIGNAL_RE.test(warningText);
}

export function shouldPreferVisionResult(
  textResult: Awaited<ReturnType<typeof parseQuestion>>,
  visionResult: Awaited<ReturnType<typeof parseQuestion>>,
): boolean {
  const confidenceJump = visionResult.confidence - textResult.confidence;
  const textHasStemWarning = isLikelyIncompleteStem(textResult);
  const visionHasStemWarning = isLikelyIncompleteStem(visionResult);
  if (confidenceJump >= 0.15) return true;
  if (textHasStemWarning && !visionHasStemWarning && visionResult.confidence >= 0.5) return true;
  if (textResult.answer === "?" && visionResult.answer !== "?") return true;
  return false;
}

export function shouldForceSecondVisionReview(
  block: QuestionBlock,
  result: Awaited<ReturnType<typeof parseQuestion>>,
): boolean {
  const stem = `${block.previewText || ""}\n${result.recognizedText || ""}`;
  const nonChoiceStem = looksNonChoiceStem(stem);
  if (!nonChoiceStem) return false;
  if (result.confidence < 0.8) return true;
  if (looksLowQualityNonChoiceAnswer(result)) return true;
  return false;
}

export function shouldPreferSecondVisionResult(
  prev: Awaited<ReturnType<typeof parseQuestion>>,
  next: Awaited<ReturnType<typeof parseQuestion>>,
  block: QuestionBlock,
): boolean {
  const prevBad = looksLowQualityNonChoiceAnswer(prev);
  const nextBad = looksLowQualityNonChoiceAnswer(next);
  if (prevBad && !nextBad) return true;
  if (!nextBad && next.confidence - prev.confidence >= 0.05) return true;
  if (
    looksNonChoiceStem(`${block.previewText || ""}\n${next.recognizedText || ""}`)
    && hasStructuredPoints(next.answer || next.detailedExplanation || "")
  ) {
    if (!hasStructuredPoints(prev.answer || prev.detailedExplanation || "")) return true;
  }
  return false;
}

export function looksLowQualityNonChoiceAnswer(result: Awaited<ReturnType<typeof parseQuestion>>): boolean {
  const answer = String(result.answer || "").trim();
  const brief = String(result.briefExplanation || "");
  const warning = String(result.warning || "");
  const longNarrative = answer.length > 90 && !hasStructuredPoints(answer);
  const uncertain = LOW_QUALITY_SIGNAL_RE.test(`${brief}\n${warning}\n${answer}`);
  const optionSet = /^[A-D](?:\s*[,，、]\s*[A-D])+$/.test(answer);
  if (optionSet) return true;
  if (longNarrative && uncertain) return true;
  return false;
}

export function extractChoiceKeysFromResultAnswer(answer: string): string[] {
  const letters = String(answer || "").toUpperCase().match(/[A-F]/g) || [];
  return Array.from(new Set(letters.filter((letter) => letter >= "A" && letter <= "F"))).sort();
}

export function normalizeJudgeAnswer(answer: string): "对" | "错" | null {
  const normalized = String(answer || "").trim().toLowerCase();
  if (!normalized) return null;
  if (["对", "正确", "true", "t", "yes", "y"].includes(normalized)) return "对";
  if (["错", "错误", "false", "f", "no", "n"].includes(normalized)) return "错";
  return null;
}

export function isChoiceLikeQuestionType(questionType: ParseResult["questionType"]): boolean {
  return questionType === "single_choice" || questionType === "multi_choice" || questionType === "judge";
}

export function isStableChoiceParseResult(result: ParseResult): boolean {
  if (!isChoiceLikeQuestionType(result.questionType)) return true;
  if (String(result.answer || "").trim() === "需人工确认") return false;

  const warningText = `${result.warning ?? ""}\n${result.briefExplanation ?? ""}`.toLowerCase();
  if (CHOICE_REVIEW_WARNING_RE.test(warningText)) {
    return false;
  }

  if (result.questionType === "judge") {
    return normalizeJudgeAnswer(result.answer) !== null;
  }

  const selectedKeys = Object.entries(result.optionSelections || {})
    .filter(([, value]) => value === true)
    .map(([key]) => key)
    .sort();
  const answerKeys = extractChoiceKeysFromResultAnswer(result.answer);
  if (!selectedKeys.length || !answerKeys.length) return false;
  if (selectedKeys.length !== answerKeys.length) return false;
  if (!answerKeys.every((key, index) => selectedKeys[index] === key)) return false;
  if (result.questionType === "single_choice" && selectedKeys.length !== 1) return false;
  return true;
}

export function shouldRetryUnstableChoiceParse(result: ParseResult): boolean {
  if (!isChoiceLikeQuestionType(result.questionType) || isStableChoiceParseResult(result)) return false;

  const answer = String(result.answer || "").trim();
  const warningText = `${result.warning ?? ""}\n${result.briefExplanation ?? ""}`.toLowerCase();
  if (
    !answer
    || answer === "?"
    || answer === "需人工确认"
    || (result.confidence ?? 0) < 0.6
    || CHOICE_RETRY_WARNING_RE.test(warningText)
  ) {
    return true;
  }

  if (result.questionType === "judge") return false;

  const selectedKeys = Object.entries(result.optionSelections || {})
    .filter(([, value]) => value === true)
    .map(([key]) => key);
  const answerKeys = extractChoiceKeysFromResultAnswer(answer);
  return !selectedKeys.length || !answerKeys.length;
}

export function shouldPersistAutoSolveParseResult(result: ParseResult): boolean {
  if (!isChoiceLikeQuestionType(result.questionType)) return true;
  return isStableChoiceParseResult(result);
}

export function looksNonChoiceStem(text: string): boolean {
  return /(\(\s*1\s*\)|（\s*1\s*）|请根据图回答|填空|____|________|简答|分析)/.test(String(text || ""));
}

export function hasStructuredPoints(text: string): boolean {
  const normalized = String(text || "");
  return /(\(\s*\d+\s*\)|（\s*\d+\s*）|[①②③④⑤⑥])/u.test(normalized);
}

export function buildAutoSolveReviewSettings<T extends { providerId: string; apiModel: string }>(
  settings: T,
): T & { apiModel: string; preferredRoute: "auto" } {
  const reviewModel = pickAutoSolveReviewModel(settings.providerId, settings.apiModel);
  return {
    ...settings,
    apiModel: reviewModel,
    preferredRoute: "auto" as const,
  };
}

export function pickAutoSolveReviewModel(providerId: string, currentModel: string): string {
  const current = String(currentModel || "").trim();
  const provider = getProvider(providerId);
  const preferredByProvider: Partial<Record<string, string>> = {
    anthropic: "claude-opus-4.8",
    openai: "gpt-5.5",
    gemini: "gemini-2.5-pro",
    qwen: "qwen3-vl-plus",
    zhipu: "glm-5v-turbo",
    minimax: "MiniMax-M3",
    ollama: "qwen3-vl",
  };
  const preferred = preferredByProvider[provider.id] || provider.defaultModel;
  if (provider.models.includes(preferred) && preferred !== current) return preferred;
  if (provider.defaultModel && provider.defaultModel !== current) return provider.defaultModel;
  return current || provider.defaultModel;
}

export function getAutoSolveFingerprint(block: QuestionBlock): string {
  if (block.identity?.stableId) return `stable:${block.identity.stableId}`;
  const order = extractAutoSolveQuestionOrder(block.previewText || "");
  const approxTop = Math.round((block.bbox?.y ?? 0) / 24);
  const approxHeight = Math.round((block.bbox?.height ?? 0) / 24);
  const idPart = String(block.id || "").slice(0, 80);
  return [
    order ? `q${order}` : "",
    idPart,
    `top${approxTop}`,
    `h${approxHeight}`,
    getAutoSolveTextFingerprint(block.previewText || ""),
  ].filter(Boolean).join("|");
}

export function extractAutoSolveQuestionOrder(text: string): number | null {
  const normalized = normalizeQuestionText(text || "");
  const match = normalized.match(/^(\d{1,3})\s*[\.。、，]/);
  if (!match) return null;
  const order = Number(match[1]);
  return Number.isFinite(order) && order > 0 ? order : null;
}

export function inferAutoSolveQuestionType(text: string): QuestionType {
  const normalized = normalizeQuestionText(text || "");
  if (/(判断题|是非题|判断|对错|正确|错误|true|false)/i.test(normalized)) return "judge";
  if (/(填空题|_{3,}|﹍{2,})/.test(normalized)) return "fill_blank";
  if (/多选题/.test(normalized)) return "multi_choice";
  if (/单选题/.test(normalized)) return "single_choice";
  const optionCount = (normalized.match(/(?:^|\n)\s*[A-F][\.\):：、]/g) || []).length;
  if (optionCount >= 4) return "single_choice";
  if (optionCount >= 2) return "multi_choice";
  return "unknown";
}

export function shouldUseVisionForAutoSolve(
  block: QuestionBlock,
  preferredRoute: "auto" | "text" | "vision",
): boolean {
  const visualNeed = inferVisualNeed(block);
  if (visualNeed === "strong") return true;

  const preview = normalizeQuestionText(block.previewText || "");
  const highCoverage = hasHighCoveragePreviewText(preview, block.questionTypeGuess);
  if (looksFormulaOrDiagramHeavy(preview) && !highCoverage) return true;
  if (preferredRoute === "vision" && visualNeed === "possible") return true;
  return false;
}

export function getAutoSolveTextFingerprint(text: string): string {
  return normalizeQuestionText(text || "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9\-_=]/g, "")
    .slice(0, 120);
}

export function isSameAutoSolveQuestion(a: string, b: string): boolean {
  const left = getAutoSolveTextFingerprint(a);
  const right = getAutoSolveTextFingerprint(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 24 && right.length >= 24 && (left.includes(right) || right.includes(left))) {
    return true;
  }

  const minLen = Math.min(left.length, right.length);
  let prefix = 0;
  while (prefix < minLen && left[prefix] === right[prefix]) prefix += 1;
  return prefix >= Math.max(20, Math.floor(minLen * 0.72));
}

export function shouldStopAutoSolveAtTail(currentOrder: number | null, total: number): boolean {
  return total > 0 && currentOrder !== null && currentOrder >= total;
}

export function looksMathHeavyForAuto(text: string): boolean {
  const normalized = String(text || "");
  if (!normalized) return false;
  return /(g\(s\)|h\(s\)|g\(j|h\(j|f\(x\)|\bkv\b|s\^|\/|=\s*0|jw|nyquist|根轨迹|奈奎斯特|伯德图|图中|下图|上图)/i.test(normalized);
}

export function shouldRetryWithVisionForAuto(
  result: Awaited<ReturnType<typeof parseQuestion>>,
  block: QuestionBlock,
): boolean {
  if ((result.confidence ?? 0) < 0.5) return true;
  const summary = `${result.warning ?? ""} ${result.briefExplanation ?? ""}`.toLowerCase();
  if (/(missing options|incomplete|无法判断|无法确定|无法作答|选项缺失)/i.test(summary)) return true;

  if (
    (block.questionTypeGuess === "single_choice" || block.questionTypeGuess === "multi_choice")
    && !/^[A-F](?:\s*[,，、]\s*[A-F])*$/i.test(String(result.answer || "").trim())
  ) {
    return true;
  }

  if (block.questionTypeGuess === "judge" && normalizeJudgeAnswer(String(result.answer || "")) === null) {
    return true;
  }

  if (block.questionTypeGuess === "fill_blank") {
    const expectedParts = countExpectedBlankParts(block.previewText || "");
    const actualParts = splitAnswerParts(String(result.answer || ""), Math.max(expectedParts, 1)).length;
    if (expectedParts > 1 && actualParts < expectedParts) return true;
  }

  return false;
}

export function countExpectedBlankParts(text: string): number {
  const normalized = String(text || "");
  const decimalLabels = normalized.match(/\d+\.\d+/g) || [];
  if (decimalLabels.length) return new Set(decimalLabels).size;
  const indexedLabels = normalized.match(/[（(]?\d+[)）]/g) || [];
  if (indexedLabels.length) return new Set(indexedLabels).size;
  const blankMarkers = normalized.match(/_{3,}|﹍{2,}/g) || [];
  return blankMarkers.length;
}

export function findReusableHistoryEntry(
  history: HistoryEntry[],
  block: QuestionBlock,
  hostname: string,
): HistoryEntry | null {
  for (const entry of history) {
    if (entry.host && entry.host !== hostname) continue;
    if (!shouldPersistAutoSolveParseResult(entry.result)) continue;
    if (block.identity?.stableId && entry.block.identity?.stableId === block.identity.stableId) return entry;
    if (
      block.identity?.contentFingerprint
      && entry.block.identity?.contentFingerprint === block.identity.contentFingerprint
    ) return entry;
    if (isSameAutoSolveQuestion(block.previewText || "", entry.block.previewText || "")) return entry;
    if (isSameAutoSolveQuestion(block.previewText || "", entry.result.recognizedText || "")) return entry;
  }
  return null;
}

function normalizeQuestionText(raw: string): string {
  return String(raw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
