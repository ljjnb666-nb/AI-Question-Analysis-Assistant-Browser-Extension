import type { BoundingBox, QuestionBlock, QuestionType } from "@/shared/types";
import type { ScanScrollRoot } from "./detector/fullPageDetector";

type BuildOrderedPlanDeps = {
  projectViewportBboxToAbsolute: (bbox: BoundingBox, scrollRoot: ScanScrollRoot) => BoundingBox;
  extractRichQuestionPreviewFromElement: (node: Element) => string;
  extractQuestionImageUrlFromBBox: (bbox: BoundingBox) => string | null;
  inferAutoSolveQuestionType: (text: string) => QuestionType;
  hasVisibleAutoSolveMedia: (scope: Element) => boolean;
  isExtensionUiElement: (el: Element) => boolean;
  normalizeQuestionText: (raw: string) => string;
  extractAutoSolveQuestionOrder: (text: string) => number | null;
  sortAutoSolveCandidates: (candidates: QuestionBlock[]) => QuestionBlock[];
};

type MergeOrderedPlanDeps = {
  sortAutoSolveCandidates: (candidates: QuestionBlock[]) => QuestionBlock[];
  findMatchingFullPageCandidate: (
    candidates: QuestionBlock[],
    target: QuestionBlock,
    usedIds: Set<string>,
    extractOrder: (text: string) => number | null,
  ) => QuestionBlock | null;
  findBestDetectedCandidateForBBox: (bbox: BoundingBox) => QuestionBlock | null;
  extractAutoSolveQuestionOrder: (text: string) => number | null;
  pickBestAutoSolvePreviewText: (
    rawPreviewText: string,
    richPreviewText: string,
    typeGuess: QuestionType,
  ) => string;
};

type RefineFullPageDeps = {
  resolveFullPageScrollRoot: () => ScanScrollRoot;
  getScrollTop: (scrollRoot: ScanScrollRoot) => number;
  getScrollLeft: (scrollRoot: ScanScrollRoot) => number;
  setScrollPosition: (scrollRoot: ScanScrollRoot, top: number, left: number) => void;
  pauseFullPage: (ms: number) => Promise<void>;
  refineViewportCandidate: (
    candidate: QuestionBlock,
    scrollRoot: ScanScrollRoot,
    deps: {
      detectCandidatesInViewport: () => QuestionBlock[];
      extractQuestionImageUrlFromBBox: (bbox: BoundingBox) => string | null;
      extractQuestionOrder: (text: string) => number | null;
      extractTextFromBBox: (bbox: BoundingBox) => string;
      inferQuestionType: (text: string) => QuestionType;
      pickBestPreviewText: (
        rawPreviewText: string,
        richPreviewText: string,
        typeGuess: QuestionType,
      ) => string;
      resolveQuestionBlockFromBBox: (bbox: BoundingBox) => {
        refinedBBox: BoundingBox;
        finalBBox: BoundingBox;
        previewText: string;
        matchedCandidate: QuestionBlock | null;
      };
      shouldPreferViewportPreview: (
        rawPreviewText: string,
        richPreviewText: string,
        matchedCandidate?: QuestionBlock | null,
      ) => boolean;
    },
    options?: { resolvedBboxMode?: "always" | "large-only" },
  ) => {
    finalViewportBBox: BoundingBox;
    hasImage: boolean;
    imageUrl?: string;
    matchedCandidate?: QuestionBlock | null;
    matchedVisibleCandidate?: QuestionBlock | null;
    previewText: string;
    typeGuess: QuestionType;
  };
  detectCandidatesInViewport: () => QuestionBlock[];
  extractQuestionImageUrlFromBBox: (bbox: BoundingBox) => string | null;
  extractAutoSolveQuestionOrder: (text: string) => number | null;
  extractTextFromBBox: (bbox: BoundingBox) => string;
  inferAutoSolveQuestionType: (text: string) => QuestionType;
  pickBestAutoSolvePreviewText: (
    rawPreviewText: string,
    richPreviewText: string,
    typeGuess: QuestionType,
  ) => string;
  resolveQuestionBlockFromBBox: (bbox: BoundingBox) => {
    refinedBBox: BoundingBox;
    finalBBox: BoundingBox;
    previewText: string;
    matchedCandidate: QuestionBlock | null;
  };
  shouldPreferViewportPreview: (
    rawPreviewText: string,
    richPreviewText: string,
    matchedCandidate?: QuestionBlock | null,
  ) => boolean;
  projectViewportBboxToAbsolute: (bbox: BoundingBox, scrollRoot: ScanScrollRoot) => BoundingBox;
  getAutoSolveTextFingerprint: (text: string) => string;
  autoSolveStopRequested: () => boolean;
};

