import type { BoundingBox, QuestionBlock, QuestionType } from "@/shared/types";
import { CIRCLED_RE, OPTION_RE, QUESTION_RE, inferQuestionType, normalizeText } from "./domText";
import { isLikelyControlPanelText } from "./domDetectorShared";
import { attachQuestionIdentity } from "../questionIdentity";
import { evaluateQuestionCompleteness } from "./questionCompleteness";
import { questionFragmentFromBlock } from "./questionFragment";
import { resolveQuestionOwnership } from "./questionOwnership";
import { classifyViewportBoundary, mergeQuestionBoundaryInfo } from "./questionBoundary";

export function isLikelyCompleteQuestionText(text: string, type: QuestionType): boolean {
  if (!text) return false;
  if (isLikelyControlPanelText(text)) return false;

  const pageIsJudge = /typeid=600079/i.test(window.location.search);
  const optionCount = (text.match(OPTION_RE) || []).length;
  const circledCount = (text.match(CIRCLED_RE) || []).length;
  const hasABCD = /A[\.\):\uFF1A\u3001][\s\S]*B[\.\):\uFF1A\u3001][\s\S]*C[\.\):\uFF1A\u3001][\s\S]*D[\.\):\uFF1A\u3001]/.test(text);
  const hasQuestion = QUESTION_RE.test(text);
  const hasIndexedStem = /^(\d{1,3})[\.、。\)）]\s*/.test(text) || /^第\s*\d{1,3}\s*题/.test(text);
  const startsWithOption = /^[A-D][\.\):\uFF1A\u3001]/.test(text);
  const startsWithIndex = /^[\u2460\u2461\u2462\u2463]/.test(text);

  const judgeLike = (type === "judge" || (pageIsJudge && type === "unknown"))
    && text.length >= 10
    && text.length <= 260
    && !startsWithOption
    && !startsWithIndex
    && /[。！？.!?)]$/.test(text);
  if (judgeLike) return true;

  if (startsWithOption || startsWithIndex) return false;
  if (type === "single_choice" || type === "multi_choice") {
    if (optionCount + circledCount < 4) return false;
    if (!hasABCD && circledCount < 4) return false;
    const hasMathLikePayload = /θ|μ|σ|λ|∞|∑|∫|π|T\d|x_\d|[A-Za-z]\([A-Za-z0-9,+\-*/=()]+\)|\d+\/\d+/.test(text);
    if (!hasQuestion && !hasMathLikePayload && !hasIndexedStem && text.length < 60) return false;
  }
  if (type === "unknown") {
    if (optionCount + circledCount < 2 && !hasQuestion) return false;
  }
  if (text.length < 28) return false;
  return true;
}

export function completenessScore(text: string, type: QuestionType, confidence: number): number {
  const optionCount = (text.match(OPTION_RE) || []).length;
  const circledCount = (text.match(CIRCLED_RE) || []).length;
  const hasQuestion = /[?\uFF1F]/.test(text);
  let score = confidence * 100;
  score += (optionCount + circledCount) * 8;
  if (hasQuestion) score += 10;
  if (type === "single_choice" || type === "multi_choice") score += 8;
  if (text.length >= 80 && text.length <= 700) score += 8;
  if (text.length > 900) score -= 20;
  return score;
}

export function filterFragmentBlocks(blocks: QuestionBlock[]): QuestionBlock[] {
  const sorted = [...blocks].sort((a, b) => candidateQualityScore(b) - candidateQualityScore(a));
  const kept: QuestionBlock[] = [];
  for (const block of sorted) {
    const text = normalizeText(block.previewText);
    const contained = kept.some((k) => {
      const yNear = Math.abs(k.bbox.y - block.bbox.y) < 160;
      const sameCol = Math.abs(k.bbox.x - block.bbox.x) < 120;
      return yNear && sameCol && normalizeText(k.previewText).includes(text);
    });
    if (!contained) kept.push(block);
  }
  return kept.sort((a, b) => a.bbox.y - b.bbox.y);
}

export function mergeAdjacentQuestionBlocks(blocks: QuestionBlock[]): QuestionBlock[] {
  if (blocks.length <= 1) return blocks;
  const sorted = [...blocks].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const out: QuestionBlock[] = [];
  for (const block of sorted) {
    const previous = out[out.length - 1];
    if (previous && shouldMergeBlocks(previous, block)) out[out.length - 1] = mergeTwoBlocks(previous, block);
    else out.push(block);
  }

  return out.map(withQuestionCompleteness);
}

