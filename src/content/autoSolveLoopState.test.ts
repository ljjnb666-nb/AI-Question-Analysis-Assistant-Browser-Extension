import { describe, expect, it, vi } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import { prepareAutoSolveIteration } from "./autoSolveLoopState";

function makeBlock(overrides: Partial<QuestionBlock> = {}): QuestionBlock {
  return {
    id: "q-1",
    bbox: { x: 10, y: 20, width: 300, height: 120 },
    previewText: "1. Sample question",
    hasImage: false,
    confidence: 0.9,
    questionTypeGuess: "single_choice",
    source: "auto_dom",
    ...overrides,
  };
}

describe("prepareAutoSolveIteration", () => {
  it("stops immediately when stop is requested", async () => {
    const sendAutoSolveDone = vi.fn();
    const sendAutoSolveProgress = vi.fn();

    const result = await prepareAutoSolveIteration(
      {
        driveFromOrderedPlan: false,
        filled: 2,
        getOrderedPlanCursor: () => 0,
        getOrderedPlanSize: () => 0,
        lastFingerprint: "prev",
        orderedPlanState: {},
        pickLiveAutoSolveBlock: () => makeBlock(),
        repeatedCount: 1,
        resolveOrderedPlanViewportBlock: async () => null,
        sendAutoSolveDone,
        sendAutoSolveProgress,
        solved: 3,
        stopRequested: true,
        toProgressBlock: (block) => block,
        total: 5,
        updateTotalCount: () => 9,
      },
      {
        extractAutoSolveQuestionOrder: () => 1,
        getAutoSolveFingerprint: () => "fp-1",
      },
    );

    expect(result.kind).toBe("done");
    expect(sendAutoSolveDone).toHaveBeenCalledTimes(1);
    expect(sendAutoSolveProgress).not.toHaveBeenCalled();
    expect(sendAutoSolveDone.mock.calls[0]?.[0]).toMatchObject({
      ok: true,
      stopped: true,
      solved: 3,
      filled: 2,
      total: 5,
    });
  });

  it("marks a repeated fingerprint as repeated same question and refreshes total", async () => {
    const sendAutoSolveDone = vi.fn();
    const sendAutoSolveProgress = vi.fn();
    const block = makeBlock({ id: "q-2", previewText: "2. Another sample" });

    const result = await prepareAutoSolveIteration(
      {
        driveFromOrderedPlan: false,
        filled: 1,
        getOrderedPlanCursor: () => 0,
        getOrderedPlanSize: () => 0,
        lastFingerprint: "same-fp",
        orderedPlanState: {},
        pickLiveAutoSolveBlock: () => block,
        repeatedCount: 1,
        resolveOrderedPlanViewportBlock: async () => null,
        sendAutoSolveDone,
        sendAutoSolveProgress,
        solved: 4,
        stopRequested: false,
        toProgressBlock: (current) => ({ ...current, previewText: `${current.previewText} progress` }),
        total: 0,
        updateTotalCount: () => 7,
      },
      {
        extractAutoSolveQuestionOrder: () => 2,
        getAutoSolveFingerprint: () => "same-fp",
      },
    );

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.repeatedSameQuestion).toBe(true);
    expect(result.state.repeatedCount).toBe(2);
    expect(result.state.total).toBe(7);
    expect(sendAutoSolveDone).not.toHaveBeenCalled();
    expect(sendAutoSolveProgress).toHaveBeenCalledTimes(1);
    expect(sendAutoSolveProgress.mock.calls[0]?.[0]).toMatchObject({
      solved: 4,
      filled: 1,
      total: 7,
      current: 5,
      currentQuestionId: "q-2",
      currentPreview: "2. Another sample",
    });
  });

  it("finishes successfully when ordered plan is exhausted and no current block is found", async () => {
    const sendAutoSolveDone = vi.fn();

    const result = await prepareAutoSolveIteration(
      {
        driveFromOrderedPlan: true,
        filled: 0,
        getOrderedPlanCursor: () => 3,
        getOrderedPlanSize: () => 3,
        lastFingerprint: "",
        orderedPlanState: { cursor: 3 },
        pickLiveAutoSolveBlock: () => null,
        repeatedCount: 0,
        resolveOrderedPlanViewportBlock: async () => null,
        sendAutoSolveDone,
        sendAutoSolveProgress: vi.fn(),
        solved: 3,
        stopRequested: false,
        toProgressBlock: (block) => block,
        total: 3,
        updateTotalCount: () => 3,
      },
      {
        extractAutoSolveQuestionOrder: () => null,
        getAutoSolveFingerprint: () => "",
      },
    );

    expect(result.kind).toBe("done");
    expect(sendAutoSolveDone).toHaveBeenCalledTimes(1);
    expect(sendAutoSolveDone.mock.calls[0]?.[0]).toMatchObject({
      ok: true,
      solved: 3,
      filled: 0,
      total: 3,
    });
  });
});
