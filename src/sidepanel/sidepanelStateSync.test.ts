import { describe, expect, it } from "vitest";
import type { CandidateSnapshot, DetectedCandidate, QuestionBlock } from "@/shared/types";
import {
  buildAutoSolveStartingState,
  mapAutoSolveDoneFeedback,
  mapAutoSolveProgressMessage,
  mapFullPageDoneCandidates,
  mapFullPageProgressMessage,
  mergeCandidateSnapshots,
  resetDetectState,
  startFullPageDetectState,
} from "./sidepanelStateSync";

const makeBlock = (id: string): QuestionBlock => ({
  id,
  bbox: { x: 0, y: 0, width: 100, height: 40 },
  previewText: `Question ${id}`,
  hasImage: false,
  questionTypeGuess: "single_choice",
  confidence: 0.8,
  source: "manual_capture",
});

describe("sidepanelStateSync", () => {
  it("merges snapshots while preserving existing result metadata", () => {
    const prev: DetectedCandidate[] = [
      {
        block: makeBlock("a"),
        selected: false,
        status: "success",
        result: {
          blockId: "a",
          questionType: "single_choice",
          answer: "B",
          confidence: 0.9,
          briefExplanation: "brief",
          detailedExplanation: "detail",
          recognizedText: "recognized",
          routeUsed: "text",
        },
      },
    ];
    const snapshots: CandidateSnapshot[] = [
      {
        block: makeBlock("a"),
        selected: true,
        status: "idle",
      },
    ];

    const merged = mergeCandidateSnapshots(prev, snapshots);

    expect(merged[0].selected).toBe(true);
    expect(merged[0].status).toBe("idle");
    expect(merged[0].result?.answer).toBe("B");
  });

  it("maps full-page progress and completion state", () => {
    expect(
      mapFullPageProgressMessage({ progress: 75, found: 3, currentStep: 2, totalScrollSteps: 4 }),
    ).toEqual({
      progress: 75,
      found: 3,
      step: 2,
      total: 4,
    });

    const done = mapFullPageDoneCandidates([makeBlock("a"), makeBlock("b")]);
    expect(done).toHaveLength(2);
    expect(done.every((candidate) => candidate.status === "idle" && !candidate.selected)).toBe(true);
  });

  it("maps auto-solve progress and localized feedback", () => {
    expect(
      mapAutoSolveProgressMessage({
        solved: 1,
        filled: 2,
        total: 3,
        current: 1,
        statusText: "working",
      }),
    ).toEqual({
      solved: 1,
      filled: 2,
      total: 3,
      current: 1,
      statusText: "working",
      currentPreview: "",
      currentBlock: undefined,
    });

    expect(mapAutoSolveDoneFeedback({ ok: true })).toBe("自动答题完成");
    expect(mapAutoSolveDoneFeedback({ ok: false })).toBe("自动答题失败");
    expect(buildAutoSolveStartingState("zh").statusText).toBe("开始自动答题...");
    expect(buildAutoSolveStartingState("en").statusText).toBe("Starting auto solve...");
  });

  it("builds detect reset state", () => {
    expect(resetDetectState()).toEqual({
      isDetecting: true,
      isFullPageScan: false,
      scanProgress: null,
      candidates: [],
      expandedIds: {},
    });

    expect(startFullPageDetectState()).toEqual({
      isDetecting: false,
      candidates: [],
      expandedIds: {},
      scanProgress: { progress: 0, found: 0, step: 0, total: 1 },
    });
  });
});
