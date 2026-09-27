import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import { bootstrapContentRuntime, type ContentRuntimeMessageListener } from "./contentRuntimeBootstrap";
import { controlRegistry } from "./answer/controlRegistry";
import { runtimeQuestionHandleCount, attachRuntimeRoot, TOP_ROOT_GENERATION, TOP_ROOT_KEY } from "./roots/rootContext";
import { sharedRootRegistry } from "./roots/rootRegistry";
import { activeQuestionRevisionAttempt, beginQuestionRevisionAttempt, disposeQuestionRevisionRuntime, revisionRegistry } from "./revision/questionRevisionRuntime";
import { runtimeMediaPayloadStore } from "./media/mediaPayloadStore";
import { runtimeMediaSourceLocatorStore } from "./media/mediaSourceLocatorStore";

const mocks = vi.hoisted(() => ({
  abortCurrentSolveAttempt: vi.fn(),
  bindingsDispose: vi.fn(),
  bridgeOptions: null as any,
  floating: null as any,
  handle: null as any,
  layoutDispose: vi.fn(),
  state: null as any,
}));

vi.mock("@/shared/utils/analytics", () => ({ initAnalytics: vi.fn() }));
vi.mock("./floating/FloatingWindowManager", () => ({
  FloatingWindowManager: class {
    constructor() {
      mocks.floating = {
        close: vi.fn(),
        destroy: vi.fn(),
        init: vi.fn(),
        open: vi.fn(),
        setError: vi.fn(),
        setOnRetake: vi.fn(),
        setOnUpgradeVision: vi.fn(),
        setResult: vi.fn(),
        setStreamingText: vi.fn(),
      };
      return mocks.floating;
    }
  },
}));
vi.mock("./contentMainBridges", () => ({
  createContentMainBridges: (options: unknown) => {
    mocks.bridgeOptions = options;
    mocks.state = (options as { state: unknown }).state;
    return {
      abortCurrentSolveAttempt: mocks.abortCurrentSolveAttempt,
      captureBlockImage: vi.fn(),
      clickNextQuestionButton: vi.fn(),
      disposeBindings: mocks.bindingsDispose,
      findNextQuestionButton: vi.fn(),
      handleAutoDetect: vi.fn(),
      handleFullPageDetect: vi.fn(),
      layoutWatch: {
        dispose: mocks.layoutDispose,
        ensureLayoutResizeObserver: vi.fn(),
        refreshLayoutResizeObservation: vi.fn(),
      },
      manualParsePipelineTimeoutMs: 45_000,
      notifySidePanel: vi.fn(),
      parseBlockForAutoSolve: vi.fn(),
      parseBlockForAutoSolveQuickReview: vi.fn(),
      parseBlockForAutoSolveReview: vi.fn(),
      isCurrentAutoSolveResult: vi.fn(),
      parseWithTieredRetries: vi.fn(),
      pickLiveAutoSolveBlock: vi.fn(),
      recordAutoSolveHistory: vi.fn(),
      refineFullPageCandidatesViaManualPipeline: vi.fn(),
      screenshotWithRetry: vi.fn(),
      sendAutoSolveDone: vi.fn(),
      sendAutoSolveProgress: vi.fn(),
      shouldPreferViewportPreview: vi.fn(),
      shouldReviewLowConfidenceHistory: vi.fn(),
      sortAutoSolveCandidates: vi.fn(),
      waitForQuestionAdvance: vi.fn(),
    };
  },
}));
vi.mock("./contentMainWorkflows", () => ({
  createContentMainWorkflows: () => ({
    ensureLayoutResizeObserver: vi.fn(),
    handleAutoSolveAll: vi.fn(),
    refreshLayoutResizeObservation: vi.fn(),
    scheduleHighlightRelayoutRescan: vi.fn(),
    startManualCapture: vi.fn(),
  }),
}));

function makeBlock(): QuestionBlock {
  return {
    id: "runtime-q1",
    identity: {
      stableId: "runtime-q1",
      contentFingerprint: "runtime-q1-fingerprint",
      identityVersion: 1,
      strategy: "content-only",
      signals: { nativeId: false, content: true, options: true, media: false, structure: true },
    },
    bbox: { x: 0, y: 0, width: 320, height: 120 },
    previewText: "A lifecycle question used only for runtime cleanup assertions",
    hasImage: false,
    questionTypeGuess: "short_answer",
    confidence: 0.95,
    source: "auto_dom",
  };
}

