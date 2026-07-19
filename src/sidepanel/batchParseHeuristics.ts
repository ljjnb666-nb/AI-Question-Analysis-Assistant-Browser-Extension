import type { DetectedCandidate, ParseResult, QuestionBlock } from "@/shared/types";
import { getProvider } from "@/shared/utils/parseRouter";
import type { ProviderId } from "@/shared/utils/parseRouter";

const INCOMPLETE_HINT_PATTERN = /(选项缺失|无法判断|无法确定|无法作答|missing options|incomplete)/i;
const RETRYABLE_ERROR_PATTERN = /(timed out|timeout|network request failed|failed to fetch|网络请求失败|截图失败|服务暂时不可用)/i;
const PARSE_FAILURE_PATTERN = /(解析提取失败|已通过容错模式提取解析结果|需人工确认)/;
const PLACEHOLDER_ANSWER_PATTERN = /^(?:—|--|待确认|需人工确认|解析提取失败|未提取到稳定答案)$/;
const JUDGE_ANSWER_PATTERN = /^(对|错|正确|错误|true|false)$/i;

export function isChoiceLikeResult(block: QuestionBlock, result: ParseResult): boolean {
  const resultType = result.questionType;
  if (resultType === "single_choice" || resultType === "multi_choice" || resultType === "judge") return true;
  const guess = block.questionTypeGuess;
  return guess === "single_choice" || guess === "multi_choice" || guess === "judge";
}

export function isRiskyCandidate(cand: DetectedCandidate): boolean {
  if (cand.status === "error") return true;
  if (cand.status !== "success" || !cand.result) return false;
  if ((cand.result.confidence ?? 0) < 0.72) return true;
  return shouldRetryWithVision(cand.result);
}

export function shouldRetryWithVision(result: ParseResult): boolean {
  if ((result.confidence ?? 0) < 0.5) return true;
  const summary = `${result.warning ?? ""} ${result.briefExplanation ?? ""}`.toLowerCase();
  return INCOMPLETE_HINT_PATTERN.test(summary);
}

export function preferVisionResult(textResult: ParseResult, visionResult: ParseResult): boolean {
  const confidenceJump = (visionResult.confidence ?? 0) - (textResult.confidence ?? 0);
  if (confidenceJump >= 0.12) return true;

  const textSummary = `${textResult.warning ?? ""} ${textResult.briefExplanation ?? ""}`;
  const visionSummary = `${visionResult.warning ?? ""} ${visionResult.briefExplanation ?? ""}`;
  const textBad = INCOMPLETE_HINT_PATTERN.test(textSummary);
  const visionBad = INCOMPLETE_HINT_PATTERN.test(visionSummary);
  return textBad && !visionBad;
}

export function pickBatchReviewModel(providerId: string, currentModel: string): string {
  const current = String(currentModel || "").trim();
  const provider = getProvider(providerId);
  const preferredByProvider: Partial<Record<ProviderId, string>> = {
    anthropic: "claude-opus-4.8",
    openai: "gpt-5.5",
    gemini: "gemini-2.5-pro",
    qwen: "qwen3-vl-plus",
    zhipu: "glm-5v-turbo",
    minimax: "MiniMax-M3",
    ollama: "qwen3-vl",
    custom: provider.defaultModel,
  };

  const preferred = preferredByProvider[provider.id] || provider.defaultModel;
  if (preferred && provider.models.includes(preferred) && preferred !== current) return preferred;
  if (provider.defaultModel && provider.defaultModel !== current) return provider.defaultModel;
  return current || provider.defaultModel;
}

export function shouldRetryBatchParseAfterError(err: unknown): boolean {
  const message = String(err instanceof Error ? err.message : err || "").toLowerCase();
  if (!message) return false;
  return RETRYABLE_ERROR_PATTERN.test(message);
}

export function shouldRetryBatchParseForIncompleteResult(result: ParseResult, block: QuestionBlock): boolean {
  if ((result.confidence ?? 0) < 0.86) return true;
  if (looksLikePlaceholderResolvedAnswer(result.answer)) return true;
  if (PARSE_FAILURE_PATTERN.test(`${result.briefExplanation} ${result.detailedExplanation}`)) return true;

  const answer = String(result.answer || "").trim();
  if (
    (block.questionTypeGuess === "single_choice" || block.questionTypeGuess === "multi_choice") &&
    !/^[A-F](?:\s*[,\uFF0C\u3001/|]\s*[A-F])*$/i.test(answer)
  ) {
    return true;
  }

  if (block.questionTypeGuess === "judge" && !JUDGE_ANSWER_PATTERN.test(answer)) {
    return true;
  }

  return false;
}

export function preferBatchRetryResult(firstResult: ParseResult, retryResult: ParseResult, block: QuestionBlock): boolean {
  const firstBad = shouldRetryBatchParseForIncompleteResult(firstResult, block);
  const retryBad = shouldRetryBatchParseForIncompleteResult(retryResult, block);
  if (firstBad && !retryBad) return true;
  if (!firstBad && retryBad) return false;
  return (retryResult.confidence ?? 0) >= (firstResult.confidence ?? 0) + 0.04;
}

export function looksLikePlaceholderResolvedAnswer(answer: string): boolean {
  const normalized = String(answer || "").replace(/\s+/g, "");
  if (!normalized) return true;
  return PLACEHOLDER_ANSWER_PATTERN.test(normalized);
}

export function looksMathHeavy(text: string): boolean {
  const value = String(text || "");
  if (!value) return false;
  return /(g\(s\)|h\(s\)|g\(j|h\(j|f\(x\)|\bkv\b|s\^|\/|=\s*0|jω|jw|ω|ζ|传递函数|积分环节|稳态误差|奈奎斯特|伯德图|如图|图中|下图|上图)/i.test(value);
}

export function langSafe(lang: "zh" | "en" | undefined, zh: string, en: string): string {
  return lang === "en" ? en : zh;
}
