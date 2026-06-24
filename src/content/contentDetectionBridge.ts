import type { QuestionBlock } from "@/shared/types";
import type { HighlightLayer } from "./highlight/HighlightLayer";
import type { ScanScrollRoot } from "./detector/fullPageDetector";
import { notifyDetectedCandidates, runAutoDetectSession, runFullPageDetectSession } from "./contentDetectionSession";
import { createDetectSessionDeps as createDetectSessionDepsFactory, createNotifySidePanelDeps as createNotifySidePanelDepsFactory, createRefineFullPageDeps as createRefineFullPageDepsFactory } from "./contentDetectSessionDeps";
import { refineFullPageCandidatesViaManualPipeline as refineFullPageCandidatesViaManualPipelineCore } from "./fullPagePlan";

type BridgeDeps = {
  candidateStatusMap: Map<string, { status: string; selected: boolean }>;
  cancelFullPageScan: () => void;
  createHighlightLayer: (options: ConstructorParameters<typeof HighlightLayer>[0]) => HighlightLayer;
  detectCandidatesFullPage: Parameters<typeof createDetectSessionDepsFactory>[0]["detectCandidatesFullPage"];
  detectCandidatesInViewport: Parameters<typeof createDetectSessionDepsFactory>[0]["detectCandidatesInViewport"];
  destroyHighlightLayer: () => void;
  getFullPageLayoutKey: (scrollRoot: ScanScrollRoot) => string;
  getScrollLeft: (scrollRoot: ScanScrollRoot) => number;
  getScrollTop: (scrollRoot: ScanScrollRoot) => number;
  isFullPageScanRunning: () => boolean;
  logEvent: Parameters<typeof createDetectSessionDepsFactory>[0]["logEvent"];
  pauseFullPage: (ms: number) => Promise<void>;
  pickBestAutoSolvePreviewText: Parameters<typeof createRefineFullPageDepsFactory>[0]["pickBestAutoSolvePreviewText"];
  projectViewportBboxToAbsolute: Parameters<typeof createRefineFullPageDepsFactory>[0]["projectViewportBboxToAbsolute"];
  refineViewportCandidate: Parameters<typeof createRefineFullPageDepsFactory>[0]["refineViewportCandidate"];
  resolveFullPageScrollRoot: Parameters<typeof createDetectSessionDepsFactory>[0]["resolveFullPageScrollRoot"];
  resolveQuestionBlockFromBBox: Parameters<typeof createRefineFullPageDepsFactory>[0]["resolveQuestionBlockFromBBox"];
  safeRuntimeSendMessage: Parameters<typeof createDetectSessionDepsFactory>[0]["safeRuntimeSendMessage"];
  setActiveCandidates: (candidates: QuestionBlock[]) => void;
  setActiveDetectMode: (mode: "viewport" | "fullpage" | null) => void;
  setActiveHighlightBlocks: (blocks: QuestionBlock[]) => void;
  setAutoSolveStopRequestedGetter: () => boolean;
  setHighlightLayer: (layer: HighlightLayer | null) => void;
  setLastFullPageLayoutKey: (layoutKey: string) => void;
  setScrollPosition: (scrollRoot: ScanScrollRoot, top: number, left: number) => void;
  setUnwatchSPA: (unwatch: (() => void) | null) => void;
  shouldPreferViewportPreviewCore: (rawPreviewText: string, richPreviewText: string, normalizeQuestionText: (text: string) => string, matchedCandidate?: QuestionBlock | null) => boolean;
  looksLikeGarbledFullPageTextCore: (text: string, normalizeQuestionText: (text: string) => string) => boolean;
  normalizeQuestionText: (text: string) => string;
  refreshFullPageHighlightsAfterLayoutChange: () => void;
  refreshLayoutResizeObservation: () => void;
  stopSpaWatch: () => void;
  watchForPageChanges: Parameters<typeof createDetectSessionDepsFactory>[0]["watchForPageChanges"];
  detectAutoSolveQuestionOrder: Parameters<typeof createRefineFullPageDepsFactory>[0]["extractAutoSolveQuestionOrder"];
  extractQuestionImageUrlFromBBox: Parameters<typeof createRefineFullPageDepsFactory>[0]["extractQuestionImageUrlFromBBox"];
  extractTextFromBBox: Parameters<typeof createRefineFullPageDepsFactory>[0]["extractTextFromBBox"];
  getAutoSolveTextFingerprint: Parameters<typeof createRefineFullPageDepsFactory>[0]["getAutoSolveTextFingerprint"];
  inferAutoSolveQuestionType: Parameters<typeof createRefineFullPageDepsFactory>[0]["inferAutoSolveQuestionType"];
};

