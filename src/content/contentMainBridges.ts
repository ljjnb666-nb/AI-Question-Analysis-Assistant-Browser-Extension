import type { QuestionBlock } from "@/shared/types";
import { cropScreenshot } from "@/shared/utils/cropImage";
import { logEvent } from "@/shared/utils/analytics";
import { getProvider, parseQuestion } from "@/shared/utils/parseRouter";
import { addHistoryEntry, loadSettings } from "@/shared/utils/storage";
import { createAutoSolveRuntimeBridge } from "./contentAutoSolveRuntimeBridge";
import { createCaptureBridge, sendToBackgroundWithTimeout } from "./contentCaptureBridge";
import { createContentDetectionBridge } from "./contentDetectionBridge";
import { initializeContentBindings } from "./contentBindings";
import { createLayoutWatchController } from "./contentLayoutWatch";
import {
  detectCandidatesFullPage,
  getScrollLeft,
  getScrollTop,
  isFullPageScanRunning,
  pause as pauseFullPage,
  resolveFullPageScrollRoot,
  setScrollPosition,
  type ScanScrollRoot,
  cancelFullPageScan,
} from "./detector/fullPageDetector";
import { detectCandidatesInViewport, watchForPageChanges } from "./detector/domDetector";
import { installFormulaEmbedFallback } from "./formulaEmbedFallback";
import { HighlightLayer } from "./highlight/HighlightLayer";
import {
  getFullPageLayoutKey as getFullPageLayoutKeyCore,
  refreshFullPageHighlightsAfterLayoutChange as refreshFullPageHighlightsAfterLayoutChangeCore,
  refreshViewportCandidatesAfterLayoutChange as refreshViewportCandidatesAfterLayoutChangeCore,
} from "./layoutSync";
import { parseWithTieredRetries as parseWithTieredRetriesCore } from "./parseRetryPipeline";
import { findMatchingCandidate, projectViewportBboxToAbsolute } from "./candidateMatching";
import {
  extractAutoSolveQuestionOrder,
  getAutoSolveFingerprint,
  getAutoSolveTextFingerprint,
  inferAutoSolveQuestionType,
} from "./autoSolveHeuristics";
import { pickBestAutoSolvePreviewText } from "./autoSolvePreview";
import {
  detectZhihuishuCurrentQuestionBlock as detectZhihuishuCurrentQuestionBlockCore,
} from "./autoSolveBlockSelection";
import {
  clickNextQuestionButton as clickNextQuestionButtonCore,
  findNextQuestionButton as findNextQuestionButtonCore,
  safeRuntimeSendMessage,
  sendAutoSolveDone as sendAutoSolveDoneCore,
  sendAutoSolveProgress as sendAutoSolveProgressCore,
  waitForQuestionAdvance as waitForQuestionAdvanceCore,
  withTimeout,
} from "./contentRuntime";
import {
  extractQuestionImageUrlFromBBox,
  extractRichQuestionPreviewFromElement,
  extractTextFromBBox,
  hasVisibleAutoSolveMedia,
  isElementVisible,
  isExtensionUiElement,
  normalizeQuestionText,
  resolveQuestionBlockFromBBox,
} from "./contentQuestionServices";
import {
  looksLikeGarbledFullPageText as looksLikeGarbledFullPageTextCore,
  shouldPreferViewportPreview as shouldPreferViewportPreviewCore,
} from "./fullPagePlan";
import { refineViewportCandidate } from "./viewportCandidateRefinement";
import type { FloatingWindowManager } from "./floating/FloatingWindowManager";
import type { HighlightLayer as _HighlightLayerInstance } from "./highlight/HighlightLayer";
import type { CandidateStatusMap, ContentMainBridgeState } from "./contentRuntimeState";

const MANUAL_PARSE_TIER_TIMEOUTS_MS = [10_000, 20_000, 30_000] as const;
const MANUAL_PARSE_PIPELINE_TIMEOUT_MS = 45_000;
const AUTO_SOLVE_PARSE_TIMEOUT_MS = 45_000;
const AUTO_SOLVE_REVIEW_TIMEOUT_MS = 60_000;
const AUTO_SOLVE_QUICK_REVIEW_TIMEOUT_MS = 15_000;
const AUTO_SOLVE_REVIEW_CONFIDENCE_THRESHOLD = 0.9;

