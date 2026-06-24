/**
 * Content Script Main (M1-M6 complete)
 * Adds: keyboard shortcut Alt+Q, streaming, scroll offset, retry, SPA watch
 */

import type { BoundingBox, ExtMessage, QuestionBlock } from "@/shared/types";
import type { CaptureOverlay } from "./overlay/CaptureOverlay";
import { FloatingWindowManager } from "./floating/FloatingWindowManager";
import type { HighlightLayer } from "./highlight/HighlightLayer";
import { detectCandidatesInViewport, watchForPageChanges } from "./detector/domDetector";
import {
  detectCandidatesFullPage,
  cancelFullPageScan,
  isFullPageScanRunning,
  resolveFullPageScrollRoot,
  type ScanScrollRoot,
  getScrollLeft,
  getScrollTop,
  setScrollPosition,
  pause as pauseFullPage,
} from "./detector/fullPageDetector";
import { fillParsedAnswerInPage, verifyParsedAnswerInPage } from "./answerFiller";
import {
  findMatchingCandidate,
  findMatchingFullPageCandidate,
  projectViewportBboxToAbsolute,
} from "./candidateMatching";
import {
  buildOrderedPlanFromDomQuestionCards as buildOrderedPlanFromDomQuestionCardsCore,
  looksLikeGarbledFullPageText as looksLikeGarbledFullPageTextCore,
  mergeOrderedPlanWithDetectedCandidates as mergeOrderedPlanWithDetectedCandidatesCore,
  refineFullPageCandidatesViaManualPipeline as refineFullPageCandidatesViaManualPipelineCore,
  shouldPreferViewportPreview as shouldPreferViewportPreviewCore,
} from "./fullPagePlan";
import {
  applySelectionUpdate as applySelectionUpdateCore,
  getFullPageLayoutKey as getFullPageLayoutKeyCore,
  refreshFullPageHighlightsAfterLayoutChange as refreshFullPageHighlightsAfterLayoutChangeCore,
  refreshViewportCandidatesAfterLayoutChange as refreshViewportCandidatesAfterLayoutChangeCore,
  remapFullPageBlocksFromDom as remapFullPageBlocksFromDomCore,
} from "./layoutSync";
import {
  detectZhihuishuCurrentQuestionBlock as detectZhihuishuCurrentQuestionBlockCore,
  pickAutoSolveBlock as pickAutoSolveBlockCore,
  sortAutoSolveCandidates as sortAutoSolveCandidatesCore,
} from "./autoSolveBlockSelection";
import { advanceAfterSolvedQuestion, toProgressBlock } from "./autoSolveFlow";
import { handleAnsweredQuestionPhase } from "./autoSolveAnsweredQuestion";
import { prepareAutoSolveIteration } from "./autoSolveLoopState";
import {
  createBuildOrderedPlanDeps,
  createMergeOrderedPlanDeps,
  createOrderedPlanDeps,
  createReportSolvedQuestionAndAdvanceDeps,
} from "./contentAutoSolveDeps";
import { initializeContentBindings } from "./contentBindings";
import {
  notifyDetectedCandidates,
  runAutoDetectSession,
  runFullPageDetectSession,
} from "./contentDetectionSession";
import { createContentDetectionBridge } from "./contentDetectionBridge";
import {
  createDetectSessionDeps,
  createNotifySidePanelDeps,
  createRefineFullPageDeps,
} from "./contentDetectSessionDeps";
import { startManualCaptureSession, submitManualCapture } from "./contentManualCapture";
import { handleContentMessage } from "./contentMessageRouter";
import {
  collectTextFromContainer,
  collectTextFromRegion,
  detectTotalQuestionCount,
  extractQuestionImageUrlFromBBox,
  extractReadableQuestionNodeText,
  extractRichQuestionPreviewFromElement,
  extractSelectedChoiceAnswer,
  extractTextFromAnchoredContainer,
  extractTextFromBBox,
  findBestDetectedCandidateForBBox,
  findBestQuestionContainer,
  findLikelyQuestionBBoxNear,
  findStrictQuestionCardBBox,
  hasLikelyMultipleQuestionStarts,
  hasVisibleAutoSolveMedia,
  inspectAutoSolveAnswerState,
  intersectionArea,
  isDecorativeQuestionImage,
  isElementVisible,
  isExtensionUiElement,
  looksLikeNavigationText,
  normalizeQuestionText,
  pickAnchorElement,
  refineManualBBoxToQuestionContainer,
  resolveQuestionBlockFromBBox,
  scoreQuestionLikeText,
} from "./contentQuestionServices";
import {
  createOrderedPlanState,
  ensureOrderedPlan,
  getOrderedPlanCursor,
  getOrderedPlanSize,
  incrementOrderedPlanCursor,
  jumpToNextCandidateInFullPage,
  resolveOrderedPlanViewportBlock,
} from "./autoSolveOrderedPlan";
import { reportSolvedQuestionAndAdvance } from "./autoSolveImmediateAdvance";
import { resolveAutoSolveQuestion } from "./autoSolveQuestionResolution";
import { runAutoSolveAll } from "./autoSolveOrchestration";
import { refineViewportCandidate } from "./viewportCandidateRefinement";
import {
  countExpectedBlankParts,
  extractAutoSolveQuestionOrder,
  findReusableHistoryEntry,
  getAutoSolveFingerprint,
  getAutoSolveTextFingerprint,
  inferAutoSolveQuestionType,
  isChoiceLikeQuestionType,
  isLikelyIncompleteStem,
  isSameAutoSolveQuestion,
  looksMathHeavyForAuto,
  shouldForceSecondVisionReview,
  shouldPreferSecondVisionResult,
  shouldPreferVisionResult,
  shouldPersistAutoSolveParseResult,
  shouldRetryUnstableChoiceParse,
  shouldStopAutoSolveAtTail,
} from "./autoSolveHeuristics";
import {
  parseBlockForAutoSolve as parseBlockForAutoSolveCore,
  parseBlockForAutoSolveQuickReview as parseBlockForAutoSolveQuickReviewCore,
  parseBlockForAutoSolveReview as parseBlockForAutoSolveReviewCore,
  recordAutoSolveHistory as recordAutoSolveHistoryCore,
  shouldReviewLowConfidenceHistory as shouldReviewLowConfidenceHistoryCore,
} from "./autoSolveParsing";
import { pickBestAutoSolvePreviewText } from "./autoSolvePreview";
import { pauseMs, withTimeout } from "./contentRuntime";
import {
  decodeFormulaLikeText,
  extractSemanticSvgLikeText,
  hasNearbyLargeVisualImageForSemanticNode,
  installFormulaEmbedFallback,
  normalizeMathDisplayText,
} from "./formulaEmbedFallback";
import { cropScreenshot } from "@/shared/utils/cropImage";
import { getProvider, parseQuestion } from "@/shared/utils/parseRouter";
import { loadSettings, addHistoryEntry, loadHistory, pruneIfNeeded } from "@/shared/utils/storage";
import { logEvent, initAnalytics } from "@/shared/utils/analytics";
import { sendToBackground } from "@/shared/utils/messaging";
import { createContentMainBridges } from "./contentMainBridges";

