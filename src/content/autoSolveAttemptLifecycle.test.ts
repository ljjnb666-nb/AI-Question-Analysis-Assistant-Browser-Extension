import { describe, expect, it, vi } from "vitest";
import type { HistoryEntry, ParseResult, QuestionBlock } from "@/shared/types";
import { fillParsedAnswerInPage, hasAutoSolveQuestionAttempt } from "./answerFiller";
import { observeLiveQuestion } from "./liveQuestionObservation";
import { attachRuntimeRoot, TOP_ROOT_GENERATION, TOP_ROOT_KEY } from "./roots/rootContext";
import { runAutoSolveAll } from "./autoSolveOrchestration";
import { beginQuestionRevisionAttempt, clearQuestionRevisionAttempt } from "./revision/questionRevisionRuntime";
import { startQuestionRevisionWatch } from "./revision/questionRevisionWatch";

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, reject, resolve };
}

function question(): QuestionBlock {
  document.body.innerHTML = '<section class="question-item" id="q-run">12. prompt <button>A. a</button><button id="b">B. b</button><button id="c">C. c</button></section>';
  const owner = document.getElementById("q-run")!;
  document.elementsFromPoint = (() => [owner]) as typeof document.elementsFromPoint;
  const observed = observeLiveQuestion({ id: "q-run", bbox: { x: 0, y: 0, width: 500, height: 240 }, previewText: "12. prompt A. a B. b C. c", questionTypeGuess: "single_choice", hasImage: false, confidence: 1, source: "auto_dom" }, owner);
  return attachRuntimeRoot(observed, { rootKey: TOP_ROOT_KEY, rootGeneration: TOP_ROOT_GENERATION, kind: "top-document" }, owner);
}

function parsed(block: QuestionBlock): ParseResult {
  return { blockId: block.id, questionType: "single_choice", answer: "B", confidence: 1, briefExplanation: "", detailedExplanation: "", recognizedText: "", routeUsed: "text" };
}

function orchestrationDeps(block: QuestionBlock, parse: (value: QuestionBlock) => Promise<ParseResult>) {
  return {
    activeCandidates: [], activeDetectMode: null, clickNextQuestionButton: () => false,
    detectCandidatesFullPage: async () => [], detectCandidatesInViewport: () => [], detectTotalQuestionCount: () => 1,
    extractAutoSolveQuestionOrder: () => 12, extractQuestionImageUrlFromBBox: () => null, extractRichQuestionPreviewFromElement: () => "",
    extractTextFromBBox: () => "", fillParsedAnswerInPage: (value: QuestionBlock, result: ParseResult, options?: { mode?: "auto" | "manual" }) => fillParsedAnswerInPage(value, result, options),
    findBestDetectedCandidateForBBox: () => null, findMatchingFullPageCandidate: () => null, findNextQuestionButton: () => document.createElement("button"),
    findReusableHistoryEntry: () => null, getAutoSolveFingerprint: () => "q-run", getAutoSolveTextFingerprint: () => "q-run", getScrollLeft: () => 0,
    hasVisibleAutoSolveMedia: () => false, inferAutoSolveQuestionType: () => "single_choice" as const,
    inspectAutoSolveAnswerState: () => ({ mode: "none" as const, answeredCount: 0, totalCount: 0, complete: false }), isChoiceLikeQuestionType: () => true,
    isExtensionUiElement: () => false, loadHistory: async () => [], parseBlockForAutoSolve: parse, parseBlockForAutoSolveQuickReview: parse,
    parseBlockForAutoSolveReview: parse, pauseMs: async () => {}, pickBestAutoSolvePreviewText: () => "", pickLiveAutoSolveBlock: () => block,
    projectViewportBboxToAbsolute: (value: QuestionBlock["bbox"]) => value, recordAutoSolveHistory: async () => {}, normalizeQuestionText: (value: string) => value,
    refineFullPageCandidatesViaManualPipeline: async () => [], refineViewportCandidate: async (value: QuestionBlock) => value, reportLocationHostname: () => "example.com",
    resolveQuestionBlockFromBBox: (value: QuestionBlock["bbox"]) => ({ refinedBBox: value, finalBBox: value, previewText: "", matchedCandidate: null }), resolveQuestionAdvance: async () => false,
    resolveScrollRoot: () => document.documentElement, sendAutoSolveDone: vi.fn(), sendAutoSolveProgress: vi.fn(), setScrollPosition: () => {},
    shouldPersistAutoSolveParseResult: () => true, shouldPreferViewportPreview: () => false, shouldRetryUnstableChoiceParse: () => false,
    shouldReviewLowConfidenceHistory: () => false, shouldStopAutoSolveAtTail: () => true, sortAutoSolveCandidates: (value: QuestionBlock[]) => value,
    verifyParsedAnswerInPage: () => ({ ok: true, message: "verified" }),
  };
}

