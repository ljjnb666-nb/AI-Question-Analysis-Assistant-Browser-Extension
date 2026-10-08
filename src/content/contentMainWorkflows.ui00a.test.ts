import type { AIConnectionScenarioFixture } from "@/test/aiConnectionFixture";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import { DEFAULT_SETTINGS } from "@/shared/types";
import type { ScanScrollRoot } from "./detector/fullPageDetector";

let mockSettings: AIConnectionScenarioFixture = { ...DEFAULT_SETTINGS };

vi.mock("@/shared/utils/storage", () => ({
  addHistoryEntry: vi.fn(async () => undefined),
  loadHistory: vi.fn(async () => []),
  loadSettings: vi.fn(async () => mockSettings),
}));

import { createContentMainWorkflows } from "./contentMainWorkflows";

function createElementStub() {
  return {} as HTMLElement;
}

function createWorkflowsOptions() {
  const noop = () => vi.fn();
  return {
    isRuntimeCurrent: () => true,
    floatingMgr: {
      close: noop(),
      open: noop(),
      setError: noop(),
      setResult: noop(),
      setStreamingText: noop(),
    },
    runtimeState: {
      destroyActiveOverlay: noop(),
      getActiveCandidates: () => [],
      getActiveDetectMode: () => null,
      getActiveOverlay: () => null,
      getAutoSolveRunning: () => false,
      getAutoSolveStopRequested: () => false,
      getHighlightLayer: () => null,
      getPendingSubmit: () => false,
      resetDetectionArtifacts: noop(),
      setActiveDetectMode: noop(),
      setActiveOverlay: noop(),
      setAutoSolveRunning: noop(),
      setAutoSolveStopRequested: noop(),
      setHighlightLayer: noop(),
      setLastFullPageLayoutKey: noop(),
      setPendingSubmit: noop(),
      stopSpaWatch: noop(),
    },
    layoutWatch: {
      ensureLayoutResizeObserver: noop(),
      refreshLayoutResizeObservation: noop(),
      scheduleHighlightRelayoutRescan: noop(),
    },
    manualParsePipelineTimeoutMs: 1000,
    parseWithTieredRetries: vi.fn(async () => {
      throw new Error("should not parse");
    }),
    screenshotWithRetry: vi.fn(async () => null),
    clickNextQuestionButton: () => false,
    detectCandidatesFullPage: vi.fn(async () => []),
    detectCandidatesInViewport: () => [],
    detectTotalQuestionCount: () => 0,
    extractAutoSolveQuestionOrder: () => null,
    extractQuestionImageUrlFromBBox: () => null,
    extractRichQuestionPreviewFromElement: () => "",
    extractTextFromBBox: () => "",
    fillParsedAnswerInPage: vi.fn(async () => ({ ok: true, filledCount: 1, message: "FILLED_VERIFIED" })),
    findBestDetectedCandidateForBBox: () => null,
    findMatchingFullPageCandidate: () => null,
    findNextQuestionButton: () => createElementStub(),
    findReusableHistoryEntry: () => null,
    getAutoSolveFingerprint: () => "",
    getAutoSolveTextFingerprint: () => "",
    getScrollLeft: () => 0,
    hasVisibleAutoSolveMedia: () => false,
    inferAutoSolveQuestionType: () => "unknown" as const,
    inspectAutoSolveAnswerState: () => ({ mode: "none" as const, answeredCount: 0, totalCount: 0, complete: false }),
    isChoiceLikeQuestionType: () => true,
    isExtensionUiElement: () => false,
    isLikelyIncompleteStem: () => false,
    normalizeQuestionText: (text: string) => text,
    parseBlockForAutoSolve: vi.fn(async () => {
      throw new Error("should not parse");
    }),
    parseBlockForAutoSolveQuickReview: vi.fn(async () => {
      throw new Error("should not parse");
    }),
    parseBlockForAutoSolveReview: vi.fn(async () => {
      throw new Error("should not parse");
    }),
    isCurrentAutoSolveResult: () => false,
    pauseMs: vi.fn(async () => undefined),
    pickBestAutoSolvePreviewText: () => "",
    pickLiveAutoSolveBlock: () => null,
    projectViewportBboxToAbsolute: (bbox: { x: number; y: number; width: number; height: number }) => bbox,
    recordAutoSolveHistory: vi.fn(async () => true),
    refineFullPageCandidatesViaManualPipeline: vi.fn(async () => []),
    refineViewportCandidate: vi.fn(),
    resolveFullPageScrollRoot: () => "window" as unknown as ScanScrollRoot,
    resolveQuestionBlockFromBBox: () => ({
      refinedBBox: { x: 0, y: 0, width: 0, height: 0 },
      finalBBox: { x: 0, y: 0, width: 0, height: 0 },
      previewText: "",
      matchedCandidate: null,
    }),
    sendAutoSolveDone: vi.fn(),
    sendAutoSolveProgress: vi.fn(),
    setScrollPosition: noop(),
    shouldForceSecondVisionReview: () => false,
    shouldPersistAutoSolveParseResult: () => true,
    shouldPreferSecondVisionResult: () => false,
    shouldPreferVisionResult: () => false,
    shouldPreferViewportPreview: () => false,
    shouldRetryUnstableChoiceParse: () => false,
    shouldReviewLowConfidenceHistory: () => false,
    shouldStopAutoSolveAtTail: () => false,
    sortAutoSolveCandidates: (candidates: QuestionBlock[]) => candidates,
    verifyParsedAnswerInPage: vi.fn(() => ({ ok: true, message: "verified" })),
    waitForQuestionAdvance: vi.fn(async () => false),
    withTimeout: async <T,>(promise: Promise<T>) => promise,
  };
}

