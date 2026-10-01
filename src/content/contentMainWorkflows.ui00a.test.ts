import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, QuestionBlock } from "@/shared/types";
import { DEFAULT_SETTINGS } from "@/shared/types";
import type { ScanScrollRoot } from "./detector/fullPageDetector";

let mockSettings: AppSettings = { ...DEFAULT_SETTINGS };

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
