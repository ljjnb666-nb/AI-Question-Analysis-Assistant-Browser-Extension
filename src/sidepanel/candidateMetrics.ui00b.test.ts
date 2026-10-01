import { describe, expect, it, vi } from "vitest";
import type { DetectedCandidate, ParseResult } from "@/shared/types";
import { isCandidateFillReady, computeCandidateMetrics } from "./sidepanelCandidateMetrics";
import { runBatchFill } from "./batchOperations";

const origin = { tabId: 41, url: "https://quiz.example.test/assignment/7" };

const providerResult: ParseResult = {
  blockId: "b",
  questionType: "single_choice",
  answer: "B",
  confidence: 0.9,
  briefExplanation: "",
  detailedExplanation: "",
  recognizedText: "",
  routeUsed: "text",
  optionSelections: { B: true },
  resultSource: "provider",
};

const makeCandidate = (id: string, result: ParseResult | undefined, overrides: Partial<DetectedCandidate> = {}): DetectedCandidate => ({
  block: {
    id,
    bbox: { x: 0, y: 0, width: 100, height: 40 },
    previewText: "1. q A. a B. b",
    hasImage: false,
    questionTypeGuess: "single_choice",
    confidence: 0.9,
    source: "auto_dom",
  },
  origin,
  selected: true,
  status: "success",
  result,
  ...overrides,
});

describe("fillable count contract (UI-00B PART D)", () => {
  it("UI00B-08: a selected provider result counts as fillable", () => {
    expect(isCandidateFillReady(makeCandidate("a", providerResult))).toBe(true);
  });

  it("UI00B-09: a selected mock result is never counted fillable", () => {
    expect(isCandidateFillReady(makeCandidate("a", { ...providerResult, resultSource: "mock" }))).toBe(false);
  });

  it("UI00B-10: a selected legacy-unknown result is never counted fillable", () => {
    const legacy: ParseResult = { ...providerResult };
    delete (legacy as Partial<ParseResult>).resultSource;
    expect(isCandidateFillReady(makeCandidate("a", legacy))).toBe(false);
  });

  it("a provider result without a fillable structured answer is not counted", () => {
    const extractionFailed: ParseResult = {
      ...providerResult,
      answer: "需人工确认",
      warning: "选择题未提取到稳定的结构化选项结论，需人工确认后再填写。",
    };
    expect(isCandidateFillReady(makeCandidate("a", extractionFailed))).toBe(false);
  });

  it("UI00B-11: a mixed selection counts exactly the authoritative candidates", () => {
    const legacy: ParseResult = { ...providerResult };
    delete (legacy as Partial<ParseResult>).resultSource;
    const candidates = [
      makeCandidate("provider-1", providerResult),
      makeCandidate("mock-2", { ...providerResult, resultSource: "mock" }),
      makeCandidate("legacy-3", legacy),
      makeCandidate("provider-4", providerResult),
      makeCandidate("idle-5", undefined, { status: "idle" as const, result: undefined }),
    ];
    const { selectedCount, selectedSolvedCount } = computeCandidateMetrics(
      candidates,
      "all",
      () => false,
    );
    expect(selectedCount).toBe(5);
    expect(selectedSolvedCount).toBe(2);
  });
});

describe("zero-fillable batch behavior (UI-00B PART E)", () => {
  it("UI00B-12: a selection with no fillable results sends zero fill messages and reports the skip", async () => {
    const deps = {
      isCandidateCurrent: vi.fn(async () => true),
      setCandidates: vi.fn(),
      sendFillMessageWithVerify: vi.fn(async () => ({ ok: true, filledCount: 1 })),
    };
    const legacy: ParseResult = { ...providerResult };
    delete (legacy as Partial<ParseResult>).resultSource;

    const { successfulQuestions, totalFilled, attemptedQuestions, withheldCount } = await runBatchFill([
      makeCandidate("mock-1", { ...providerResult, resultSource: "mock" }),
      makeCandidate("legacy-2", legacy),
    ], deps);

    expect(deps.sendFillMessageWithVerify).not.toHaveBeenCalled();
    expect(attemptedQuestions).toBe(0);
    expect(successfulQuestions).toBe(0);
    expect(totalFilled).toBe(0);
    expect(withheldCount).toBe(0);
  });

  it("a partial selection reports only the actually-filled questions as filled", async () => {
    const deps = {
      isCandidateCurrent: vi.fn(async () => true),
      setCandidates: vi.fn(),
      sendFillMessageWithVerify: vi.fn(async () => ({ ok: true, filledCount: 2 })),
    };

    const { successfulQuestions, attemptedQuestions, withheldCount } = await runBatchFill([
      makeCandidate("provider-1", providerResult),
      makeCandidate("mock-2", { ...providerResult, resultSource: "mock" }),
    ], deps);

    expect(deps.sendFillMessageWithVerify).toHaveBeenCalledTimes(1);
    expect(attemptedQuestions).toBe(1);
    expect(successfulQuestions).toBe(1);
    expect(withheldCount).toBe(0);
  });
});
