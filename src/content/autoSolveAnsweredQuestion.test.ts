import { describe, expect, it, vi } from "vitest";
import type { HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import { handleAnsweredQuestionPhase } from "./autoSolveAnsweredQuestion";
import { findReusableHistoryEntry } from "./autoSolveHeuristics";
import { captureSolveStartControlState, fillParsedAnswerInPage, finishAutoSolveQuestionAttempt, hasAutoSolveQuestionAttempt } from "./answerFiller";
import { observeLiveQuestion } from "./liveQuestionObservation";
import { attachRuntimeRoot, TOP_ROOT_GENERATION, TOP_ROOT_KEY } from "./roots/rootContext";
import { resolveAutoSolveQuestion } from "./autoSolveQuestionResolution";

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

function bindTopRuntimeCandidate(block: QuestionBlock, owner: Element): QuestionBlock {
  const observed = observeLiveQuestion(block, owner);
  return attachRuntimeRoot(observed, { rootKey: TOP_ROOT_KEY, rootGeneration: TOP_ROOT_GENERATION, kind: "top-document" }, owner);
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
  it("AUTO-SNAP4 and AUTO-SNAP4B do not let history reuse write without its original auto snapshot", async () => {
    const historyResult = makeResult({ questionType: "single_choice", answer: "B" });
    const historyEntry = makeHistoryEntry(historyResult);
    const run = async (unavailable: boolean) => {
      document.body.innerHTML = unavailable
        ? '<div id="q-hist">12. prompt <section class="question-item" data-question-id="11">11. unrelated A. x</section><section class="question-item" data-question-id="13">13. unrelated B. y</section></div><button id="b">B. b decoy</button><button id="c">C. c decoy</button>'
        : '<section class="question-item" id="q-hist">12. prompt <button>A. a</button><button id="b">B. b</button><button id="c">C. c</button></section>';
      const owner = document.getElementById("q-hist")!;
      document.elementsFromPoint = (() => [owner]) as typeof document.elementsFromPoint;
      const block = bindTopRuntimeCandidate(makeBlock({ id: "q-hist", previewText: "12. prompt A. a B. b C. c" }), owner);
      document.getElementById("c")!.addEventListener("click", () => document.getElementById("c")!.setAttribute("aria-checked", "true"));
      if (!unavailable) { captureSolveStartControlState(block); document.getElementById("c")!.click(); }
      const fill = vi.fn((target: QuestionBlock, parsed: ParseResult) => {
        // The no-control candidate cannot produce a solve-start snapshot; its
        // exact runtime owner still resolves, then fill fails closed.
        return fillParsedAnswerInPage(target, parsed, { mode: "auto" });
      });
      try {
        const outcome = await handleAnsweredQuestionPhase(
          { answerState: { mode: "none", answeredCount: 0, totalCount: 0, complete: false }, currentBlock: block, currentOrder: 12, driveFromOrderedPlan: false, filled: 0, fixedTotal: 1, history: [historyEntry], lastFingerprint: "q-hist", locationHostname: "example.com", repeatedCount: 0, solved: 0, total: 1 },
          { fillParsedAnswerInPage: fill, findReusableHistoryEntry: () => historyEntry, isChoiceLikeQuestionType: () => true, reportSolvedQuestionAndAdvance: vi.fn(async () => "continued" as const), sendAutoSolveProgress: vi.fn(), shouldReviewLowConfidenceHistory: () => false, toProgressBlock: value => value, verifyParsedAnswerInPage: () => ({ ok: false, message: "not filled" }) },
        );
        expect(outcome.handled).toBe(false);
        expect(fill).toHaveBeenCalledOnce();
        expect((await fill.mock.results[0]!.value).message).toBe(unavailable ? "USER_STATE_SNAPSHOT_UNAVAILABLE" : "USER_STATE_CHANGED");
        expect(document.getElementById("b")!.getAttribute("aria-checked")).toBeNull();
        if (!unavailable) expect(document.getElementById("c")!.getAttribute("aria-checked")).toBe("true");
        expect(hasAutoSolveQuestionAttempt(block)).toBe(true);
      } finally {
        finishAutoSolveQuestionAttempt(block);
      }
    };
    await run(true);
    await run(false);
  });

  it("AUTO-SNAP5 keeps one immutable attempt from failed history reuse through normal parse fallback", async () => {
    document.body.innerHTML = '<section class="question-item" id="q-fallback">12. prompt <button>A. a</button><button id="b">B. b</button><button id="c">C. c</button></section>';
    const owner = document.getElementById("q-fallback")!;
    document.elementsFromPoint = (() => [owner]) as typeof document.elementsFromPoint;
    const block = bindTopRuntimeCandidate(makeBlock({ id: "q-fallback", previewText: "12. prompt A. a B. b C. c" }), owner);
    document.getElementById("c")!.addEventListener("click", () => document.getElementById("c")!.setAttribute("aria-checked", "true"));
    const historyResult = makeResult({ blockId: block.id, questionType: "single_choice", answer: "B" });
    const historyEntry = makeHistoryEntry(historyResult);
    captureSolveStartControlState(block);
    document.getElementById("c")!.click();
    const autoFill = (target: QuestionBlock, parsed: ParseResult) => fillParsedAnswerInPage(target, parsed, { mode: "auto" });
    try {
      const history = await handleAnsweredQuestionPhase(
        { answerState: { mode: "none", answeredCount: 0, totalCount: 0, complete: false }, currentBlock: block, currentOrder: 12, driveFromOrderedPlan: false, filled: 0, fixedTotal: 1, history: [historyEntry], lastFingerprint: "q-fallback", locationHostname: "example.com", repeatedCount: 0, solved: 0, total: 1 },
        { fillParsedAnswerInPage: autoFill, findReusableHistoryEntry: () => historyEntry, isChoiceLikeQuestionType: () => true, reportSolvedQuestionAndAdvance: vi.fn(async () => "continued" as const), sendAutoSolveProgress: vi.fn(), shouldReviewLowConfidenceHistory: () => false, toProgressBlock: value => value, verifyParsedAnswerInPage: () => ({ ok: false, message: "not filled" }) },
      );
      expect(history.handled).toBe(false);
      expect(hasAutoSolveQuestionAttempt(block)).toBe(true);
      const normal = await resolveAutoSolveQuestion(
        { answerStateComplete: false, currentBlock: block, filled: 0, history: [], historyEntry: null, needsHistoryReview: false, needsQuickAnsweredChoiceReview: false, solved: 0, total: 1 },
        { fillParsedAnswerInPage: autoFill, isChoiceLikeQuestionType: () => true, parseBlockForAutoSolve: vi.fn(async () => historyResult), parseBlockForAutoSolveQuickReview: vi.fn(), parseBlockForAutoSolveReview: vi.fn(), recordAutoSolveHistory: vi.fn(), sendProgress: vi.fn(), shouldPersistAutoSolveParseResult: () => true, shouldRetryUnstableChoiceParse: () => false, toProgressBlock: value => value, verifyParsedAnswerInPage: () => ({ ok: false, message: "not filled" }) },
      );
      expect(normal.progressMessage).toContain("USER_STATE_CHANGED");
      expect(document.getElementById("c")!.getAttribute("aria-checked")).toBe("true");
      expect(document.getElementById("b")!.getAttribute("aria-checked")).toBeNull();
    } finally {
      finishAutoSolveQuestionAttempt(block);
      expect(hasAutoSolveQuestionAttempt(block)).toBe(false);
    }
  });

  it("HIST-LEGACY production flow denies identity-less history and falls through to a fresh parse", async () => {
    document.body.innerHTML = '<section class="question-item" id="q-legacy">根据下图选择正确答案。 <button>A. 甲</button><button id="b">B. 乙</button><button>C. 丙</button><button>D. 丁</button></section>';
    const owner = document.getElementById("q-legacy")!;
    document.elementsFromPoint = (() => [owner]) as typeof document.elementsFromPoint;
    const current = bindTopRuntimeCandidate(
      makeBlock({ id: "q-legacy", previewText: "根据下图选择正确答案。 A. 甲 B. 乙 C. 丙 D. 丁", hasImage: true, questionImageUrl: "http://img.test/diagram-b.png" }),
      owner,
    );
    expect(current.identity?.stableId).toBeTruthy();
    expect(current.identity?.contentFingerprint).toBeTruthy();

    const legacyEntry: HistoryEntry = {
      id: "hist-legacy",
      timestamp: 1,
      host: "example.com",
      block: {
        id: "hist-legacy",
        bbox: { x: 0, y: 0, width: 320, height: 120 },
        previewText: "根据下图选择正确答案。 A. 甲 B. 乙 C. 丙 D. 丁",
        hasImage: true,
        questionImageUrl: "http://img.test/diagram-a.png",
        confidence: 0.9,
        questionTypeGuess: "single_choice",
        source: "auto_dom",
      },
      result: makeResult({ blockId: "hist-legacy", questionType: "single_choice", answer: "B", confidence: 0.99 }),
    };
    // The matcher itself must be the real production policy, not a stub.
    expect(findReusableHistoryEntry([legacyEntry], current, "example.com")).toBeNull();

    const fill = vi.fn();
    const reportSolvedQuestionAndAdvance = vi.fn(async () => "continued" as const);
    try {
      const outcome = await handleAnsweredQuestionPhase(
        { answerState: { mode: "none", answeredCount: 0, totalCount: 0, complete: false }, currentBlock: current, currentOrder: 12, driveFromOrderedPlan: false, filled: 0, fixedTotal: 1, history: [legacyEntry], lastFingerprint: "q-legacy", locationHostname: "example.com", repeatedCount: 0, solved: 0, total: 1 },
        { fillParsedAnswerInPage: fill, findReusableHistoryEntry, isChoiceLikeQuestionType: (questionType) => questionType === "single_choice", reportSolvedQuestionAndAdvance, sendAutoSolveProgress: vi.fn(), shouldReviewLowConfidenceHistory: () => false, toProgressBlock: (block) => block, verifyParsedAnswerInPage: () => ({ ok: true, message: "verified" }) },
      );
      // The stale legacy answer never reaches the fill path; the workflow
      // falls through to the current-question parse/review path instead.
      expect(outcome.handled).toBe(false);
      expect(outcome.historyEntry).toBeNull();
      expect(fill).not.toHaveBeenCalled();
      expect(reportSolvedQuestionAndAdvance).not.toHaveBeenCalled();
    } finally {
      finishAutoSolveQuestionAttempt(current);
    }
  });

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
