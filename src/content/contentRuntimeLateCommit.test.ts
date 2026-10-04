import type { ParseQuestionRuntimeContext } from "@/shared/utils/parseRouter";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type ParseResult, type QuestionBlock } from "@/shared/types";
import { handleFullPageDetect } from "./detectOrchestration";
import { runManualCapturePipeline } from "./manualCapturePipeline";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

const block: QuestionBlock = {
  id: "late-candidate",
  bbox: { x: 0, y: 0, width: 240, height: 100 },
  previewText: "A question whose detection will resolve after shutdown",
  questionTypeGuess: "short_answer",
  confidence: 0.9,
  hasImage: false,
  source: "auto_dom",
};

const result: ParseResult = {
  blockId: "manual-late",
  questionType: "short_answer",
  answer: "late answer",
  confidence: 0.9,
  briefExplanation: "",
  detailedExplanation: "",
  recognizedText: "question",
  routeUsed: "text",
};

describe("runtime late completion fences", () => {
  it("P10B-FULLPAGE-LATE-01 discards partial candidates returned after shutdown", async () => {
    const detection = deferred<QuestionBlock[]>();
    let current = true;
    const candidateStatusMap = new Map<string, { status: string; selected: boolean }>();
    const safeRuntimeSendMessage = vi.fn();
    const createHighlightLayer = vi.fn(() => ({ setBlocks: vi.fn(), destroy: vi.fn() }));
    const refineFullPageCandidatesViaManualPipeline = vi.fn(async (candidates: QuestionBlock[]) => candidates);
    const outcome = handleFullPageDetect({
      isRuntimeCurrent: () => current,
      isFullPageScanRunning: () => false,
      cancelFullPageScan: vi.fn(),
      logEvent: vi.fn(),
      destroyHighlightLayer: vi.fn(),
      stopSpaWatch: vi.fn(),
      clearRouteOwnedState: vi.fn(),
      candidateStatusMap,
      refreshLayoutResizeObservation: vi.fn(),
      safeRuntimeSendMessage,
      detectCandidatesFullPage: () => detection.promise,
      refineFullPageCandidatesViaManualPipeline,
      resolveFullPageScrollRoot: () => document.documentElement,
      getFullPageLayoutKey: () => "layout",
      createHighlightLayer,
      refreshFullPageHighlightsAfterLayoutChange: vi.fn(),
      notifySidePanel: vi.fn(),
    } as never);

    current = false;
    detection.resolve([block]);
    await expect(outcome).resolves.toBeNull();

    expect(refineFullPageCandidatesViaManualPipeline).not.toHaveBeenCalled();
    expect(candidateStatusMap.size).toBe(0);
    expect(createHighlightLayer).not.toHaveBeenCalled();
    expect(safeRuntimeSendMessage.mock.calls.flat().map((message) => (message as { type?: string }).type))
      .not.toContain("FULL_PAGE_DETECT_DONE");
  });

  it("P10B-MANUAL-LATE-01 blocks late provider, stream, result, error, and history commits", async () => {
    const provider = deferred<ParseResult>();
    let current = true;
    let lateStream: ((partial: string) => void) | undefined;
    const floatingMgr = {
      open: vi.fn(),
      setStreamingText: vi.fn(),
      setResult: vi.fn(),
      setError: vi.fn(),
    };
    const addHistoryEntry = vi.fn();
    const parseWithTieredRetries = vi.fn((_block: QuestionBlock, _settings: unknown, _vision: boolean, onStream: (partial: string) => void) => {
      lateStream = onStream;
      return provider.promise;
    });
    const capture = runManualCapturePipeline(
      { x: 0, y: 0, width: 240, height: 100 },
      { forceVision: false, pipelineTimeoutMs: 5_000, isRuntimeCurrent: () => current },
      {
        floatingMgr,
        resolveQuestionBlockFromBBox: (bbox) => ({ refinedBBox: bbox, finalBBox: bbox, previewText: "question", matchedCandidate: null }),
        extractQuestionImageUrlFromBBox: () => null,
        screenshotWithRetry: async () => null,
        cropScreenshot: async () => "",
        loadSettings: async () => ({ ...DEFAULT_SETTINGS, preferredRoute: "text" }),
        getRuntimeCaptureInfo: async () => ({ name: "test", baseUrl: "https://example.com", supportsVision: false }),
        parseWithTieredRetries,
        withTimeout: <T>(promise: Promise<T>) => promise,
        addHistoryEntry,
        isLikelyIncompleteStem: () => false,
        shouldPreferVisionResult: () => false,
        shouldForceSecondVisionReview: () => false,
        shouldPreferSecondVisionResult: () => false,
        logEvent: vi.fn(),
      },
    );

    await vi.waitFor(() => expect(parseWithTieredRetries).toHaveBeenCalledTimes(1));
    current = false;
    provider.resolve(result);
    await capture;
    lateStream?.("late text");

    expect(floatingMgr.open).toHaveBeenCalledTimes(1);
    expect(floatingMgr.setStreamingText).not.toHaveBeenCalled();
    expect(floatingMgr.setResult).not.toHaveBeenCalled();
    expect(floatingMgr.setError).not.toHaveBeenCalled();
    expect(addHistoryEntry).not.toHaveBeenCalled();
  });
});


it("RF01 manual pipeline timeout aborts nested work and rejects late UI/history/second-review commits", async () => {
  const provider = deferred<ParseResult>();
  let nested!: ParseQuestionRuntimeContext; let lateStream!: (text: string) => void;
  let timeout!: () => void;
  const floatingMgr = { open: vi.fn(), setStreamingText: vi.fn(), setResult: vi.fn(), setError: vi.fn() };
  const addHistoryEntry = vi.fn(); const logEvent = vi.fn();
  const parse = vi.fn((_block, _prefs, _vision, stream, context) => {
    nested = context; lateStream = stream; return provider.promise;
  });
  const capture = runManualCapturePipeline(block.bbox, { forceVision: false, pipelineTimeoutMs: 100 }, {
    floatingMgr,
    resolveQuestionBlockFromBBox: bbox => ({ refinedBBox: bbox, finalBBox: bbox, previewText: "question", matchedCandidate: null }),
    extractQuestionImageUrlFromBBox: () => null, screenshotWithRetry: async () => "image",
    cropScreenshot: async () => "data:image/png;base64,abc",
    loadSettings: async () => DEFAULT_SETTINGS,
    getRuntimeCaptureInfo: async () => ({ name: "test", baseUrl: "https://example.com", supportsVision: true }),
    parseWithTieredRetries: parse,
    withTimeout: <T>(promise: Promise<T>) => Promise.race([promise, new Promise<T>((_, reject) => {
      timeout = () => reject(new Error("manual_pipeline_timeout"));
    })]),
    addHistoryEntry, isLikelyIncompleteStem: () => true, shouldPreferVisionResult: () => true,
    shouldForceSecondVisionReview: () => true, shouldPreferSecondVisionResult: () => true, logEvent,
  });
  await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
  timeout(); await capture;
  expect(nested.signal?.aborted).toBe(true);
  provider.resolve(result); lateStream("late stream");
  await Promise.resolve(); await Promise.resolve();
  expect(parse).toHaveBeenCalledTimes(1);
  expect(floatingMgr.setStreamingText).not.toHaveBeenCalled();
  expect(floatingMgr.setResult).not.toHaveBeenCalled(); expect(addHistoryEntry).not.toHaveBeenCalled();
  expect(floatingMgr.setError).toHaveBeenCalledTimes(1);
  expect(logEvent).not.toHaveBeenCalledWith("manual_second_vision_review_started", expect.anything());
});
