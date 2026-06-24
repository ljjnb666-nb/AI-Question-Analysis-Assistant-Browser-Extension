import type { HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import type {
  findNextQuestionButton as findNextQuestionButtonCore,
  clickNextQuestionButton as clickNextQuestionButtonCore,
} from "./contentRuntime";
import {
  parseBlockForAutoSolve as parseBlockForAutoSolveCore,
  parseBlockForAutoSolveQuickReview as parseBlockForAutoSolveQuickReviewCore,
  parseBlockForAutoSolveReview as parseBlockForAutoSolveReviewCore,
  recordAutoSolveHistory as recordAutoSolveHistoryCore,
  shouldReviewLowConfidenceHistory as shouldReviewLowConfidenceHistoryCore,
} from "./autoSolveParsing";
import type {
  sendAutoSolveDone as sendAutoSolveDoneCore,
  sendAutoSolveProgress as sendAutoSolveProgressCore,
  waitForQuestionAdvance as waitForQuestionAdvanceCore,
} from "./contentRuntime";
import { pickLiveAutoSolveBlock as pickLiveAutoSolveBlockCore } from "./contentRuntime";
import type {
  detectZhihuishuCurrentQuestionBlock as detectZhihuishuCurrentQuestionBlockCore,
} from "./autoSolveBlockSelection";
import {
  pickAutoSolveBlock as pickAutoSolveBlockCore,
  sortAutoSolveCandidates as sortAutoSolveCandidatesCore,
} from "./autoSolveBlockSelection";

type AutoSolveBridgeDeps = {
  addHistoryEntry: (entry: HistoryEntry) => Promise<void>;
  autoSolveParsingDeps: Parameters<typeof parseBlockForAutoSolveCore>[2];
  autoSolveParsingTimeouts: {
    parseTimeoutMs: number;
    reviewTimeoutMs: number;
    quickReviewTimeoutMs: number;
    reviewConfidenceThreshold: number;
  };
  clickNextQuestionButtonCore: typeof clickNextQuestionButtonCore;
  detectZhihuishuCurrentQuestionBlockCore: typeof detectZhihuishuCurrentQuestionBlockCore;
  extractAutoSolveQuestionOrder: (text: string) => number | null;
  findNextQuestionButtonCore: typeof findNextQuestionButtonCore;
  getAutoSolveFingerprint: (block: QuestionBlock) => string;
  isElementVisible: (el: HTMLElement) => boolean;
  isExtensionUiElement: (el: Element) => boolean;
  parseQuestionNavDeps: {
    normalizeQuestionText: (text: string) => string;
    isExtensionUiElement: (el: Element) => boolean;
    isElementVisible: (el: HTMLElement) => boolean;
  };
  resolveQuestionBlockFromBBox: (bbox: QuestionBlock["bbox"]) => {
    refinedBBox: QuestionBlock["bbox"];
    finalBBox: QuestionBlock["bbox"];
    previewText: string;
    matchedCandidate: QuestionBlock | null;
  };
  sendAutoSolveDoneCore: typeof sendAutoSolveDoneCore;
  sendAutoSolveProgressCore: typeof sendAutoSolveProgressCore;
  waitForQuestionAdvanceCore: typeof waitForQuestionAdvanceCore;
  stopRequestedRef: () => boolean;
  extractRichQuestionPreviewFromElement: (node: Element) => string;
  inferAutoSolveQuestionType: (text: string) => QuestionBlock["questionTypeGuess"];
  extractQuestionImageUrlFromBBox: (bbox: QuestionBlock["bbox"]) => string | null;
  hasVisibleAutoSolveMedia: (scope: Element) => boolean;
};

export function createAutoSolveRuntimeBridge(deps: AutoSolveBridgeDeps) {
  async function parseBlockForAutoSolve(block: QuestionBlock) {
    return parseBlockForAutoSolveCore(block, deps.autoSolveParsingTimeouts, deps.autoSolveParsingDeps);
  }

  async function parseBlockForAutoSolveReview(
    block: QuestionBlock,
    previousResult: ParseResult | null,
  ) {
    return parseBlockForAutoSolveReviewCore(block, previousResult, deps.autoSolveParsingTimeouts, deps.autoSolveParsingDeps);
  }

  async function parseBlockForAutoSolveQuickReview(block: QuestionBlock) {
    return parseBlockForAutoSolveQuickReviewCore(block, deps.autoSolveParsingTimeouts, deps.autoSolveParsingDeps);
  }

  function shouldReviewLowConfidenceHistory(entry: HistoryEntry | null): boolean {
    return shouldReviewLowConfidenceHistoryCore(entry, deps.autoSolveParsingTimeouts.reviewConfidenceThreshold);
  }

  async function recordAutoSolveHistory(
    history: HistoryEntry[],
    block: QuestionBlock,
    result: ParseResult,
  ): Promise<void> {
    await recordAutoSolveHistoryCore(history, block, result, { addHistoryEntry: deps.addHistoryEntry });
  }

  function sendAutoSolveProgress(payload: {
    running: boolean;
    solved: number;
    filled: number;
    total: number;
    current: number;
    statusText: string;
    currentQuestionId?: string;
    currentPreview?: string;
    currentBlock?: QuestionBlock;
  }) {
    deps.sendAutoSolveProgressCore(payload);
  }

  function sendAutoSolveDone(payload: {
    ok: boolean;
    stopped?: boolean;
    solved: number;
    filled: number;
    total: number;
    message: string;
  }) {
    deps.sendAutoSolveDoneCore(payload);
  }

  function pickAutoSolveBlock(blocks: QuestionBlock[]): QuestionBlock | null {
    return pickAutoSolveBlockCore(blocks);
  }

  function sortAutoSolveCandidates(candidates: QuestionBlock[]): QuestionBlock[] {
    return sortAutoSolveCandidatesCore(candidates, deps.extractAutoSolveQuestionOrder);
  }

  function detectZhihuishuCurrentQuestionBlock(): QuestionBlock | null {
    return deps.detectZhihuishuCurrentQuestionBlockCore({
      isExtensionUiElement: deps.isExtensionUiElement,
      isElementVisible: deps.isElementVisible,
      extractRichQuestionPreviewFromElement: deps.extractRichQuestionPreviewFromElement,
      resolveQuestionBlockFromBBox: deps.resolveQuestionBlockFromBBox,
      inferAutoSolveQuestionType: deps.inferAutoSolveQuestionType,
      extractQuestionImageUrlFromBBox: deps.extractQuestionImageUrlFromBBox,
      hasVisibleAutoSolveMedia: deps.hasVisibleAutoSolveMedia,
      extractAutoSolveQuestionOrder: deps.extractAutoSolveQuestionOrder,
    });
  }

  function pickLiveAutoSolveBlock(): QuestionBlock | null {
    return pickLiveAutoSolveBlockCore(detectZhihuishuCurrentQuestionBlock, pickAutoSolveBlock);
  }

  function findNextQuestionButton(): HTMLElement | null {
    return deps.findNextQuestionButtonCore(
      deps.parseQuestionNavDeps.normalizeQuestionText,
      deps.parseQuestionNavDeps.isExtensionUiElement,
      deps.parseQuestionNavDeps.isElementVisible,
    );
  }

  function clickNextQuestionButton(): boolean {
    return deps.clickNextQuestionButtonCore(
      deps.parseQuestionNavDeps.normalizeQuestionText,
      deps.parseQuestionNavDeps.isExtensionUiElement,
      deps.parseQuestionNavDeps.isElementVisible,
    );
  }

  async function waitForQuestionAdvance(previousFingerprint: string, previousOrder: number | null, timeoutMs = 8000): Promise<boolean> {
    return deps.waitForQuestionAdvanceCore(previousFingerprint, previousOrder, {
      timeoutMs,
      autoSolveStopRequested: deps.stopRequestedRef,
      pickLiveAutoSolveBlock,
      getAutoSolveFingerprint: deps.getAutoSolveFingerprint,
      extractAutoSolveQuestionOrder: deps.extractAutoSolveQuestionOrder,
    });
  }

  return {
    clickNextQuestionButton,
    detectZhihuishuCurrentQuestionBlock,
    findNextQuestionButton,
    parseBlockForAutoSolve,
    parseBlockForAutoSolveQuickReview,
    parseBlockForAutoSolveReview,
    pickAutoSolveBlock,
    pickLiveAutoSolveBlock,
    recordAutoSolveHistory,
    sendAutoSolveDone,
    sendAutoSolveProgress,
    shouldReviewLowConfidenceHistory,
    sortAutoSolveCandidates,
    waitForQuestionAdvance,
  };
}
