import type { BoundingBox, HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import { cropScreenshot } from "@/shared/utils/cropImage";
import { getProvider } from "@/shared/utils/parseRouter";
import { addHistoryEntry, loadHistory, loadSettings } from "@/shared/utils/storage";
import { logEvent } from "@/shared/utils/analytics";
import type { ActiveDetectMode } from "./contentRuntimeState";
import { startManualCaptureSession, submitManualCapture } from "./contentManualCapture";
import { runAutoSolveAll } from "./autoSolveOrchestration";
import type { ScanScrollRoot } from "./detector/fullPageDetector";
import type { CaptureOverlay } from "./overlay/CaptureOverlay";
import type { ViewportCandidateRefinement } from "./viewportCandidateRefinement";

type RuntimeStateLike = {
  destroyActiveOverlay: () => void;
  getActiveCandidates: () => QuestionBlock[];
  getActiveDetectMode: () => ActiveDetectMode;
  getActiveOverlay: () => CaptureOverlay | null;
  getAutoSolveRunning: () => boolean;
  getAutoSolveStopRequested: () => boolean;
  getHighlightLayer: () => { destroy: () => void } | null;
  getPendingSubmit: () => boolean;
  resetDetectionArtifacts: () => void;
  setActiveDetectMode: (mode: ActiveDetectMode) => void;
  setActiveOverlay: (overlay: CaptureOverlay | null) => void;
  setAutoSolveRunning: (running: boolean) => void;
  setAutoSolveStopRequested: (stopRequested: boolean) => void;
  setHighlightLayer: (layer: null) => void;
  setLastFullPageLayoutKey: (layoutKey: string) => void;
  setPendingSubmit: (pending: boolean) => void;
  stopSpaWatch: () => void;
};

type LayoutWatchLike = {
  ensureLayoutResizeObserver: () => void;
  refreshLayoutResizeObservation: () => void;
  scheduleHighlightRelayoutRescan: () => void;
};

type CreateContentMainWorkflowsOptions = {
  floatingMgr: {
    close: () => void;
    open: (block: QuestionBlock) => void;
    setError: (message: string) => void;
    setResult: (result: ParseResult) => void;
    setStreamingText: (text: string) => void;
  };
  runtimeState: RuntimeStateLike;
  layoutWatch: LayoutWatchLike;
  manualParsePipelineTimeoutMs: number;
  parseWithTieredRetries: (
    block: QuestionBlock,
    settings: Awaited<ReturnType<typeof loadSettings>>,
    providerSupportsVision: boolean,
    onStream: (partial: string) => void,
  ) => Promise<ParseResult>;
  screenshotWithRetry: () => Promise<string | null>;
  clickNextQuestionButton: () => boolean;
  detectCandidatesFullPage: () => Promise<QuestionBlock[]>;
  detectCandidatesInViewport: () => QuestionBlock[];
  detectTotalQuestionCount: () => number;
  extractAutoSolveQuestionOrder: (text: string) => number | null;
  extractQuestionImageUrlFromBBox: (bbox: BoundingBox) => string | null;
  extractRichQuestionPreviewFromElement: (node: Element) => string;
  extractTextFromBBox: (bbox: BoundingBox) => string;
  fillParsedAnswerInPage: (
    block: QuestionBlock,
    result: ParseResult,
  ) => Promise<{ ok: boolean; filledCount: number; message: string }>;
  findBestDetectedCandidateForBBox: (bbox: BoundingBox) => QuestionBlock | null;
  findMatchingFullPageCandidate: (
    candidates: QuestionBlock[],
    target: QuestionBlock,
    usedIds: Set<string>,
    extractOrder: (text: string) => number | null,
  ) => QuestionBlock | null;
  findNextQuestionButton: () => HTMLElement | null;
  findReusableHistoryEntry: (
    entries: HistoryEntry[],
    block: QuestionBlock,
    hostname?: string,
  ) => HistoryEntry | null;
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
  isLikelyIncompleteStem: (result: ParseResult) => boolean;
  normalizeQuestionText: (text: string) => string;
  parseBlockForAutoSolve: (block: QuestionBlock) => Promise<ParseResult>;
  parseBlockForAutoSolveQuickReview: (block: QuestionBlock) => Promise<ParseResult>;
  parseBlockForAutoSolveReview: (
    block: QuestionBlock,
    previousResult: ParseResult | null,
  ) => Promise<ParseResult>;
  pauseMs: (ms: number) => Promise<void>;
  pickBestAutoSolvePreviewText: (
    rawPreviewText: string,
    richPreviewText: string,
    typeGuess: QuestionBlock["questionTypeGuess"],
  ) => string;
  pickLiveAutoSolveBlock: () => QuestionBlock | null;
  projectViewportBboxToAbsolute: (
    bbox: QuestionBlock["bbox"],
    scrollRoot: ScanScrollRoot,
  ) => QuestionBlock["bbox"];
  recordAutoSolveHistory: (
    history: HistoryEntry[],
    block: QuestionBlock,
    result: ParseResult,
  ) => Promise<void>;
  refineFullPageCandidatesViaManualPipeline: (candidates: QuestionBlock[]) => Promise<QuestionBlock[]>;
  refineViewportCandidate: (
    candidate: QuestionBlock,
    root: ScanScrollRoot,
    deps: {
      detectCandidatesInViewport: () => QuestionBlock[];
      extractQuestionImageUrlFromBBox: (bbox: QuestionBlock["bbox"]) => string | null;
      extractQuestionOrder: (text: string) => number | null;
      extractTextFromBBox: (bbox: QuestionBlock["bbox"]) => string;
      inferQuestionType: (text: string) => QuestionBlock["questionTypeGuess"];
      pickBestPreviewText: (
        rawPreviewText: string,
        richPreviewText: string,
        typeGuess: QuestionBlock["questionTypeGuess"],
      ) => string;
      resolveQuestionBlockFromBBox: (bbox: QuestionBlock["bbox"]) => {
        refinedBBox: QuestionBlock["bbox"];
        finalBBox: QuestionBlock["bbox"];
        previewText: string;
        matchedCandidate: QuestionBlock | null;
      };
      shouldPreferViewportPreview: (
        rawPreviewText: string,
        richPreviewText: string,
        matchedCandidate?: QuestionBlock | null,
      ) => boolean;
    },
  ) => ViewportCandidateRefinement;
  resolveFullPageScrollRoot: () => ScanScrollRoot;
  resolveQuestionBlockFromBBox: (bbox: QuestionBlock["bbox"]) => {
    refinedBBox: QuestionBlock["bbox"];
    finalBBox: QuestionBlock["bbox"];
    previewText: string;
    matchedCandidate: QuestionBlock | null;
  };
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
  shouldForceSecondVisionReview: (block: QuestionBlock, result: ParseResult) => boolean;
  shouldPersistAutoSolveParseResult: (result: ParseResult) => boolean;
  shouldPreferSecondVisionResult: (
    previousResult: ParseResult,
    secondVisionResult: ParseResult,
    block: QuestionBlock,
  ) => boolean;
  shouldPreferVisionResult: (firstResult: ParseResult, visionResult: ParseResult) => boolean;
  shouldPreferViewportPreview: (
    rawPreviewText: string,
    richPreviewText: string,
    matchedCandidate?: QuestionBlock | null,
  ) => boolean;
  shouldRetryUnstableChoiceParse: (result: ParseResult) => boolean;
  shouldReviewLowConfidenceHistory: (entry: HistoryEntry | null) => boolean;
  shouldStopAutoSolveAtTail: (currentOrder: number | null, total: number) => boolean;
  sortAutoSolveCandidates: (candidates: QuestionBlock[]) => QuestionBlock[];
  verifyParsedAnswerInPage: (block: QuestionBlock, result: ParseResult) => { ok: boolean; message: string };
  waitForQuestionAdvance: (
    previousFingerprint: string,
    previousOrder: number | null,
    timeoutMs?: number,
  ) => Promise<boolean>;
  withTimeout: <T>(promise: Promise<T>, timeoutMs: number, timeoutReason: string) => Promise<T>;
};

export function createContentMainWorkflows(options: CreateContentMainWorkflowsOptions) {
  const refreshLayoutResizeObservation = () => {
    options.layoutWatch.refreshLayoutResizeObservation();
  };

  const scheduleHighlightRelayoutRescan = () => {
    options.layoutWatch.scheduleHighlightRelayoutRescan();
  };

  function startManualCapture(forceVisionMode: boolean) {
    startManualCaptureSession(forceVisionMode, {
      activeOverlay: options.runtimeState.getActiveOverlay(),
      clearHighlightLayer: () => {
        options.runtimeState.getHighlightLayer()?.destroy();
        options.runtimeState.setHighlightLayer(null);
      },
      logEvent,
      onSubmit: handleBBoxSubmit,
      refreshLayoutResizeObservation,
      resetDetectMode: () => {
        options.runtimeState.setActiveDetectMode(null);
        options.runtimeState.setLastFullPageLayoutKey("");
      },
      setActiveOverlay: (overlay) => {
        options.runtimeState.setActiveOverlay(overlay);
      },
    });
  }

  async function handleBBoxSubmit(bbox: BoundingBox, forceVision: boolean) {
    await submitManualCapture(bbox, {
      forceVision,
      isPendingSubmit: options.runtimeState.getPendingSubmit,
      pipelineDeps: {
        floatingMgr: options.floatingMgr,
        resolveQuestionBlockFromBBox: options.resolveQuestionBlockFromBBox,
        extractQuestionImageUrlFromBBox: options.extractQuestionImageUrlFromBBox,
        screenshotWithRetry: options.screenshotWithRetry,
        cropScreenshot,
        loadSettings,
        getProvider,
        parseWithTieredRetries: options.parseWithTieredRetries,
        withTimeout: options.withTimeout,
        addHistoryEntry,
        isLikelyIncompleteStem: options.isLikelyIncompleteStem,
        shouldPreferVisionResult: options.shouldPreferVisionResult,
        shouldForceSecondVisionReview: options.shouldForceSecondVisionReview,
        shouldPreferSecondVisionResult: options.shouldPreferSecondVisionResult,
        logEvent,
      },
      pipelineTimeoutMs: options.manualParsePipelineTimeoutMs,
      setActiveOverlay: (overlay) => {
        options.runtimeState.setActiveOverlay(overlay);
      },
      setPendingSubmit: (pending) => {
        options.runtimeState.setPendingSubmit(pending);
      },
    });
  }

  async function handleAutoSolveAll() {
    await runAutoSolveAll(
      {
        isRunning: options.runtimeState.getAutoSolveRunning,
        setRunning: options.runtimeState.setAutoSolveRunning,
        isStopRequested: options.runtimeState.getAutoSolveStopRequested,
        requestStop: options.runtimeState.setAutoSolveStopRequested,
      },
      {
        activeCandidates: options.runtimeState.getActiveCandidates(),
        activeDetectMode: options.runtimeState.getActiveDetectMode(),
        clickNextQuestionButton: options.clickNextQuestionButton,
        detectCandidatesFullPage: options.detectCandidatesFullPage,
        detectCandidatesInViewport: options.detectCandidatesInViewport,
        detectTotalQuestionCount: options.detectTotalQuestionCount,
        extractAutoSolveQuestionOrder: options.extractAutoSolveQuestionOrder,
        extractQuestionImageUrlFromBBox: options.extractQuestionImageUrlFromBBox,
        extractRichQuestionPreviewFromElement: options.extractRichQuestionPreviewFromElement,
        extractTextFromBBox: options.extractTextFromBBox,
        fillParsedAnswerInPage: options.fillParsedAnswerInPage,
        findBestDetectedCandidateForBBox: options.findBestDetectedCandidateForBBox,
        findMatchingFullPageCandidate: options.findMatchingFullPageCandidate,
        findNextQuestionButton: options.findNextQuestionButton,
        findReusableHistoryEntry: (entries, block, hostname) =>
          options.findReusableHistoryEntry(entries, block, hostname ?? location.hostname),
        getAutoSolveFingerprint: options.getAutoSolveFingerprint,
        getAutoSolveTextFingerprint: options.getAutoSolveTextFingerprint,
        getScrollLeft: options.getScrollLeft,
        hasVisibleAutoSolveMedia: options.hasVisibleAutoSolveMedia,
        inferAutoSolveQuestionType: options.inferAutoSolveQuestionType,
        inspectAutoSolveAnswerState: options.inspectAutoSolveAnswerState,
        isChoiceLikeQuestionType: options.isChoiceLikeQuestionType,
        isExtensionUiElement: options.isExtensionUiElement,
        loadHistory,
        normalizeQuestionText: options.normalizeQuestionText,
        parseBlockForAutoSolve: options.parseBlockForAutoSolve,
        parseBlockForAutoSolveQuickReview: options.parseBlockForAutoSolveQuickReview,
        parseBlockForAutoSolveReview: options.parseBlockForAutoSolveReview,
        pauseMs: options.pauseMs,
        pickBestAutoSolvePreviewText: options.pickBestAutoSolvePreviewText,
        pickLiveAutoSolveBlock: options.pickLiveAutoSolveBlock,
        projectViewportBboxToAbsolute: options.projectViewportBboxToAbsolute,
        recordAutoSolveHistory: options.recordAutoSolveHistory,
        refineFullPageCandidatesViaManualPipeline: options.refineFullPageCandidatesViaManualPipeline,
        refineViewportCandidate: (candidate, root) =>
          options.refineViewportCandidate(candidate, root, {
            detectCandidatesInViewport: options.detectCandidatesInViewport,
            extractQuestionImageUrlFromBBox: options.extractQuestionImageUrlFromBBox,
            extractQuestionOrder: options.extractAutoSolveQuestionOrder,
            extractTextFromBBox: options.extractTextFromBBox,
            inferQuestionType: options.inferAutoSolveQuestionType,
            pickBestPreviewText: options.pickBestAutoSolvePreviewText,
            resolveQuestionBlockFromBBox: options.resolveQuestionBlockFromBBox,
            shouldPreferViewportPreview: options.shouldPreferViewportPreview,
          }),
        reportLocationHostname: () => location.hostname,
        resolveQuestionAdvance: options.waitForQuestionAdvance,
        resolveQuestionBlockFromBBox: options.resolveQuestionBlockFromBBox,
        resolveScrollRoot: options.resolveFullPageScrollRoot,
        sendAutoSolveDone: options.sendAutoSolveDone,
        sendAutoSolveProgress: options.sendAutoSolveProgress,
        setScrollPosition: options.setScrollPosition,
        shouldPersistAutoSolveParseResult: options.shouldPersistAutoSolveParseResult,
        shouldPreferViewportPreview: options.shouldPreferViewportPreview,
        shouldRetryUnstableChoiceParse: options.shouldRetryUnstableChoiceParse,
        shouldReviewLowConfidenceHistory: options.shouldReviewLowConfidenceHistory,
        shouldStopAutoSolveAtTail: options.shouldStopAutoSolveAtTail,
        sortAutoSolveCandidates: options.sortAutoSolveCandidates,
        verifyParsedAnswerInPage: options.verifyParsedAnswerInPage,
      },
    );
  }

  return {
    ensureLayoutResizeObserver: options.layoutWatch.ensureLayoutResizeObserver,
    handleAutoSolveAll,
    refreshLayoutResizeObservation,
    scheduleHighlightRelayoutRescan,
    startManualCapture,
  };
}