export function createContentDetectionBridge(deps: BridgeDeps) {
  async function refineFullPageCandidatesViaManualPipeline(candidates: QuestionBlock[]): Promise<QuestionBlock[]> {
    return refineFullPageCandidatesViaManualPipelineCore(
      candidates,
      createRefineFullPageDepsFactory({
        resolveFullPageScrollRoot: deps.resolveFullPageScrollRoot,
        getScrollTop: deps.getScrollTop,
        getScrollLeft: deps.getScrollLeft,
        setScrollPosition: deps.setScrollPosition,
        pauseFullPage: deps.pauseFullPage,
        refineViewportCandidate: deps.refineViewportCandidate,
        detectCandidatesInViewport: deps.detectCandidatesInViewport,
        extractQuestionImageUrlFromBBox: deps.extractQuestionImageUrlFromBBox,
        extractAutoSolveQuestionOrder: deps.detectAutoSolveQuestionOrder,
        extractTextFromBBox: deps.extractTextFromBBox,
        inferAutoSolveQuestionType: deps.inferAutoSolveQuestionType,
        pickBestAutoSolvePreviewText: deps.pickBestAutoSolvePreviewText,
        resolveQuestionBlockFromBBox: deps.resolveQuestionBlockFromBBox,
        shouldPreferViewportPreview,
        projectViewportBboxToAbsolute: deps.projectViewportBboxToAbsolute,
        getAutoSolveTextFingerprint: deps.getAutoSolveTextFingerprint,
        autoSolveStopRequested: deps.setAutoSolveStopRequestedGetter,
      }),
    );
  }

  function shouldPreferViewportPreview(
    rawPreviewText: string,
    richPreviewText: string,
    matchedCandidate?: QuestionBlock | null,
  ): boolean {
    return deps.shouldPreferViewportPreviewCore(
      rawPreviewText,
      richPreviewText,
      deps.normalizeQuestionText,
      matchedCandidate,
    );
  }

  function looksLikeGarbledFullPageText(text: string): boolean {
    return deps.looksLikeGarbledFullPageTextCore(text, deps.normalizeQuestionText);
  }

  async function handleFullPageDetect() {
    await runFullPageDetectSession(createDetectSessionDepsFactory({
      candidateStatusMap: deps.candidateStatusMap,
      cancelFullPageScan: deps.cancelFullPageScan,
      createHighlightLayer: deps.createHighlightLayer,
      detectCandidatesFullPage: deps.detectCandidatesFullPage,
      detectCandidatesInViewport: deps.detectCandidatesInViewport,
      destroyHighlightLayer: deps.destroyHighlightLayer,
      getFullPageLayoutKey: deps.getFullPageLayoutKey,
      isFullPageScanRunning: deps.isFullPageScanRunning,
      logEvent: deps.logEvent,
      notifySidePanel,
      refreshFullPageHighlightsAfterLayoutChange: deps.refreshFullPageHighlightsAfterLayoutChange,
      refreshLayoutResizeObservation: deps.refreshLayoutResizeObservation,
      refineFullPageCandidatesViaManualPipeline,
      resolveFullPageScrollRoot: deps.resolveFullPageScrollRoot,
      safeRuntimeSendMessage: deps.safeRuntimeSendMessage,
      setActiveCandidates: deps.setActiveCandidates,
      setActiveDetectMode: deps.setActiveDetectMode,
      setActiveHighlightBlocks: deps.setActiveHighlightBlocks,
      setHighlightLayer: deps.setHighlightLayer,
      setLastFullPageLayoutKey: deps.setLastFullPageLayoutKey,
      setUnwatchSPA: deps.setUnwatchSPA,
      stopSpaWatch: deps.stopSpaWatch,
      watchForPageChanges: deps.watchForPageChanges,
    }));
  }

  async function handleAutoDetect() {
    await runAutoDetectSession(createDetectSessionDepsFactory({
      candidateStatusMap: deps.candidateStatusMap,
      cancelFullPageScan: deps.cancelFullPageScan,
      createHighlightLayer: deps.createHighlightLayer,
      detectCandidatesFullPage: deps.detectCandidatesFullPage,
      detectCandidatesInViewport: deps.detectCandidatesInViewport,
      destroyHighlightLayer: deps.destroyHighlightLayer,
      getFullPageLayoutKey: deps.getFullPageLayoutKey,
      isFullPageScanRunning: deps.isFullPageScanRunning,
      logEvent: deps.logEvent,
      notifySidePanel,
      refreshFullPageHighlightsAfterLayoutChange: deps.refreshFullPageHighlightsAfterLayoutChange,
      refreshLayoutResizeObservation: deps.refreshLayoutResizeObservation,
      refineFullPageCandidatesViaManualPipeline,
      resolveFullPageScrollRoot: deps.resolveFullPageScrollRoot,
      safeRuntimeSendMessage: deps.safeRuntimeSendMessage,
      setActiveCandidates: deps.setActiveCandidates,
      setActiveDetectMode: deps.setActiveDetectMode,
      setActiveHighlightBlocks: deps.setActiveHighlightBlocks,
      setHighlightLayer: deps.setHighlightLayer,
      setLastFullPageLayoutKey: deps.setLastFullPageLayoutKey,
      setUnwatchSPA: deps.setUnwatchSPA,
      stopSpaWatch: deps.stopSpaWatch,
      watchForPageChanges: deps.watchForPageChanges,
    }));
  }

  function notifySidePanel(candidates: QuestionBlock[]) {
    notifyDetectedCandidates(candidates, createNotifySidePanelDepsFactory({
      candidateStatusMap: deps.candidateStatusMap,
      safeRuntimeSendMessage: deps.safeRuntimeSendMessage,
    }));
  }

  return {
    handleAutoDetect,
    handleFullPageDetect,
    looksLikeGarbledFullPageText,
    notifySidePanel,
    refineFullPageCandidatesViaManualPipeline,
    shouldPreferViewportPreview,
  };
}