describe("Auto Solve provider configuration entry guard (UI-00A, UI00A-06)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = { ...DEFAULT_SETTINGS };
  });

  it("refuses to start Auto Solve without a configured provider and never fills", async () => {
    mockSettings = { ...DEFAULT_SETTINGS, providerId: "anthropic", apiKey: "" };
    const options = createWorkflowsOptions();
    const workflows = createContentMainWorkflows(options);

    await workflows.handleAutoSolveAll();

    expect(options.sendAutoSolveDone).toHaveBeenCalledTimes(1);
    expect(options.sendAutoSolveDone).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, solved: 0, filled: 0 }),
    );
    const payload = vi.mocked(options.sendAutoSolveDone).mock.calls[0]?.[0] as { message?: string };
    expect(payload.message).toContain("请先在设置");
    // Layer 2/3 (parse gate, fill-core gate) are never even reached.
    expect(options.fillParsedAnswerInPage).not.toHaveBeenCalled();
    expect(options.sendAutoSolveProgress).not.toHaveBeenCalled();
  });

  it("a key-optional provider (Ollama, no key) still starts the real workflow", async () => {
    mockSettings = { ...DEFAULT_SETTINGS, providerId: "ollama", apiKey: "" };
    const options = createWorkflowsOptions();
    const workflows = createContentMainWorkflows(options);

    await workflows.handleAutoSolveAll();

    // The guard passed: the workflow actually started (progress emitted) and
    // ran to its natural no-question stop — with zero fills.
    expect(options.sendAutoSolveProgress).toHaveBeenCalledWith(
      expect.objectContaining({ running: true, statusText: "开始自动答题..." }),
    );
    expect(options.sendAutoSolveDone).toHaveBeenCalledTimes(1);
    expect(options.fillParsedAnswerInPage).not.toHaveBeenCalled();
  });
});

vi.mock("@/shared/utils/aiSolvePreferences", async () => {
  const storage = await import("@/shared/utils/storage");
  const { getProvider } = await import("@/shared/ai/providers");
  return {
    loadParsePreferences: async () => { const { preferredRoute, language } = await storage.loadSettings(); return { preferredRoute, language }; },
    getRuntimeCaptureInfo: async () => { const fixture = await storage.loadSettings() as AIConnectionScenarioFixture; return getProvider(fixture.providerId ?? "anthropic"); },
    getAIConnectionReadiness: async () => {
      const fixture = await storage.loadSettings() as AIConnectionScenarioFixture;
      return { ready: getProvider(fixture.providerId ?? "anthropic").keyOptional === true || Boolean(fixture.apiKey?.trim()) };
    },
  };
});


