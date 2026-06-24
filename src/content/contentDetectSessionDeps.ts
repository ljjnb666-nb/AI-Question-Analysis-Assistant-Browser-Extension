import type { QuestionBlock } from "@/shared/types";
import type { HighlightLayer } from "./highlight/HighlightLayer";
import type { refineFullPageCandidatesViaManualPipeline as refineFullPageCandidatesViaManualPipelineCore } from "./fullPagePlan";
import type {
  notifyDetectedCandidates,
  runAutoDetectSession,
  runFullPageDetectSession,
} from "./contentDetectionSession";

type DetectSessionDeps = Parameters<typeof runFullPageDetectSession>[0];
type AutoDetectSessionDeps = Parameters<typeof runAutoDetectSession>[0];
type NotifyDetectedCandidatesDeps = Parameters<typeof notifyDetectedCandidates>[1];
type RefineFullPageDeps = Parameters<typeof refineFullPageCandidatesViaManualPipelineCore>[1];

type SharedDetectSessionFactoryOptions = {
  candidateStatusMap: DetectSessionDeps["candidateStatusMap"];
  cancelFullPageScan: DetectSessionDeps["cancelFullPageScan"];
  createHighlightLayer: DetectSessionDeps["createHighlightLayer"];
  detectCandidatesFullPage: DetectSessionDeps["detectCandidatesFullPage"];
  detectCandidatesInViewport: DetectSessionDeps["detectCandidatesInViewport"];
  getFullPageLayoutKey: DetectSessionDeps["getFullPageLayoutKey"];
  isFullPageScanRunning: DetectSessionDeps["isFullPageScanRunning"];
  logEvent: DetectSessionDeps["logEvent"];
  notifySidePanel: DetectSessionDeps["notifySidePanel"];
  refreshFullPageHighlightsAfterLayoutChange: DetectSessionDeps["refreshFullPageHighlightsAfterLayoutChange"];
  refreshLayoutResizeObservation: DetectSessionDeps["refreshLayoutResizeObservation"];
  refineFullPageCandidatesViaManualPipeline: DetectSessionDeps["refineFullPageCandidatesViaManualPipeline"];
  resolveFullPageScrollRoot: DetectSessionDeps["resolveFullPageScrollRoot"];
  safeRuntimeSendMessage: DetectSessionDeps["safeRuntimeSendMessage"];
  watchForPageChanges: DetectSessionDeps["watchForPageChanges"];
  destroyHighlightLayer: () => void;
  setActiveCandidates: (candidates: QuestionBlock[]) => void;
  setActiveDetectMode: (mode: "viewport" | "fullpage") => void;
  setActiveHighlightBlocks: (blocks: QuestionBlock[]) => void;
  setHighlightLayer: (layer: HighlightLayer | null) => void;
  setLastFullPageLayoutKey: (layoutKey: string) => void;
  setUnwatchSPA: (unwatch: (() => void) | null) => void;
  stopSpaWatch: () => void;
};

export function createDetectSessionDeps(
  options: SharedDetectSessionFactoryOptions,
): DetectSessionDeps & AutoDetectSessionDeps {
  return {
    candidateStatusMap: options.candidateStatusMap,
    cancelFullPageScan: options.cancelFullPageScan,
    createHighlightLayer: options.createHighlightLayer,
    detectCandidatesFullPage: options.detectCandidatesFullPage,
    detectCandidatesInViewport: options.detectCandidatesInViewport,
    destroyHighlightLayer: options.destroyHighlightLayer,
    getFullPageLayoutKey: options.getFullPageLayoutKey,
    isFullPageScanRunning: options.isFullPageScanRunning,
    logEvent: options.logEvent,
    notifySidePanel: options.notifySidePanel,
    refreshFullPageHighlightsAfterLayoutChange: options.refreshFullPageHighlightsAfterLayoutChange,
    refreshLayoutResizeObservation: options.refreshLayoutResizeObservation,
    refineFullPageCandidatesViaManualPipeline: options.refineFullPageCandidatesViaManualPipeline,
    resolveFullPageScrollRoot: options.resolveFullPageScrollRoot,
    safeRuntimeSendMessage: options.safeRuntimeSendMessage,
    setActiveCandidates: options.setActiveCandidates,
    setActiveDetectMode: options.setActiveDetectMode,
    setActiveHighlightBlocks: options.setActiveHighlightBlocks,
    setHighlightLayer: options.setHighlightLayer,
    setLastFullPageLayoutKey: options.setLastFullPageLayoutKey,
    setUnwatchSPA: options.setUnwatchSPA,
    stopSpaWatch: options.stopSpaWatch,
    watchForPageChanges: options.watchForPageChanges,
  };
}

export function createRefineFullPageDeps(options: RefineFullPageDeps): RefineFullPageDeps {
  return options;
}

export function createNotifySidePanelDeps(
  options: NotifyDetectedCandidatesDeps,
): NotifyDetectedCandidatesDeps {
  return {
    candidateStatusMap: options.candidateStatusMap,
    safeRuntimeSendMessage: options.safeRuntimeSendMessage,
  };
}
