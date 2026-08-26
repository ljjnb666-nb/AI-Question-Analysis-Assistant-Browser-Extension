import { describe, expect, it, vi } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { resolveAutoSolveQuestion } from "./autoSolveQuestionResolution";
import {
  fillParsedAnswerInPage,
  finishAutoSolveQuestionAttempt,
  hasAutoSolveQuestionAttempt,
} from "./answerFiller";
import { observeLiveQuestion } from "./liveQuestionObservation";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function prepareChoiceQuestion() {
  document.body.innerHTML = '<section class="question-item" id="q-12">12. prompt <button id="a">A. a</button><button id="b">B. b</button><button id="c">C. c</button></section>';
  const owner = document.getElementById("q-12")!;
  document.elementsFromPoint = (() => [owner]) as typeof document.elementsFromPoint;
  document.getElementById("c")!.addEventListener("click", () => document.getElementById("c")!.setAttribute("aria-checked", "true"));
  return observeLiveQuestion(makeBlock({ id: "q-12", previewText: "12. prompt A. a B. b C. c" }), owner);
}

function resolveDeps(parse: (block: QuestionBlock) => Promise<ParseResult>) {
  return {
    fillParsedAnswerInPage: (block: QuestionBlock, result: ParseResult) => fillParsedAnswerInPage(block, result, { mode: "auto" }),
    isChoiceLikeQuestionType: () => true,
    parseBlockForAutoSolve: parse,
    parseBlockForAutoSolveQuickReview: vi.fn(),
    parseBlockForAutoSolveReview: vi.fn(),
    recordAutoSolveHistory: vi.fn(async () => {}),
    sendProgress: vi.fn(),
    shouldPersistAutoSolveParseResult: () => true,
    shouldRetryUnstableChoiceParse: (result: ParseResult) => result.confidence < 0.5,
    toProgressBlock: (block: QuestionBlock) => block,
    verifyParsedAnswerInPage: () => ({ ok: false, message: "not filled" }),
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

  it("AUTO-SNAP1 keeps the original empty baseline across a real deferred retry", async () => {
    const block = prepareChoiceQuestion();
    const first = deferred<ParseResult>();
    const second = deferred<ParseResult>();
    const parse = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const workflow = resolveAutoSolveQuestion(
      { answerStateComplete: false, currentBlock: block, filled: 0, history: [], historyEntry: null, needsHistoryReview: false, needsQuickAnsweredChoiceReview: false, solved: 0, total: 1 },
      resolveDeps(parse),
    );
    expect(hasAutoSolveQuestionAttempt(block)).toBe(true);
    document.getElementById("c")!.click();
    first.resolve(makeResult({ blockId: block.id, answer: "A", confidence: 0.2 }));
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(2));
    expect(hasAutoSolveQuestionAttempt(block)).toBe(true);
    second.resolve(makeResult({ blockId: block.id, answer: "B", confidence: 0.95 }));
    const outcome = await workflow;
    expect(outcome.progressMessage).toContain("USER_STATE_CHANGED");
    expect(document.getElementById("c")!.getAttribute("aria-checked")).toBe("true");
    expect(document.getElementById("b")!.getAttribute("aria-checked")).toBeNull();
    finishAutoSolveQuestionAttempt(block);
    expect(hasAutoSolveQuestionAttempt(block)).toBe(false);
  });

  it("AUTO-SNAP2 and AUTO-SNAP3 preserve a user change on deferred review routes", async () => {
    for (const route of ["history", "quick"] as const) {
      const block = prepareChoiceQuestion();
      const pending = deferred<ParseResult>();
      const deps = resolveDeps(vi.fn());
      if (route === "history") deps.parseBlockForAutoSolveReview = vi.fn(() => pending.promise);
      else deps.parseBlockForAutoSolveQuickReview = vi.fn(() => pending.promise);
      const workflow = resolveAutoSolveQuestion(
        { answerStateComplete: route === "quick", currentBlock: block, filled: 0, history: [], historyEntry: null, needsHistoryReview: route === "history", needsQuickAnsweredChoiceReview: route === "quick", solved: 0, total: 1 },
        deps,
      );
      expect(hasAutoSolveQuestionAttempt(block)).toBe(true);
      document.getElementById("c")!.click();
      pending.resolve(makeResult({ blockId: block.id, answer: "B", confidence: 0.95 }));
      const outcome = await workflow;
      expect(outcome.progressMessage).toContain("USER_STATE_CHANGED");
      expect(document.getElementById("c")!.getAttribute("aria-checked")).toBe("true");
      expect(document.getElementById("b")!.getAttribute("aria-checked")).toBeNull();
      finishAutoSolveQuestionAttempt(block);
      expect(hasAutoSolveQuestionAttempt(block)).toBe(false);
    }
  });

  it("CLEAN-ABORT1 and an unexpected fill exception leave final cleanup to the owner", async () => {
    const block = prepareChoiceQuestion();
    const abort = resolveAutoSolveQuestion(
      { answerStateComplete: false, currentBlock: block, filled: 0, history: [], historyEntry: null, needsHistoryReview: false, needsQuickAnsweredChoiceReview: false, solved: 0, total: 1 },
      resolveDeps(vi.fn(async () => { throw new DOMException("aborted", "AbortError"); })),
    );
    await abort;
    expect(hasAutoSolveQuestionAttempt(block)).toBe(true);
    finishAutoSolveQuestionAttempt(block);
    expect(hasAutoSolveQuestionAttempt(block)).toBe(false);

    const next = prepareChoiceQuestion();
    const deps = resolveDeps(vi.fn(async () => makeResult({ blockId: next.id, answer: "B", confidence: 0.95 })));
    deps.fillParsedAnswerInPage = vi.fn(async () => { throw new Error("unexpected fill failure"); });
    await resolveAutoSolveQuestion(
      { answerStateComplete: false, currentBlock: next, filled: 0, history: [], historyEntry: null, needsHistoryReview: false, needsQuickAnsweredChoiceReview: false, solved: 0, total: 1 },
      deps,
    );
    expect(hasAutoSolveQuestionAttempt(next)).toBe(true);
    finishAutoSolveQuestionAttempt(next);
    expect(hasAutoSolveQuestionAttempt(next)).toBe(false);
  });
});