export function buildOrderedPlanFromDomQuestionCards(
  scrollRoot: ScanScrollRoot,
  deps: BuildOrderedPlanDeps,
): QuestionBlock[] {
  const containerNodes = Array.from(
    document.querySelectorAll<HTMLElement>(".question-item, .questionBox, .base-question-component"),
  ).filter((el) => {
    if (!el.isConnected || deps.isExtensionUiElement(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 240 && rect.height >= 120;
  });

  const seenContainers = new Set<HTMLElement>();
  const domBlocks = containerNodes
    .filter((el) => {
      if (seenContainers.has(el)) return false;
      if (el.matches(".base-question-component") && el.closest(".question-item, .questionBox")) return false;
      seenContainers.add(el);
      return true;
    })
    .map((el, index) => {
      const rect = el.getBoundingClientRect();
      const viewportBox: BoundingBox = {
        x: Math.max(0, rect.left),
        y: Math.max(0, rect.top),
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      };
      const bbox = deps.projectViewportBboxToAbsolute(viewportBox, scrollRoot);
      const previewText = deps.extractRichQuestionPreviewFromElement(el).slice(0, 1200);
      const imageUrl = deps.extractQuestionImageUrlFromBBox(viewportBox) ?? undefined;
      return {
        id: `dom-plan-${index}`,
        bbox,
        previewText,
        questionTypeGuess: deps.inferAutoSolveQuestionType(previewText),
        questionImageUrl: imageUrl,
        hasImage: Boolean(imageUrl) || deps.hasVisibleAutoSolveMedia(el),
        confidence: 0.98,
        source: "auto_dom" as const,
      } satisfies QuestionBlock;
    })
    .filter((block) => {
      const text = deps.normalizeQuestionText(block.previewText || "");
      return text.length >= 16 && deps.extractAutoSolveQuestionOrder(text) !== null;
    });

  return deps.sortAutoSolveCandidates(domBlocks);
}

export function mergeOrderedPlanWithDetectedCandidates(
  domPlan: QuestionBlock[],
  detectedCandidates: QuestionBlock[],
  deps: MergeOrderedPlanDeps,
): QuestionBlock[] {
  if (!domPlan.length) return deps.sortAutoSolveCandidates(detectedCandidates);
  if (!detectedCandidates.length) return domPlan;

  const usedIds = new Set<string>();
  return domPlan.map((domBlock) => {
    const matched =
      deps.findMatchingFullPageCandidate(detectedCandidates, domBlock, usedIds, deps.extractAutoSolveQuestionOrder)
      ?? deps.findBestDetectedCandidateForBBox(domBlock.bbox);
    if (!matched) return domBlock;

    usedIds.add(matched.id);
    const typeGuess = matched.questionTypeGuess ?? domBlock.questionTypeGuess;
    const previewText =
      deps.pickBestAutoSolvePreviewText(domBlock.previewText, matched.previewText, typeGuess)
      || matched.previewText
      || domBlock.previewText;
    return {
      ...matched,
      bbox: domBlock.bbox,
      previewText,
      questionTypeGuess: typeGuess,
      hasImage: domBlock.hasImage || matched.hasImage,
      questionImageUrl: matched.questionImageUrl ?? domBlock.questionImageUrl,
      confidence: Math.max(domBlock.confidence ?? 0, matched.confidence ?? 0),
    };
  });
}

export async function refineFullPageCandidatesViaManualPipeline(
  candidates: QuestionBlock[],
  deps: RefineFullPageDeps,
): Promise<QuestionBlock[]> {
  if (!candidates.length) return [];

  const scrollRoot = deps.resolveFullPageScrollRoot();
  const originalTop = deps.getScrollTop(scrollRoot);
  const originalLeft = deps.getScrollLeft(scrollRoot);
  const refined: QuestionBlock[] = [];
  const seen = new Set<string>();

  try {
    for (const candidate of [...candidates].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)) {
      if (deps.autoSolveStopRequested()) break;

      const targetTop = Math.max(0, candidate.bbox.y - Math.max(96, Math.floor(window.innerHeight * 0.16)));
      deps.setScrollPosition(scrollRoot, targetTop, originalLeft);
      await deps.pauseFullPage(220);

      const {
        finalViewportBBox,
        hasImage,
        imageUrl,
        matchedCandidate,
        matchedVisibleCandidate,
        previewText,
        typeGuess,
      } = deps.refineViewportCandidate(candidate, scrollRoot, {
        detectCandidatesInViewport: deps.detectCandidatesInViewport,
        extractQuestionImageUrlFromBBox: deps.extractQuestionImageUrlFromBBox,
        extractQuestionOrder: deps.extractAutoSolveQuestionOrder,
        extractTextFromBBox: deps.extractTextFromBBox,
        inferQuestionType: deps.inferAutoSolveQuestionType,
        pickBestPreviewText: deps.pickBestAutoSolvePreviewText,
        resolveQuestionBlockFromBBox: deps.resolveQuestionBlockFromBBox,
        shouldPreferViewportPreview: deps.shouldPreferViewportPreview,
      }, { resolvedBboxMode: "always" });
      const absoluteBBox = deps.projectViewportBboxToAbsolute(finalViewportBBox, scrollRoot);

      const order = deps.extractAutoSolveQuestionOrder(previewText) ?? deps.extractAutoSolveQuestionOrder(candidate.previewText);
      const fingerprint = `${order ?? "x"}:${deps.getAutoSolveTextFingerprint(previewText)}`;
      if (fingerprint.length > 4 && seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      refined.push({
        ...candidate,
        bbox: absoluteBBox,
        previewText: previewText.slice(0, 1200),
        displaySegments: matchedVisibleCandidate?.displaySegments ?? matchedCandidate?.displaySegments ?? candidate.displaySegments,
        questionImageUrl: imageUrl,
        hasImage,
        questionTypeGuess: typeGuess,
        confidence: Math.max(candidate.confidence ?? 0, matchedCandidate?.confidence ?? 0.9),
      });
    }
  } finally {
    deps.setScrollPosition(scrollRoot, originalTop, originalLeft);
  }

  return refined.length ? refined : candidates;
}

export function shouldPreferViewportPreview(
  rawPreviewText: string,
  richPreviewText: string,
  normalizeQuestionText: (raw: string) => string,
  matchedCandidate?: QuestionBlock | null,
): boolean {
  if (!richPreviewText) return false;
  if (!rawPreviewText) return true;
  if (matchedCandidate?.questionImageUrl) return true;
  if (
    looksLikeGarbledFullPageText(rawPreviewText, normalizeQuestionText)
    && !looksLikeGarbledFullPageText(richPreviewText, normalizeQuestionText)
  ) {
    return true;
  }
  return false;
}

export function looksLikeGarbledFullPageText(
  text: string,
  normalizeQuestionText: (raw: string) => string,
): boolean {
  const normalized = normalizeQuestionText(text || "");
  if (!normalized) return false;
  if (/TXXXX\^|q q|x x x|=\s*=\s*=|(?:^|\s)[qθωσ]\s+\d(?:\s+\d){2,}/i.test(normalized)) return true;
  if (/(?:取得样本值|取样本值).{0,24}(?:q|x)\s*\d(?:[\s,.\-+=()]*\d){2,}/.test(normalized)) return true;
  return false;
}