// 鈹€鈹€鈹€ Init 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
initAnalytics();
pruneIfNeeded(); // clean up storage if near quota

// 鈹€鈹€鈹€ State 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
let activeOverlay: CaptureOverlay | null = null;
let highlightLayer: HighlightLayer | null = null;
let unwatchSPA: (() => void) | null = null;
const candidateStatusMap = new Map<string, { status: string; selected: boolean }>();
let activeCandidates: QuestionBlock[] = [];
let activeHighlightBlocks: QuestionBlock[] = [];
let activeDetectMode: "viewport" | "fullpage" | null = null;
let lastFullPageLayoutKey = "";
let autoSolveRunning = false;
let autoSolveStopRequested = false;

const floatingMgr = new FloatingWindowManager();
let pendingSubmit = false;
const {
  captureBlockImage,
  clickNextQuestionButton,
  detectZhihuishuCurrentQuestionBlock,
  findNextQuestionButton,
  handleAutoDetect,
  handleFullPageDetect,
  layoutWatch,
  looksLikeGarbledFullPageText,
  manualParsePipelineTimeoutMs,
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
} = createContentMainBridges({
  candidateStatusMap,
  floatingMgr,
  refreshLayoutResizeObservation,
  scheduleHighlightRelayoutRescan,
  startManualCapture,
  state: {
    getActiveCandidates: () => activeCandidates,
    setActiveCandidates: (candidates) => {
      activeCandidates = candidates;
    },
    getActiveHighlightBlocks: () => activeHighlightBlocks,
    setActiveHighlightBlocks: (blocks) => {
      activeHighlightBlocks = blocks;
    },
    getActiveDetectMode: () => activeDetectMode,
    setActiveDetectMode: (mode) => {
      activeDetectMode = mode;
    },
    getHighlightLayer: () => highlightLayer,
    setHighlightLayer: (layer) => {
      highlightLayer = layer;
    },
    getLastFullPageLayoutKey: () => lastFullPageLayoutKey,
    setLastFullPageLayoutKey: (layoutKey) => {
      lastFullPageLayoutKey = layoutKey;
    },
    getAutoSolveStopRequested: () => autoSolveStopRequested,
    setUnwatchSPA: (unwatch) => {
      unwatchSPA = unwatch;
    },
    stopSpaWatch: () => {
      unwatchSPA?.();
      unwatchSPA = null;
    },
  },
});

