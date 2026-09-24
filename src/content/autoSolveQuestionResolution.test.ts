import { describe, expect, it, vi } from "vitest";
import type { HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import { resolveAutoSolveQuestion } from "./autoSolveQuestionResolution";
import {
  fillParsedAnswerInPage,
  finishAutoSolveQuestionAttempt,
  hasAutoSolveQuestionAttempt,
} from "./answerFiller";
import { observeLiveQuestion } from "./liveQuestionObservation";
import { attachRuntimeRoot, TOP_ROOT_GENERATION, TOP_ROOT_KEY } from "./roots/rootContext";
import { StaleQuestionRevisionError } from "@/shared/utils/parseAttemptErrors";

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
  const observed = observeLiveQuestion(makeBlock({ id: "q-12", previewText: "12. prompt A. a B. b C. c" }), owner);
  return attachRuntimeRoot(observed, { rootKey: TOP_ROOT_KEY, rootGeneration: TOP_ROOT_GENERATION, kind: "top-document" }, owner);
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

  it("RC-A commits a current result once before filling", async () => {
    const block = makeBlock();
    const result = makeResult({ confidence: 0.95 });
    const parse = vi.fn(async () => result);
    const recordAutoSolveHistory = vi.fn(async () => true);
    const fillParsedAnswerInPage = vi.fn(async () => ({ ok: true, filledCount: 1, message: "filled" }));
    const sendProgress = vi.fn();

    const outcome = await resolveAutoSolveQuestion(
      { answerStateComplete: false, currentBlock: block, filled: 0, history: [], historyEntry: null, needsHistoryReview: false, needsQuickAnsweredChoiceReview: false, solved: 0, total: 1 },
      {
        ...resolveDeps(parse),
        fillParsedAnswerInPage,
        isChoiceLikeQuestionType: () => true,
        isCurrentAutoSolveResult: () => true,
        recordAutoSolveHistory,
        sendProgress,
        shouldRetryUnstableChoiceParse: () => false,
        verifyParsedAnswerInPage: () => ({ ok: true, message: "verified" }),
      },
    );

    expect(outcome.stale).toBeUndefined();
    expect(recordAutoSolveHistory).toHaveBeenCalledTimes(1);
    expect(fillParsedAnswerInPage).toHaveBeenCalledTimes(1);
    expect(sendProgress).toHaveBeenCalledTimes(1);
  });

  it("RC-B discards a provider result that became stale while pending", async () => {
    const block = makeBlock();
    const pending = deferred<ParseResult>();
    let current = true;
    const parse = vi.fn(() => pending.promise);
    const recordAutoSolveHistory = vi.fn(async () => true);
    const fillParsedAnswerInPage = vi.fn(async () => ({ ok: true, filledCount: 1, message: "filled" }));
    const sendProgress = vi.fn();
    const workflow = resolveAutoSolveQuestion(
      { answerStateComplete: false, currentBlock: block, filled: 0, history: [], historyEntry: null, needsHistoryReview: false, needsQuickAnsweredChoiceReview: false, solved: 0, total: 1 },
      {
        ...resolveDeps(parse),
        fillParsedAnswerInPage,
        isCurrentAutoSolveResult: () => current,
        recordAutoSolveHistory,
        sendProgress,
      },
    );

    current = false;
    pending.resolve(makeResult({ confidence: 0.95 }));
    const outcome = await workflow;

    expect(outcome).toMatchObject({ stale: true, filledDelta: 0, questionCompleted: false });
    expect(recordAutoSolveHistory).not.toHaveBeenCalled();
    expect(fillParsedAnswerInPage).not.toHaveBeenCalled();
    expect(sendProgress).not.toHaveBeenCalled();
  });

  it("AUTO-COMMIT1 keeps authorized history but stops progress and fill when authority is lost during storage", async () => {
    const block = makeBlock();
    const historyWrite = deferred<boolean>();
    const historyDispatched = deferred<void>();
    const committedHistory: HistoryEntry[] = [];
    let current = true;
    const result = makeResult({ confidence: 0.95 });
    const fillParsedAnswerInPage = vi.fn(async () => ({ ok: true, filledCount: 1, message: "filled" }));
    const sendProgress = vi.fn();
    const recordAutoSolveHistory = vi.fn(async (history: HistoryEntry[], currentBlock: QuestionBlock, parsed: ParseResult) => {
      expect(current).toBe(true);
      historyDispatched.resolve();
      const committed = await historyWrite.promise;
      if (committed) {
        const entry: HistoryEntry = { id: "committed-during-storage", timestamp: 1, block: currentBlock, result: parsed, host: "example.test" };
        history.unshift(entry);
        committedHistory.push(entry);
      }
      return committed;
    });
    const workflow = resolveAutoSolveQuestion(
      { answerStateComplete: false, currentBlock: block, filled: 0, history: [], historyEntry: null, needsHistoryReview: false, needsQuickAnsweredChoiceReview: false, solved: 0, total: 1 },
      {
        ...resolveDeps(vi.fn(async () => result)),
        fillParsedAnswerInPage,
        isCurrentAutoSolveResult: () => current,
        recordAutoSolveHistory,
        sendProgress,
        shouldRetryUnstableChoiceParse: () => false,
      },
    );

    await historyDispatched.promise;
    current = false;
    historyWrite.resolve(true);
    const outcome = await workflow;

    expect(committedHistory).toHaveLength(1);
    expect(recordAutoSolveHistory).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ stale: true, filledDelta: 0, questionCompleted: false });
    expect(sendProgress).not.toHaveBeenCalled();
    expect(fillParsedAnswerInPage).not.toHaveBeenCalled();
  });

  it("RC-C lets only the latest overlapping parse resolve, persist, and fill", async () => {
    const block = makeBlock();
    const first = deferred<ParseResult>();
    const second = deferred<ParseResult>();
    let latestAnswer = "older";
    const parse = vi.fn()
      .mockImplementationOnce(() => {
        latestAnswer = "older";
        return first.promise;
      })
      .mockImplementationOnce(() => {
        latestAnswer = "newer";
        return second.promise;
      });
    const recordAutoSolveHistory = vi.fn(async () => true);
    const fillParsedAnswerInPage = vi.fn(async () => ({ ok: true, filledCount: 1, message: "filled" }));
    const deps = {
      ...resolveDeps(parse),
      fillParsedAnswerInPage,
      isCurrentAutoSolveResult: (_block: QuestionBlock, result: ParseResult) => result.answer === latestAnswer,
      recordAutoSolveHistory,
      shouldRetryUnstableChoiceParse: () => false,
      verifyParsedAnswerInPage: () => ({ ok: true, message: "verified" }),
    };
    const options = { answerStateComplete: false, currentBlock: block, filled: 0, history: [], historyEntry: null, needsHistoryReview: false, needsQuickAnsweredChoiceReview: false, solved: 0, total: 1 };
    const olderWorkflow = resolveAutoSolveQuestion(options, deps);
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
    const newerWorkflow = resolveAutoSolveQuestion(options, deps);
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(2));

    second.resolve(makeResult({ answer: "newer", confidence: 0.95 }));
    const newer = await newerWorkflow;
    first.resolve(makeResult({ answer: "older", confidence: 0.95 }));
    const older = await olderWorkflow;

    expect(newer.stale).toBeUndefined();
    expect(older.stale).toBe(true);
    expect(recordAutoSolveHistory).toHaveBeenCalledTimes(1);
    expect(recordAutoSolveHistory).toHaveBeenCalledWith(expect.any(Array), block, expect.objectContaining({ answer: "newer" }));
    expect(fillParsedAnswerInPage).toHaveBeenCalledTimes(1);
    expect(fillParsedAnswerInPage).toHaveBeenCalledWith(block, expect.objectContaining({ answer: "newer" }));
  });

  it("returns a stale outcome for typed revision invalidation without reporting parse failure", async () => {
    const block = makeBlock();
    const recordAutoSolveHistory = vi.fn(async () => true);
    const fillParsedAnswerInPage = vi.fn(async () => ({ ok: true, filledCount: 1, message: "filled" }));
    const sendProgress = vi.fn();

    const outcome = await resolveAutoSolveQuestion(
      { answerStateComplete: false, currentBlock: block, filled: 0, history: [], historyEntry: null, needsHistoryReview: false, needsQuickAnsweredChoiceReview: false, solved: 0, total: 1 },
      {
        ...resolveDeps(vi.fn(async () => { throw new StaleQuestionRevisionError(); })),
        fillParsedAnswerInPage,
        recordAutoSolveHistory,
        sendProgress,
      },
    );

    expect(outcome).toMatchObject({ stale: true, filledDelta: 0, questionCompleted: false });
    expect(recordAutoSolveHistory).not.toHaveBeenCalled();
    expect(fillParsedAnswerInPage).not.toHaveBeenCalled();
    expect(sendProgress).not.toHaveBeenCalled();
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
