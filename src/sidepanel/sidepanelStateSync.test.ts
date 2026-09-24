import { describe, expect, it } from "vitest";
import type { CandidateOrigin, CandidateSnapshot, DetectedCandidate, QuestionBlock } from "@/shared/types";
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

const origin: CandidateOrigin = { tabId: 41, url: "https://quiz.example.test/assignment/7" };

const makeBlock = (id: string, fingerprint = `fingerprint-${id}`): QuestionBlock => ({
  id,
  identity: {
    stableId: `stable-${id}`,
    contentFingerprint: fingerprint,
    identityVersion: 1,
    strategy: "content-only",
    signals: { nativeId: false, content: true, options: true, media: false, structure: true },
  },
  runtimeQuestionHandle: `rqh_${id.padEnd(32, "0").slice(0, 32)}`,
  bbox: { x: 0, y: 0, width: 100, height: 40 },
  previewText: `Question ${id}`,
  hasImage: false,
  questionTypeGuess: "single_choice",
  confidence: 0.8,
  source: "auto_dom",
});

describe("sidepanelStateSync", () => {
  it("merges snapshots while preserving existing result metadata", () => {
    const prev: DetectedCandidate[] = [
      {
        block: makeBlock("a"),
        origin,
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

    const merged = mergeCandidateSnapshots(prev, snapshots, origin);

    expect(merged[0].selected).toBe(true);
    expect(merged[0].status).toBe("idle");
    expect(merged[0].result?.answer).toBe("B");
  });

  it("clears a prior result when a scan comes from another tab or page", () => {
    const previous: DetectedCandidate[] = [{
      block: makeBlock("a"),
      origin,
      selected: true,
      status: "success",
      result: { blockId: "a", questionType: "single_choice", answer: "B", confidence: 0.9, briefExplanation: "brief", detailedExplanation: "detail", recognizedText: "recognized", routeUsed: "text" },
    }];

    const merged = mergeCandidateSnapshots(previous, [{ block: makeBlock("a"), selected: true, status: "idle" }], {
      tabId: 42,
      url: "https://quiz.example.test/assignment/8",
    });

    expect(merged[0].status).toBe("idle");
    expect(merged[0].result).toBeUndefined();
    expect(merged[0].origin).toEqual({ tabId: 42, url: "https://quiz.example.test/assignment/8" });
  });

  it("clears a prior result when the same block id has a different runtime revision", () => {
    const previous: DetectedCandidate[] = [{
      block: makeBlock("a"),
      origin,
      selected: true,
      status: "success",
      result: { blockId: "a", questionType: "single_choice", answer: "B", confidence: 0.9, briefExplanation: "brief", detailedExplanation: "detail", recognizedText: "recognized", routeUsed: "text" },
    }];

    const merged = mergeCandidateSnapshots(previous, [{ block: makeBlock("a", "new-fingerprint"), selected: true, status: "idle" }], origin);

    expect(merged[0].status).toBe("idle");
    expect(merged[0].result).toBeUndefined();
  });

  it("does not transfer legacy manual-capture results into detected candidates", () => {
    const previous: DetectedCandidate[] = [{
      block: { ...makeBlock("a"), source: "manual_capture" },
      origin,
      selected: true,
      status: "success",
      result: { blockId: "a", questionType: "single_choice", answer: "B", confidence: 0.9, briefExplanation: "brief", detailedExplanation: "detail", recognizedText: "recognized", routeUsed: "text" },
    }];

    const merged = mergeCandidateSnapshots(previous, [{ block: makeBlock("a"), selected: true, status: "idle" }], origin);

    expect(merged[0].status).toBe("idle");
    expect(merged[0].result).toBeUndefined();
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