type CreateContentMainBridgesOptions = {
  candidateStatusMap: CandidateStatusMap;
  floatingMgr: FloatingWindowManager;
  refreshLayoutResizeObservation: () => void;
  scheduleHighlightRelayoutRescan: () => void;
  startManualCapture: (forceVisionMode: boolean) => void;
  state: ContentMainBridgeState;
};

export function createContentMainBridges(options: CreateContentMainBridgesOptions) {
  const parseRetryDeps = {
    logEvent,
    parseQuestion,
    setStreamingText: options.floatingMgr.setStreamingText.bind(options.floatingMgr),
    withTimeout,
  };
  const autoSolveParsingTimeouts = {
    parseTimeoutMs: AUTO_SOLVE_PARSE_TIMEOUT_MS,
    reviewTimeoutMs: AUTO_SOLVE_REVIEW_TIMEOUT_MS,
    quickReviewTimeoutMs: AUTO_SOLVE_QUICK_REVIEW_TIMEOUT_MS,
    reviewConfidenceThreshold: AUTO_SOLVE_REVIEW_CONFIDENCE_THRESHOLD,
  };

  async function parseWithTieredRetries(
    block: QuestionBlock,
    settings: Awaited<ReturnType<typeof loadSettings>>,
    providerSupportsVision: boolean,
    onStream: (partial: string) => void,
  ) {
    return parseWithTieredRetriesCore(
      block,
      settings,
      providerSupportsVision,
      onStream,
      MANUAL_PARSE_TIER_TIMEOUTS_MS,
      parseRetryDeps,
    );
  }

  const { captureBlockImage, screenshotWithRetry, tryCaptureBlockImageForAutoSolve } = createCaptureBridge({
    sendToBackgroundWithTimeout,
    cropScreenshot,
  });

  const autoSolveParsingDeps = {
    loadSettings,
    getProvider,
    tryCaptureBlockImageForAutoSolve,
    parseWithTieredRetries,
    withTimeout,
    parseQuestion,
    addHistoryEntry,
  };
  const questionNavDeps = {
    normalizeQuestionText,
    isExtensionUiElement,
    isElementVisible,
  };

  function refreshViewportCandidatesAfterLayoutChange() {
    const refreshed = refreshViewportCandidatesAfterLayoutChangeCore({
      activeDetectMode: options.state.getActiveDetectMode(),
      highlightLayer: options.state.getHighlightLayer(),
      activeCandidates: options.state.getActiveCandidates(),
      detectCandidatesInViewport,
      findMatchingCandidate,
      candidateStatusMap: options.candidateStatusMap,
      notifySidePanel,
    });
    if (!refreshed) return;
    options.state.setActiveCandidates(refreshed.activeCandidates);
    options.state.setActiveHighlightBlocks(refreshed.activeHighlightBlocks);
  }

  function refreshFullPageHighlightsAfterLayoutChange() {
    const refreshed = refreshFullPageHighlightsAfterLayoutChangeCore(options.state.getActiveCandidates(), {
      activeDetectMode: options.state.getActiveDetectMode(),
      highlightLayer: options.state.getHighlightLayer(),
      resolveFullPageScrollRoot,
      refreshLayoutResizeObservation: options.refreshLayoutResizeObservation,
      candidateStatusMap: options.candidateStatusMap,
      isExtensionUiElement,
      extractRichQuestionPreviewFromElement,
      extractAutoSolveQuestionOrder,
      getAutoSolveTextFingerprint,
      inferAutoSolveQuestionType,
      projectViewportBboxToAbsolute,
    });
    if (!refreshed) return;
    options.state.setLastFullPageLayoutKey(refreshed.lastFullPageLayoutKey);
    options.state.setActiveCandidates(refreshed.activeCandidates);
    options.state.setActiveHighlightBlocks(refreshed.activeHighlightBlocks);
  }

  const layoutWatch = createLayoutWatchController({
    getActiveCandidatesCount: () => options.state.getActiveCandidates().length,
    getActiveDetectMode: options.state.getActiveDetectMode,
    getHighlightLayerPresent: () => Boolean(options.state.getHighlightLayer()),
    getLastFullPageLayoutKey: options.state.getLastFullPageLayoutKey,
    getFullPageLayoutKey: (scrollRoot) => getFullPageLayoutKeyCore(scrollRoot as ScanScrollRoot),
    onRefreshFullPage: refreshFullPageHighlightsAfterLayoutChange,
    onRefreshViewport: refreshViewportCandidatesAfterLayoutChange,
    resolveFullPageScrollRoot,
    setLastFullPageLayoutKey: options.state.setLastFullPageLayoutKey,
  });

  const {
    handleAutoDetect,
    handleFullPageDetect,
    looksLikeGarbledFullPageText,
    notifySidePanel,
    refineFullPageCandidatesViaManualPipeline,
    shouldPreferViewportPreview,
  } = createContentDetectionBridge({
    candidateStatusMap: options.candidateStatusMap,
    cancelFullPageScan,
    createHighlightLayer: (bridgeOptions) => new HighlightLayer(bridgeOptions),
    detectCandidatesFullPage,
    detectCandidatesInViewport,
    destroyHighlightLayer: () => {
      options.state.getHighlightLayer()?.destroy();
      options.state.setHighlightLayer(null);
    },
    getAutoSolveTextFingerprint,
    getFullPageLayoutKey: getFullPageLayoutKeyCore,
    getScrollLeft,
    getScrollTop,
    inferAutoSolveQuestionType,
    isFullPageScanRunning,
    logEvent,
    looksLikeGarbledFullPageTextCore,
    normalizeQuestionText,
    pauseFullPage,
    pickBestAutoSolvePreviewText,
    projectViewportBboxToAbsolute,
    refineViewportCandidate,
    refreshFullPageHighlightsAfterLayoutChange,
    refreshLayoutResizeObservation: options.refreshLayoutResizeObservation,
    resolveFullPageScrollRoot,
    resolveQuestionBlockFromBBox,
    safeRuntimeSendMessage,
    setActiveCandidates: options.state.setActiveCandidates,
    setActiveDetectMode: options.state.setActiveDetectMode,
    setActiveHighlightBlocks: options.state.setActiveHighlightBlocks,
    setAutoSolveStopRequestedGetter: options.state.getAutoSolveStopRequested,
    setHighlightLayer: options.state.setHighlightLayer,
    setLastFullPageLayoutKey: options.state.setLastFullPageLayoutKey,
    setScrollPosition,
    setUnwatchSPA: options.state.setUnwatchSPA,
    shouldPreferViewportPreviewCore,
    stopSpaWatch: options.state.stopSpaWatch,
    watchForPageChanges,
    detectAutoSolveQuestionOrder: extractAutoSolveQuestionOrder,
    extractQuestionImageUrlFromBBox,
    extractTextFromBBox,
  });

  const {
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
  } = createAutoSolveRuntimeBridge({
    addHistoryEntry,
    autoSolveParsingDeps,
    autoSolveParsingTimeouts,
    clickNextQuestionButtonCore,
    detectZhihuishuCurrentQuestionBlockCore,
    extractAutoSolveQuestionOrder,
    extractQuestionImageUrlFromBBox,
    extractRichQuestionPreviewFromElement,
    findNextQuestionButtonCore,
    getAutoSolveFingerprint,
    hasVisibleAutoSolveMedia,
    inferAutoSolveQuestionType,
    isElementVisible,
    isExtensionUiElement,
    parseQuestionNavDeps: questionNavDeps,
    resolveQuestionBlockFromBBox,
    sendAutoSolveDoneCore,
    sendAutoSolveProgressCore,
    stopRequestedRef: options.state.getAutoSolveStopRequested,
    waitForQuestionAdvanceCore,
  });

  initializeContentBindings({
    floatingMgr: options.floatingMgr,
    handleAutoDetect,
    installFormulaEmbedFallback,
    logEvent,
    scheduleHighlightRelayoutRescan: options.scheduleHighlightRelayoutRescan,
    startManualCapture: options.startManualCapture,
  });

  return {
    captureBlockImage,
    clickNextQuestionButton,
    detectZhihuishuCurrentQuestionBlock,
    findNextQuestionButton,
    handleAutoDetect,
    handleFullPageDetect,
    layoutWatch,
    looksLikeGarbledFullPageText,
    manualParsePipelineTimeoutMs: MANUAL_PARSE_PIPELINE_TIMEOUT_MS,
    notifySidePanel,
    parseBlockForAutoSolve,
    parseBlockForAutoSolveQuickReview,
    parseBlockForAutoSolveReview,
    parseWithTieredRetries,
    pickAutoSolveBlock,
    pickLiveAutoSolveBlock,
    recordAutoSolveHistory,
    refineFullPageCandidatesViaManualPipeline,
    screenshotWithRetry,
    sendAutoSolveDone,
    sendAutoSolveProgress,
    shouldPreferViewportPreview,
    shouldReviewLowConfidenceHistory,
    sortAutoSolveCandidates,
    waitForQuestionAdvance,
  };
}
