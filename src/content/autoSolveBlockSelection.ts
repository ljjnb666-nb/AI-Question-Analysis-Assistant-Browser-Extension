import type { BoundingBox, QuestionBlock, QuestionType } from "@/shared/types";

type ResolvedQuestionBlock = {
  refinedBBox: BoundingBox;
  finalBBox: BoundingBox;
  previewText: string;
  matchedCandidate: QuestionBlock | null;
};

type DetectLiveBlockDeps = {
  isExtensionUiElement: (el: Element) => boolean;
  isElementVisible: (el: HTMLElement) => boolean;
  extractRichQuestionPreviewFromElement: (node: Element) => string;
  resolveQuestionBlockFromBBox: (bbox: BoundingBox) => ResolvedQuestionBlock;
  inferAutoSolveQuestionType: (text: string) => QuestionType;
  extractQuestionImageUrlFromBBox: (bbox: BoundingBox) => string | null;
  hasVisibleAutoSolveMedia: (scope: Element) => boolean;
  extractAutoSolveQuestionOrder: (text: string) => number | null;
};

export function pickAutoSolveBlock(blocks: QuestionBlock[]): QuestionBlock | null {
  if (!blocks.length) return null;
  return [...blocks].sort((a, b) => {
    const scoreA = (a.confidence || 0) * 100 - a.bbox.y * 0.01;
    const scoreB = (b.confidence || 0) * 100 - b.bbox.y * 0.01;
    return scoreB - scoreA || a.bbox.y - b.bbox.y;
  })[0] ?? null;
}

export function sortAutoSolveCandidates(
  candidates: QuestionBlock[],
  extractAutoSolveQuestionOrder: (text: string) => number | null,
): QuestionBlock[] {
  const decorated = candidates.map((candidate, index) => ({
    candidate,
    index,
    order: extractAutoSolveQuestionOrder(candidate.previewText || ""),
  }));

  return decorated
    .sort((a, b) => {
      if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
      if (a.order !== null && b.order === null) return -1;
      if (a.order === null && b.order !== null) return 1;
      const topDelta = a.candidate.bbox.y - b.candidate.bbox.y;
      if (Math.abs(topDelta) > 20) return topDelta;
      const leftDelta = a.candidate.bbox.x - b.candidate.bbox.x;
      if (Math.abs(leftDelta) > 12) return leftDelta;
      return a.index - b.index;
    })
    .map((entry) => entry.candidate);
}

export function detectZhihuishuCurrentQuestionBlock(
  deps: DetectLiveBlockDeps,
): QuestionBlock | null {
  if (!/zhihuishu\.com$/i.test(location.hostname)) return null;

  const questionBoxes = Array.from(document.querySelectorAll(".questionBox"))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => !deps.isExtensionUiElement(el))
    .filter((el) => deps.isElementVisible(el));

  const fallbackBoxes = questionBoxes.length > 0
    ? questionBoxes
    : Array.from(document.querySelectorAll(".Classificationquestionall-div"))
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
      .filter((el) => !deps.isExtensionUiElement(el))
      .filter((el) => deps.isElementVisible(el))
      .map((el) => {
        const innerQuestionBox = el.querySelector(".questionBox");
        return innerQuestionBox instanceof HTMLElement ? innerQuestionBox : el;
      });

  const boxes = fallbackBoxes
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const text = deps.extractRichQuestionPreviewFromElement(el);
      return { el, rect, text, isQuestionBox: el.classList.contains("questionBox") };
    })
    .filter(({ rect, text }) => rect.width > 260 && rect.height > 80 && /^\d{1,3}\s*[\.、]/.test(text))
    .sort((a, b) => Number(b.isQuestionBox) - Number(a.isQuestionBox) || a.rect.top - b.rect.top || b.rect.height - a.rect.height);

  const chosen = boxes[0];
  if (!chosen) return null;

  const chosenBbox: BoundingBox = {
    x: Math.max(0, chosen.rect.left),
    y: Math.max(0, chosen.rect.top),
    width: chosen.rect.width,
    height: chosen.rect.height,
  };

  const resolved = deps.resolveQuestionBlockFromBBox(chosenBbox);
  const finalBBox = resolved.finalBBox;
  const matchedCandidate = resolved.matchedCandidate;
  const previewText = resolved.previewText || chosen.text;
  const typeGuess = matchedCandidate?.questionTypeGuess ?? deps.inferAutoSolveQuestionType(previewText || chosen.text);
  const imageUrl = matchedCandidate?.questionImageUrl ?? deps.extractQuestionImageUrlFromBBox(finalBBox) ?? undefined;
  const hasMedia = deps.hasVisibleAutoSolveMedia(chosen.el) || Boolean(matchedCandidate?.hasImage) || Boolean(imageUrl);

  return {
    id: `live-zhihuishu-${deps.extractAutoSolveQuestionOrder(previewText) ?? deps.extractAutoSolveQuestionOrder(chosen.text) ?? "x"}`,
    bbox: finalBBox,
    previewText: previewText.slice(0, 1200),
    displaySegments: matchedCandidate?.displaySegments,
    hasImage: hasMedia,
    questionImageUrl: imageUrl,
    questionTypeGuess: typeGuess,
    confidence: Math.max(0.9, matchedCandidate?.confidence ?? 0.98),
    source: "auto_dom",
  };
}
