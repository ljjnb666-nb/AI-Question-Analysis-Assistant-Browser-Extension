import { describe, expect, it, vi } from "vitest";
import type { HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import { handleAnsweredQuestionPhase } from "./autoSolveAnsweredQuestion";

function makeBlock(overrides: Partial<QuestionBlock> = {}): QuestionBlock {
  return {
    id: "q-1",
    bbox: { x: 10, y: 20, width: 320, height: 120 },
    previewText: "1. sample question",
    hasImage: false,
    confidence: 0.9,
    questionTypeGuess: "single_choice",
    source: "auto_dom",
    ...overrides,
  };
}

function makeResult(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    blockId: "q-1",
    questionType: "single_choice",
    answer: "A",
    confidence: 0.95,
    briefExplanation: "",
    detailedExplanation: "",
    recognizedText: "",
    routeUsed: "vision",
    ...overrides,
  };
}

function makeHistoryEntry(result: ParseResult): HistoryEntry {
  return {
    id: "hist-1",
    timestamp: Date.now(),
    block: makeBlock({ id: result.blockId }),
    result,
    host: "example.com",
  };
}

describe("handleAnsweredQuestionPhase", () => {
  it("skips already answered text questions without review", async () => {
    const reportSolvedQuestionAndAdvance = vi.fn<
      (options: {
        currentBlock: QuestionBlock;
        currentOrder: number | null;
        driveFromOrderedPlan: boolean;
        filled: number;
        fixedTotal: number;
        lastFingerprint: string;
        solved: number;
        statusText: string;
        total: number;
      }) => Promise<"continued" | "done">
    >(async () => "continued");
    const result = await handleAnsweredQuestionPhase(
      {
        answerState: { mode: "text", answeredCount: 2, totalCount: 2, complete: true },
        currentBlock: makeBlock(),
        currentOrder: 1,
        driveFromOrderedPlan: false,
        filled: 3,
        fixedTotal: 5,
        history: [],
        lastFingerprint: "fp-1",
        locationHostname: "example.com",
        repeatedCount: 0,
        solved: 4,
        total: 8,
      },
      {
        fillParsedAnswerInPage: vi.fn(),
        findReusableHistoryEntry: () => null,
        isChoiceLikeQuestionType: () => false,
        reportSolvedQuestionAndAdvance,
        sendAutoSolveProgress: vi.fn(),
        shouldReviewLowConfidenceHistory: () => false,
        toProgressBlock: (block) => block,
        verifyParsedAnswerInPage: vi.fn(),
      },
    );

    expect(result.handled).toBe(true);
    expect(result.done).toBe(false);
    expect(result.solved).toBe(5);
    expect(result.filled).toBe(3);
    expect(reportSolvedQuestionAndAdvance).toHaveBeenCalledTimes(1);
    expect(reportSolvedQuestionAndAdvance).toHaveBeenCalledWith(expect.objectContaining({
      solved: 5,
      filled: 3,
      currentOrder: 1,
    }));
  });

  it("keeps current answered choice and advances after repeated stalls", async () => {
    const reportSolvedQuestionAndAdvance = vi.fn<
      (options: {
        currentBlock: QuestionBlock;
        currentOrder: number | null;
        driveFromOrderedPlan: boolean;
        filled: number;
        fixedTotal: number;
        lastFingerprint: string;
        solved: number;
        statusText: string;
        total: number;
      }) => Promise<"continued" | "done">
    >(async () => "continued");
    const result = await handleAnsweredQuestionPhase(
      {
        answerState: { mode: "choice", answeredCount: 1, totalCount: 1, complete: true },
        currentBlock: makeBlock(),
        currentOrder: 2,
        driveFromOrderedPlan: true,
        filled: 1,
        fixedTotal: 6,
        history: [],
        lastFingerprint: "fp-2",
        locationHostname: "example.com",
        repeatedCount: 1,
        solved: 2,
        total: 6,
      },
      {
        fillParsedAnswerInPage: vi.fn(),
        findReusableHistoryEntry: () => null,
        isChoiceLikeQuestionType: () => true,
        reportSolvedQuestionAndAdvance,
        sendAutoSolveProgress: vi.fn(),
        shouldReviewLowConfidenceHistory: () => false,
        toProgressBlock: (block) => block,
        verifyParsedAnswerInPage: vi.fn(),
      },
    );

    expect(result.handled).toBe(true);
    expect(result.solved).toBe(3);
    expect(reportSolvedQuestionAndAdvance).toHaveBeenCalledTimes(1);
    expect(reportSolvedQuestionAndAdvance).toHaveBeenCalledWith(expect.objectContaining({
      driveFromOrderedPlan: true,
      solved: 3,
    }));
  });

  it("reuses accepted history answers and completes the question", async () => {
    const historyResult = makeResult({ questionType: "single_choice", answer: "B" });
    const historyEntry = makeHistoryEntry(historyResult);
    const sendAutoSolveProgress = vi.fn();
    const reportSolvedQuestionAndAdvance = vi.fn<
      (options: {
        currentBlock: QuestionBlock;
        currentOrder: number | null;
        driveFromOrderedPlan: boolean;
        filled: number;
        fixedTotal: number;
        lastFingerprint: string;
        solved: number;
        statusText: string;
        total: number;
      }) => Promise<"continued" | "done">
    >(async () => "continued");

    const result = await handleAnsweredQuestionPhase(
      {
        answerState: { mode: "none", answeredCount: 0, totalCount: 0, complete: false },
        currentBlock: makeBlock({ id: "q-hist" }),
        currentOrder: 3,
        driveFromOrderedPlan: false,
        filled: 0,
        fixedTotal: 10,
        history: [historyEntry],
        lastFingerprint: "fp-hist",
        locationHostname: "example.com",
        repeatedCount: 0,
        solved: 2,
        total: 10,
      },
      {
        fillParsedAnswerInPage: vi.fn(async () => ({ ok: true, filledCount: 1, message: "filled from history" })),
        findReusableHistoryEntry: () => historyEntry,
        isChoiceLikeQuestionType: (questionType) => questionType === "single_choice",
        reportSolvedQuestionAndAdvance,
        sendAutoSolveProgress,
        shouldReviewLowConfidenceHistory: () => false,
        toProgressBlock: (block) => block,
        verifyParsedAnswerInPage: vi.fn(() => ({ ok: true, message: "verified" })),
      },
    );

    expect(result.handled).toBe(true);
    expect(result.solved).toBe(3);
    expect(result.filled).toBe(1);
    expect(result.historyEntry).toBe(historyEntry);
    expect(sendAutoSolveProgress).toHaveBeenCalledTimes(2);
    expect(reportSolvedQuestionAndAdvance).toHaveBeenCalledTimes(1);
  });
});