export function withQuestionCompleteness(block: QuestionBlock): QuestionBlock {
  const viewport = block.boundary ? null : classifyViewportBoundary(block.bbox);
  const boundary = {
    state: block.boundary?.state ?? (viewport!.state === "fully-visible" ? "complete" as const : viewport!.state === "clipped-top" ? "partial-top" as const : viewport!.state === "clipped-bottom" ? "partial-bottom" as const : "partial-both" as const),
    clippedTop: block.boundary?.clippedTop ?? viewport!.clippedTop, clippedBottom: block.boundary?.clippedBottom ?? viewport!.clippedBottom,
    confidence: block.boundary?.confidence ?? viewport!.visibleRatio,
    reasons: block.boundary?.reasons ?? [viewport!.clippedTop ? "Q_BOUNDARY_PARTIAL_TOP" : "", viewport!.clippedBottom ? "Q_BOUNDARY_PARTIAL_BOTTOM" : ""].filter(Boolean),
  };
  const result = { ...block, boundary };
  return { ...result, completeness: evaluateQuestionCompleteness(result) };
}

export function deduplicateBlocks(blocks: QuestionBlock[]): QuestionBlock[] {
  const out: QuestionBlock[] = [];
  for (const b of blocks) {
    const overlapIndex = out.findIndex((k) => {
      if (overlapRatio(k.bbox, b.bbox) > 0.5) return true;
      const sameColumn = Math.abs(k.bbox.x - b.bbox.x) < 120;
      const closeTop = Math.abs(k.bbox.y - b.bbox.y) < 140;
      const textA = normalizeText(k.previewText);
      const textB = normalizeText(b.previewText);
      return sameColumn && closeTop && !!textA && !!textB && (textA.includes(textB) || textB.includes(textA));
    });
    if (overlapIndex < 0) {
      out.push(b);
      continue;
    }
    if (candidateQualityScore(b) > candidateQualityScore(out[overlapIndex])) {
      out[overlapIndex] = b;
    }
  }
  return out;
}

function shouldMergeBlocks(a: QuestionBlock, b: QuestionBlock): boolean {
  if (a.id.startsWith("auto-direct-") && b.id.startsWith("auto-direct-")) return false;
  const verticalGap = Math.max(0, b.bbox.y - (a.bbox.y + a.bbox.height));
  const overlap = Math.max(0, Math.min(a.bbox.x + a.bbox.width, b.bbox.x + b.bbox.width) - Math.max(a.bbox.x, b.bbox.x));
  const ownership = resolveQuestionOwnership(questionFragmentFromBlock(a), questionFragmentFromBlock(b), { verticalGap, horizontalOverlapRatio: overlap / Math.max(1, Math.min(a.bbox.width, b.bbox.width)) });
  return ownership.relation === "same-question" && ownership.confidence >= 0.8;
}

function mergeTwoBlocks(a: QuestionBlock, b: QuestionBlock): QuestionBlock {
  const left = Math.min(a.bbox.x, b.bbox.x);
  const top = Math.min(a.bbox.y, b.bbox.y);
  const right = Math.max(a.bbox.x + a.bbox.width, b.bbox.x + b.bbox.width);
  const bottom = Math.max(a.bbox.y + a.bbox.height, b.bbox.y + b.bbox.height);

  const identityText = normalizeText([a.identitySourceText ?? a.previewText, b.identitySourceText ?? b.previewText].filter(Boolean).join(" "));
  const combinedText = normalizeText([a.previewText, b.previewText].filter(Boolean).join(" "));
  const typeA = a.questionTypeGuess;
  const typeB = b.questionTypeGuess;
  const mergedType: QuestionType =
    typeA !== "unknown"
      ? typeA
      : typeB !== "unknown"
        ? typeB
        : inferQuestionType(combinedText);

  const nativeQuestionId = a.identity?.nativeQuestionId === b.identity?.nativeQuestionId
    ? a.identity?.nativeQuestionId
    : a.identity?.nativeQuestionId ?? b.identity?.nativeQuestionId;
  return attachQuestionIdentity({
    ...a,
    id: a.id,
    bbox: { x: left, y: top, width: Math.max(20, right - left), height: Math.max(20, bottom - top) },
    previewText: combinedText.slice(0, 900),
    identitySourceText: identityText,
    hasImage: a.hasImage || b.hasImage,
    questionTypeGuess: mergedType,
    confidence: Math.min(1, Math.max(a.confidence, b.confidence) + 0.05),
    boundary: mergeQuestionBoundaryInfo(a.boundary, b.boundary),
  }, undefined, { identityText, nativeQuestionId });
}

function candidateQualityScore(block: QuestionBlock): number {
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  const area = Math.max(1, block.bbox.width * block.bbox.height);
  const areaRatio = area / viewportArea;
  const heightRatio = block.bbox.height / Math.max(1, window.innerHeight);
  let score = completenessScore(block.previewText, block.questionTypeGuess, block.confidence);

  if (areaRatio > 0.42) score -= (areaRatio - 0.42) * 220;
  if (heightRatio > 0.68) score -= (heightRatio - 0.68) * 180;
  if ((block.questionTypeGuess === "single_choice" || block.questionTypeGuess === "multi_choice") && areaRatio > 0.28) {
    score -= 22;
  }
  if (/\b(?:返回|提交作业|上一题|下一题|答题卡)\b/.test(block.previewText)) {
    score -= 26;
  }
  return score;
}

function overlapRatio(a: BoundingBox, b: BoundingBox): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
