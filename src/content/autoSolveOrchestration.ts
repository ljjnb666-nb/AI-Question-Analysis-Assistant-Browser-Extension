import type { HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import type { ScanScrollRoot } from "./detector/fullPageDetector";
import {
  createBuildOrderedPlanDeps,
  createMergeOrderedPlanDeps,
  createOrderedPlanDeps,
  createReportSolvedQuestionAndAdvanceDeps,
} from "./contentAutoSolveDeps";
import {
  buildOrderedPlanFromDomQuestionCards,
  mergeOrderedPlanWithDetectedCandidates,
} from "./fullPagePlan";
import { prepareAutoSolveIteration } from "./autoSolveLoopState";
import { handleAnsweredQuestionPhase } from "./autoSolveAnsweredQuestion";
import { resolveAutoSolveQuestion } from "./autoSolveQuestionResolution";
import { advanceAfterSolvedQuestion, toProgressBlock } from "./autoSolveFlow";
import { reportSolvedQuestionAndAdvance } from "./autoSolveImmediateAdvance";
import {
  createOrderedPlanState,
  ensureOrderedPlan,
  getOrderedPlanCursor,
  getOrderedPlanSize,
  incrementOrderedPlanCursor,
  jumpToNextCandidateInFullPage,
  resolveOrderedPlanViewportBlock,
} from "./autoSolveOrderedPlan";

type AutoSolveController = {
  isRunning: () => boolean;
  setRunning: (running: boolean) => void;
  isStopRequested: () => boolean;
  requestStop: (stop: boolean) => void;
};

type AutoSolveDeps = {
  activeCandidates: QuestionBlock[];
  activeDetectMode: "viewport" | "fullpage" | null;
  clickNextQuestionButton: () => boolean;
  detectCandidatesFullPage: () => Promise<QuestionBlock[]>;
  detectCandidatesInViewport: () => QuestionBlock[];
  detectTotalQuestionCount: () => number;
  extractAutoSolveQuestionOrder: (text: string) => number | null;
  extractQuestionImageUrlFromBBox: (bbox: QuestionBlock["bbox"]) => string | null;
  extractRichQuestionPreviewFromElement: (node: Element) => string;
  extractTextFromBBox: (bbox: QuestionBlock["bbox"]) => string;
  fillParsedAnswerInPage: (block: QuestionBlock, result: ParseResult) => Promise<{ ok: boolean; filledCount: number; message: string }>;
  findBestDetectedCandidateForBBox: (bbox: QuestionBlock["bbox"]) => QuestionBlock | null;
  findMatchingFullPageCandidate: (
    candidates: QuestionBlock[],
    target: QuestionBlock,
    usedIds: Set<string>,
    extractOrder: (text: string) => number | null,
  ) => QuestionBlock | null;
  findNextQuestionButton: () => HTMLElement | null;
  findReusableHistoryEntry: (entries: HistoryEntry[], block: QuestionBlock, hostname?: string) => HistoryEntry | null;
  getAutoSolveFingerprint: (block: QuestionBlock) => string;
  getAutoSolveTextFingerprint: (text: string) => string;
  getScrollLeft: (scrollRoot: ScanScrollRoot) => number;
  hasVisibleAutoSolveMedia: (scope: Element) => boolean;
  inferAutoSolveQuestionType: (text: string) => QuestionBlock["questionTypeGuess"];
  inspectAutoSolveAnswerState: (block: QuestionBlock) => {
    mode: "choice" | "text" | "none";
    answeredCount: number;
    totalCount: number;
    complete: boolean;
  };
  isChoiceLikeQuestionType: (type: QuestionBlock["questionTypeGuess"]) => boolean;
  isExtensionUiElement: (el: Element) => boolean;
  loadHistory: () => Promise<HistoryEntry[]>;
  parseBlockForAutoSolve: (block: QuestionBlock) => Promise<ParseResult>;
  parseBlockForAutoSolveQuickReview: (block: QuestionBlock) => Promise<ParseResult>;
  parseBlockForAutoSolveReview: (block: QuestionBlock, previousResult: ParseResult | null) => Promise<ParseResult>;
  pauseMs: (ms: number) => Promise<void>;
  pickBestAutoSolvePreviewText: (rawPreviewText: string, richPreviewText: string, typeGuess: QuestionBlock["questionTypeGuess"]) => string;
  pickLiveAutoSolveBlock: () => QuestionBlock | null;
  projectViewportBboxToAbsolute: (bbox: QuestionBlock["bbox"], scrollRoot: ScanScrollRoot) => QuestionBlock["bbox"];
  recordAutoSolveHistory: (history: HistoryEntry[], block: QuestionBlock, result: ParseResult) => Promise<void>;
  normalizeQuestionText: (text: string) => string;
  refineFullPageCandidatesViaManualPipeline: (candidates: QuestionBlock[]) => Promise<QuestionBlock[]>;
  refineViewportCandidate: ReturnType<typeof createOrderedPlanDeps>["refineViewportCandidate"];
  reportLocationHostname: () => string;
  resolveQuestionBlockFromBBox: (bbox: QuestionBlock["bbox"]) => {
    refinedBBox: QuestionBlock["bbox"];
    finalBBox: QuestionBlock["bbox"];
    previewText: string;
    matchedCandidate: QuestionBlock | null;
  };
  resolveQuestionAdvance: (previousFingerprint: string, previousOrder: number | null, timeoutMs?: number) => Promise<boolean>;
  resolveScrollRoot: () => ScanScrollRoot;
  sendAutoSolveDone: (payload: {
    ok: boolean;
    stopped?: boolean;
    solved: number;
    filled: number;
    total: number;
    message: string;
  }) => void;
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
  setScrollPosition: (scrollRoot: ScanScrollRoot, top: number, left: number) => void;
  shouldPersistAutoSolveParseResult: (result: ParseResult) => boolean;
  shouldPreferViewportPreview: (rawPreviewText: string, richPreviewText: string, matchedCandidate?: QuestionBlock | null) => boolean;
  shouldRetryUnstableChoiceParse: (result: ParseResult) => boolean;
  shouldReviewLowConfidenceHistory: (entry: HistoryEntry | null) => boolean;
  shouldStopAutoSolveAtTail: (currentOrder: number | null, total: number) => boolean;
  sortAutoSolveCandidates: (candidates: QuestionBlock[]) => QuestionBlock[];
  verifyParsedAnswerInPage: (block: QuestionBlock, result: ParseResult) => { ok: boolean; message: string };
};

export async function runAutoSolveAll(controller: AutoSolveController, deps: AutoSolveDeps) {
  if (controller.isRunning()) return;

  controller.setRunning(true);
  controller.requestStop(false);

  let solved = 0;
  let filled = 0;
  let total = deps.detectTotalQuestionCount();
  const fixedTotal = total > 0 ? total : 0;
  let lastFingerprint = "";
  let repeatedCount = 0;
  const history = await deps.loadHistory();
  const scrollRoot = deps.resolveScrollRoot();
  const sequentialScrollMode = !deps.findNextQuestionButton();
  const driveFromOrderedPlan = sequentialScrollMode;
  const orderedPlanState = createOrderedPlanState();
  const orderedPlanDeps = createOrderedPlanDeps({
    activeDetectMode: deps.activeDetectMode,
    activeCandidates: deps.activeCandidates,
    buildOrderedPlanFromDomQuestionCards: (root: ScanScrollRoot) =>
      buildOrderedPlanFromDomQuestionCards(root, createBuildOrderedPlanDeps({
        projectViewportBboxToAbsolute: deps.projectViewportBboxToAbsolute,
        extractRichQuestionPreviewFromElement: deps.extractRichQuestionPreviewFromElement,
        extractQuestionImageUrlFromBBox: deps.extractQuestionImageUrlFromBBox,
        inferAutoSolveQuestionType: deps.inferAutoSolveQuestionType,
        hasVisibleAutoSolveMedia: deps.hasVisibleAutoSolveMedia,
        isExtensionUiElement: deps.isExtensionUiElement,
        normalizeQuestionText: deps.normalizeQuestionText,
        extractAutoSolveQuestionOrder: deps.extractAutoSolveQuestionOrder,
        sortAutoSolveCandidates: deps.sortAutoSolveCandidates,
      })),
    detectCandidatesFullPage: deps.detectCandidatesFullPage,
    detectTotalQuestionCount: deps.detectTotalQuestionCount,
    extractAutoSolveQuestionOrder: deps.extractAutoSolveQuestionOrder,
    getScrollLeft: deps.getScrollLeft,
    mergeOrderedPlanWithDetectedCandidates: (domPlan: QuestionBlock[], refined: QuestionBlock[]) =>
      mergeOrderedPlanWithDetectedCandidates(domPlan, refined, createMergeOrderedPlanDeps({
        sortAutoSolveCandidates: deps.sortAutoSolveCandidates,
        findMatchingFullPageCandidate: deps.findMatchingFullPageCandidate,
        findBestDetectedCandidateForBBox: deps.findBestDetectedCandidateForBBox,
        extractAutoSolveQuestionOrder: deps.extractAutoSolveQuestionOrder,
        pickBestAutoSolvePreviewText: deps.pickBestAutoSolvePreviewText,
      })),
    pauseMs: deps.pauseMs,
    refineFullPageCandidatesViaManualPipeline: deps.refineFullPageCandidatesViaManualPipeline,
    refineViewportCandidate: deps.refineViewportCandidate,
    scrollRoot,
    sequentialScrollMode,
    setScrollPosition: deps.setScrollPosition,
    sortAutoSolveCandidates: deps.sortAutoSolveCandidates,
  });

  const advanceAfterSolvedQuestionDeps = {
    clickNextQuestionButton: deps.clickNextQuestionButton,
    jumpToNextCandidateInFullPage: (currentBlock: QuestionBlock) =>
      jumpToNextCandidateInFullPage(currentBlock, orderedPlanState, orderedPlanDeps),
    sendAutoSolveDone: deps.sendAutoSolveDone,
    shouldStopAutoSolveAtTail: deps.shouldStopAutoSolveAtTail,
    waitForQuestionAdvance: deps.resolveQuestionAdvance,
  };
  const reportSolvedQuestionAndAdvanceDeps = createReportSolvedQuestionAndAdvanceDeps({
    advanceAfterSolvedQuestion: (options) => advanceAfterSolvedQuestion(options, advanceAfterSolvedQuestionDeps),
    incrementOrderedPlanCursor: () => incrementOrderedPlanCursor(orderedPlanState),
    sendAutoSolveProgress: deps.sendAutoSolveProgress,
    toProgressBlock,
  });

  try {
    if (sequentialScrollMode) {
      const plan = await ensureOrderedPlan(orderedPlanState, orderedPlanDeps);
      if (plan.length > 0) total = Math.max(total, plan.length);
    }

    deps.sendAutoSolveProgress({
      running: true,
      solved,
      filled,
      total,
      current: solved + 1,
      statusText: "开始自动答题...",
    });

    for (let round = 0; round < Math.max(fixedTotal || total || 0, 1) + 8; round += 1) {
      await deps.pauseMs(500);
      const iteration = await prepareAutoSolveIteration(
        {
          driveFromOrderedPlan,
          filled,
          getOrderedPlanCursor: (state) => getOrderedPlanCursor(state as typeof orderedPlanState),
          getOrderedPlanSize: (state) => getOrderedPlanSize(state as typeof orderedPlanState),
          lastFingerprint,
          orderedPlanState,
          pickLiveAutoSolveBlock: deps.pickLiveAutoSolveBlock,
          repeatedCount,
          resolveOrderedPlanViewportBlock: (state) =>
            resolveOrderedPlanViewportBlock(state as typeof orderedPlanState, orderedPlanDeps),
          sendAutoSolveDone: deps.sendAutoSolveDone,
          sendAutoSolveProgress: deps.sendAutoSolveProgress,
          solved,
          stopRequested: controller.isStopRequested(),
          toProgressBlock,
          total,
          updateTotalCount: deps.detectTotalQuestionCount,
        },
        {
          extractAutoSolveQuestionOrder: deps.extractAutoSolveQuestionOrder,
          getAutoSolveFingerprint: deps.getAutoSolveFingerprint,
        },
      );
      total = iteration.state.total;
      lastFingerprint = iteration.state.lastFingerprint;
      repeatedCount = iteration.state.repeatedCount;
      if (iteration.kind === "done") return;

      const { currentBlock, currentOrder } = iteration;
      const answerState = deps.inspectAutoSolveAnswerState(currentBlock);
      const answeredPhase = await handleAnsweredQuestionPhase(
        {
          answerState,
          currentBlock,
          currentOrder,
          driveFromOrderedPlan,
          filled,
          fixedTotal,
          history,
          lastFingerprint,
          locationHostname: deps.reportLocationHostname(),
          repeatedCount,
          solved,
          total,
        },
        {
          fillParsedAnswerInPage: deps.fillParsedAnswerInPage,
          findReusableHistoryEntry: deps.findReusableHistoryEntry,
          isChoiceLikeQuestionType: deps.isChoiceLikeQuestionType,
          reportSolvedQuestionAndAdvance: (options) => reportSolvedQuestionAndAdvance(options, reportSolvedQuestionAndAdvanceDeps),
          sendAutoSolveProgress: deps.sendAutoSolveProgress,
          shouldReviewLowConfidenceHistory: deps.shouldReviewLowConfidenceHistory,
          toProgressBlock,
          verifyParsedAnswerInPage: deps.verifyParsedAnswerInPage,
        },
      );
      solved = answeredPhase.solved;
      filled = answeredPhase.filled;
      if (answeredPhase.done) return;
      if (answeredPhase.handled) continue;

      const resolution = await resolveAutoSolveQuestion(
        {
          answerStateComplete: answerState.complete,
          currentBlock,
          filled,
          history,
          historyEntry: answeredPhase.historyEntry,
          needsHistoryReview: answeredPhase.needsHistoryReview,
          needsQuickAnsweredChoiceReview: answeredPhase.needsQuickAnsweredChoiceReview,
          solved,
          total,
        },
        {
          fillParsedAnswerInPage: deps.fillParsedAnswerInPage,
          isChoiceLikeQuestionType: deps.isChoiceLikeQuestionType,
          parseBlockForAutoSolve: deps.parseBlockForAutoSolve,
          parseBlockForAutoSolveQuickReview: deps.parseBlockForAutoSolveQuickReview,
          parseBlockForAutoSolveReview: deps.parseBlockForAutoSolveReview,
          recordAutoSolveHistory: deps.recordAutoSolveHistory,
          sendProgress: ({ currentBlock: progressBlock, filled: progressFilled, solved: progressSolved, statusText, total: progressTotal }) => {
            deps.sendAutoSolveProgress({
              running: true,
              solved: progressSolved,
              filled: progressFilled,
              total: progressTotal,
              current: progressSolved + 1,
              statusText,
              currentQuestionId: currentBlock.id,
              currentPreview: currentBlock.previewText,
              currentBlock: progressBlock,
            });
          },
          shouldPersistAutoSolveParseResult: deps.shouldPersistAutoSolveParseResult,
          shouldRetryUnstableChoiceParse: deps.shouldRetryUnstableChoiceParse,
          toProgressBlock,
          verifyParsedAnswerInPage: deps.verifyParsedAnswerInPage,
        },
      );
      const questionCompleted = resolution.questionCompleted;
      filled += resolution.filledDelta;
      if (questionCompleted) solved += 1;

      deps.sendAutoSolveProgress({
        running: true,
        solved,
        filled,
        total,
        current: questionCompleted ? solved : solved + 1,
        statusText: resolution.progressMessage,
        currentQuestionId: currentBlock.id,
        currentPreview: currentBlock.previewText,
        currentBlock: toProgressBlock(currentBlock),
      });

      if (!questionCompleted) continue;

      const advanceResult = await advanceAfterSolvedQuestion(
        {
          currentBlock,
          currentOrder,
          driveFromOrderedPlan,
          filled,
          fixedTotal,
          lastFingerprint,
          solved,
          total,
        },
        advanceAfterSolvedQuestionDeps,
      );
      if (driveFromOrderedPlan) incrementOrderedPlanCursor(orderedPlanState);
      if (advanceResult === "done") return;
    }

    deps.sendAutoSolveDone({
      ok: true,
      solved,
      filled,
      total: Math.max(total, solved),
      message: `自动答题完成，共处理 ${solved} 题`,
    });
  } catch (err) {
    deps.sendAutoSolveDone({
      ok: false,
      solved,
      filled,
      total: Math.max(total, solved),
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    controller.setRunning(false);
    controller.requestStop(false);
  }
}
