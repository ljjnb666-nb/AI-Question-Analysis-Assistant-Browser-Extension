import type { QuestionBlock } from "@/shared/types";
import type { ScanScrollRoot } from "./detector/fullPageDetector";
import { CandidateRootAggregation } from "./candidateRootAggregation";
import { projectCandidateSnapshots } from "./candidateWorkspaceRuntime";

type CandidateStatus = { status: string; selected: boolean };

type NotifySidePanelDeps = {
  candidateStatusMap: Map<string, CandidateStatus>;
  safeRuntimeSendMessage: (message: unknown) => void;
};

type FullPageProgress = {
  progress: number;
  found: number;
  currentStep: number;
  totalScrollSteps: number;
};

type FullPageDetectDeps<TLayer extends { setBlocks: (blocks: QuestionBlock[], statusMap: Map<string, CandidateStatus>) => void }> = {
  clearRouteOwnedState?: () => void;
  isFullPageScanRunning: () => boolean;
  isRuntimeCurrent?: () => boolean;
  cancelFullPageScan: () => void;
  logEvent: (event: "auto_detect_started" | "auto_detect_candidates_found" | "auto_detect_candidate_selected", data?: Record<string, unknown>) => void;
  destroyHighlightLayer: () => void;
  stopSpaWatch: () => void;
  candidateStatusMap: Map<string, CandidateStatus>;
  refreshLayoutResizeObservation: () => void;
  safeRuntimeSendMessage: (message: unknown) => void;
  detectCandidatesFullPage: (
    onProgress: (progress: FullPageProgress) => void,
    isExecutionCurrent?: () => boolean,
  ) => Promise<QuestionBlock[]>;
  refineFullPageCandidatesViaManualPipeline: (candidates: QuestionBlock[]) => Promise<QuestionBlock[]>;
  resolveFullPageScrollRoot: () => ScanScrollRoot;
  getFullPageLayoutKey: (scrollRoot: ScanScrollRoot) => string;
  createHighlightLayer: (options: {
    coordinateSpace: "scroll-root";
    scrollRoot: ScanScrollRoot;
    onSelect: (blockId: string, selected: boolean) => void;
  }) => TLayer;
  refreshFullPageHighlightsAfterLayoutChange: () => void;
  notifySidePanel: (candidates: QuestionBlock[]) => void;
};

type ViewportDetectDeps<TLayer extends { setBlocks: (blocks: QuestionBlock[], statusMap: Map<string, CandidateStatus>) => void }> = {
  clearRouteOwnedState?: () => void;
  logEvent: (event: "auto_detect_started" | "auto_detect_candidates_found" | "auto_detect_candidate_selected", data?: Record<string, unknown>) => void;
  destroyHighlightLayer: () => void;
  stopSpaWatch: () => void;
  candidateStatusMap: Map<string, CandidateStatus>;
  detectCandidatesInViewport: () => QuestionBlock[];
  notifySidePanel: (candidates: QuestionBlock[]) => void;
  createHighlightLayer: (options: {
    onSelect: (blockId: string, selected: boolean) => void;
  }) => TLayer;
  watchForPageChanges: (onChange: (blocks: QuestionBlock[], rootKey?: string) => void) => () => void;
  isRuntimeCurrent?: () => boolean;
};

export function notifySidePanel(
  candidates: QuestionBlock[],
  deps: NotifySidePanelDeps,
): void {
  const enriched = projectCandidateSnapshots(candidates, deps.candidateStatusMap);
  deps.safeRuntimeSendMessage({ type: "AUTO_DETECT_RESULT_READY", candidates: enriched });
}

