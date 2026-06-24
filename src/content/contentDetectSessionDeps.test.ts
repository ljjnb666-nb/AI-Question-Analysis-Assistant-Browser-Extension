import { describe, expect, it, vi } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import {
  createDetectSessionDeps,
  createNotifySidePanelDeps,
  createRefineFullPageDeps,
} from "./contentDetectSessionDeps";

function makeBlock(overrides: Partial<QuestionBlock> = {}): QuestionBlock {
  return {
    id: "q-1",
    bbox: { x: 10, y: 20, width: 300, height: 120 },
    previewText: "1. sample question",
    hasImage: false,
    confidence: 0.9,
    questionTypeGuess: "single_choice",
    source: "auto_dom",
    ...overrides,
  };
}

describe("contentDetectSessionDeps", () => {
  it("creates detect session deps by direct passthrough", async () => {
    const candidateStatusMap = new Map<string, { status: string; selected: boolean }>();
    const createHighlightLayer = vi.fn();
    const detectCandidatesFullPage = vi.fn(async () => [makeBlock()]);
    const detectCandidatesInViewport = vi.fn(() => [makeBlock({ id: "viewport" })]);
    const watchForPageChanges = vi.fn(() => () => undefined);

    const deps = createDetectSessionDeps({
      candidateStatusMap,
      cancelFullPageScan: vi.fn(),
      createHighlightLayer,
      detectCandidatesFullPage,
      detectCandidatesInViewport,
      destroyHighlightLayer: vi.fn(),
      getFullPageLayoutKey: vi.fn(() => "layout-key"),
      isFullPageScanRunning: vi.fn(() => false),
      logEvent: vi.fn(),
      notifySidePanel: vi.fn(),
      refreshFullPageHighlightsAfterLayoutChange: vi.fn(),
      refreshLayoutResizeObservation: vi.fn(),
      refineFullPageCandidatesViaManualPipeline: vi.fn(async (candidates: QuestionBlock[]) => candidates),
      resolveFullPageScrollRoot: vi.fn(() => window),
      safeRuntimeSendMessage: vi.fn(),
      setActiveCandidates: vi.fn(),
      setActiveDetectMode: vi.fn(),
      setActiveHighlightBlocks: vi.fn(),
      setHighlightLayer: vi.fn(),
      setLastFullPageLayoutKey: vi.fn(),
      setUnwatchSPA: vi.fn(),
      stopSpaWatch: vi.fn(),
      watchForPageChanges,
    });

    expect(deps.candidateStatusMap).toBe(candidateStatusMap);
    expect(await deps.detectCandidatesFullPage(() => undefined)).toEqual([makeBlock()]);
    expect(deps.detectCandidatesInViewport()).toEqual([makeBlock({ id: "viewport" })]);
    expect(deps.watchForPageChanges(() => undefined)).toBeTypeOf("function");
    expect(deps.createHighlightLayer).toBe(createHighlightLayer);
  });

  it("returns refine full page deps unchanged", () => {
    const refineDeps = {
      resolveFullPageScrollRoot: vi.fn(() => window),
      getScrollTop: vi.fn(() => 0),
      getScrollLeft: vi.fn(() => 0),
      setScrollPosition: vi.fn(),
      pauseFullPage: vi.fn(async () => {}),
      refineViewportCandidate: vi.fn(),
      detectCandidatesInViewport: vi.fn(() => []),
      extractQuestionImageUrlFromBBox: vi.fn(() => null),
      extractAutoSolveQuestionOrder: vi.fn(() => 1),
      extractTextFromBBox: vi.fn(() => ""),
      inferAutoSolveQuestionType: vi.fn(() => "single_choice" as const),
      pickBestAutoSolvePreviewText: vi.fn(() => ""),
      resolveQuestionBlockFromBBox: vi.fn(() => ({
        refinedBBox: { x: 0, y: 0, width: 1, height: 1 },
        finalBBox: { x: 0, y: 0, width: 1, height: 1 },
        previewText: "",
        matchedCandidate: null,
      })),
      shouldPreferViewportPreview: vi.fn(() => false),
      projectViewportBboxToAbsolute: vi.fn((bbox: QuestionBlock["bbox"]) => bbox),
      getAutoSolveTextFingerprint: vi.fn(() => "fp"),
      autoSolveStopRequested: vi.fn(() => false),
    };

    expect(createRefineFullPageDeps(refineDeps)).toBe(refineDeps);
  });

  it("creates notify sidepanel deps with only the required fields", () => {
    const candidateStatusMap = new Map<string, { status: string; selected: boolean }>();
    const safeRuntimeSendMessage = vi.fn();

    const deps = createNotifySidePanelDeps({
      candidateStatusMap,
      safeRuntimeSendMessage,
    });

    expect(deps).toEqual({
      candidateStatusMap,
      safeRuntimeSendMessage,
    });
  });
});
