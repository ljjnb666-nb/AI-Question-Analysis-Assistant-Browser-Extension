import { describe, expect, it, vi } from "vitest";
import type { BoundingBox, QuestionBlock } from "@/shared/types";
import {
  createBuildOrderedPlanDeps,
  createMergeOrderedPlanDeps,
  createOrderedPlanDeps,
  createReportSolvedQuestionAndAdvanceDeps,
} from "./contentAutoSolveDeps";

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

describe("contentAutoSolveDeps", () => {
  it("creates build ordered plan deps by direct passthrough", () => {
    const deps = createBuildOrderedPlanDeps({
      projectViewportBboxToAbsolute: vi.fn((bbox: BoundingBox) => bbox),
      extractRichQuestionPreviewFromElement: vi.fn(() => "preview"),
      extractQuestionImageUrlFromBBox: vi.fn(() => null),
      inferAutoSolveQuestionType: vi.fn(() => "single_choice" as const),
      hasVisibleAutoSolveMedia: vi.fn(() => false),
      isExtensionUiElement: vi.fn(() => false),
      normalizeQuestionText: vi.fn((raw: string) => raw.trim()),
      extractAutoSolveQuestionOrder: vi.fn(() => 1),
      sortAutoSolveCandidates: vi.fn((candidates: QuestionBlock[]) => candidates),
    });

    expect(deps.extractRichQuestionPreviewFromElement(document.body)).toBe("preview");
    expect(deps.inferAutoSolveQuestionType("x")).toBe("single_choice");
    expect(deps.extractAutoSolveQuestionOrder("1. x")).toBe(1);
  });

  it("creates merge ordered plan deps by direct passthrough", () => {
    const match = vi.fn(() => makeBlock({ id: "matched" }));
    const pick = vi.fn(() => "picked");
    const deps = createMergeOrderedPlanDeps({
      sortAutoSolveCandidates: vi.fn((candidates: QuestionBlock[]) => candidates),
      findMatchingFullPageCandidate: match,
      findBestDetectedCandidateForBBox: vi.fn(() => null),
      extractAutoSolveQuestionOrder: vi.fn(() => 2),
      pickBestAutoSolvePreviewText: pick,
    });

    const candidates = [makeBlock()];
    const target = makeBlock({ id: "target" });
    const usedIds = new Set<string>();
    expect(deps.findMatchingFullPageCandidate(candidates, target, usedIds, deps.extractAutoSolveQuestionOrder)?.id).toBe("matched");
    expect(deps.pickBestAutoSolvePreviewText("raw", "rich", "single_choice")).toBe("picked");
  });

  it("creates ordered plan deps with wrapped getters and refiners", async () => {
    const activeCandidates = [makeBlock()];
    const refineViewportCandidate = vi.fn(() => ({
      finalViewportBBox: { x: 1, y: 2, width: 3, height: 4 },
      hasImage: false,
      previewText: "refined",
      typeGuess: "single_choice" as const,
    }));
    const deps = createOrderedPlanDeps({
      activeCandidates,
      activeDetectMode: "viewport",
      buildOrderedPlanFromDomQuestionCards: vi.fn(() => activeCandidates),
      detectCandidatesFullPage: vi.fn(async () => activeCandidates),
      detectTotalQuestionCount: vi.fn(() => 4),
      getScrollLeft: vi.fn(() => 0),
      mergeOrderedPlanWithDetectedCandidates: vi.fn((domPlan, refined) => [...domPlan, ...refined]),
      pauseMs: vi.fn(async () => {}),
      refineFullPageCandidatesViaManualPipeline: vi.fn(async (candidates) => candidates),
      refineViewportCandidate,
      scrollRoot: window,
      sequentialScrollMode: true,
      setScrollPosition: vi.fn(),
      sortAutoSolveCandidates: vi.fn((candidates: QuestionBlock[]) => candidates),
      extractAutoSolveQuestionOrder: vi.fn(() => 1),
    });

    expect(deps.getActiveCandidates()).toBe(activeCandidates);
    expect(await deps.detectCandidatesFullPage()).toBe(activeCandidates);
    expect(await deps.refineFullPageCandidatesViaManualPipeline(activeCandidates)).toBe(activeCandidates);
    deps.refineViewportCandidate(activeCandidates[0], window);
    expect(refineViewportCandidate).toHaveBeenCalledWith(activeCandidates[0], window);
  });

  it("maps advance progress into sidepanel progress payload", async () => {
    const sendAutoSolveProgress = vi.fn();
    const advanceAfterSolvedQuestion = vi.fn(async () => "continued" as const);
    const deps = createReportSolvedQuestionAndAdvanceDeps({
      advanceAfterSolvedQuestion,
      incrementOrderedPlanCursor: vi.fn(),
      sendAutoSolveProgress,
      toProgressBlock: (block) => ({ ...block, previewText: `${block.previewText} progress` }),
    });

    const currentBlock = makeBlock();
    deps.sendProgress({
      currentBlock,
      filled: 2,
      questionId: currentBlock.id,
      questionPreview: currentBlock.previewText,
      solved: 3,
      statusText: "advancing",
      total: 9,
    });

    expect(sendAutoSolveProgress).toHaveBeenCalledTimes(1);
    expect(sendAutoSolveProgress).toHaveBeenCalledWith(expect.objectContaining({
      running: true,
      solved: 3,
      filled: 2,
      total: 9,
      current: 3,
      currentQuestionId: currentBlock.id,
      currentPreview: currentBlock.previewText,
    }));

    await deps.advanceAfterSolvedQuestion({
      currentBlock,
      currentOrder: 1,
      driveFromOrderedPlan: false,
      filled: 2,
      fixedTotal: 9,
      lastFingerprint: "fp-1",
      solved: 3,
      total: 9,
    });
    expect(advanceAfterSolvedQuestion).toHaveBeenCalledTimes(1);
  });
});
