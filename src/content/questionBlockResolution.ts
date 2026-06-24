import type { BoundingBox, QuestionBlock } from "@/shared/types";

type ResolutionDeps = {
  detectCandidatesInViewport: () => QuestionBlock[];
  extractRichQuestionPreviewFromElement: (node: Element) => string;
  extractTextFromBBox: (bbox: BoundingBox) => string;
  intersectionArea: (rect: DOMRect, bbox: BoundingBox) => number;
  isElementVisible: (el: HTMLElement) => boolean;
  isExtensionUiElement: (el: Element) => boolean;
};

export type ResolvedQuestionBlock = {
  refinedBBox: BoundingBox;
  finalBBox: BoundingBox;
  previewText: string;
  matchedCandidate: QuestionBlock | null;
};

export function resolveQuestionBlockFromBBox(
  bbox: BoundingBox,
  deps: ResolutionDeps & {
    refineManualBBoxToQuestionContainer: (bbox: BoundingBox) => BoundingBox;
    looksLikeNavigationText: (text: string) => boolean;
    findLikelyQuestionBBoxNear: (bbox: BoundingBox) => BoundingBox | null;
    findBestDetectedCandidateForBBox: (bbox: BoundingBox) => QuestionBlock | null;
  },
): ResolvedQuestionBlock {
  const refinedBBox = deps.refineManualBBoxToQuestionContainer(bbox);

  let previewText = deps.extractTextFromBBox(refinedBBox);
  let finalBBox = refinedBBox;
  if (deps.looksLikeNavigationText(previewText)) {
    const fallbackBBox = deps.findLikelyQuestionBBoxNear(refinedBBox);
    if (fallbackBBox) {
      finalBBox = fallbackBBox;
      previewText = deps.extractTextFromBBox(finalBBox);
    }
  }

  const matchedCandidate = deps.findBestDetectedCandidateForBBox(finalBBox);
  if (matchedCandidate) {
    finalBBox = matchedCandidate.bbox;
    previewText = matchedCandidate.previewText || previewText;
  }

  return {
    refinedBBox,
    finalBBox,
    previewText,
    matchedCandidate,
  };
}

export function refineManualBBoxToQuestionContainer(
  bbox: BoundingBox,
  deps: ResolutionDeps & {
    pickAnchorElement: (bbox: BoundingBox) => Element | null;
    findBestQuestionContainer: (anchor: Element, bbox: BoundingBox) => Element | null;
    findStrictQuestionCardBBox: (bbox: BoundingBox) => BoundingBox | null;
    findBestDetectedCandidateForBBox: (bbox: BoundingBox) => QuestionBlock | null;
    hasLikelyMultipleQuestionStarts: (text: string) => boolean;
  },
): BoundingBox {
  const detectedCandidate = deps.findBestDetectedCandidateForBBox(bbox);
  if (detectedCandidate) {
    const detectedArea = Math.max(1, detectedCandidate.bbox.width * detectedCandidate.bbox.height);
    const originalArea = Math.max(1, bbox.width * bbox.height);
    if (detectedArea <= originalArea * 2.6) {
      return detectedCandidate.bbox;
    }
  }

  const strictCard = deps.findStrictQuestionCardBBox(bbox);
  if (strictCard) return strictCard;

  const anchor = deps.pickAnchorElement(bbox);
  if (!anchor) return bbox;
  const container = deps.findBestQuestionContainer(anchor, bbox);
  if (!container) return bbox;

  const rect = container.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 80) return bbox;

  const snapped: BoundingBox = {
    x: Math.max(0, rect.left),
    y: Math.max(0, rect.top),
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };

  const origArea = Math.max(1, bbox.width * bbox.height);
  const snapArea = Math.max(1, snapped.width * snapped.height);
  if (snapArea > origArea * 4) return bbox;
  if (snapArea < origArea * 0.2) return bbox;

  const snappedText = deps.extractTextFromBBox(snapped);
  if (deps.hasLikelyMultipleQuestionStarts(snappedText)) return bbox;
  return snapped;
}

