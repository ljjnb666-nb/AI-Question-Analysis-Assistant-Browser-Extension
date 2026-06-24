import type { BoundingBox, QuestionBlock, QuestionType } from "@/shared/types";
import type { ScanScrollRoot } from "./detector/fullPageDetector";
import type { reportSolvedQuestionAndAdvance } from "./autoSolveImmediateAdvance";

type ReportAdvanceDeps = Parameters<typeof reportSolvedQuestionAndAdvance>[1];

export function createBuildOrderedPlanDeps(options: {
  projectViewportBboxToAbsolute: (bbox: BoundingBox, scrollRoot: ScanScrollRoot) => BoundingBox;
  extractRichQuestionPreviewFromElement: (node: Element) => string;
  extractQuestionImageUrlFromBBox: (bbox: BoundingBox) => string | null;
  inferAutoSolveQuestionType: (text: string) => QuestionType;
  hasVisibleAutoSolveMedia: (scope: Element) => boolean;
  isExtensionUiElement: (el: Element) => boolean;
  normalizeQuestionText: (raw: string) => string;
  extractAutoSolveQuestionOrder: (text: string) => number | null;
  sortAutoSolveCandidates: (candidates: QuestionBlock[]) => QuestionBlock[];
}) {
  return {
    projectViewportBboxToAbsolute: options.projectViewportBboxToAbsolute,
    extractRichQuestionPreviewFromElement: options.extractRichQuestionPreviewFromElement,
    extractQuestionImageUrlFromBBox: options.extractQuestionImageUrlFromBBox,
    inferAutoSolveQuestionType: options.inferAutoSolveQuestionType,
    hasVisibleAutoSolveMedia: options.hasVisibleAutoSolveMedia,
    isExtensionUiElement: options.isExtensionUiElement,
    normalizeQuestionText: options.normalizeQuestionText,
    extractAutoSolveQuestionOrder: options.extractAutoSolveQuestionOrder,
    sortAutoSolveCandidates: options.sortAutoSolveCandidates,
  };
}

export function createMergeOrderedPlanDeps(options: {
  sortAutoSolveCandidates: (candidates: QuestionBlock[]) => QuestionBlock[];
  findMatchingFullPageCandidate: (
    candidates: QuestionBlock[],
    target: QuestionBlock,
    usedIds: Set<string>,
    extractOrder: (text: string) => number | null,
  ) => QuestionBlock | null;
  findBestDetectedCandidateForBBox: (bbox: BoundingBox) => QuestionBlock | null;
  extractAutoSolveQuestionOrder: (text: string) => number | null;
  pickBestAutoSolvePreviewText: (rawPreviewText: string, richPreviewText: string, typeGuess: QuestionType) => string;
}) {
  return {
    sortAutoSolveCandidates: options.sortAutoSolveCandidates,
    findMatchingFullPageCandidate: options.findMatchingFullPageCandidate,
    findBestDetectedCandidateForBBox: options.findBestDetectedCandidateForBBox,
    extractAutoSolveQuestionOrder: options.extractAutoSolveQuestionOrder,
    pickBestAutoSolvePreviewText: options.pickBestAutoSolvePreviewText,
  };
}

export function createOrderedPlanDeps(options: {
  activeCandidates: QuestionBlock[];
  activeDetectMode: "viewport" | "fullpage" | null;
  buildOrderedPlanFromDomQuestionCards: (root: ScanScrollRoot) => QuestionBlock[];
  detectCandidatesFullPage: () => Promise<QuestionBlock[]>;
  detectTotalQuestionCount: () => number;
  getScrollLeft: (scrollRoot: ScanScrollRoot) => number;
  mergeOrderedPlanWithDetectedCandidates: (domPlan: QuestionBlock[], refined: QuestionBlock[]) => QuestionBlock[];
  pauseMs: (ms: number) => Promise<void>;
  refineFullPageCandidatesViaManualPipeline: (candidates: QuestionBlock[]) => Promise<QuestionBlock[]>;
  refineViewportCandidate: (
    candidate: QuestionBlock,
    root: ScanScrollRoot,
  ) => {
    finalViewportBBox: BoundingBox;
    hasImage: boolean;
    imageUrl?: string;
    matchedVisibleCandidate?: QuestionBlock | null;
    previewText: string;
    typeGuess: QuestionType;
  };
  scrollRoot: ScanScrollRoot;
  sequentialScrollMode: boolean;
  setScrollPosition: (scrollRoot: ScanScrollRoot, top: number, left: number) => void;
  sortAutoSolveCandidates: (candidates: QuestionBlock[]) => QuestionBlock[];
  extractAutoSolveQuestionOrder: (text: string) => number | null;
}) {
  return {
    activeDetectMode: options.activeDetectMode,
    buildOrderedPlanFromDomQuestionCards: options.buildOrderedPlanFromDomQuestionCards,
    detectCandidatesFullPage: options.detectCandidatesFullPage,
    detectTotalQuestionCount: options.detectTotalQuestionCount,
    extractAutoSolveQuestionOrder: options.extractAutoSolveQuestionOrder,
    getActiveCandidates: () => options.activeCandidates,
    getScrollLeft: options.getScrollLeft,
    mergeOrderedPlanWithDetectedCandidates: options.mergeOrderedPlanWithDetectedCandidates,
    pauseMs: options.pauseMs,
    refineFullPageCandidatesViaManualPipeline: options.refineFullPageCandidatesViaManualPipeline,
    refineViewportCandidate: options.refineViewportCandidate,
    scrollRoot: options.scrollRoot,
    sequentialScrollMode: options.sequentialScrollMode,
    setScrollPosition: options.setScrollPosition,
    sortAutoSolveCandidates: options.sortAutoSolveCandidates,
  };
}

export function createReportSolvedQuestionAndAdvanceDeps(options: {
  advanceAfterSolvedQuestion: ReportAdvanceDeps["advanceAfterSolvedQuestion"];
  incrementOrderedPlanCursor: () => void;
  sendAutoSolveProgress: (payload: {
    running: boolean;
    solved: number;
    filled: number;
    total: number;
    current: number;
    statusText: string;
    currentQuestionId?: string;
    currentPreview?: string;
    currentBlock?: QuestionBlock;
  }) => void;
  toProgressBlock: (block: QuestionBlock) => QuestionBlock;
}): ReportAdvanceDeps {
  return {
    advanceAfterSolvedQuestion: options.advanceAfterSolvedQuestion,
    incrementOrderedPlanCursor: options.incrementOrderedPlanCursor,
    sendProgress: ({ currentBlock, filled, questionId, questionPreview, solved, statusText, total }) => {
      options.sendAutoSolveProgress({
        running: true,
        solved,
        filled,
        total,
        current: solved,
        statusText,
        currentQuestionId: questionId,
        currentPreview: questionPreview,
        currentBlock,
      });
    },
    toProgressBlock: options.toProgressBlock,
  };
}
