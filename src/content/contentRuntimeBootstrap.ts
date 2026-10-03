/**
 * Content Script Main (M1-M6 complete)
 * Adds: keyboard shortcut Alt+Q, streaming, scroll offset, retry, SPA watch
 */

import { FloatingWindowManager } from "./floating/FloatingWindowManager";
import { detectCandidatesAcrossRoots, detectCandidatesInViewport } from "./detector/domDetector";
import {
  detectCandidatesFullPage,
  cancelFullPageScan,
  resolveFullPageScrollRoot,
  getScrollLeft,
  setScrollPosition,
} from "./detector/fullPageDetector";
import { disposeAnswerFillerRuntimeState, clearAutoSolveSnapshotState, fillParsedAnswerInPage, verifyParsedAnswerInPage } from "./answerFiller";
import { findMatchingFullPageCandidate, projectViewportBboxToAbsolute } from "./candidateMatching";
import { registerContentRuntimeMessageHandlers } from "./contentRuntimeMessages";
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
import { pauseMs, withTimeout, safeRuntimeSendMessage, sendAutoSolveDone as sendLegacyAutoSolveDone, sendAutoSolveProgress as sendLegacyAutoSolveProgress } from "./contentRuntime";
import { createCandidateWorkspaceRuntime } from "./candidateWorkspaceRuntime";
import { initAnalytics } from "@/shared/utils/analytics";
import { createContentMainBridges } from "./contentMainBridges";
import { createContentRuntimeState } from "./contentRuntimeState";
import { createContentMainWorkflows } from "./contentMainWorkflows";
import { beginContentRuntimeGeneration } from "./contentRuntimeLifecycle";
import { startContentRouteLifecycleWatch } from "./revision/contentRouteLifecycle";
import { controlRegistry } from "./answer/controlRegistry";
import { sharedRootRegistry } from "./roots/rootRegistry";
import { invalidateAllRuntimeQuestionHandles } from "./roots/rootContext";
import { disposeQuestionRevisionRuntime } from "./revision/questionRevisionRuntime";
import { runtimeMediaPayloadStore } from "./media/mediaPayloadStore";
import { runtimeMediaSourceLocatorStore } from "./media/mediaSourceLocatorStore";
import type { ExtMessage } from "@/shared/types";

