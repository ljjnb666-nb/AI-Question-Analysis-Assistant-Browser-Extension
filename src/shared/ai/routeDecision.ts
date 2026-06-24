import type { AppSettings, QuestionBlock, RouteUsed } from "../types";
import { getProvider } from "./providers";
import { analyzeImageContent, detectVisualKeywords } from "../utils/ocr";

export async function decideRoute(block: QuestionBlock, settings: AppSettings): Promise<RouteUsed> {
  const provider = getProvider(settings.providerId ?? "anthropic");
  if (settings.preferredRoute !== "auto") {
    if (!provider.supportsVision) return "text";
    return settings.preferredRoute;
  }
  if (!provider.supportsVision) return "text";
  if (block.imageDataUrl) return "vision";
  if (block.hasImage) {
    return hasSufficientPreviewText(block.previewText) ? "text" : "hybrid";
  }
  if (block.previewText && detectVisualKeywords(block.previewText)) {
    return hasSufficientPreviewText(block.previewText) ? "text" : "hybrid";
  }
  if (block.imageDataUrl) {
    const { hasComplexVisual, ocrQualityEstimate } = await analyzeImageContent(block.imageDataUrl);
    if (hasComplexVisual) return "vision";
    if (ocrQualityEstimate < 0.4) return "hybrid";
  }
  return "text";
}

export function hasSufficientPreviewText(text?: string): boolean {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (t.length >= 100) return true;
  if (/\(\s*1\s*\)|（\s*1\s*）|A[、.．]|B[、.．]|C[、.．]|D[、.．]/.test(t) && t.length >= 100) {
    return true;
  }
  return false;
}