describe("runAutoSolveAll attempt ownership", () => {
  it("RUN-CLEAN1 owns a successful question attempt through its final cleanup", async () => {
    const block = question();
    let running = false; let stopped = false;
    const controller = { isRunning: () => running, setRunning: (value: boolean) => { running = value; }, isStopRequested: () => stopped, requestStop: (value: boolean) => { stopped = value; } };
    await runAutoSolveAll(controller, orchestrationDeps(block, async () => parsed(block)) as never);
    expect(hasAutoSolveQuestionAttempt(block)).toBe(false);
  });

  it("RUN-STOP1 keeps the existing stop timing and cleans an aborted pending question", async () => {
    const block = question();
    const pending = deferred<ParseResult>();
    let running = false; let stopped = false;
    const controller = { isRunning: () => running, setRunning: (value: boolean) => { running = value; }, isStopRequested: () => stopped, requestStop: (value: boolean) => { stopped = value; } };
    const workflow = runAutoSolveAll(controller, orchestrationDeps(block, () => pending.promise) as never);
    await vi.waitFor(() => expect(hasAutoSolveQuestionAttempt(block)).toBe(true), { timeout: 5000 });
    controller.requestStop(true);
    pending.reject(new DOMException("aborted", "AbortError"));
    await workflow;
    expect(hasAutoSolveQuestionAttempt(block)).toBe(false);
    expect(running).toBe(false);
  });

  it("AUTO-COMMIT2 keeps history committed but stops progress, fill, and advance when authority changes during storage", async () => {
    const block = question();
    const storageWrite = deferred<boolean>();
    const historyDispatched = deferred<void>();
    let current = true;
    let running = false;
    let stopped = false;
    let committedHistoryWrites = 0;
    let progressCallsAtDispatch = 0;
    const sendAutoSolveProgress = vi.fn();
    const fillParsedAnswerInPage = vi.fn(async () => ({ ok: true, filledCount: 1, message: "filled" }));
    const resolveQuestionAdvance = vi.fn(async () => false);
    const controller = {
      isRunning: () => running,
      setRunning: (value: boolean) => { running = value; },
      isStopRequested: () => stopped,
      requestStop: (value: boolean) => { stopped = value; },
    };
    const deps = {
      ...orchestrationDeps(block, async () => parsed(block)),
      fillParsedAnswerInPage,
      isCurrentAutoSolveResult: () => current,
      recordAutoSolveHistory: async (history: HistoryEntry[], currentBlock: QuestionBlock, result: ParseResult) => {
        expect(current).toBe(true);
        progressCallsAtDispatch = sendAutoSolveProgress.mock.calls.length;
        historyDispatched.resolve();
        const committed = await storageWrite.promise;
        if (committed) {
          history.push({ id: "committed-in-flight", timestamp: 1, block: currentBlock, result, host: "example.test" });
          committedHistoryWrites += 1;
        }
        return committed;
      },
      resolveQuestionAdvance,
      sendAutoSolveProgress,
    };

    const workflow = runAutoSolveAll(controller, deps as never);
    await historyDispatched.promise;
    current = false;
    controller.requestStop(true);
    storageWrite.resolve(true);
    await workflow;

    expect(committedHistoryWrites).toBe(1);
    expect(sendAutoSolveProgress).toHaveBeenCalledTimes(progressCallsAtDispatch);
    expect(fillParsedAnswerInPage).not.toHaveBeenCalled();
    expect(resolveQuestionAdvance).not.toHaveBeenCalled();
    expect(running).toBe(false);
  });

  it("RUN-TX-STOP stops Auto Solve before question advance after a failed transaction", async () => {
    const block = question();
    let running = false;
    let stopped = false;
    const controller = {
      isRunning: () => running,
      setRunning: (value: boolean) => { running = value; },
      isStopRequested: () => stopped,
      requestStop: (value: boolean) => { stopped = value; },
    };
    const fillParsedAnswerInPage = vi.fn(async () => ({ ok: false, filledCount: 0, message: "PARTIAL_MUTATION_UNPROVABLE", stopAutomation: true }));
    const sendAutoSolveDone = vi.fn();
    const resolveQuestionAdvance = vi.fn(async () => false);

    await runAutoSolveAll(controller, {
      ...orchestrationDeps(block, async () => parsed(block)),
      fillParsedAnswerInPage,
      sendAutoSolveDone,
      resolveQuestionAdvance,
    } as never);

    expect(fillParsedAnswerInPage).toHaveBeenCalledTimes(1);
    expect(sendAutoSolveDone).toHaveBeenCalledWith(expect.objectContaining({ ok: false, stopped: true, message: "PARTIAL_MUTATION_UNPROVABLE" }));
    expect(resolveQuestionAdvance).not.toHaveBeenCalled();
    expect(running).toBe(false);
  });

  it("SPA-RACE1 production orchestration rejects a late stale provider result with zero DOM mutation", async () => {
    const current = question();
    const pending = deferred<ParseResult>();
    let candidates = [current];
    let running = false; let stopped = false; let clicks = 0;
    document.getElementById("b")!.addEventListener("click", () => clicks += 1);
    const provider = new AbortController();
    const stopWatch = startQuestionRevisionWatch({ detectCandidates: () => candidates, onCandidates: () => {} });
    const controller = { isRunning: () => running, setRunning: (value: boolean) => { running = value; }, isStopRequested: () => stopped, requestStop: (value: boolean) => { stopped = value; } };
    const workflow = runAutoSolveAll(controller, orchestrationDeps(current, async () => {
      beginQuestionRevisionAttempt(current, provider);
      return pending.promise;
    }) as never);
    await vi.waitFor(() => expect(hasAutoSolveQuestionAttempt(current)).toBe(true), { timeout: 5000 });
    const owner = document.getElementById("q-run")!;
    owner.firstChild!.textContent = "12. revised prompt ";
    candidates = [{ ...current, identity: { ...current.identity!, contentFingerprint: "cf-revised" } }];
    document.body.append(document.createElement("div"));
    await vi.waitFor(() => expect(provider.signal.aborted).toBe(true), { timeout: 5000 });
    pending.resolve(parsed(current));
    await workflow;
    expect(clicks).toBe(0);
    expect(hasAutoSolveQuestionAttempt(current)).toBe(false);
    stopWatch(); clearQuestionRevisionAttempt(provider);
  }, 20_000);
});
