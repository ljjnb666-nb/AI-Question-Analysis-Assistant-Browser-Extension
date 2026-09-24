import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import {
  createOrderedPlanState,
  ensureOrderedPlan,
  resolveOrderedPlanViewportBlock,
} from "./autoSolveOrderedPlan";

const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");

function setScrollY(value: number): void {
  Object.defineProperty(window, "scrollY", { configurable: true, value });
}

afterEach(() => {
  if (originalScrollY) Object.defineProperty(window, "scrollY", originalScrollY);
  else Reflect.deleteProperty(window, "scrollY");
});

function makeRootQuestion(): QuestionBlock {
  return {
    id: "frame-question",
    identity: {
      identityVersion: 1,
      stableId: "q_v1_exact_frame",
      contentFingerprint: "cf_v1_exact_frame",
      strategy: "content-only",
      signals: { nativeId: true, content: true, options: true, media: false, structure: true },
    },
    bbox: { x: 20, y: 100, width: 500, height: 220 },
    previewText: "12. Which value equals 2 + 2? A. 3 B. 4 C. 5 D. 6",
    hasImage: false,
    questionTypeGuess: "single_choice",
    confidence: 1,
    source: "auto_dom",
    runtimeQuestionHandle: "rqh_exact_runtime_candidate",
  };
}

function makeDeps(block: QuestionBlock) {
  const setScrollPosition = vi.fn();
  const refineViewportCandidate = vi.fn(() => ({
    finalViewportBBox: { x: 999, y: 999, width: 1, height: 1 },
    hasImage: true,
    imageUrl: "https://wrong-top-page.invalid/preview.png",
    matchedVisibleCandidate: null,
    previewText: "wrong top-document question",
    typeGuess: "short_answer" as const,
  }));
  const refreshRuntimeQuestionBlock = vi.fn((candidate: QuestionBlock) => ({
    ...candidate,
    bbox: { ...candidate.bbox, x: 24, y: 31 },
  }));
  const projectViewportBboxToAbsolute = vi.fn((bbox: QuestionBlock["bbox"], _root: Window | Element) => ({
    ...bbox,
    y: bbox.y + window.scrollY,
  }));
  return {
    deps: {
      activeDetectMode: "viewport" as const,
      detectCandidatesFullPage: vi.fn(async () => []),
      detectRootCandidates: vi.fn(() => [block]),
      detectTotalQuestionCount: vi.fn(() => 10),
      extractAutoSolveQuestionOrder: vi.fn((text: string) => Number(text.match(/^\d+/)?.[0] ?? 0) || null),
      getActiveCandidates: vi.fn(() => []),
      getScrollLeft: vi.fn(() => 0),
      projectViewportBboxToAbsolute,
      refreshRuntimeQuestionBlock,
      mergeOrderedPlanWithDetectedCandidates: vi.fn((_dom: QuestionBlock[], refined: QuestionBlock[]) => refined),
      pauseMs: vi.fn(async () => undefined),
      refineFullPageCandidatesViaManualPipeline: vi.fn(async (_candidates: QuestionBlock[]) => []),
      refineViewportCandidate,
      scrollRoot: window,
      sequentialScrollMode: false,
      setScrollPosition,
      sortAutoSolveCandidates: vi.fn((candidates: QuestionBlock[]) => candidates),
      buildOrderedPlanFromDomQuestionCards: vi.fn(() => []),
    },
    setScrollPosition,
    refineViewportCandidate,
    refreshRuntimeQuestionBlock,
    projectViewportBboxToAbsolute,
  };
}

describe("cross-root ordered plan coordinate contract", () => {
  it("ROOT-PLAN-SCROLL-1 converts an iframe viewport box to page absolute coordinates", async () => {
    setScrollY(620);
    const block = makeRootQuestion();
    const state = createOrderedPlanState();
    const mocks = makeDeps(block);

    const plan = await ensureOrderedPlan(state, mocks.deps);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      coordinateSpace: "SCROLL_ROOT_ABSOLUTE",
      block: { bbox: { x: 20, y: 720, width: 500, height: 220 } },
    });

    const resolved = await resolveOrderedPlanViewportBlock(state, mocks.deps);
    expect(mocks.setScrollPosition).toHaveBeenCalledWith(window, 598, 0);
    expect(resolved?.bbox.y).toBe(31);
    expect(resolved?.identity).toEqual(block.identity);
    expect(mocks.refineViewportCandidate).not.toHaveBeenCalled();
  });

  it("ROOT-PLAN-SCROLL-2 never lets top-document refinement rewrite frame semantics", async () => {
    setScrollY(0);
    const block = makeRootQuestion();
    const state = createOrderedPlanState();
    const mocks = makeDeps(block);

    const resolved = await resolveOrderedPlanViewportBlock(state, mocks.deps);
    expect(resolved?.previewText).toBe(block.previewText);
    expect(resolved?.questionTypeGuess).toBe(block.questionTypeGuess);
    expect(resolved?.identity?.stableId).toBe(block.identity?.stableId);
    expect(mocks.refineViewportCandidate).not.toHaveBeenCalled();
    expect(mocks.refreshRuntimeQuestionBlock).toHaveBeenCalledWith(expect.objectContaining({
      runtimeQuestionHandle: block.runtimeQuestionHandle,
    }));
  });

  it("ROOT-PLAN-SCROLL-3 keeps root identity when the page scrolls after detection", async () => {
    setScrollY(200);
    const block = makeRootQuestion();
    const state = createOrderedPlanState();
    const mocks = makeDeps(block);
    await ensureOrderedPlan(state, mocks.deps);

    setScrollY(500);
    const resolved = await resolveOrderedPlanViewportBlock(state, mocks.deps);

    expect(mocks.setScrollPosition).toHaveBeenCalledWith(window, 178, 0);
    expect(resolved?.identity?.stableId).toBe("q_v1_exact_frame");
    expect(resolved?.identity?.contentFingerprint).toBe("cf_v1_exact_frame");
    expect(resolved?.runtimeQuestionHandle).toBe(block.runtimeQuestionHandle);
  });
});