// 鈹€鈹€鈹€ Floating trigger button 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Disabled by default - only create when user explicitly triggers capture
// if (!FloatingTrigger.getExisting()) {
//   new FloatingTrigger(() => startManualCapture(false));
// }

ensureLayoutResizeObserver();
refreshLayoutResizeObservation();

// 鈹€鈹€鈹€ Messages 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
chrome.runtime.onMessage.addListener((message: ExtMessage, _sender, sendResponse) => {
  return handleContentMessage(message, sendResponse, {
    cancelFullPageScan,
    cancelManualCapture: () => {
      activeOverlay?.destroy();
      activeOverlay = null;
    },
    captureBlockImage,
    clearHighlights: () => {
      highlightLayer?.destroy();
      highlightLayer = null;
      unwatchSPA?.();
      unwatchSPA = null;
      candidateStatusMap.clear();
      activeCandidates = [];
      activeHighlightBlocks = [];
      activeDetectMode = null;
      lastFullPageLayoutKey = "";
      refreshLayoutResizeObservation();
    },
    closeFloatingResult: () => {
      floatingMgr.close();
    },
    fillParsedAnswerInPage,
    flashCandidate: (blockId) => {
      highlightLayer?.flashBlock(blockId);
    },
    handleAutoDetect,
    handleFullPageDetect,
    startAutoSolveAll: () => {
      void handleAutoSolveAll();
    },
    startManualCapture,
    stopAutoSolveAll: () => {
      autoSolveStopRequested = true;
    },
    updateCandidateSelection: (nextMessage) => {
      applySelectionUpdateCore(nextMessage, {
        candidateStatusMap,
        activeHighlightBlocks,
        activeCandidates,
        highlightLayer,
        notifySidePanel,
      });
    },
    verifyParsedAnswerInPage,
  });
});

// 鈹€鈹€鈹€ Manual Capture 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function scheduleHighlightRelayoutRescan() {
  layoutWatch.scheduleHighlightRelayoutRescan();
}

function ensureLayoutResizeObserver() {
  layoutWatch.ensureLayoutResizeObserver();
}

function refreshLayoutResizeObservation() {
  layoutWatch.refreshLayoutResizeObservation();
}

function startManualCapture(forceVisionMode: boolean) {
  startManualCaptureSession(forceVisionMode, {
    activeOverlay,
    clearHighlightLayer: () => {
      highlightLayer?.destroy();
      highlightLayer = null;
    },
    logEvent,
    onSubmit: handleBBoxSubmit,
    refreshLayoutResizeObservation,
    resetDetectMode: () => {
      activeDetectMode = null;
      lastFullPageLayoutKey = "";
    },
    setActiveOverlay: (overlay) => {
      activeOverlay = overlay;
    },
  });
}

