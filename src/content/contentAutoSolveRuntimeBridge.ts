import type { HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import type { ParseQuestionRuntimeContext } from "@/shared/utils/parseRouter";
import { logEvent } from "@/shared/utils/analytics";
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
import { captureSolveStartControlState } from "./answerFiller";
import { beginQuestionRevisionAttempt, clearQuestionRevisionAttempt, isQuestionRevisionCurrent } from "./revision/questionRevisionRuntime";
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
  type ActiveSolveAttempt = {
    controller: AbortController;
    questionId: string;
    contentFingerprint: string;
    revision: ReturnType<typeof beginQuestionRevisionAttempt>;
  };
  let activeAttempt: ActiveSolveAttempt | null = null;
  const resultAttempts = new WeakMap<ParseResult, ActiveSolveAttempt>();

  function isAttemptCurrent(attempt: ActiveSolveAttempt, block: QuestionBlock): boolean {
    const live = pickLiveAutoSolveBlock();
    const liveQuestionId = live?.identity?.stableId ?? live?.id;
    const liveFingerprint = live?.identity?.contentFingerprint ?? live?.id;
    return activeAttempt === attempt
      && !attempt.controller.signal.aborted
      && attempt.questionId === (block.identity?.stableId ?? block.id)
      && attempt.contentFingerprint === (block.identity?.contentFingerprint ?? block.id)
      && isQuestionRevisionCurrent(attempt.revision)
      && liveQuestionId === attempt.questionId
      && liveFingerprint === attempt.contentFingerprint;
  }

  function beginAttempt(block: QuestionBlock): { attempt: ActiveSolveAttempt; runtimeContext: ParseQuestionRuntimeContext } {
    captureSolveStartControlState(block);
    activeAttempt?.controller.abort();
    const controller = new AbortController();
    const questionId = block.identity?.stableId ?? block.id;
    const contentFingerprint = block.identity?.contentFingerprint ?? block.id;
    const revision = beginQuestionRevisionAttempt(block, controller);
    const attempt: ActiveSolveAttempt = { controller, questionId, contentFingerprint, revision };
    activeAttempt = attempt;
    const runtimeContext: ParseQuestionRuntimeContext = {
      signal: controller.signal,
      deferSuccessTelemetry: true,
      isQuestionRevisionCurrent: (identity) => {
        return identity.questionId === questionId
          && identity.contentFingerprint === contentFingerprint
          && isAttemptCurrent(attempt, block);
      },
    };
    return { attempt, runtimeContext };
  }
  function abortCurrentSolveAttempt() {
    const current = activeAttempt;
    current?.controller.abort();
    clearQuestionRevisionAttempt(current?.controller);
    activeAttempt = null;
  }

  async function parseForAttempt(block: QuestionBlock, parse: (runtimeContext: ParseQuestionRuntimeContext) => Promise<ParseResult>): Promise<ParseResult> {
    const { attempt, runtimeContext } = beginAttempt(block);
    const result = await parse(runtimeContext);
    // Provider completion does not imply commit authority. Bind this result to
    // the exact attempt that produced it; every commit revalidates this lease.
    const boundResult = { ...result };
    resultAttempts.set(boundResult, attempt);
    return boundResult;
  }

  function isCurrentAutoSolveResult(block: QuestionBlock, result: ParseResult): boolean {
    const attempt = resultAttempts.get(result);
    return Boolean(attempt && isAttemptCurrent(attempt, block));
  }

  async function parseBlockForAutoSolve(block: QuestionBlock) {
    return parseForAttempt(block, (runtimeContext) =>
      parseBlockForAutoSolveCore(block, deps.autoSolveParsingTimeouts, deps.autoSolveParsingDeps, runtimeContext));
  }

  async function parseBlockForAutoSolveReview(
    block: QuestionBlock,
    previousResult: ParseResult | null,
  ) {
    return parseForAttempt(block, (runtimeContext) =>
      parseBlockForAutoSolveReviewCore(block, previousResult, deps.autoSolveParsingTimeouts, deps.autoSolveParsingDeps, runtimeContext));
  }

  async function parseBlockForAutoSolveQuickReview(block: QuestionBlock) {
    return parseForAttempt(block, (runtimeContext) =>
      parseBlockForAutoSolveQuickReviewCore(block, deps.autoSolveParsingTimeouts, deps.autoSolveParsingDeps, runtimeContext));
  }

  function shouldReviewLowConfidenceHistory(entry: HistoryEntry | null): boolean {
    return shouldReviewLowConfidenceHistoryCore(entry, deps.autoSolveParsingTimeouts.reviewConfidenceThreshold);
  }

  async function recordAutoSolveHistory(
    history: HistoryEntry[],
    block: QuestionBlock,
    result: ParseResult,
  ): Promise<boolean> {
    const attempt = resultAttempts.get(result);
    if (!attempt) return false;
    const committed = await recordAutoSolveHistoryCore(
      history,
      block,
      result,
      deps.autoSolveParsingDeps,
      () => isAttemptCurrent(attempt, block),
    );
    if (committed) {
      // parse_success records an authorized history commit. The resolver
      // independently revalidates before progress, fill, and advancement.
      logEvent("parse_success", { blockId: block.id, route: result.routeUsed, source: "auto_solve_commit" });
      return true;
    }
    if (!isAttemptCurrent(attempt, block)) {
      // This diagnostic means the result lost authority before history commit.
      logEvent("provider_result_discarded_stale", { blockId: block.id, source: "auto_solve_commit" });
    }
    return false;
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
    abortCurrentSolveAttempt,
    clickNextQuestionButton,
    detectZhihuishuCurrentQuestionBlock,
    findNextQuestionButton,
    parseBlockForAutoSolve,
    parseBlockForAutoSolveQuickReview,
    parseBlockForAutoSolveReview,
    isCurrentAutoSolveResult,
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