export type ContentRuntimeMessageListener = (
  message: ExtMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean;

export type ContentRuntimeHandle = {
  generation: number;
  listener: ContentRuntimeMessageListener;
  dispose: () => void;
};

let activeRuntime: ContentRuntimeHandle | null = null;

export function bootstrapContentRuntime(options: { onShutdown?: () => void } = {}): ContentRuntimeHandle {
  if (activeRuntime) return activeRuntime;

  const lifecycle = beginContentRuntimeGeneration();
  initAnalytics();

  const floatingMgr = new FloatingWindowManager();
  const runtimeState = createContentRuntimeState();
  const workspace = createCandidateWorkspaceRuntime({ url: () => location.href, send: safeRuntimeSendMessage });
  const cancelWorkspaceScan = () => {
    cancelFullPageScan();
    workspace.cancelFullPage();
  };
  let workflows: ReturnType<typeof createContentMainWorkflows> | null = null;
  let startManualCaptureImpl = (_forceVisionMode: boolean) => {};
  function startManualCapture(forceVisionMode: boolean) {
    startManualCaptureImpl(forceVisionMode);
  }
  const {
    captureBlockImage,
    abortCurrentSolveAttempt,
    clickNextQuestionButton,
    clearRouteOwnedState,
    disposeBindings,
    findNextQuestionButton,
    handleAutoDetect,
    handleFullPageDetect,
    layoutWatch,
    manualParsePipelineTimeoutMs,
    notifySidePanel,
    parseBlockForAutoSolve,
    parseBlockForAutoSolveQuickReview,
    parseBlockForAutoSolveReview,
    isCurrentAutoSolveResult,
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
    workspace,
    candidateStatusMap: runtimeState.candidateStatusMap,
    floatingMgr,
    isRuntimeCurrent: lifecycle.isCurrent,
    refreshLayoutResizeObservation: () => workflows?.refreshLayoutResizeObservation(),
    scheduleHighlightRelayoutRescan: () => workflows?.scheduleHighlightRelayoutRescan(),
    startManualCapture,
    state: runtimeState,
  });
  workflows = createContentMainWorkflows({
    workspaceRouteEpoch: () => workspace.metadata().routeEpoch,
    // Preserve owner termination and safety evidence without projecting an
    // old route's completion/progress into the current workspace snapshot.
    setSupersededAutoSolveStopped: () => runtimeState.setAutoSolveRunning(false),
    sendSupersededAutoSolveDone: sendLegacyAutoSolveDone,
    sendSupersededAutoSolveProgress: sendLegacyAutoSolveProgress,
    isRuntimeCurrent: lifecycle.isCurrent,
    clickNextQuestionButton,
    detectCandidatesFullPage: async () => detectCandidatesFullPage(() => {}),
    detectCandidatesAcrossRoots,
    detectCandidatesInViewport,
    detectTotalQuestionCount,
    extractAutoSolveQuestionOrder,
    extractQuestionImageUrlFromBBox,
    extractRichQuestionPreviewFromElement,
    extractTextFromBBox,
    fillParsedAnswerInPage: (block, result, fillOptions) => fillParsedAnswerInPage(block, result, {
      ...fillOptions,
      isRuntimeCurrent: lifecycle.isCurrent,
    }),
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
    isCurrentAutoSolveResult,
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
    runtimeState: { ...runtimeState, setAutoSolveRunning: (running) => {
      runtimeState.setAutoSolveRunning(running);
      workspace.setAutoSolveRunning(running);
    } },
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
  startManualCaptureImpl = workflows.startManualCapture;

  const stopContentRouteLifecycleWatch = startContentRouteLifecycleWatch(() => {
    if (!lifecycle.isCurrent()) return;
    runtimeState.setAutoSolveStopRequested(true);
    abortCurrentSolveAttempt();
    controlRegistry.clear();
    clearAutoSolveSnapshotState();
    cancelFullPageScan();
    runtimeState.destroyActiveOverlay();
    floatingMgr.close();
    clearRouteOwnedState();
  });

  // Floating Trigger Button
  // Disabled by default - only create when user explicitly triggers capture
  // if (!FloatingTrigger.getExisting()) {
  //   new FloatingTrigger(() => startManualCapture(false));
  // }

  workflows.ensureLayoutResizeObserver();
  workflows.refreshLayoutResizeObservation();

  const messageHandlerOptions = {
    cancelFullPageScan: cancelWorkspaceScan,
    getWorkspaceSnapshot: workspace.snapshot,
    notifySelectionChanged: () => {
      const candidates = workspace.updateSelection(runtimeState.candidateStatusMap);
      safeRuntimeSendMessage({ type: "AUTO_DETECT_RESULT_READY", candidates, ...workspace.metadata() });
    },
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
    fillParsedAnswerInPage: (block, result, fillOptions) => fillParsedAnswerInPage(block, result, {
      ...fillOptions,
      isRuntimeCurrent: lifecycle.isCurrent,
    }),
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
      workspace.resetDetection();
    },
    startAutoSolveAll: () => {
      void workflows.handleAutoSolveAll();
    },
    startManualCapture,
    stopAutoSolveAll: () => {
      runtimeState.setAutoSolveStopRequested(true);
      abortCurrentSolveAttempt();
    },
    stopSpaWatch: runtimeState.stopSpaWatch,
    verifyParsedAnswerInPage,
    isRuntimeCurrent: lifecycle.isCurrent,
  } satisfies Parameters<typeof registerContentRuntimeMessageHandlers>[0];

  const listener = registerContentRuntimeMessageHandlers(messageHandlerOptions);
  let disposed = false;
  const runtimeHandle: ContentRuntimeHandle = {
    generation: lifecycle.generation,
    listener,
    dispose() {
      if (disposed) return;
      disposed = true;
      lifecycle.invalidate();
      const cleanup = (action: () => void) => {
        try {
          action();
        } catch (error) {
          console.warn("[ContentRuntime] shutdown cleanup failed:", error);
        }
      };

      cleanup(() => chrome.runtime.onMessage.removeListener(listener));
      cleanup(stopContentRouteLifecycleWatch);
      cleanup(() => runtimeState.setAutoSolveStopRequested(true));
      cleanup(abortCurrentSolveAttempt);
      cleanup(disposeAnswerFillerRuntimeState);
      cleanup(cancelFullPageScan);
      cleanup(runtimeState.destroyActiveOverlay);
      cleanup(runtimeState.stopSpaWatch);
      cleanup(disposeBindings);
      cleanup(layoutWatch.dispose);
      cleanup(() => {
        runtimeState.getHighlightLayer()?.destroy();
        runtimeState.setHighlightLayer(null);
      });
      cleanup(() => floatingMgr.destroy());
      cleanup(() => controlRegistry.clear());
      cleanup(disposeQuestionRevisionRuntime);
      cleanup(() => sharedRootRegistry().reset());
      cleanup(invalidateAllRuntimeQuestionHandles);
      cleanup(() => runtimeMediaPayloadStore.clear());
      cleanup(() => runtimeMediaSourceLocatorStore.clear());
      cleanup(runtimeState.disposeEphemeralState);
      cleanup(workspace.dispose);

      if (activeRuntime === runtimeHandle) activeRuntime = null;
      cleanup(() => options.onShutdown?.());
    },
  };
  activeRuntime = runtimeHandle;
  return runtimeHandle;
}

export function shutdownContentRuntime(): void {
  activeRuntime?.dispose();
}

