import { describe, expect, it, vi } from "vitest";
import type { BoundingBox, QuestionBlock } from "@/shared/types";
import { createContentDetectionBridge } from "./contentDetectionBridge";

const makeQuestion = (): QuestionBlock => ({
  id: "q-stem",
  bbox: { x: 90, y: 110, width: 730, height: 280 },
  previewText: "下列有关学习动机的说法正确的是？ A. 选项甲 B. 选项乙 C. 选项丙 D. 选项丁",
  source: "auto_dom",
  questionTypeGuess: "single_choice",
  confidence: 0.9,
  hasImage: false,
});

function createFixture(stopped = true) {
  const send = vi.fn();
  const refineViewport = vi.fn((candidate: QuestionBlock) => ({
    finalViewportBBox: candidate.bbox,
    previewText: candidate.previewText,
    typeGuess: candidate.questionTypeGuess,
    imageUrl: undefined,
    hasImage: candidate.hasImage,
    matchedCandidate: null,
    matchedVisibleCandidate: null,
  }));
  const setActiveCandidates = vi.fn();
  const candidate = makeQuestion();
  const deps = {
    candidateStatusMap: new Map(),
    isRuntimeCurrent: () => true,
    workspaceRouteEpoch: () => 0,
    workspaceDetectionGeneration: () => 1,
    isFullPageScanRunning: () => false,
    setAutoSolveStopRequestedGetter: () => stopped,
    detectCandidatesFullPage: vi.fn(async () => [candidate]),
    cancelFullPageScan: vi.fn(),
    safeRuntimeSendMessage: send,
    createHighlightLayer: () => ({ setBlocks: vi.fn(), destroy: vi.fn() }),
    destroyHighlightLayer: vi.fn(),
    stopSpaWatch: vi.fn(),
    refreshLayoutResizeObservation: vi.fn(),
    refreshFullPageHighlightsAfterLayoutChange: vi.fn(),
    logEvent: vi.fn(),
    setActiveCandidates,
    setActiveHighlightBlocks: vi.fn(),
    setActiveDetectMode: vi.fn(),
    setLastFullPageLayoutKey: vi.fn(),
    setHighlightLayer: vi.fn(),
    setUnwatchSPA: vi.fn(),
    getFullPageLayoutKey: () => "window",
    resolveFullPageScrollRoot: () => window,
    getScrollTop: () => 0,
    getScrollLeft: () => 0,
    setScrollPosition: vi.fn(),
    pauseFullPage: async () => undefined,
    detectCandidatesInViewport: () => [candidate],
    refineViewportCandidate: refineViewport,
    getAutoSolveTextFingerprint: (text: string) => text,
    detectAutoSolveQuestionOrder: () => 1,
    extractQuestionImageUrlFromBBox: () => null,
    extractTextFromBBox: () => candidate.previewText,
    inferAutoSolveQuestionType: () => "single_choice",
    pickBestAutoSolvePreviewText: (left: string, right: string) => right || left,
    resolveQuestionBlockFromBBox: (bbox: BoundingBox) => ({
      refinedBBox: bbox, finalBBox: bbox, previewText: candidate.previewText, matchedCandidate: null,
    }),
    projectViewportBboxToAbsolute: (bbox: BoundingBox) => bbox,
    shouldPreferViewportPreviewCore: () => true,
    looksLikeGarbledFullPageTextCore: () => false,
    normalizeQuestionText: (text: string) => text,
    watchForPageChanges: vi.fn(() => vi.fn()),
  };
  const bridge = createContentDetectionBridge(deps as unknown as Parameters<typeof createContentDetectionBridge>[0]);
  return { bridge, send, refineViewport, setActiveCandidates, deps };
}

describe("RC03B-R11 independent full-page/auto-solve stop ownership", () => {
  it("R11A an old Auto Solve STOP cannot erase independently scanned full-page questions", async () => {
    const { bridge, send, refineViewport, setActiveCandidates } = createFixture(true);
    await bridge.handleFullPageDetect(undefined, () => true);
    expect(refineViewport).toHaveBeenCalledOnce();
    expect(setActiveCandidates).toHaveBeenCalledWith([expect.objectContaining({ id: "q-stem" })]);
    const done = send.mock.calls.map(([msg]) => msg).find((msg) => msg.type === "FULL_PAGE_DETECT_DONE");
    expect(done).toMatchObject({ outcome: "completed", totalFound: 1 });
    expect(done.candidates).toHaveLength(1);
  });

  it("R11B an Auto Solve refinement still observes its own STOP flag", async () => {
    const { bridge, refineViewport } = createFixture(true);
    expect(await bridge.refineFullPageCandidatesViaManualPipeline([makeQuestion()])).toEqual([]);
    expect(refineViewport).not.toHaveBeenCalled();
  });

  it("R11C a revoked Full Page generation cannot commit even when Auto Solve STOP is ignored", async () => {
    const { bridge, send, setActiveCandidates } = createFixture(true);
    await bridge.handleFullPageDetect(undefined, () => false);
    expect(setActiveCandidates).not.toHaveBeenCalled();
    expect(send.mock.calls.map(([msg]) => msg.type)).not.toContain("FULL_PAGE_DETECT_DONE");
  });
});
