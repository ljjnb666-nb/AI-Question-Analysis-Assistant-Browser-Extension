import type { AppSettings, QuestionBlock, RouteUsed } from "../types";
import { getProvider } from "./providers";
import { analyzeImageContent, detectVisualKeywords } from "../utils/ocr";
import { buildPreferredQuestionText } from "./questionPromptText";

type VisualNeed = "none" | "possible" | "strong";

const STRONG_VISUAL_PATTERNS = [
  /如图/,
  /下图/,
  /上图/,
  /图中/,
  /图示/,
  /根据图/,
  /观察图像/,
  /看图回答/,
  /示意图/,
  /流程图/,
  /电路图/,
  /几何图/,
  /函数图像/,
  /波形图/,
  /坐标图/,
  /表格/,
  /根轨迹/,
  /奈奎斯特/,
  /伯德图/,
  /nyquist/i,
  /bode/i,
];

const WEAK_VISUAL_PATTERNS = [
  /图像/,
  /曲线/,
  /波形/,
  /电路/,
  /几何/,
  /函数/,
  /示波/,
  /坐标/,
  /图表/,
  /diagram/i,
  /figure/i,
  /chart/i,
];

const JUDGE_PATTERNS = /(判断题|是非题|对错|正确|错误|true|false)/i;
const FILL_BLANK_PATTERNS = /(填空|____|_{3,}|﹍{2,}|_{2,})/;
const MULTI_PART_PATTERNS = /(\(\s*\d+\s*\)|（\s*\d+\s*）)/;
const OPTION_PATTERNS = /(?:^|\s)([A-F])[\.\):：、]/g;
const FORMULA_PATTERNS = /(g\(s\)|h\(s\)|g\(j|h\(j|f\(x\)|jw|σ|theta|λ|μ|∑|∫|∞|\/|=\s*0|s\^|nyquist|bode|根轨迹|奈奎斯特|伯德图)/i;

export async function decideRoute(block: QuestionBlock, settings: AppSettings): Promise<RouteUsed> {
  const provider = getProvider(settings.providerId ?? "anthropic");
  const questionText = buildPreferredQuestionText(block);
  if (settings.preferredRoute !== "auto") {
    if (!provider.supportsVision) return "text";
    return settings.preferredRoute;
  }

  if (!provider.supportsVision) return "text";

  const visualNeed = inferVisualNeed(block);
  const textSufficient = hasSufficientPreviewText(questionText, block.questionTypeGuess);
  const highCoverage = hasHighCoveragePreviewText(questionText, block.questionTypeGuess);
  const mathHeavy = looksFormulaOrDiagramHeavy(questionText);

  if (visualNeed === "strong") {
    if (block.imageDataUrl) return "vision";
    return "hybrid";
  }

  if (block.imageDataUrl) {
    if (mathHeavy && !highCoverage) return "vision";
    if (!textSufficient) {
      const analysis = await safelyAnalyzeImage(block.imageDataUrl);
      if (analysis?.hasComplexVisual) return "vision";
      if ((analysis?.ocrQualityEstimate ?? 0.5) < 0.45) return "hybrid";
      return "hybrid";
    }
    if (visualNeed === "possible") return mathHeavy ? "hybrid" : "text";
    return mathHeavy ? "hybrid" : "text";
  }

  if (block.hasImage) {
    if (!textSufficient) return "hybrid";
    return mathHeavy && !highCoverage ? "hybrid" : "text";
  }

  if (visualNeed === "possible") {
    return textSufficient ? "text" : "hybrid";
  }

  if (mathHeavy && !highCoverage) return "hybrid";
  return "text";
}

export function hasSufficientPreviewText(text?: string, questionTypeGuess?: QuestionBlock["questionTypeGuess"]): boolean {
  const normalized = normalizePreviewText(text);
  if (!normalized) return false;

  const optionCount = countChoiceOptions(normalized);
  const isJudge = questionTypeGuess === "judge" || JUDGE_PATTERNS.test(normalized);
  const isFillBlank = questionTypeGuess === "fill_blank" || FILL_BLANK_PATTERNS.test(normalized);
  const isMultiPart = MULTI_PART_PATTERNS.test(normalized);

  if (normalized.length >= 160) return true;
  if (optionCount >= 4 && normalized.length >= 48) return true;
  if (isJudge && normalized.length >= 18 && /(对|错|true|false)/i.test(normalized)) return true;
  if (isFillBlank && normalized.length >= 28) return true;
  if (isMultiPart && normalized.length >= 40) return true;
  return normalized.length >= 90;
}

export function hasHighCoveragePreviewText(text?: string, questionTypeGuess?: QuestionBlock["questionTypeGuess"]): boolean {
  const normalized = normalizePreviewText(text);
  if (!normalized) return false;

  const optionCount = countChoiceOptions(normalized);
  const isJudge = questionTypeGuess === "judge" || JUDGE_PATTERNS.test(normalized);
  const isFillBlank = questionTypeGuess === "fill_blank" || FILL_BLANK_PATTERNS.test(normalized);
  const isMultiPart = MULTI_PART_PATTERNS.test(normalized);

  if (normalized.length >= 260) return true;
  if (optionCount >= 4 && normalized.length >= 90) return true;
  if (isJudge && normalized.length >= 26 && /(对|错|true|false)/i.test(normalized)) return true;
  if (isFillBlank && normalized.length >= 60) return true;
  if (isMultiPart && normalized.length >= 72) return true;
  return normalized.length >= 130;
}

export function inferVisualNeed(block: Pick<QuestionBlock, "previewText" | "hasImage" | "imageDataUrl" | "questionTypeGuess">): VisualNeed {
  const normalized = normalizePreviewText(block.previewText);
  if (block.imageDataUrl && !normalized) return "strong";
  if (STRONG_VISUAL_PATTERNS.some((pattern) => pattern.test(normalized))) return "strong";
  if (block.hasImage && !hasSufficientPreviewText(normalized, block.questionTypeGuess)) return "strong";
  if (detectVisualKeywords(normalized)) return "possible";
  if (WEAK_VISUAL_PATTERNS.some((pattern) => pattern.test(normalized))) return "possible";
  if (block.hasImage || block.imageDataUrl) return "possible";
  return "none";
}

export function looksFormulaOrDiagramHeavy(text?: string): boolean {
  const normalized = normalizePreviewText(text);
  return FORMULA_PATTERNS.test(normalized);
}

function normalizePreviewText(text?: string): string {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countChoiceOptions(text: string): number {
  return Array.from(text.matchAll(OPTION_PATTERNS)).length;
}

async function safelyAnalyzeImage(dataUrl: string): Promise<Awaited<ReturnType<typeof analyzeImageContent>> | null> {
  try {
    return await analyzeImageContent(dataUrl);
  } catch {
    return null;
  }
}
