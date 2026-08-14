import { describe, expect, it, vi } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { resolveAutoSolveQuestion } from "./autoSolveQuestionResolution";

function makeBlock(overrides: Partial<QuestionBlock> = {}): QuestionBlock {
  return {
    id: "q-1",
    bbox: { x: 0, y: 0, width: 320, height: 120 },
    previewText: "1. sample question",
    hasImage: false,
    questionTypeGuess: "single_choice",
    confidence: 0.9,
    source: "auto_dom",
    ...overrides,
  };
}

function makeResult(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    blockId: "q-1",
    questionType: "single_choice",
    answer: "A",
    confidence: 0.4,
    briefExplanation: "",
    detailedExplanation: "",
    recognizedText: "1. sample question",
    routeUsed: "text",
    optionSelections: {},
    ...overrides,
  };
}

describe("resolveAutoSolveQuestion", () => {
  it("does not call a provider for an incomplete automatic candidate", async () => {
    const parse = vi.fn();
    const result = await resolveAutoSolveQuestion({ answerStateComplete: false, currentBlock: makeBlock({ completeness: { state: "incomplete", boundaryComplete: false, stemComplete: false, optionsComplete: "unknown", visualComplete: true, controlsComplete: "unknown", confidence: .9, reasons: ["Q_INCOMPLETE_STEM"] } }), filled: 0, history: [], historyEntry: null, needsHistoryReview: false, needsQuickAnsweredChoiceReview: false, solved: 0, total: 1 }, { fillParsedAnswerInPage: vi.fn(), isChoiceLikeQuestionType: vi.fn(), parseBlockForAutoSolve: parse, parseBlockForAutoSolveQuickReview: vi.fn(), parseBlockForAutoSolveReview: vi.fn(), recordAutoSolveHistory: vi.fn(), sendProgress: vi.fn(), shouldPersistAutoSolveParseResult: vi.fn(), shouldRetryUnstableChoiceParse: vi.fn(), toProgressBlock: block => block, verifyParsedAnswerInPage: vi.fn() });
    expect(parse).not.toHaveBeenCalled();
    expect(result.progressMessage).toContain("INCOMPLETE_QUESTION");
  });
  it("retries unstable parses only once before continuing", async () => {
    const currentBlock = makeBlock();
    const parseBlockForAutoSolve = vi
      .fn()
      .mockResolvedValueOnce(makeResult({ confidence: 0.35 }))
      .mockResolvedValueOnce(makeResult({ confidence: 0.38 }));

    const result = await resolveAutoSolveQuestion(
      {
        answerStateComplete: false,
        currentBlock,
        filled: 0,
        history: [],
        historyEntry: null,
        needsHistoryReview: false,
        needsQuickAnsweredChoiceReview: false,
        solved: 0,
        total: 3,
      },
      {
        fillParsedAnswerInPage: vi.fn(async () => ({ ok: true, filledCount: 1, message: "filled" })),
        isChoiceLikeQuestionType: vi.fn(() => true),
        parseBlockForAutoSolve,
        parseBlockForAutoSolveQuickReview: vi.fn(),
        parseBlockForAutoSolveReview: vi.fn(),
        recordAutoSolveHistory: vi.fn(async () => {}),
        sendProgress: vi.fn(),
        shouldPersistAutoSolveParseResult: vi.fn(() => false),
        shouldRetryUnstableChoiceParse: vi.fn(() => true),
        toProgressBlock: (block) => block,
        verifyParsedAnswerInPage: vi.fn(() => ({ ok: false, message: "not used" })),
      },
    );

    expect(parseBlockForAutoSolve).toHaveBeenCalledTimes(2);
    expect(result.questionCompleted).toBe(true);
    expect(result.progressMessage).toContain("2 attempts");
  });
});
