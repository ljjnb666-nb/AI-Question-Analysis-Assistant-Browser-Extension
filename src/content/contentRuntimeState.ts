import type { QuestionBlock } from "@/shared/types";
import type { CaptureOverlay } from "./overlay/CaptureOverlay";
import type { HighlightLayer } from "./highlight/HighlightLayer";

export type CandidateStatusMap = Map<string, { status: string; selected: boolean }>;
export type ActiveDetectMode = "viewport" | "fullpage" | null;

export type ContentMainBridgeState = {
  getActiveCandidates: () => QuestionBlock[];
  setActiveCandidates: (candidates: QuestionBlock[]) => void;
  getActiveHighlightBlocks: () => QuestionBlock[];
  setActiveHighlightBlocks: (blocks: QuestionBlock[]) => void;
  getActiveDetectMode: () => ActiveDetectMode;
  setActiveDetectMode: (mode: ActiveDetectMode) => void;
  getHighlightLayer: () => HighlightLayer | null;
  setHighlightLayer: (layer: HighlightLayer | null) => void;
  getLastFullPageLayoutKey: () => string;
  setLastFullPageLayoutKey: (layoutKey: string) => void;
  getAutoSolveStopRequested: () => boolean;
  setUnwatchSPA: (unwatch: (() => void) | null) => void;
  stopSpaWatch: () => void;
};

export function createContentRuntimeState() {
  let activeOverlay: CaptureOverlay | null = null;
  let highlightLayer: HighlightLayer | null = null;
  let unwatchSPA: (() => void) | null = null;
  const candidateStatusMap: CandidateStatusMap = new Map();
  let activeCandidates: QuestionBlock[] = [];
  let activeHighlightBlocks: QuestionBlock[] = [];
  let activeDetectMode: ActiveDetectMode = null;
  let lastFullPageLayoutKey = "";
  let autoSolveRunning = false;
  let autoSolveStopRequested = false;
  let pendingSubmit = false;

  return {
    candidateStatusMap,
    destroyActiveOverlay() {
      activeOverlay?.destroy();
      activeOverlay = null;
    },
    getActiveCandidates: () => activeCandidates,
    setActiveCandidates: (candidates: QuestionBlock[]) => {
      activeCandidates = candidates;
    },
    getActiveDetectMode: () => activeDetectMode,
    setActiveDetectMode: (mode: ActiveDetectMode) => {
      activeDetectMode = mode;
    },
    getActiveHighlightBlocks: () => activeHighlightBlocks,
    setActiveHighlightBlocks: (blocks: QuestionBlock[]) => {
      activeHighlightBlocks = blocks;
    },
    getActiveOverlay: () => activeOverlay,
    setActiveOverlay: (overlay: CaptureOverlay | null) => {
      activeOverlay = overlay;
    },
    getAutoSolveRunning: () => autoSolveRunning,
    setAutoSolveRunning: (running: boolean) => {
      autoSolveRunning = running;
    },
    getAutoSolveStopRequested: () => autoSolveStopRequested,
    setAutoSolveStopRequested: (stopRequested: boolean) => {
      autoSolveStopRequested = stopRequested;
    },
    getHighlightLayer: () => highlightLayer,
    setHighlightLayer: (layer: HighlightLayer | null) => {
      highlightLayer = layer;
    },
    getLastFullPageLayoutKey: () => lastFullPageLayoutKey,
    setLastFullPageLayoutKey: (layoutKey: string) => {
      lastFullPageLayoutKey = layoutKey;
    },
    getPendingSubmit: () => pendingSubmit,
    setPendingSubmit: (pending: boolean) => {
      pendingSubmit = pending;
    },
    setUnwatchSPA: (unwatch: (() => void) | null) => {
      unwatchSPA = unwatch;
    },
    stopSpaWatch: () => {
      unwatchSPA?.();
      unwatchSPA = null;
    },
    resetDetectionArtifacts() {
      candidateStatusMap.clear();
      activeCandidates = [];
      activeHighlightBlocks = [];
      activeDetectMode = null;
      lastFullPageLayoutKey = "";
    },
  };
}
