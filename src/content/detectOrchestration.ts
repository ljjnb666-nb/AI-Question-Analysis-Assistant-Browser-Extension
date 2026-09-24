import type { QuestionBlock } from "@/shared/types";
import type { ScanScrollRoot } from "./detector/fullPageDetector";
import { CandidateRootAggregation } from "./candidateRootAggregation";
import { sanitizeQuestionBlockForRuntimeMessage } from "@/shared/utils/mediaSerialization";

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
  isFullPageScanRunning: () => boolean;
  cancelFullPageScan: () => void;
  logEvent: (event: "auto_detect_started" | "auto_detect_candidates_found" | "auto_detect_candidate_selected", data?: Record<string, unknown>) => void;
  destroyHighlightLayer: () => void;
  stopSpaWatch: () => void;
  candidateStatusMap: Map<string, CandidateStatus>;
  refreshLayoutResizeObservation: () => void;
  safeRuntimeSendMessage: (message: unknown) => void;
  detectCandidatesFullPage: (onProgress: (progress: FullPageProgress) => void) => Promise<QuestionBlock[]>;
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
};

export function notifySidePanel(
  candidates: QuestionBlock[],
  deps: NotifySidePanelDeps,
): void {
  const enriched = candidates.map((block) => ({
    block: sanitizeQuestionBlockForRuntimeMessage(block),
    selected: deps.candidateStatusMap.get(block.id)?.selected ?? false,
    status: (deps.candidateStatusMap.get(block.id)?.status ?? "idle") as "idle" | "loading" | "success" | "error",
  }));
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
      deps.safeRuntimeSendMessage({
        type: "FULL_PAGE_DETECT_PROGRESS",
        progress: p.progress,
        found: p.found,
        currentStep: p.currentStep,
        totalScrollSteps: p.totalScrollSteps,
      });
    });
    const candidates = await deps.refineFullPageCandidatesViaManualPipeline(roughCandidates);
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
