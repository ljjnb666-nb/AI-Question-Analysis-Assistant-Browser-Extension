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
  watchForPageChanges: (onChange: (blocks: QuestionBlock[]) => void) => () => void;
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

export async function runFullPageDetectSession(deps: DetectSessionDeps): Promise<void> {
  const result = await handleFullPageDetectCore({
    isFullPageScanRunning: deps.isFullPageScanRunning,
    cancelFullPageScan: deps.cancelFullPageScan,
    logEvent: deps.logEvent,
    destroyHighlightLayer: deps.destroyHighlightLayer,
    stopSpaWatch: deps.stopSpaWatch,
    candidateStatusMap: deps.candidateStatusMap,
    refreshLayoutResizeObservation: deps.refreshLayoutResizeObservation,
    safeRuntimeSendMessage: deps.safeRuntimeSendMessage,
    detectCandidatesFullPage: deps.detectCandidatesFullPage,
    refineFullPageCandidatesViaManualPipeline: deps.refineFullPageCandidatesViaManualPipeline,
    resolveFullPageScrollRoot: deps.resolveFullPageScrollRoot,
    getFullPageLayoutKey: deps.getFullPageLayoutKey,
    createHighlightLayer: (options) => deps.createHighlightLayer(options),
    refreshFullPageHighlightsAfterLayoutChange: deps.refreshFullPageHighlightsAfterLayoutChange,
    notifySidePanel: deps.notifySidePanel,
  });
  if (!result) return;
  deps.setActiveCandidates(result.activeCandidates);
  deps.setActiveHighlightBlocks(result.activeHighlightBlocks);
  deps.setActiveDetectMode(result.activeDetectMode);
  deps.setLastFullPageLayoutKey(result.lastFullPageLayoutKey);
  deps.setHighlightLayer(result.highlightLayer);
}

export async function runAutoDetectSession(deps: DetectSessionDeps): Promise<void> {
  const result = handleAutoDetectCore({
    logEvent: deps.logEvent,
    destroyHighlightLayer: deps.destroyHighlightLayer,
    stopSpaWatch: deps.stopSpaWatch,
    candidateStatusMap: deps.candidateStatusMap,
    detectCandidatesInViewport: deps.detectCandidatesInViewport,
    notifySidePanel: deps.notifySidePanel,
    createHighlightLayer: (options) => deps.createHighlightLayer(options),
    watchForPageChanges: deps.watchForPageChanges,
  });
  deps.setActiveCandidates(result.activeCandidates);
  deps.setActiveHighlightBlocks(result.activeHighlightBlocks);
  deps.setActiveDetectMode(result.activeDetectMode);
  deps.setHighlightLayer(result.highlightLayer);
  deps.setUnwatchSPA(result.unwatchSPA);
}
