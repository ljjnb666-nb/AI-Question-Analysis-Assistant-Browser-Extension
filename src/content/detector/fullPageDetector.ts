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

export type ScanScrollRoot = Window | HTMLElement;

/**
 * Every scan owns a distinct scroll lease. Cancel releases the active slot
 * immediately; an older paused scan cannot restore/scroll a newer scan.
 */
type ActiveFullPageScan = { cancelled: boolean; eligible: () => boolean };
let activeScan: ActiveFullPageScan | null = null;

function isWindowScrollRoot(scrollRoot: ScanScrollRoot): scrollRoot is Window {
  return scrollRoot === window;
}

export function isFullPageScanRunning(): boolean {
  // A route/Runtime lease can expire without a matching explicit CANCEL.
  if (activeScan && !activeScan.eligible()) {
    activeScan.cancelled = true;
    activeScan = null;
  }
  return activeScan !== null;
}

export function cancelFullPageScan(): void {
  if (!activeScan) return;
  activeScan.cancelled = true;
  activeScan = null;
}

export interface ScanProgress {
  progress: number;
  found: number;
  currentStep: number;
  totalScrollSteps: number;
}

/**
 * isExecutionCurrent is captured from the exact Full Page START (or Auto
 * Solve run) and composed with the starting URL and attached scroll root.
 * Both scroll mutation and scroll restoration are denied on cancellation.
 */