export function findStrictQuestionCardBBox(
  bbox: BoundingBox,
  deps: Pick<ResolutionDeps, "intersectionArea" | "isElementVisible">,
): BoundingBox | null {
  const cards = Array.from(document.querySelectorAll("#qlist-container .q-detail, .card.q-detail, .card.mb-3.q-detail")) as HTMLElement[];
  if (cards.length === 0) return null;

  const bx = bbox.x + bbox.width / 2;
  const by = bbox.y + bbox.height / 2;
  let bestRect: DOMRect | null = null;
  let bestScore = -Infinity;

  for (const card of cards) {
    if (!deps.isElementVisible(card)) continue;
    const r = card.getBoundingClientRect();
    if (r.width < 280 || r.height < 140) continue;
    const inter = deps.intersectionArea(r, bbox);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dist = Math.hypot(cx - bx, cy - by);
    const score = inter * 1.2 - dist + Math.min((r.width * r.height) / 3000, 180);
    if (score > bestScore) {
      bestScore = score;
      bestRect = r;
    }
  }

  if (!bestRect) return null;
  return {
    x: Math.max(0, bestRect.left),
    y: Math.max(0, bestRect.top),
    width: Math.max(1, bestRect.width),
    height: Math.max(1, bestRect.height),
  };
}

export function looksLikeNavigationText(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  const navHits = [
    "试题检索",
    "教材版本",
    "课本",
    "题型",
    "难易度",
    "按章节",
    "按知识点",
    "组卷预览",
  ].filter((k) => t.includes(k)).length;
  const questionHints = /(A[、.．]|B[、.．]|C[、.．]|D[、.．]|\(\s*1\s*\)|（\s*1\s*）|请据图回答|下列)/.test(t);
  return navHits >= 2 && !questionHints;
}

export function findLikelyQuestionBBoxNear(
  bbox: BoundingBox,
  deps: ResolutionDeps & {
    findStrictQuestionCardBBox: (bbox: BoundingBox) => BoundingBox | null;
  },
): BoundingBox | null {
  const strict = deps.findStrictQuestionCardBBox(bbox);
  if (strict) return strict;

  const questionLikeNodes = Array.from(document.querySelectorAll("div,p,li"))
    .filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (!deps.isElementVisible(el) || deps.isExtensionUiElement(el)) return false;
      const txt = deps.extractRichQuestionPreviewFromElement(el);
      if (txt.length < 40 || txt.length > 5000) return false;
      return /(A[、.．]|B[、.．]|C[、.．]|D[、.．]|\(\s*1\s*\)|（\s*1\s*）|请据图回答|下列)/.test(txt);
    }) as HTMLElement[];

  let best: DOMRect | null = null;
  let bestScore = -Infinity;
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  for (const el of questionLikeNodes) {
    const r = el.getBoundingClientRect();
    if (r.width < 260 || r.height < 120) continue;
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const dist = Math.hypot(dx, dy);
    const area = r.width * r.height;
    const score = -dist + Math.min(area / 2000, 120);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (!best) return null;
  return {
    x: Math.max(0, best.left),
    y: Math.max(0, best.top),
    width: Math.max(1, best.width),
    height: Math.max(1, Math.min(best.height, 900)),
  };
}

export function findBestDetectedCandidateForBBox(
  bbox: BoundingBox,
  deps: Pick<ResolutionDeps, "detectCandidatesInViewport" | "intersectionArea">,
): QuestionBlock | null {
  const cands = deps.detectCandidatesInViewport();
  if (!cands.length) return null;

  const bboxArea = Math.max(1, bbox.width * bbox.height);
  const bx = bbox.x + bbox.width / 2;
  const by = bbox.y + bbox.height / 2;
  let best: QuestionBlock | null = null;
  let bestScore = -Infinity;

  for (const cand of cands) {
    const cb = cand.bbox;
    const inter = deps.intersectionArea(
      { left: cb.x, top: cb.y, width: cb.width, height: cb.height, right: cb.x + cb.width, bottom: cb.y + cb.height } as DOMRect,
      bbox,
    );
    if (inter <= 0) continue;

    const candArea = Math.max(1, cb.width * cb.height);
    const overlapRatio = inter / Math.min(bboxArea, candArea);
    const centerInside =
      bx >= cb.x &&
      bx <= cb.x + cb.width &&
      by >= cb.y &&
      by <= cb.y + cb.height;
    if (!centerInside && overlapRatio < 0.55) continue;

    const cx = cb.x + cb.width / 2;
    const cy = cb.y + cb.height / 2;
    const dist = Math.hypot(cx - bx, cy - by);
    const score =
      overlapRatio * 120 +
      Math.min(candArea / bboxArea, 4) * 6 +
      (cand.confidence || 0) * 20 -
      dist * 0.08;

    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  return best;
}
