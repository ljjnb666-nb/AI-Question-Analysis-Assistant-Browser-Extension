import type { BoundingBox, QuestionBlock } from "@/shared/types";
import {
  getScrollLeft,
  getScrollTop,
  type ScanScrollRoot,
} from "./detector/fullPageDetector";

export function projectAbsoluteBboxToViewport(bbox: BoundingBox, scrollRoot: ScanScrollRoot): BoundingBox {
  if (scrollRoot === window) {
    return {
      x: bbox.x - getScrollLeft(scrollRoot),
      y: bbox.y - getScrollTop(scrollRoot),
      width: bbox.width,
      height: bbox.height,
    };
  }

  const elementRoot = scrollRoot as HTMLElement;
  const rect = elementRoot.getBoundingClientRect();
  return {
    x: rect.left + bbox.x - elementRoot.scrollLeft,
    y: rect.top + bbox.y - elementRoot.scrollTop,
    width: bbox.width,
    height: bbox.height,
  };
}

export function projectViewportBboxToAbsolute(bbox: BoundingBox, scrollRoot: ScanScrollRoot): BoundingBox {
  if (scrollRoot === window) {
    return {
      x: bbox.x + getScrollLeft(scrollRoot),
      y: bbox.y + getScrollTop(scrollRoot),
      width: bbox.width,
      height: bbox.height,
    };
  }

  const elementRoot = scrollRoot as HTMLElement;
  const rect = elementRoot.getBoundingClientRect();
  return {
    x: bbox.x - rect.left + elementRoot.scrollLeft,
    y: bbox.y - rect.top + elementRoot.scrollTop,
    width: bbox.width,
    height: bbox.height,
  };
}

export function findBestVisibleCandidateByOrder(
  visibleCandidates: QuestionBlock[],
  target: QuestionBlock,
  extractQuestionOrder: (text: string) => number | null,
): QuestionBlock | null {
  const targetOrder = extractQuestionOrder(target.previewText || "");
  if (targetOrder === null) return null;

  let best: QuestionBlock | null = null;
  let bestScore = -Infinity;
  for (const candidate of visibleCandidates) {
    const candidateOrder = extractQuestionOrder(candidate.previewText || "");
    if (candidateOrder !== targetOrder) continue;
    let score = 0;
    if (candidate.questionTypeGuess === target.questionTypeGuess) score += 20;
    score += candidate.confidence ?? 0;
    score += Math.max(0, 800 - Math.abs(candidate.bbox.y - target.bbox.y)) / 100;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

export function findMatchingCandidate(candidates: QuestionBlock[], target: QuestionBlock): QuestionBlock | null {
  let best: QuestionBlock | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const score = scoreCandidateMatch(candidate, target);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore >= 60 ? best : null;
}

export function findMatchingFullPageCandidate(
  candidates: QuestionBlock[],
  target: QuestionBlock,
  usedIds: Set<string>,
  extractQuestionOrder: (text: string) => number | null,
): QuestionBlock | null {
  const targetText = normalizeCandidatePreview(target.previewText);
  const targetOrder = extractQuestionOrder(target.previewText);
  let best: QuestionBlock | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    if (usedIds.has(candidate.id)) continue;

    const candidateText = normalizeCandidatePreview(candidate.previewText);
    const candidateOrder = extractQuestionOrder(candidate.previewText);
    let score = 0;

    if (candidateText && targetText && candidateText === targetText) score += 120;
    if (candidateOrder !== null && targetOrder !== null && candidateOrder === targetOrder) score += 90;
    if (candidate.questionTypeGuess === target.questionTypeGuess) score += 15;
    if (candidateText && targetText && (candidateText.includes(targetText) || targetText.includes(candidateText))) score += 40;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore >= 70 ? best : null;
}

function scoreCandidateMatch(a: QuestionBlock, b: QuestionBlock): number {
  const overlap = bboxOverlapRatio(a.bbox, b.bbox);
  const textA = normalizeCandidatePreview(a.previewText);
  const textB = normalizeCandidatePreview(b.previewText);
  const sameFingerprint = textA && textB && textA === textB;
  const sameType = a.questionTypeGuess === b.questionTypeGuess;

  let score = overlap * 100;
  if (sameFingerprint) score += 80;
  if (sameType) score += 10;
  if (Math.abs(a.bbox.y - b.bbox.y) < 80) score += 10;
  if (Math.abs(a.bbox.x - b.bbox.x) < 80) score += 10;
  return score;
}

function bboxOverlapRatio(a: BoundingBox, b: BoundingBox): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizeCandidatePreview(text: string): string {
  return String(text || "").replace(/\s+/g, "").slice(0, 120);
}