async function handleBBoxSubmit(bbox: BoundingBox, forceVision: boolean) {
  await submitManualCapture(bbox, {
    forceVision,
    isPendingSubmit: () => pendingSubmit,
    pipelineDeps: {
      floatingMgr,
      resolveQuestionBlockFromBBox,
      extractQuestionImageUrlFromBBox,
      screenshotWithRetry,
      cropScreenshot,
      loadSettings,
      getProvider,
      parseWithTieredRetries,
      withTimeout,
      addHistoryEntry,
      isLikelyIncompleteStem,
      shouldPreferVisionResult,
      shouldForceSecondVisionReview,
      shouldPreferSecondVisionResult,
      logEvent,
    },
    pipelineTimeoutMs: manualParsePipelineTimeoutMs,
    setActiveOverlay: (overlay) => {
      activeOverlay = overlay;
    },
    setPendingSubmit: (pending) => {
      pendingSubmit = pending;
    },
  });
}

async function handleAutoSolveAll() {
  await runAutoSolveAll(
    {
      isRunning: () => autoSolveRunning,
      setRunning: (running) => {
        autoSolveRunning = running;
      },
      isStopRequested: () => autoSolveStopRequested,
      requestStop: (stop) => {
        autoSolveStopRequested = stop;
      },
    },
    {
      activeCandidates,
      activeDetectMode,
      clickNextQuestionButton,
      detectCandidatesFullPage: async () => detectCandidatesFullPage(() => {}),
      detectCandidatesInViewport,
      detectTotalQuestionCount,
      extractAutoSolveQuestionOrder,
      extractQuestionImageUrlFromBBox,
      extractRichQuestionPreviewFromElement,
      extractTextFromBBox,
      fillParsedAnswerInPage,
      findBestDetectedCandidateForBBox,
      findMatchingFullPageCandidate,
      findNextQuestionButton,
      findReusableHistoryEntry: (entries, block, hostname) =>
        findReusableHistoryEntry(entries, block, hostname ?? location.hostname),
      getAutoSolveFingerprint,
      getAutoSolveTextFingerprint,
      getScrollLeft,
      hasVisibleAutoSolveMedia,
      inferAutoSolveQuestionType,
      inspectAutoSolveAnswerState,
      isChoiceLikeQuestionType,
      isExtensionUiElement,
      loadHistory,
      normalizeQuestionText,
      parseBlockForAutoSolve,
      parseBlockForAutoSolveQuickReview,
      parseBlockForAutoSolveReview,
      pauseMs,
      pickBestAutoSolvePreviewText,
      pickLiveAutoSolveBlock,
      projectViewportBboxToAbsolute,
      recordAutoSolveHistory,
      refineFullPageCandidatesViaManualPipeline,
      refineViewportCandidate: (candidate: QuestionBlock, root: ScanScrollRoot) =>
        refineViewportCandidate(candidate, root, {
          detectCandidatesInViewport,
          extractQuestionImageUrlFromBBox,
          extractQuestionOrder: extractAutoSolveQuestionOrder,
          extractTextFromBBox,
          inferQuestionType: inferAutoSolveQuestionType,
          pickBestPreviewText: pickBestAutoSolvePreviewText,
          resolveQuestionBlockFromBBox,
          shouldPreferViewportPreview,
        }),
      reportLocationHostname: () => location.hostname,
      resolveQuestionAdvance: waitForQuestionAdvance,
      resolveQuestionBlockFromBBox,
      resolveScrollRoot: resolveFullPageScrollRoot,
      sendAutoSolveDone,
      sendAutoSolveProgress,
      setScrollPosition,
      shouldPersistAutoSolveParseResult,
      shouldPreferViewportPreview,
      shouldRetryUnstableChoiceParse,
      shouldReviewLowConfidenceHistory,
      shouldStopAutoSolveAtTail,
      sortAutoSolveCandidates,
      verifyParsedAnswerInPage,
    },
  );
}

// 鈹€鈹€鈹€ Full Page Detect 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// 鈹€鈹€鈹€ Auto Detect 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

