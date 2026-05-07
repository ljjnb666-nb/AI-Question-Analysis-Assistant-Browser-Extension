/**
 * Full Page Detector (V2)
 * Scrolls the entire page from top to bottom, capturing question candidates
 * at each viewport position. Deduplicates across scroll positions.
 * Reports progress to the side panel via chrome.runtime.sendMessage.
 */

import type { QuestionBlock } from "@/shared/types";
import { detectCandidatesInViewport } from "./domDetector";

// ─── Config ───────────────────────────────────────────────────────────────────

const SCROLL_STEP_PX = 600;         // px to scroll per step (slightly less than viewport)
const SCROLL_PAUSE_MS = 300;        // wait after each scroll for content to render
const MAX_SCROLL_STEPS = 200;       // safety cap (~120,000px page max)
const OVERLAP_RATIO_THRESHOLD = 0.4;

// ─── State ────────────────────────────────────────────────────────────────────

let running = false;
let cancelled = false;

export function isFullPageScanRunning(): boolean {
  return running;
}

export function cancelFullPageScan(): void {
  cancelled = true;
}

// ─── Progress callback type ───────────────────────────────────────────────────

export interface ScanProgress {
  progress: number;      // 0–100
  found: number;
  currentStep: number;
  totalScrollSteps: number;
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function detectCandidatesFullPage(
  onProgress: (p: ScanProgress) => void,
): Promise<QuestionBlock[]> {
  if (running) return [];
  running = true;
  cancelled = false;

  const originalScrollY = window.scrollY;
  const allBlocks: QuestionBlock[] = [];

  // Scroll to top first
  window.scrollTo({ top: 0, behavior: "instant" });
  await pause(SCROLL_PAUSE_MS);

  const totalHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
  );
  const viewportH = window.innerHeight;
  const totalSteps = Math.min(
    Math.ceil((totalHeight - viewportH) / SCROLL_STEP_PX) + 1,
    MAX_SCROLL_STEPS,
  );

  let step = 0;

  while (!cancelled) {
    // Detect at current scroll position
    const viewport_blocks = detectCandidatesInViewport();

    for (const block of viewport_blocks) {
      // Convert viewport coords to page-absolute coords
      const absoluteBlock = toAbsoluteCoords(block);
      const normalizedPreview = normalizePreviewText(absoluteBlock.previewText);
      if (!isLikelyUsefulPreview(normalizedPreview, absoluteBlock.questionTypeGuess)) continue;
      const normalizedBlock: QuestionBlock = {
        ...absoluteBlock,
        previewText: normalizedPreview.slice(0, 420),
      };
      upsertCandidate(allBlocks, normalizedBlock);
    }

    step++;
    const progress = Math.min(Math.round((step / totalSteps) * 100), 99);
    onProgress({ progress, found: allBlocks.length, currentStep: step, totalScrollSteps: totalSteps });

    // Check if we've reached the bottom
    const currentBottom = window.scrollY + viewportH;
    if (currentBottom >= totalHeight - 10) break;
    if (step >= MAX_SCROLL_STEPS) break;

    // Scroll down one step
    window.scrollBy({ top: SCROLL_STEP_PX, behavior: "instant" });
    await pause(SCROLL_PAUSE_MS);
  }

  // Restore original scroll position
  window.scrollTo({ top: originalScrollY, behavior: "instant" });

  running = false;

  if (cancelled) return allBlocks;

  // Final post-process and sort by absolute Y position (top-to-bottom page order)
  const filtered = postProcessCandidates(allBlocks).sort((a, b) => a.bbox.y - b.bbox.y);

