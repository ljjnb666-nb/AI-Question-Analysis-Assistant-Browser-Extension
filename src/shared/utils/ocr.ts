/**
 * OCR Utilities (M5)
 * Uses Tesseract.js (loaded via CDN worker) for in-browser OCR.
 * Falls back gracefully if Tesseract isn't available.
 */

import { logError } from "./errorLogger";

export interface OcrResult {
  text: string;
  confidence: number; // 0–100
  hasImage: boolean;
}

/**
 * Simple heuristic: check if the cropped image looks like it contains
 * non-text visual elements (charts, geometry, tables).
 * Uses pixel variance sampling — high variance in unexpected areas → likely image content.
 */
export async function analyzeImageContent(dataUrl: string): Promise<{
  hasComplexVisual: boolean;
  ocrQualityEstimate: number;
}> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const W = Math.min(img.naturalWidth, 200);
      const H = Math.min(img.naturalHeight, 200);
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve({ hasComplexVisual: false, ocrQualityEstimate: 0.7 }); return; }

      ctx.drawImage(img, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H).data;

      // Sample pixel brightness variance
      let sum = 0, sumSq = 0;
      const samples = Math.min(data.length / 4, 2000);
      for (let i = 0; i < samples; i++) {
        const idx = Math.floor((i / samples) * (data.length / 4)) * 4;
        const brightness = (data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114) / 255;
        sum += brightness;
        sumSq += brightness * brightness;
      }
      const mean = sum / samples;
      const variance = sumSq / samples - mean * mean;

      // High variance suggests complex visual content (images, charts)
      const hasComplexVisual = variance > 0.08;
      // Estimate text quality: medium variance is best for text
      const ocrQualityEstimate = variance < 0.02 ? 0.3 : variance > 0.15 ? 0.5 : 0.85;

      resolve({ hasComplexVisual, ocrQualityEstimate });
    };
    img.onerror = (err) => {
      logError("Failed to load image for analysis", err, "analyzeImageContent");
      resolve({ hasComplexVisual: false, ocrQualityEstimate: 0.5 });
    };
    img.src = dataUrl;
  });
}

/**
 * Extract text keywords that suggest image/visual content.
 */
export function detectVisualKeywords(text: string): boolean {
  const keywords = [
    "如图所示", "根据下表", "观察图像", "如图", "图中",
    "下图", "上图", "表格", "坐标", "函数图",
    "电路图", "几何", "according to the figure", "shown in"
  ];
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}
