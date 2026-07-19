/**
 * Content Script Main (M1-M6 complete)
 * Adds: keyboard shortcut Alt+Q, streaming, scroll offset, retry, SPA watch
 */

import { FloatingWindowManager } from "./floating/FloatingWindowManager";
import { detectCandidatesInViewport } from "./detector/domDetector";
import {
  detectCandidatesFullPage,
  cancelFullPageScan,
  resolveFullPageScrollRoot,
  getScrollLeft,
  setScrollPosition,
} from "./detector/fullPageDetector";
import { fillParsedAnswerInPage, verifyParsedAnswerInPage } from "./answerFiller";
import { findMatchingFullPageCandidate, projectViewportBboxToAbsolute } from "./candidateMatching";
import { createContentRuntimeMessageListener, registerContentRuntimeMessageHandlers } from "./contentRuntimeMessages";
import {
  detectTotalQuestionCount,
  extractQuestionImageUrlFromBBox,
  extractRichQuestionPreviewFromElement,
  extractTextFromBBox,
  findBestDetectedCandidateForBBox,
  hasVisibleAutoSolveMedia,
  inspectAutoSolveAnswerState,
  isExtensionUiElement,
  normalizeQuestionText,
  resolveQuestionBlockFromBBox,
} from "./contentQuestionServices";
import { refineViewportCandidate } from "./viewportCandidateRefinement";
import {
  extractAutoSolveQuestionOrder,
  findReusableHistoryEntry,
  getAutoSolveFingerprint,
  getAutoSolveTextFingerprint,
  inferAutoSolveQuestionType,
  isChoiceLikeQuestionType,
  isLikelyIncompleteStem,
  shouldForceSecondVisionReview,
  shouldPreferSecondVisionResult,
  shouldPreferVisionResult,
  shouldPersistAutoSolveParseResult,
  shouldRetryUnstableChoiceParse,
  shouldStopAutoSolveAtTail,
} from "./autoSolveHeuristics";
import { pickBestAutoSolvePreviewText } from "./autoSolvePreview";
import { pauseMs, withTimeout } from "./contentRuntime";
import { initAnalytics } from "@/shared/utils/analytics";
import { createContentMainBridges } from "./contentMainBridges";
import { createContentRuntimeState } from "./contentRuntimeState";
import { createContentMainWorkflows } from "./contentMainWorkflows";
import type { ExtMessage } from "@/shared/types";

type ContentRuntimeMessageListener = (
  message: ExtMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean;

let runtimeListener: ContentRuntimeMessageListener | null = null;
let runtimeWorkflows: ReturnType<typeof createContentMainWorkflows> | null = null;

export function bootstrapContentRuntime(): ContentRuntimeMessageListener {
  if (runtimeListener) return runtimeListener;

  initAnalytics();

  const floatingMgr = new FloatingWindowManager();
  const runtimeState = createContentRuntimeState();
  let startManualCaptureImpl = (_forceVisionMode: boolean) => {};
  function startManualCapture(forceVisionMode: boolean) {
    startManualCaptureImpl(forceVisionMode);
  }
  const {
    captureBlockImage,
    clickNextQuestionButton,
    findNextQuestionButton,
    handleAutoDetect,
    handleFullPageDetect,
    layoutWatch,
    manualParsePipelineTimeoutMs,
    notifySidePanel,
    parseBlockForAutoSolve,
    parseBlockForAutoSolveQuickReview,
    parseBlockForAutoSolveReview,
    parseWithTieredRetries,
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
    candidateStatusMap: runtimeState.candidateStatusMap,
    floatingMgr,
    refreshLayoutResizeObservation,
    scheduleHighlightRelayoutRescan,
    startManualCapture,
    state: runtimeState,
  });
  const workflows = createContentMainWorkflows({
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
    floatingMgr,
    getAutoSolveFingerprint,
    getAutoSolveTextFingerprint,
    getScrollLeft,
    hasVisibleAutoSolveMedia,
    inferAutoSolveQuestionType,
    inspectAutoSolveAnswerState,
    isChoiceLikeQuestionType,
    isExtensionUiElement,
    isLikelyIncompleteStem,
    layoutWatch,
    manualParsePipelineTimeoutMs,
    normalizeQuestionText,
    parseBlockForAutoSolve,
    parseBlockForAutoSolveQuickReview,
    parseBlockForAutoSolveReview,
    parseWithTieredRetries,
    pauseMs,
    pickBestAutoSolvePreviewText,
    pickLiveAutoSolveBlock,
    projectViewportBboxToAbsolute,
    recordAutoSolveHistory,
    refineFullPageCandidatesViaManualPipeline,
    refineViewportCandidate,
    resolveFullPageScrollRoot,
    resolveQuestionBlockFromBBox,
    runtimeState,
    screenshotWithRetry,
    sendAutoSolveDone,
    sendAutoSolveProgress,
    setScrollPosition,
    shouldForceSecondVisionReview,
    shouldPersistAutoSolveParseResult,
    shouldPreferSecondVisionResult,
    shouldPreferVisionResult,
    shouldPreferViewportPreview,
    shouldRetryUnstableChoiceParse,
    shouldReviewLowConfidenceHistory,
    shouldStopAutoSolveAtTail,
    sortAutoSolveCandidates,
    verifyParsedAnswerInPage,
    waitForQuestionAdvance,
    withTimeout,
  });
  runtimeWorkflows = workflows;
  startManualCaptureImpl = workflows.startManualCapture;

  // Floating Trigger Button
  // Disabled by default - only create when user explicitly triggers capture
  // if (!FloatingTrigger.getExisting()) {
  //   new FloatingTrigger(() => startManualCapture(false));
  // }

  workflows.ensureLayoutResizeObserver();
  workflows.refreshLayoutResizeObservation();

  const messageHandlerOptions = {
    cancelFullPageScan,
    cancelManualCapture: () => {
      runtimeState.destroyActiveOverlay();
    },
    candidateStatusMap: runtimeState.candidateStatusMap,
    captureBlockImage,
    clearHighlightLayer: () => {
      runtimeState.getHighlightLayer()?.destroy();
      runtimeState.setHighlightLayer(null);
    },
    closeFloatingResult: () => {
      floatingMgr.close();
    },
    fillParsedAnswerInPage,
    getActiveCandidates: runtimeState.getActiveCandidates,
    getActiveHighlightBlocks: runtimeState.getActiveHighlightBlocks,
    getHighlightLayer: runtimeState.getHighlightLayer,
    handleAutoDetect,
    handleFullPageDetect,
    notifySidePanel,
    refreshLayoutResizeObservation: workflows.refreshLayoutResizeObservation,
    resetDetectionArtifacts: () => {
      runtimeState.destroyActiveOverlay();
      runtimeState.resetDetectionArtifacts();
    },
    startAutoSolveAll: () => {
      void workflows.handleAutoSolveAll();
    },
    startManualCapture,
    stopAutoSolveAll: () => {
      runtimeState.setAutoSolveStopRequested(true);
    },
    stopSpaWatch: runtimeState.stopSpaWatch,
    verifyParsedAnswerInPage,
  } satisfies Parameters<typeof createContentRuntimeMessageListener>[0];

  registerContentRuntimeMessageHandlers(messageHandlerOptions);
  runtimeListener = createContentRuntimeMessageListener(messageHandlerOptions);
  return runtimeListener;
}

function scheduleHighlightRelayoutRescan() {
  runtimeWorkflows?.scheduleHighlightRelayoutRescan();
}

function refreshLayoutResizeObservation() {
  runtimeWorkflows?.refreshLayoutResizeObservation();
}

// Full Page Detect
// Auto Detect

