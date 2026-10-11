import type { QuestionBlock } from "@/shared/types";
import type { HighlightLayer } from "./highlight/HighlightLayer";
import {
  handleAutoDetect as handleAutoDetectCore,
  handleFullPageDetect as handleFullPageDetectCore,
  notifySidePanel as notifySidePanelCore,
} from "./detectOrchestration";
import type { ScanScrollRoot } from "./detector/fullPageDetector";

type CandidateStatus = { status: string; selected: boolean };

type DetectSessionDeps = {
  candidateStatusMap: Map<string, CandidateStatus>;
  clearRouteOwnedState?: () => void;
  createHighlightLayer: (options: ConstructorParameters<typeof HighlightLayer>[0]) => HighlightLayer;
  cancelFullPageScan: () => void;
  detectCandidatesFullPage: (onProgress: (progress: {
    progress: number;
    found: number;
    currentStep: number;
    totalScrollSteps: number;
  }) => void) => Promise<QuestionBlock[]>;
  detectCandidatesInViewport: () => QuestionBlock[];
  destroyHighlightLayer: () => void;
  getFullPageLayoutKey: (scrollRoot: ScanScrollRoot) => string;
  isFullPageScanRunning: () => boolean;
  isRuntimeCurrent?: () => boolean;
  logEvent: (event: "auto_detect_started" | "auto_detect_candidates_found" | "auto_detect_candidate_selected", data?: Record<string, unknown>) => void;
  notifySidePanel: (candidates: QuestionBlock[]) => void;
  refreshFullPageHighlightsAfterLayoutChange: () => void;
  refreshLayoutResizeObservation: () => void;
  refineFullPageCandidatesViaManualPipeline: (candidates: QuestionBlock[]) => Promise<QuestionBlock[]>;
  resolveFullPageScrollRoot: () => ScanScrollRoot;
  safeRuntimeSendMessage: (message: unknown) => void;
  setActiveCandidates: (candidates: QuestionBlock[]) => void;
  setActiveDetectMode: (mode: "viewport" | "fullpage") => void;
  setActiveHighlightBlocks: (blocks: QuestionBlock[]) => void;
  setHighlightLayer: (layer: HighlightLayer | null) => void;
  setLastFullPageLayoutKey: (layoutKey: string) => void;
  setUnwatchSPA: (unwatch: (() => void) | null) => void;
  stopSpaWatch: () => void;
  watchForPageChanges: (onChange: (blocks: QuestionBlock[], rootKey?: string) => void) => () => void;
};

export function notifyDetectedCandidates(
  candidates: QuestionBlock[],
  deps: Pick<DetectSessionDeps, "candidateStatusMap" | "safeRuntimeSendMessage">,
): void {
  notifySidePanelCore(candidates, {
    candidateStatusMap: deps.candidateStatusMap,
    safeRuntimeSendMessage: deps.safeRuntimeSendMessage,
  });
}

/**
 * Bind only Full Page PROGRESS/DONE to the immutable START identity. Other
 * runtime notifications and legacy untagged calls preserve their contracts.
 * Each invocation owns its closure, never a mutable last-run global.
 */
export function bindFullPageGeneration(
  emit: (message: unknown) => void,
  generationId?: string,
): (message: unknown) => void {
  return (message: unknown) => {
    if (generationId && message && typeof message === "object" && !Array.isArray(message)) {
      const m = message as { type?: unknown };
      if (m.type === "FULL_PAGE_DETECT_PROGRESS" || m.type === "FULL_PAGE_DETECT_DONE") {
        emit({ ...message, generationId });
        return;
      }
    }
    emit(message);
  };
}

export async function runFullPageDetectSession(
  deps: DetectSessionDeps, generationId?: string,
): Promise<void> {
  const isRuntimeCurrent = deps.isRuntimeCurrent ?? (() => true);
  if (!isRuntimeCurrent()) return;
  const result = await handleFullPageDetectCore({
    isFullPageScanRunning: deps.isFullPageScanRunning,
    isRuntimeCurrent,
    clearRouteOwnedState: deps.clearRouteOwnedState,
    cancelFullPageScan: deps.cancelFullPageScan,
    logEvent: deps.logEvent,
    destroyHighlightLayer: deps.destroyHighlightLayer,
    stopSpaWatch: deps.stopSpaWatch,
    candidateStatusMap: deps.candidateStatusMap,
    refreshLayoutResizeObservation: deps.refreshLayoutResizeObservation,
    safeRuntimeSendMessage: bindFullPageGeneration(deps.safeRuntimeSendMessage, generationId),
    commitBeforeDone: (result) => {
      if (!isRuntimeCurrent()) return;
      deps.setActiveCandidates(result.activeCandidates);
      deps.setActiveHighlightBlocks(result.activeHighlightBlocks);
      deps.setActiveDetectMode(result.activeDetectMode);
      deps.setLastFullPageLayoutKey(result.lastFullPageLayoutKey);
      // The real factory returns HighlightLayer; orchestration's generic
      // signature intentionally exposes only the setBlocks capability.
      deps.setHighlightLayer(result.highlightLayer as HighlightLayer | null);
    },
    detectCandidatesFullPage: deps.detectCandidatesFullPage,
    refineFullPageCandidatesViaManualPipeline: deps.refineFullPageCandidatesViaManualPipeline,
    resolveFullPageScrollRoot: deps.resolveFullPageScrollRoot,
    getFullPageLayoutKey: deps.getFullPageLayoutKey,
    createHighlightLayer: (options) => deps.createHighlightLayer(options),
    refreshFullPageHighlightsAfterLayoutChange: deps.refreshFullPageHighlightsAfterLayoutChange,
    notifySidePanel: deps.notifySidePanel,
  });
  // All active state has been committed synchronously BEFORE terminal DONE.
  // Never replay a stale result here after another generation has started.
  if (result && !isRuntimeCurrent()) (result.highlightLayer as HighlightLayer | null)?.destroy();
}

export async function runAutoDetectSession(deps: DetectSessionDeps): Promise<void> {
  const isRuntimeCurrent = deps.isRuntimeCurrent ?? (() => true);
  if (!isRuntimeCurrent()) return;
  const result = handleAutoDetectCore({
    logEvent: deps.logEvent,
    destroyHighlightLayer: deps.destroyHighlightLayer,
    stopSpaWatch: deps.stopSpaWatch,
    candidateStatusMap: deps.candidateStatusMap,
    clearRouteOwnedState: deps.clearRouteOwnedState,
    detectCandidatesInViewport: deps.detectCandidatesInViewport,
    notifySidePanel: deps.notifySidePanel,
    isRuntimeCurrent,
    createHighlightLayer: (options) => deps.createHighlightLayer(options),
    watchForPageChanges: deps.watchForPageChanges,
  });
  deps.setActiveCandidates(result.activeCandidates);
  deps.setActiveHighlightBlocks(result.activeHighlightBlocks);
  deps.setActiveDetectMode(result.activeDetectMode);
  deps.setHighlightLayer(result.highlightLayer);
  deps.setUnwatchSPA(result.unwatchSPA);
}
