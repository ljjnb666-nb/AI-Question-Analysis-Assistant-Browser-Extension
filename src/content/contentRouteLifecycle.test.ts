import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import { clearAutoSolveSnapshotState, captureSolveStartControlState, getAnswerFillerRuntimeStateCounts } from "./answerFiller";
import { controlRegistry } from "./answer/controlRegistry";
import { runFullPageDetectSession } from "./contentDetectionSession";
import { beginContentRuntimeGeneration, type ContentRuntimeGeneration } from "./contentRuntimeLifecycle";
import { observeLiveQuestion } from "./liveQuestionObservation";
import { attachRuntimeRoot, TOP_ROOT_GENERATION, TOP_ROOT_KEY } from "./roots/rootContext";
import { startContentRouteLifecycleWatch, CONTENT_ROUTE_POLL_INTERVAL_MS } from "./revision/contentRouteLifecycle";
import { activeQuestionRevisionAttempt, beginQuestionRevisionAttempt, disposeQuestionRevisionRuntime, revisionRegistry } from "./revision/questionRevisionRuntime";

const basicBlock: QuestionBlock = {
  id: "route-q1",
  identity: {
    stableId: "route-q1",
    contentFingerprint: "route-q1-fingerprint",
    identityVersion: 1,
    strategy: "content-only",
    signals: { nativeId: false, content: true, options: true, media: false, structure: true },
  },
  identityObservationSource: "structured",
  bbox: { x: 0, y: 0, width: 240, height: 100 },
  previewText: "A question owned by the current route A",
  questionTypeGuess: "single_choice",
  confidence: 1,
  hasImage: false,
  source: "auto_dom",
};

function makeOwnedQuestion(): QuestionBlock {
  document.body.innerHTML = '<section class="question-item" id="route-question">1. prompt <button>A. one</button><button>B. two</button></section>';
  const owner = document.getElementById("route-question")!;
  document.elementsFromPoint = (() => [owner]) as typeof document.elementsFromPoint;
  const observed = observeLiveQuestion({
    ...basicBlock,
    id: "route-question",
    bbox: { x: 0, y: 0, width: 500, height: 240 },
    previewText: "1. prompt A. one B. two",
  }, owner);
  return attachRuntimeRoot(observed, { rootKey: TOP_ROOT_KEY, rootGeneration: TOP_ROOT_GENERATION, kind: "top-document" }, owner);
}

type RouteState = {
  candidateStatusMap: Map<string, { status: string; selected: boolean }>;
  activeCandidates: QuestionBlock[];
  activeHighlightBlocks: QuestionBlock[];
  activeDetectMode: "viewport" | "fullpage" | null;
  highlightLayer: { destroy: () => void; setBlocks: (blocks: QuestionBlock[], map: Map<string, { status: string; selected: boolean }>) => void } | null;
};

function clearRouteState(state: RouteState): void {
  controlRegistry.clear();
  clearAutoSolveSnapshotState();
  state.candidateStatusMap.clear();
  state.activeCandidates = [];
  state.activeHighlightBlocks = [];
  state.activeDetectMode = null;
  state.highlightLayer?.destroy();
  state.highlightLayer = null;
}