export async function detectCandidatesFullPage(
  onProgress: (p: ScanProgress) => void,
  isExecutionCurrent: () => boolean = () => true,
): Promise<QuestionBlock[]> {
  if (isFullPageScanRunning()) return [];

  const startedAtUrl = location.href;
  let scrollRoot: ScanScrollRoot | null = null;
  const scan: ActiveFullPageScan = {
    cancelled: false,
    eligible: () => {
      if (location.href !== startedAtUrl) return false;
      if (scrollRoot && !isWindowScrollRoot(scrollRoot) && !scrollRoot.isConnected) return false;
      try {
        return isExecutionCurrent();
      } catch {
        return false;
      }
    },
  };
  activeScan = scan;
  const isCurrent = () => activeScan === scan && !scan.cancelled && scan.eligible();
  const allBlocks: QuestionBlock[] = [];
  let originalTop = 0;
  let originalLeft = 0;

  try {
    if (!isCurrent()) return [];
    const root = resolveFullPageScrollRoot();
    scrollRoot = root;
    if (!isCurrent()) return [];

    originalTop = getScrollTop(root);
    originalLeft = getScrollLeft(root);

    if (!isCurrent()) return [];
    setScrollPosition(root, 0, originalLeft);
    await pause(SCROLL_PAUSE_MS);

    // Capture an immutable scan budget after the initial top-of-page scroll.
    // Live sites may grow/shrink their scrollHeight as ads/images load or the
    // scroll root reflows. Recomputing the denominator on every iteration
    // used to yield "31 / 15" and to keep scrolling well past the advertised
    // number of steps (only the unrelated 200-step safety cap applied).
    if (!isCurrent()) return [];
    const initialMetrics = getScrollMetrics(root);
    const initialDistance = initialMetrics.scrollHeight - initialMetrics.clientHeight;
    const totalSteps = Number.isFinite(initialDistance)
      ? Math.min(Math.max(1, Math.ceil(Math.max(0, initialDistance) / SCROLL_STEP_PX) + 1), MAX_SCROLL_STEPS)
      : 1;
    let step = 0;
    let previousTop: number | null = null;
    while (isCurrent() && step < totalSteps) {
      const metrics = getScrollMetrics(root);
      // A scroll trap or fixed-position container must not repeatedly parse
      // the same viewport while claiming forward progress.
      if (previousTop !== null && metrics.scrollTop <= previousTop) break;

      const viewportBlocks = detectCandidatesInViewport();
      if (!isCurrent()) break;
      for (const block of viewportBlocks) {
        const absoluteBlock = toAbsoluteCoords(block, root);
        const normalizedPreview = normalizePreviewText(absoluteBlock.previewText);
        if (!isLikelyUsefulPreview(normalizedPreview, absoluteBlock.questionTypeGuess)) continue;
        upsertCandidate(allBlocks, { ...absoluteBlock, previewText: normalizedPreview.slice(0, 420) });
      }

      step++;
      if (!isCurrent()) break;
      onProgress({
        progress: Math.min(Math.round((step / totalSteps) * 100), 99),
        found: allBlocks.length,
        currentStep: step,
        totalScrollSteps: totalSteps,
      });
      // User handlers may synchronously CANCEL or change the route.
      if (!isCurrent()) break;
      if (metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - 10) break;
      // The immutable budget is an execution limit, not just a UI total.
      if (step >= totalSteps) break;

      if (!isCurrent()) break;
      const nextTop = Math.min(metrics.scrollTop + SCROLL_STEP_PX, metrics.scrollHeight);
      if (nextTop <= metrics.scrollTop) break;
      previousTop = metrics.scrollTop;
      setScrollPosition(root, nextTop, metrics.scrollLeft);
      await pause(SCROLL_PAUSE_MS);
    }

    if (!isCurrent()) return allBlocks;
    const filtered = postProcessCandidates(allBlocks).sort((a, b) => a.bbox.y - b.bbox.y);
    return filtered.map((block, index) => ({
      ...block,
      id: `fullpage-${Date.now()}-${index}`,
    }));
  } finally {
    // Never restore scroll after STOP, SPA churn, reinjection, or replacement.
    // A still-current normal scan owns its original scroll restoration.
    try {
      if (scrollRoot && isCurrent()) setScrollPosition(scrollRoot, originalTop, originalLeft);
    } finally {
      if (activeScan === scan) activeScan = null;
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a viewport-relative block to page-absolute coordinates */
function toAbsoluteCoords(block: QuestionBlock, scrollRoot: ScanScrollRoot): QuestionBlock {
  if (!isWindowScrollRoot(scrollRoot)) {
    const rect = scrollRoot.getBoundingClientRect();
    return {
      ...block,
      bbox: {
        x: block.bbox.x - rect.left + getScrollLeft(scrollRoot),
        y: block.bbox.y - rect.top + getScrollTop(scrollRoot),
        width: block.bbox.width,
        height: block.bbox.height,
      },
    };
  }

  return {
    ...block,
    bbox: {
      x: block.bbox.x + getScrollLeft(scrollRoot),
      y: block.bbox.y + getScrollTop(scrollRoot),
      width: block.bbox.width,
      height: block.bbox.height,
    },
  };
}

export function resolveFullPageScrollRoot(): ScanScrollRoot {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let best: HTMLElement | null = null;
  let bestScore = 0;

  const nodes = Array.from(document.querySelectorAll<HTMLElement>("body *"));
  for (const el of nodes) {
    if (!el.isConnected) continue;
    if (el.id === "qs-highlight-layer" || el.closest("#qs-highlight-layer, #qs-overlay-root, #qs-floating-host, #qs-capture-toolbar")) continue;
    const style = window.getComputedStyle(el);
    if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
    const scrollDelta = el.scrollHeight - el.clientHeight;
    if (scrollDelta < 200) continue;
    if (el.clientHeight < Math.max(220, vh * 0.35)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < Math.max(320, vw * 0.3)) continue;
    if (rect.height < Math.max(220, vh * 0.3)) continue;

    let score = scrollDelta;
    score += Math.min(rect.width, vw) * 0.2;
    score += Math.min(rect.height, vh) * 0.3;
    if (/question|exam|scroll|content|main|body|list|paper/i.test(`${el.className} ${el.id}`)) score += 240;
    if (rect.left < vw * 0.2) score += 60;

    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  return best ?? window;
}

export function getScrollMetrics(scrollRoot: ScanScrollRoot): {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  clientHeight: number;
} {
  if (isWindowScrollRoot(scrollRoot)) {
    const el = document.scrollingElement || document.documentElement;
    return {
      scrollTop: window.scrollY,
      scrollLeft: window.scrollX,
      scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, el.scrollHeight),
      clientHeight: window.innerHeight,
    };
  }

  const elementRoot = scrollRoot;
  return {
    scrollTop: elementRoot.scrollTop,
    scrollLeft: elementRoot.scrollLeft,
    scrollHeight: elementRoot.scrollHeight,
    clientHeight: elementRoot.clientHeight,
  };
}

export function getScrollTop(scrollRoot: ScanScrollRoot): number {
  if (isWindowScrollRoot(scrollRoot)) return window.scrollY;
  return scrollRoot.scrollTop;
}

export function getScrollLeft(scrollRoot: ScanScrollRoot): number {
  if (isWindowScrollRoot(scrollRoot)) return window.scrollX;
  return scrollRoot.scrollLeft;
}

export function setScrollPosition(scrollRoot: ScanScrollRoot, top: number, left: number): void {
  if (isWindowScrollRoot(scrollRoot)) {
    window.scrollTo({ top, left, behavior: "instant" });
    return;
  }
  scrollRoot.scrollTo({ top, left, behavior: "instant" });
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

export function pause(ms: number): Promise<void> {
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