describe("Phase14B-02C Auto Solve START to PROGRESS/DONE generation propagation", () => {
  it("P14B02C_AUTOSOLVE_01 tagged START emits the same immutable generation on progress and DONE", async () => {
    mockSettings = { ...DEFAULT_SETTINGS, providerId: "ollama", apiKey: "" };
    const generationId = "18aabcde-0ee2-4e98-8e12-48fdce879012";
    const options = createWorkflowsOptions();
    const workflows = createContentMainWorkflows(options);
    await workflows.handleAutoSolveAll(generationId);
    expect(options.sendAutoSolveProgress).toHaveBeenCalledWith(
      expect.objectContaining({ generationId, running: true }),
    );
    expect(options.sendAutoSolveDone).toHaveBeenCalledWith(
      expect.objectContaining({ generationId }),
    );
  });

  it("P14B02C_AUTOSOLVE_02 provider guard emits a tagged rejection, not an unbound DONE", async () => {
    mockSettings = { ...DEFAULT_SETTINGS, providerId: "anthropic", apiKey: "" };
    const generationId = "18aabcde-0ee2-4e98-8e12-48fdce879012";
    const options = createWorkflowsOptions();
    await createContentMainWorkflows(options).handleAutoSolveAll(generationId);
    expect(options.sendAutoSolveDone).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, solved: 0, generationId }),
    );
    expect(options.sendAutoSolveProgress).not.toHaveBeenCalled();
  });

  it("P14B02C_AUTOSOLVE_03 omitted generation preserves legacy untagged completion", async () => {
    mockSettings = { ...DEFAULT_SETTINGS, providerId: "anthropic", apiKey: "" };
    const options = createWorkflowsOptions();
    await createContentMainWorkflows(options).handleAutoSolveAll();
    const done = vi.mocked(options.sendAutoSolveDone).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(done).not.toHaveProperty("generationId");
  });
});

describe("Phase14B-02C-E1 in-flight Auto Solve side-effect authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = { ...DEFAULT_SETTINGS, providerId: "ollama", apiKey: "" };
  });

  const candidate = {
    id: "lease-question",
    bbox: { x: 0, y: 0, width: 360, height: 120 },
    previewText: "1. Select B. A. First B. Second",
    questionTypeGuess: "single_choice",
    hasImage: false,
    confidence: 1,
    source: "auto_dom",
  } as QuestionBlock;
  const history = {
    result: {
      blockId: candidate.id,
      questionType: "single_choice",
      answer: "B",
      confidence: 1,
      routeUsed: "text",
    },
  };

  function setupDelayedFill() {
    const options = createWorkflowsOptions();
    let releaseFill!: () => void;
    let enteredFill!: () => void;
    const entered = new Promise<void>((resolve) => { enteredFill = resolve; });
    const pending = new Promise<void>((resolve) => { releaseFill = resolve; });
    const mutatePage = vi.fn();
    const nextButton = vi.fn(() => true);
    const fill = vi.fn(async (
      _block: QuestionBlock,
      _result: unknown,
      fillOptions?: { isRuntimeCurrent?: () => boolean },
    ) => {
      enteredFill();
      await pending;
      if (fillOptions?.isRuntimeCurrent?.()) mutatePage();
      return { ok: true, filledCount: 1, message: "FILLED_VERIFIED" };
    });
    Object.assign(options, {
      detectTotalQuestionCount: () => 1,
      pickLiveAutoSolveBlock: () => candidate,
      findReusableHistoryEntry: () => history,
      clickNextQuestionButton: nextButton,
      shouldStopAutoSolveAtTail: () => true,
      fillParsedAnswerInPage: fill,
    });
    return { options, entered, releaseFill: () => releaseFill(), mutatePage, nextButton, fill };
  }

  it("P14B02C_E1_03 STOP during awaited fill blocks DOM mutation and next-question click", async () => {
    const harness = setupDelayedFill();
    let leaseCurrent = true;
    const run = createContentMainWorkflows(harness.options).handleAutoSolveAll(
      "18aabcde-0ee2-4e98-8e12-48fdce879012", () => leaseCurrent,
    );
    await harness.entered;
    const guard = harness.fill.mock.calls[0]?.[2]?.isRuntimeCurrent;
    expect(guard?.()).toBe(true);
    leaseCurrent = false;
    expect(guard?.()).toBe(false);
    harness.releaseFill();
    await run;
    expect(harness.mutatePage).not.toHaveBeenCalled();
    expect(harness.nextButton).not.toHaveBeenCalled();
  });

  it("P14B02C_E1_04 route epoch change during awaited fill blocks subsequent mutation and navigation", async () => {
    const harness = setupDelayedFill();
    let epoch = 1;
    Object.assign(harness.options, { workspaceRouteEpoch: () => epoch });
    const run = createContentMainWorkflows(harness.options).handleAutoSolveAll();
    await harness.entered;
    epoch = 2;
    harness.releaseFill();
    await run;
    expect(harness.mutatePage).not.toHaveBeenCalled();
    expect(harness.nextButton).not.toHaveBeenCalled();
  });

  it("P14B02C_E1_05 current lease still permits verified fill and next-question navigation", async () => {
    const harness = setupDelayedFill();
    const run = createContentMainWorkflows(harness.options).handleAutoSolveAll();
    await harness.entered;
    harness.releaseFill();
    await run;
    expect(harness.mutatePage).toHaveBeenCalledOnce();
    expect(harness.nextButton).toHaveBeenCalledOnce();
  });
});