describe("content runtime route lifecycle", () => {
  let lifecycle: ContentRuntimeGeneration | null = null;
  let stopRouteWatch: (() => void) | null = null;
  let originalHref = "";

  beforeEach(() => {
    originalHref = location.href;
    vi.useFakeTimers();
    disposeQuestionRevisionRuntime();
    controlRegistry.clear();
    clearAutoSolveSnapshotState();
  });

  afterEach(() => {
    stopRouteWatch?.();
    stopRouteWatch = null;
    lifecycle?.invalidate();
    lifecycle = null;
    disposeQuestionRevisionRuntime();
    controlRegistry.clear();
    clearAutoSolveSnapshotState();
    document.body.innerHTML = "";
    history.replaceState(null, "", originalHref);
    vi.useRealTimers();
  });

  it("P10B-ROUTE-PUSHSTATE-01 observes a real pushState without popstate or DOM mutation", () => {
    lifecycle = beginContentRuntimeGeneration();
    const block = makeOwnedQuestion();
    const controller = new AbortController();
    beginQuestionRevisionAttempt(block, controller);
    captureSolveStartControlState(block);
    expect(getAnswerFillerRuntimeStateCounts()).toEqual({ solveStartSnapshotCount: 1, autoSnapshotStatusCount: 1 });

    const state: RouteState = {
      candidateStatusMap: new Map([[block.id, { status: "pending", selected: false }]]),
      activeCandidates: [block],
      activeHighlightBlocks: [block],
      activeDetectMode: "viewport",
      highlightLayer: { destroy: vi.fn(), setBlocks: vi.fn() },
    };
    const oldHighlight = state.highlightLayer!;
    const bodyBefore = document.body.innerHTML;
    const routeEpochBefore = revisionRegistry().getRoute().routeEpoch;
    const onRouteChange = vi.fn(() => clearRouteState(state));
    stopRouteWatch = startContentRouteLifecycleWatch(onRouteChange);

    history.pushState(null, "", "/route-pushstate");
    vi.advanceTimersByTime(CONTENT_ROUTE_POLL_INTERVAL_MS);

    expect(onRouteChange).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
    expect(activeQuestionRevisionAttempt()?.controller.signal.aborted).toBe(true);
    expect(revisionRegistry().getRoute().routeEpoch).toBeGreaterThan(routeEpochBefore);
    expect(state.candidateStatusMap.size).toBe(0);
    expect(state.activeCandidates).toEqual([]);
    expect(state.activeHighlightBlocks).toEqual([]);
    expect(oldHighlight.destroy).toHaveBeenCalledTimes(1);
    expect(state.highlightLayer).toBeNull();
    expect(getAnswerFillerRuntimeStateCounts()).toEqual({ solveStartSnapshotCount: 0, autoSnapshotStatusCount: 0 });
    expect(document.body.innerHTML).toBe(bodyBefore);
    expect(lifecycle.isCurrent()).toBe(true);

    captureSolveStartControlState(block);
    expect(getAnswerFillerRuntimeStateCounts()).toEqual({ solveStartSnapshotCount: 1, autoSnapshotStatusCount: 1 });
  });

  it("P10B-ROUTE-REPLACESTATE-01 observes a real replaceState without popstate", () => {
    lifecycle = beginContentRuntimeGeneration();
    const controller = new AbortController();
    beginQuestionRevisionAttempt(basicBlock, controller);
    const state: RouteState = {
      candidateStatusMap: new Map([[basicBlock.id, { status: "pending", selected: false }]]),
      activeCandidates: [basicBlock],
      activeHighlightBlocks: [basicBlock],
      activeDetectMode: "viewport",
      highlightLayer: { destroy: vi.fn(), setBlocks: vi.fn() },
    };
    const onRouteChange = vi.fn(() => clearRouteState(state));
    stopRouteWatch = startContentRouteLifecycleWatch(onRouteChange);

    history.replaceState(null, "", "/route-replacestate");
    vi.advanceTimersByTime(CONTENT_ROUTE_POLL_INTERVAL_MS);

    expect(onRouteChange).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
    expect(state.candidateStatusMap.size).toBe(0);
    expect(state.activeCandidates).toEqual([]);
    expect(lifecycle.isCurrent()).toBe(true);
  });

  it("P10B-FULLPAGE-ROUTE-01 clears committed full-page results while the route owner remains alive", async () => {
    lifecycle = beginContentRuntimeGeneration();
    const block: QuestionBlock = { ...basicBlock };
    const layer = { destroy: vi.fn(), setBlocks: vi.fn() };
    const state: RouteState = {
      candidateStatusMap: new Map(),
      activeCandidates: [],
      activeHighlightBlocks: [],
      activeDetectMode: null,
      highlightLayer: null,
    };
    const stopSpaWatch = vi.fn();
    const onRouteChange = vi.fn(() => clearRouteState(state));
    stopRouteWatch = startContentRouteLifecycleWatch(onRouteChange);

    await runFullPageDetectSession({
      candidateStatusMap: state.candidateStatusMap,
      clearRouteOwnedState: () => clearRouteState(state),
      cancelFullPageScan: vi.fn(),
      createHighlightLayer: vi.fn(() => layer),
      detectCandidatesFullPage: async () => [block],
      detectCandidatesInViewport: () => [],
      destroyHighlightLayer: () => { state.highlightLayer?.destroy(); state.highlightLayer = null; },
      getFullPageLayoutKey: () => "fullpage-layout-a",
      isFullPageScanRunning: () => false,
      isRuntimeCurrent: lifecycle.isCurrent,
      logEvent: vi.fn(),
      notifySidePanel: vi.fn(),
      refreshFullPageHighlightsAfterLayoutChange: vi.fn(),
      refreshLayoutResizeObservation: vi.fn(),
      refineFullPageCandidatesViaManualPipeline: async (candidates: QuestionBlock[]) => candidates,
      resolveFullPageScrollRoot: () => document.documentElement,
      safeRuntimeSendMessage: vi.fn(),
      setActiveCandidates: (candidates: QuestionBlock[]) => { state.activeCandidates = candidates; },
      setActiveDetectMode: (mode: "viewport" | "fullpage") => { state.activeDetectMode = mode; },
      setActiveHighlightBlocks: (blocks: QuestionBlock[]) => { state.activeHighlightBlocks = blocks; },
      setHighlightLayer: (highlight: typeof layer | null) => { state.highlightLayer = highlight; },
      setLastFullPageLayoutKey: vi.fn(),
      setUnwatchSPA: vi.fn(),
      stopSpaWatch,
      watchForPageChanges: vi.fn(() => vi.fn()),
    } as never);

    expect(stopSpaWatch).toHaveBeenCalledTimes(1);
    expect(state.activeDetectMode).toBe("fullpage");
    expect(state.activeCandidates).toEqual([block]);
    expect(state.highlightLayer).toBe(layer);

    history.pushState(null, "", "/route-after-fullpage");
    vi.advanceTimersByTime(CONTENT_ROUTE_POLL_INTERVAL_MS);

    expect(onRouteChange).toHaveBeenCalledTimes(1);
    expect(state.activeDetectMode).toBeNull();
    expect(state.activeCandidates).toEqual([]);
    expect(state.activeHighlightBlocks).toEqual([]);
    expect(state.candidateStatusMap.size).toBe(0);
    expect(state.highlightLayer).toBeNull();
    expect(layer.destroy).toHaveBeenCalledTimes(1);
    expect(lifecycle.isCurrent()).toBe(true);
  });

  it("keeps popstate/hashchange support, clears its timer, and does not reset unchanged routes", () => {
    const onRouteChange = vi.fn();
    const routeEpoch = revisionRegistry().getRoute().routeEpoch;
    stopRouteWatch = startContentRouteLifecycleWatch(onRouteChange);
    vi.advanceTimersByTime(CONTENT_ROUTE_POLL_INTERVAL_MS * 4);
    expect(onRouteChange).not.toHaveBeenCalled();
    expect(revisionRegistry().getRoute().routeEpoch).toBe(routeEpoch);

    history.pushState(null, "", "/route-popstate");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(onRouteChange).toHaveBeenCalledTimes(1);
    history.replaceState(null, "", "/route-hashchange#next");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(onRouteChange).toHaveBeenCalledTimes(2);

    stopRouteWatch();
    stopRouteWatch = null;
    history.replaceState(null, "", "/route-after-stop");
    vi.advanceTimersByTime(CONTENT_ROUTE_POLL_INTERVAL_MS * 4);
    expect(onRouteChange).toHaveBeenCalledTimes(2);
  });
});
