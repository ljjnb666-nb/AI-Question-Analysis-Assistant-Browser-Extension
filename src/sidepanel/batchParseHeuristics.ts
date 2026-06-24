import type { DetectedCandidate, ParseResult, QuestionBlock } from "@/shared/types";
import { getProvider } from "@/shared/utils/parseRouter";
import type { ProviderId } from "@/shared/utils/parseRouter";

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
  const s = `${result.warning ?? ""} ${result.briefExplanation ?? ""}`.toLowerCase();
  return /(选项缺失|无法判断|无法确定|无法作答|missing options|incomplete)/i.test(s);
}

export function preferVisionResult(textResult: ParseResult, visionResult: ParseResult): boolean {
  const jump = (visionResult.confidence ?? 0) - (textResult.confidence ?? 0);
  if (jump >= 0.12) return true;
  const t = `${textResult.warning ?? ""} ${textResult.briefExplanation ?? ""}`;
  const v = `${visionResult.warning ?? ""} ${visionResult.briefExplanation ?? ""}`;
  const textBad = /(选项缺失|无法判断|无法确定|无法作答|missing options|incomplete)/i.test(t);
  const visionBad = /(选项缺失|无法判断|无法确定|无法作答|missing options|incomplete)/i.test(v);
  return textBad && !visionBad;
}

export function pickBatchReviewModel(providerId: string, currentModel: string): string {
  const current = String(currentModel || "").trim();
  const provider = getProvider(providerId);
  const preferredByProvider: Partial<Record<ProviderId, string>> = {
    anthropic: "claude-opus-4-5",
    openai: "gpt-4o",
    gemini: "gemini-1.5-pro",
    qwen: "qwen-vl-max",
    zhipu: "glm-4v-plus",
    minimax: "MiniMax-M3",
    ollama: "qwen2.5-vl",
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
  return /(timed out|timeout|network request failed|failed to fetch|网络请求失败|截图失败|服务暂时不可用)/i.test(message);
}

export function shouldRetryBatchParseForIncompleteResult(result: ParseResult, block: QuestionBlock): boolean {
  if ((result.confidence ?? 0) < 0.86) return true;
  if (looksLikePlaceholderResolvedAnswer(result.answer)) return true;
  if (/(解析提取失败|已通过容错模式提取解析结果|需人工确认)/.test(`${result.briefExplanation} ${result.detailedExplanation}`)) return true;

  const answer = String(result.answer || "").trim();
  if ((block.questionTypeGuess === "single_choice" || block.questionTypeGuess === "multi_choice") && !/^[A-F](?:\s*[,\uFF0C\u3001/|]\s*[A-F])*$/i.test(answer)) {
    return true;
  }
  if (block.questionTypeGuess === "judge" && !/^(对|错|正确|错误|true|false)$/i.test(answer)) {
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
  return /^(?:—|-|--|待确认|需人工确认|解析提取失败|未提取到稳定答案)$/.test(normalized);
}

export function looksMathHeavy(text: string): boolean {
  const t = String(text || "");
  if (!t) return false;
  return /(g\(s\)|h\(s\)|g\(j|h\(j|f\(x\)|\bkv\b|s\^|\/|=\s*0|jω|jw|ω|σ|∫|Σ|√|传递函数|积分环节|稳态误差|奈奎斯特|伯德图|如图|图中|下图|上图)/i.test(t);
}

export function langSafe(lang: "zh" | "en" | undefined, zh: string, en: string): string {
  return lang === "en" ? en : zh;
}