describe("content runtime shutdown owner", () => {
  let listeners: Set<ContentRuntimeMessageListener>;
  let handle: ReturnType<typeof bootstrapContentRuntime> | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    listeners = new Set();
    mocks.bridgeOptions = null;
    mocks.state = null;
    mocks.floating = null;
    mocks.handle = null;
    mocks.abortCurrentSolveAttempt.mockReset();
    mocks.bindingsDispose.mockReset();
    mocks.layoutDispose.mockReset();
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: ContentRuntimeMessageListener) => { listeners.add(listener); }),
          removeListener: vi.fn((listener: ContentRuntimeMessageListener) => { listeners.delete(listener); }),
        },
      },
    });
    controlRegistry.clear();
    disposeQuestionRevisionRuntime();
    sharedRootRegistry().reset();
    runtimeMediaPayloadStore.clear();
    runtimeMediaSourceLocatorStore.clear();
  });

  afterEach(() => {
    handle?.dispose();
    handle = null;
    controlRegistry.clear();
    disposeQuestionRevisionRuntime();
    sharedRootRegistry().reset();
    runtimeMediaPayloadStore.clear();
    runtimeMediaSourceLocatorStore.clear();
    vi.unstubAllGlobals();
  });

  it("P10B-LISTENER-01, P10B-AUTOSOLVE-SHUTDOWN-01, P10B-MEDIA-CLEANUP-01, P10B-SHUTDOWN-IDEMPOTENT-01, and P10B-REBOOT-01 close and restart exactly once", () => {
    const onShutdown = vi.fn();
    handle = bootstrapContentRuntime({ onShutdown });
    const listenerA = handle.listener;
    const originalGeneration = handle.generation;
    const runtimeCurrentA = (mocks.bridgeOptions as { isRuntimeCurrent: () => boolean }).isRuntimeCurrent;
    expect(runtimeCurrentA()).toBe(true);
    expect(listeners.size).toBe(1);
    expect(listeners.has(listenerA)).toBe(true);
    expect(bootstrapContentRuntime()).toBe(handle);
    expect(listeners.size).toBe(1);

    const state = mocks.state as {
      candidateStatusMap: Map<string, { status: string; selected: boolean }>;
      getActiveCandidates: () => QuestionBlock[];
      getActiveHighlightBlocks: () => QuestionBlock[];
      getAutoSolveStopRequested: () => boolean;
      setActiveCandidates: (candidates: QuestionBlock[]) => void;
      setActiveDetectMode: (mode: "viewport" | "fullpage" | null) => void;
      setActiveHighlightBlocks: (blocks: QuestionBlock[]) => void;
    };
    const block = makeBlock();
    const owner = document.createElement("div");
    owner.textContent = block.previewText;
    document.body.append(owner);
    state.candidateStatusMap.set(block.id, { status: "pending", selected: false });
    state.setActiveCandidates([block]);
    state.setActiveHighlightBlocks([block]);
    state.setActiveDetectMode("viewport");

    const controller = new AbortController();
    beginQuestionRevisionAttempt(block, controller);
    revisionRegistry().observe(block, owner, { rootKey: TOP_ROOT_KEY, rootGeneration: TOP_ROOT_GENERATION });
    sharedRootRegistry().reconcile(document);
    attachRuntimeRoot(block, { rootKey: TOP_ROOT_KEY, rootGeneration: TOP_ROOT_GENERATION, kind: "top-document" }, owner);
    expect(runtimeQuestionHandleCount()).toBe(1);

    const controlOwner = document.createElement("div");
    const control = document.createElement("input");
    controlOwner.append(control);
    document.body.append(controlOwner);
    const token = controlRegistry.lifecycleToken("runtime-q1", TOP_ROOT_KEY, TOP_ROOT_GENERATION)!;
    expect(controlRegistry.put({
      controlId: "runtime-control",
      questionId: "runtime-q1",
      role: "option",
      optionKey: "A",
      controlType: "radio",
      semanticFingerprint: "runtime-control-fingerprint",
      enabled: true,
      visible: true,
      confidence: 1,
      reasons: ["DOM_ORDER_FALLBACK"],
    }, control, controlOwner, TOP_ROOT_KEY, TOP_ROOT_GENERATION, token)).toBe(true);

    const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    runtimeMediaPayloadStore.put("owned", { dataUrl: "data:image/png;base64,abc", ownedObjectUrl: "blob:owned" });
    runtimeMediaSourceLocatorStore.put("source", { sourceUrl: "blob:page-source" });

    let stopRequestedWhenAborting = false;
    mocks.abortCurrentSolveAttempt.mockImplementation(() => {
      stopRequestedWhenAborting = state.getAutoSolveStopRequested();
      controller.abort();
    });

    handle.dispose();
    expect(listeners.has(listenerA)).toBe(false);
    expect(stopRequestedWhenAborting).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(activeQuestionRevisionAttempt()).toBeNull();
    expect(revisionRegistry().size).toBe(0);
    expect(controlRegistry.size).toBe(0);
    expect(sharedRootRegistry().list()).toHaveLength(0);
    expect(runtimeQuestionHandleCount()).toBe(0);
    expect(runtimeMediaPayloadStore.size).toBe(0);
    expect(runtimeMediaPayloadStore.bytes).toBe(0);
    expect(runtimeMediaSourceLocatorStore.size).toBe(0);
    expect(mocks.bindingsDispose).toHaveBeenCalledTimes(1);
    expect(mocks.layoutDispose).toHaveBeenCalledTimes(1);
    expect(mocks.floating.destroy).toHaveBeenCalledTimes(1);
    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(state.getActiveCandidates()).toEqual([]);
    expect(state.getActiveHighlightBlocks()).toEqual([]);
    expect(state.candidateStatusMap.size).toBe(0);
    expect(runtimeCurrentA()).toBe(false);
    expect(listenerA({ type: "START_AUTO_DETECT" } as never, {} as never, vi.fn())).toBe(false);
    handle.dispose();
    handle.dispose();
    expect(mocks.abortCurrentSolveAttempt).toHaveBeenCalledTimes(1);
    expect(mocks.bindingsDispose).toHaveBeenCalledTimes(1);
    expect(mocks.layoutDispose).toHaveBeenCalledTimes(1);
    expect(mocks.floating.destroy).toHaveBeenCalledTimes(1);
    expect(onShutdown).toHaveBeenCalledTimes(1);

    if (revokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:owned");

    handle = bootstrapContentRuntime();
    expect(handle.generation).toBeGreaterThan(originalGeneration);
    expect(runtimeCurrentA()).toBe(false);
    expect((mocks.bridgeOptions as { isRuntimeCurrent: () => boolean }).isRuntimeCurrent()).toBe(true);
    expect(listeners.size).toBe(1);
    expect(listeners.has(handle.listener)).toBe(true);
    handle.dispose();
    expect(listeners.size).toBe(0);
    handle = null;
  });
});