  // Re-number IDs sequentially
  return filtered.map((b, i) => ({
    ...b,
    id: `fullpage-${Date.now()}-${i}`,
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a viewport-relative block to page-absolute coordinates */
function toAbsoluteCoords(block: QuestionBlock): QuestionBlock {
  return {
    ...block,
    bbox: {
      x: block.bbox.x + window.scrollX,
      y: block.bbox.y + window.scrollY,
      width: block.bbox.width,
      height: block.bbox.height,
    },
  };
}

function overlapRatio(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function upsertCandidate(target: QuestionBlock[], block: QuestionBlock): void {
  const idx = target.findIndex((existing) => isLikelySameQuestion(existing, block));
  if (idx < 0) {
    target.push(block);
    return;
  }
  const prev = target[idx];
  if (candidateRank(block) > candidateRank(prev)) {
    target[idx] = block;
  }
}

function postProcessCandidates(blocks: QuestionBlock[]): QuestionBlock[] {
  const byRank = [...blocks].sort((a, b) => candidateRank(b) - candidateRank(a));
  const kept: QuestionBlock[] = [];
  const fingerprintSet = new Set<string>();

  for (const block of byRank) {
    const text = normalizePreviewText(block.previewText);
    if (!isLikelyUsefulPreview(text, block.questionTypeGuess)) continue;

    const fp = textFingerprint(text);
    if (fp.length >= 28 && fingerprintSet.has(fp)) continue;

    const isDuplicate = kept.some((k) => isLikelySameQuestion(k, block));
    if (isDuplicate) continue;

    kept.push({ ...block, previewText: text.slice(0, 420) });
    if (fp.length >= 28) fingerprintSet.add(fp);
  }

  return kept;
}

function isLikelySameQuestion(a: QuestionBlock, b: QuestionBlock): boolean {
  if (overlapRatio(a.bbox, b.bbox) > OVERLAP_RATIO_THRESHOLD) return true;

  const closeBy =
    Math.abs(a.bbox.x - b.bbox.x) < 140 &&
    Math.abs(a.bbox.y - b.bbox.y) < 260;
  if (!closeBy) return false;

  const ta = normalizePreviewText(a.previewText);
  const tb = normalizePreviewText(b.previewText);
  if (!ta || !tb) return false;

  if (textFingerprint(ta) === textFingerprint(tb)) return true;
  return textSimilarity(ta, tb) > 0.86;
}

function candidateRank(block: QuestionBlock): number {
  const text = normalizePreviewText(block.previewText);
  const len = text.length;
  const optionCount = (text.match(/[A-D][\.\):\uFF1A\u3001]/g) || []).length;
  const circledCount = (text.match(/[\u2460\u2461\u2462\u2463]/g) || []).length;
  const hasQuestion = /[?\uFF1F]/.test(text);
  let rank = (block.confidence ?? 0) * 100;
  rank += Math.min(optionCount + circledCount, 6) * 8;
  if (hasQuestion) rank += 10;
  if (len >= 80 && len <= 650) rank += 12;
  if (len > 900) rank -= 20;
  if ((block.questionTypeGuess === "single_choice" || block.questionTypeGuess === "multi_choice") && optionCount + circledCount >= 4) {
    rank += 12;
  }
  return rank;
}

function normalizePreviewText(raw: string): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyUsefulPreview(text: string, questionType: QuestionBlock["questionTypeGuess"]): boolean {
  if (!text) return false;
  const controlPanelLike = /试题检索|教材版本|题型|难易度|按章节|按知识点|试题篮|组卷预览|登录|注册/.test(text);
  if (controlPanelLike) return false;
  if (text.length < 28) {
    const shortJudgeLike = (questionType === "judge" || questionType === "unknown")
      && text.length >= 12
      && !/[A-D][\.\):\uFF1A\u3001]/.test(text)
      && /[。！？.!?\)）]$/.test(text);
    if (!shortJudgeLike) return false;
  }
  if (/^(?:[A-D][\.\):\uFF1A\u3001]?|[\u2460\u2461\u2462\u2463])/.test(text)) return false;

  const optionCount = (text.match(/[A-D][\.\):\uFF1A\u3001]/g) || []).length;
  const circledCount = (text.match(/[\u2460\u2461\u2462\u2463]/g) || []).length;
  const optionLike = optionCount + circledCount;
  const looksChoice = questionType === "single_choice" || questionType === "multi_choice" || optionLike >= 3;
  const hasABCD = /A[\.\):\uFF1A\u3001][\s\S]*B[\.\):\uFF1A\u3001][\s\S]*C[\.\):\uFF1A\u3001][\s\S]*D[\.\):\uFF1A\u3001]/.test(text);

  if (looksChoice && optionLike < 4) return false;
  if (looksChoice && !hasABCD && circledCount < 4) return false;
  return true;
}

function textFingerprint(text: string): string {
  return text
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "")
    .slice(0, 96);
}

function textSimilarity(a: string, b: string): number {
  const setA = makeBigramSet(a);
  const setB = makeBigramSet(b);
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const item of setA) if (setB.has(item)) inter++;
  return inter / Math.max(setA.size, setB.size);
}

function makeBigramSet(text: string): Set<string> {
  const compact = text.replace(/\s+/g, "");
  const grams = new Set<string>();
  for (let i = 0; i < compact.length - 1; i++) {
    grams.add(compact.slice(i, i + 2));
  }
  return grams;
}