export async function handleFullPageDetect<TLayer extends { setBlocks: (blocks: QuestionBlock[], statusMap: Map<string, CandidateStatus>) => void }>(
  deps: FullPageDetectDeps<TLayer>,
): Promise<{
  activeCandidates: QuestionBlock[];
  activeHighlightBlocks: QuestionBlock[];
  activeDetectMode: "fullpage";
  lastFullPageLayoutKey: string;
  highlightLayer: TLayer | null;
} | {
  activeCandidates: QuestionBlock[];
  activeHighlightBlocks: QuestionBlock[];
  activeDetectMode: "fullpage";
  lastFullPageLayoutKey: string;
  highlightLayer: null;
} | null> {
  const isRuntimeCurrent = deps.isRuntimeCurrent ?? (() => true);
  if (!isRuntimeCurrent()) return null;
  const startedAtUrl = location.href;
  const isCurrentRoute = () => isRuntimeCurrent() && location.href === startedAtUrl;

  if (deps.isFullPageScanRunning()) {
    deps.cancelFullPageScan();
    return null;
  }

  deps.logEvent("auto_detect_started", { mode: "full_page" });
  deps.destroyHighlightLayer();
  deps.stopSpaWatch();
  deps.candidateStatusMap.clear();
  deps.refreshLayoutResizeObservation();

  deps.safeRuntimeSendMessage({
    type: "FULL_PAGE_DETECT_PROGRESS",
    progress: 0,
    found: 0,
    currentStep: 0,
    totalScrollSteps: 1,
  });

  try {
    const roughCandidates = await deps.detectCandidatesFullPage((p) => {
      if (!isCurrentRoute()) return;
      deps.safeRuntimeSendMessage({
        type: "FULL_PAGE_DETECT_PROGRESS",
        progress: p.progress,
        found: p.found,
        currentStep: p.currentStep,
        totalScrollSteps: p.totalScrollSteps,
      });
    }, isCurrentRoute);
    if (!isCurrentRoute()) {
      deps.cancelFullPageScan();
      deps.clearRouteOwnedState?.();
      return null;
    }
    const candidates = await deps.refineFullPageCandidatesViaManualPipeline(roughCandidates);
    if (!isCurrentRoute()) {
      deps.clearRouteOwnedState?.();
      return null;
    }
    const scrollRoot = deps.resolveFullPageScrollRoot();
    const lastFullPageLayoutKey = deps.getFullPageLayoutKey(scrollRoot);

    deps.logEvent("auto_detect_candidates_found", { count: candidates.length, mode: "full_page" });

    candidates.forEach((b) => deps.candidateStatusMap.set(b.id, { status: "pending", selected: false }));

    const state = {
      activeCandidates: candidates,
      activeHighlightBlocks: candidates,
      activeDetectMode: "fullpage" as const,
      lastFullPageLayoutKey,
    };

    const highlightLayer = deps.createHighlightLayer({
      coordinateSpace: "scroll-root",
      scrollRoot,
      onSelect: (blockId, selected) => {
        const s = deps.candidateStatusMap.get(blockId);
        if (s) {
          s.selected = selected;
          if (highlightLayer) highlightLayer.setBlocks(state.activeHighlightBlocks, deps.candidateStatusMap);
        }
        deps.logEvent("auto_detect_candidate_selected", { blockId, selected });
        deps.notifySidePanel(state.activeCandidates);
      },
    });
    deps.refreshFullPageHighlightsAfterLayoutChange();

    deps.safeRuntimeSendMessage({
      type: "FULL_PAGE_DETECT_DONE",
      candidates,
      totalFound: candidates.length,
    });

    return { ...state, highlightLayer };
  } catch (err) {
    if (!isCurrentRoute()) return null;
    console.error("[QS] Full page detect error:", err);
    deps.refreshLayoutResizeObservation();
    deps.safeRuntimeSendMessage({
      type: "FULL_PAGE_DETECT_DONE",
      candidates: [],
      totalFound: 0,
    });
    return {
      activeCandidates: [],
      activeHighlightBlocks: [],
      activeDetectMode: "fullpage",
      lastFullPageLayoutKey: "",
      highlightLayer: null,
    };
  }
}

export function handleAutoDetect<TLayer extends { setBlocks: (blocks: QuestionBlock[], statusMap: Map<string, CandidateStatus>) => void }>(
  deps: ViewportDetectDeps<TLayer>,
): {
  activeCandidates: QuestionBlock[];
  activeHighlightBlocks: QuestionBlock[];
  activeDetectMode: "viewport";
  highlightLayer: TLayer | null;
  unwatchSPA: (() => void) | null;
} {
  const isRuntimeCurrent = deps.isRuntimeCurrent ?? (() => true);
  if (!isRuntimeCurrent()) {
    return {
      activeCandidates: [],
      activeHighlightBlocks: [],
      activeDetectMode: "viewport",
      highlightLayer: null,
      unwatchSPA: null,
    };
  }
  deps.logEvent("auto_detect_started");
  deps.destroyHighlightLayer();
  deps.stopSpaWatch();
  deps.candidateStatusMap.clear();

  const candidates = deps.detectCandidatesInViewport();
  deps.logEvent("auto_detect_candidates_found", { count: candidates.length });
  deps.notifySidePanel(candidates);
  if (candidates.length === 0) {
    return {
      activeCandidates: candidates,
      activeHighlightBlocks: candidates,
      activeDetectMode: "viewport",
      highlightLayer: null,
      unwatchSPA: null,
    };
  }

  candidates.forEach((b) => deps.candidateStatusMap.set(b.id, { status: "pending", selected: false }));

  const state = {
    activeCandidates: candidates,
    activeHighlightBlocks: candidates,
    activeDetectMode: "viewport" as const,
  };

  const highlightLayer = deps.createHighlightLayer({
    onSelect: (blockId, selected) => {
      const s = deps.candidateStatusMap.get(blockId);
      if (s) {
        s.selected = selected;
        if (highlightLayer) highlightLayer.setBlocks(state.activeHighlightBlocks, deps.candidateStatusMap);
      }
      deps.logEvent("auto_detect_candidate_selected", { blockId, selected });
      deps.notifySidePanel(state.activeCandidates);
    },
  });
  highlightLayer.setBlocks(state.activeHighlightBlocks, deps.candidateStatusMap);

  let aggregate = new CandidateRootAggregation(candidates);
  const unwatchSPA = deps.watchForPageChanges((newBlocks, rootKey) => {
    if (!isRuntimeCurrent()) return;
    let nextBlocks: QuestionBlock[];
    if (rootKey) {
      nextBlocks = newBlocks.length === 0
        ? aggregate.removeRoot(rootKey)
        : aggregate.replaceRoot(rootKey, newBlocks);
    } else {
      aggregate = new CandidateRootAggregation(newBlocks);
      nextBlocks = aggregate.snapshot();
    }
    for (const block of nextBlocks) {
      if (!deps.candidateStatusMap.has(block.id)) deps.candidateStatusMap.set(block.id, { status: "pending", selected: false });
    }
    state.activeCandidates = nextBlocks;
    state.activeHighlightBlocks = nextBlocks;
    if (highlightLayer) highlightLayer.setBlocks(nextBlocks, deps.candidateStatusMap);
    deps.notifySidePanel(nextBlocks);
  });

  return { ...state, highlightLayer, unwatchSPA };
}
