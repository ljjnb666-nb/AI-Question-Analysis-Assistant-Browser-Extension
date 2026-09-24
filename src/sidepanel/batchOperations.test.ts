import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type DetectedCandidate, type ParseResult, type QuestionBlock } from "@/shared/types";
import {
  runBatchFill,
  runBatchParse,
  runFillCandidate,
  runRetryRisky,
  runRetryVision,
} from "./batchOperations";
import { createCandidateAttemptRegistry } from "./candidateAuthority";

const origin = { tabId: 41, url: "https://quiz.example.test/assignment/7" };
const identityFor = (id: string) => ({
  stableId: `stable-${id}`,
  contentFingerprint: `fingerprint-${id}`,
  identityVersion: 1 as const,
  strategy: "content-only" as const,
  signals: { nativeId: false, content: true, options: true, media: false, structure: true },
});

const makeBlock = (id = "block-1", overrides: Partial<QuestionBlock> = {}): QuestionBlock => ({
  id,
  identity: identityFor(id),
  runtimeQuestionHandle: `rqh_${id.padEnd(32, "0").slice(0, 32)}`,
  bbox: { x: 0, y: 0, width: 120, height: 60 },
  previewText: "6-44 输出月份英文名 函数接口定义： char *getmonth( int n );",
  hasImage: false,
  questionTypeGuess: "short_answer",
  confidence: 0.9,
  source: "auto_dom",
  ...overrides,
});

const makeResult = (overrides: Partial<ParseResult> = {}): ParseResult => ({
  blockId: "block-1",
  questionType: "short_answer",
  answer: "answer",
  confidence: 0.9,
  briefExplanation: "brief",
  detailedExplanation: "detail",
  recognizedText: "recognized",
  routeUsed: "vision",
  ...overrides,
});

const makeCandidate = (id = "block-1", overrides: Partial<DetectedCandidate> = {}): DetectedCandidate => ({
  block: makeBlock(id),
  origin,
  selected: false,
  status: "success",
  result: makeResult({ blockId: id }),
  ...overrides,
});

function createSetCandidates(initial: DetectedCandidate[]) {
  let state = initial;
  let staleBoundaryPassed = false;
  let updatesAfterStaleBoundary = 0;
  const setCandidates = (updater: (prev: DetectedCandidate[]) => DetectedCandidate[]) => {
    if (staleBoundaryPassed) updatesAfterStaleBoundary += 1;
    state = updater(state);
  };
  return {
    setCandidates,
    getState: () => state,
    replaceState: (next: DetectedCandidate[]) => { state = next; },
    markStaleBoundary: () => { staleBoundaryPassed = true; },
    getUpdatesAfterStaleBoundary: () => updatesAfterStaleBoundary,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createDeps(overrides: Record<string, unknown> = {}) {
  const history: unknown[] = [];
  const deps = {
    attempts: createCandidateAttemptRegistry(),
    isCandidateCurrent: vi.fn(async () => true),
    logCommittedResult: vi.fn(),
    logDiscardedStaleResult: vi.fn(),
    addHistoryEntryIfCurrent: vi.fn(async (entry: unknown, isCurrent: () => Promise<boolean>) => {
      if (!await isCurrent()) return false;
      history.push(entry);
      return true;
    }),
    loadSettings: async () => DEFAULT_SETTINGS,
    getProvider: () => ({ supportsVision: true }),
    requestBlockImage: vi.fn(async (tabId: number) => {
      expect(tabId).toBe(origin.tabId);
      return "data:image/png;base64,abc";
    }),
    parseQuestion: vi.fn(async () => makeResult()),
    pickBatchReviewModel: () => DEFAULT_SETTINGS.apiModel,
    shouldRetryBatchParseAfterError: () => false,
    shouldRetryWithVision: () => false,
    preferVisionResult: (_text: ParseResult, vision: ParseResult) => vision.confidence > 0.5,
    hasSufficientPreviewText: () => true,
    langSafe: (_lang: "zh" | "en" | undefined, zh: string) => zh,
    shouldRetryBatchParseForIncompleteResult: () => false,
    preferBatchRetryResult: (first: ParseResult, retry: ParseResult) => retry.confidence > first.confidence,
    ...overrides,
  };
  return { deps, history };
}

describe("Side Panel result commit authority", () => {
  it("keeps the origin tab and a better prior result through a vision retry", async () => {
    const current = makeResult({ answer: "better current answer", confidence: 0.95 });
    const candidate = makeCandidate("block-1", { result: current });
    const store = createSetCandidates([candidate]);
    const { deps, history } = createDeps({
      parseQuestion: vi.fn(async () => makeResult({ answer: "worse retry", confidence: 0.55 })),
    });

    await runRetryVision(candidate, {
      ...deps,
      setCandidates: store.setCandidates,
    });

    expect(deps.requestBlockImage).toHaveBeenCalledWith(origin.tabId, candidate.block.bbox);
    expect(store.getState()[0].result).toEqual(current);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ host: "quiz.example.test", result: current });
    expect(deps.logCommittedResult).toHaveBeenCalledTimes(1);
  });

  it("uses the reviewed vision result when the first retry remains incomplete", async () => {
    const candidate = makeCandidate("reviewed", { status: "idle", result: undefined });
    const firstVision = makeResult({ blockId: candidate.block.id, answer: "需人工确认", confidence: 0.62 });
    const reviewedVision = makeResult({ blockId: candidate.block.id, answer: "reviewed answer", confidence: 0.88 });
    const store = createSetCandidates([candidate]);
    const { deps, history } = createDeps({
      parseQuestion: vi.fn().mockResolvedValueOnce(firstVision).mockResolvedValueOnce(reviewedVision),
      shouldRetryBatchParseForIncompleteResult: (result: ParseResult) => result.answer === "需人工确认",
      preferBatchRetryResult: (first: ParseResult, retry: ParseResult) => retry.answer !== "需人工确认" || retry.confidence > first.confidence,
    });

    await runRetryVision(candidate, { ...deps, setCandidates: store.setCandidates });

    expect(deps.parseQuestion).toHaveBeenCalledTimes(2);
    expect(store.getState()[0].result).toEqual(reviewedVision);
    expect(history).toHaveLength(1);
    expect((history[0] as { result: ParseResult }).result).toEqual(reviewedVision);
  });

  it("keeps an existing good result when vision capture fails", async () => {
    const current = makeResult({ blockId: "capture-failure", answer: "existing", confidence: 0.97 });
    const candidate = makeCandidate("capture-failure", { result: current });
    const store = createSetCandidates([candidate]);
    const { deps, history } = createDeps({
      requestBlockImage: vi.fn(async () => { throw new Error("Screenshot unavailable"); }),
    });

    await runRetryVision(candidate, { ...deps, setCandidates: store.setCandidates });

    expect(store.getState()[0].status).toBe("success");
    expect(store.getState()[0].result).toEqual(current);
    expect(store.getState()[0].debugInfo?.retryError).toBe("Screenshot unavailable");
    expect(history).toHaveLength(0);
  });

  it("discards a vision result when its source revision changes while the provider is pending", async () => {
    const candidate = makeCandidate();
    const store = createSetCandidates([candidate]);
    const { deps, history } = createDeps({
      isCandidateCurrent: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      parseQuestion: vi.fn(async () => makeResult({ answer: "stale answer" })),
    });

    await runRetryVision(candidate, { ...deps, setCandidates: store.setCandidates });

    expect(history).toHaveLength(0);
    expect(store.getState()[0]).toMatchObject({ status: "idle", error: "STALE_QUESTION_REVISION" });
    expect(store.getState()[0].result).toBeUndefined();
    expect(deps.logDiscardedStaleResult).toHaveBeenCalledTimes(1);
    expect(deps.logCommittedResult).not.toHaveBeenCalled();
  });

  it("RC-SIDEPANEL-COMMIT keeps committed history and success telemetry but leaves a newer candidate untouched", async () => {
    const candidate = makeCandidate("commit-race", { selected: true, status: "idle", result: undefined });
    const nextCandidate = makeCandidate("commit-race", {
      block: makeBlock("commit-race", {
        identity: { ...identityFor("commit-race"), contentFingerprint: "next-revision" },
        runtimeQuestionHandle: "rqh_nextrevision0123456789abcdef",
      }),
      status: "idle",
      result: undefined,
    });
    const store = createSetCandidates([candidate]);
    const storageWrite = deferred<void>();
    const historyDispatched = deferred<void>();
    let current = true;
    const { deps, history } = createDeps({
      getProvider: () => ({ supportsVision: false }),
      isCandidateCurrent: vi.fn(async () => current),
      parseQuestion: vi.fn(async () => makeResult({ blockId: candidate.block.id, answer: "committed answer" })),
      addHistoryEntryIfCurrent: vi.fn(async (entry: unknown, isAuthorized: () => Promise<boolean>) => {
        expect(await isAuthorized()).toBe(true);
        historyDispatched.resolve();
        await storageWrite.promise;
        history.push(entry);
        return true;
      }),
    });
    const workflow = runBatchParse([candidate], { ...deps, setCandidates: store.setCandidates });

    await historyDispatched.promise;
    current = false;
    store.replaceState([nextCandidate]);
    store.markStaleBoundary();
    storageWrite.resolve();
    await workflow;
    const sendFillMessageWithVerify = vi.fn(async () => ({ ok: true, filledCount: 1 }));
    await expect(runFillCandidate(store.getState()[0], {
      isCandidateCurrent: async () => true,
      setCandidates: store.setCandidates,
      sendFillMessageWithVerify,
    })).resolves.toBeNull();

    expect(history).toHaveLength(1);
    expect(store.getState()).toEqual([nextCandidate]);
    expect(store.getState()[0]).toBe(nextCandidate);
    expect(store.getUpdatesAfterStaleBoundary()).toBe(0);
    expect(sendFillMessageWithVerify).not.toHaveBeenCalled();
    expect(deps.logCommittedResult).toHaveBeenCalledTimes(1);
    expect(deps.logDiscardedStaleResult).not.toHaveBeenCalled();
  });

  it("prevents an older vision completion from overwriting a newer attempt", async () => {
    let resolveFirst!: (result: ParseResult) => void;
    let resolveSecond!: (result: ParseResult) => void;
    const candidate = makeCandidate("block-race");
    const store = createSetCandidates([candidate]);
    const parseQuestion = vi.fn()
      .mockImplementationOnce(() => new Promise<ParseResult>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<ParseResult>((resolve) => { resolveSecond = resolve; }));
    const { deps, history } = createDeps({ parseQuestion });

    const first = runRetryVision(candidate, { ...deps, setCandidates: store.setCandidates });
    await vi.waitFor(() => expect(parseQuestion).toHaveBeenCalledTimes(1));
    const second = runRetryVision(candidate, { ...deps, setCandidates: store.setCandidates });
    await vi.waitFor(() => expect(parseQuestion).toHaveBeenCalledTimes(2));
    resolveSecond(makeResult({ blockId: candidate.block.id, answer: "newer", confidence: 0.99 }));
    await second;
    resolveFirst(makeResult({ blockId: candidate.block.id, answer: "older", confidence: 0.99 }));
    await first;

    expect(store.getState()[0].result?.answer).toBe("newer");
    expect(history).toHaveLength(1);
    expect((history[0] as { result: ParseResult }).result.answer).toBe("newer");
  });

  it("applies the same revision fence to risky retries", async () => {
    const candidate = makeCandidate("risky");
    const store = createSetCandidates([candidate]);
    const { deps, history } = createDeps({
      isCandidateCurrent: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      parseQuestion: vi.fn(async () => makeResult({ blockId: candidate.block.id, answer: "stale risky" })),
    });

    await runRetryRisky([candidate], () => true, { ...deps, setCandidates: store.setCandidates });

    expect(history).toHaveLength(0);
    expect(store.getState()[0].result).toBeUndefined();
  });

  it("discards one stale batch item while committing a current item", async () => {
    const stale = makeCandidate("q-stale", { selected: true, status: "idle", result: undefined });
    const current = makeCandidate("q-current", { selected: true, status: "idle", result: undefined });
    const store = createSetCandidates([stale, current]);
    const { deps, history } = createDeps({
      getProvider: () => ({ supportsVision: false }),
      requestBlockImage: vi.fn(),
      isCandidateCurrent: vi.fn(async (candidate: DetectedCandidate) => candidate.block.id !== "q-stale"),
      parseQuestion: vi.fn(async (block: QuestionBlock) => makeResult({ blockId: block.id, answer: `answer:${block.id}` })),
    });

    await runBatchParse([stale, current], { ...deps, setCandidates: store.setCandidates });

    expect(deps.parseQuestion).toHaveBeenCalledTimes(1);
    expect(deps.parseQuestion).toHaveBeenCalledWith(current.block, expect.any(Object));
    expect(history).toHaveLength(1);
    expect((history[0] as { result: ParseResult }).result.blockId).toBe("q-current");
    expect(store.getState().find((item) => item.block.id === "q-current")?.result?.answer).toBe("answer:q-current");
    expect(store.getState().find((item) => item.block.id === "q-stale")?.result).toBeUndefined();
    expect(deps.logCommittedResult).toHaveBeenCalledTimes(1);
  });

  it("routes Fill to the detected origin tab and fails closed when that context is stale", async () => {
    const candidate = makeCandidate("fill");
    const store = createSetCandidates([candidate]);
    const sendFillMessageWithVerify = vi.fn(async () => ({ ok: true, filledCount: 1 }));
    const isCandidateCurrent = vi.fn(async () => true);
    const deps = { isCandidateCurrent, setCandidates: store.setCandidates, sendFillMessageWithVerify };

    await runFillCandidate(candidate, deps);
    expect(sendFillMessageWithVerify).toHaveBeenCalledWith(origin.tabId, candidate.block, candidate.result);

    isCandidateCurrent.mockResolvedValue(false);
    const stale = await runFillCandidate(candidate, deps);
    expect(stale).toMatchObject({ ok: false, filledCount: 0, message: "STALE_QUESTION_REVISION" });
    expect(sendFillMessageWithVerify).toHaveBeenCalledTimes(1);
    expect(store.getState()[0].result).toBeUndefined();
  });

  it("revalidates each batch-fill item against its own origin", async () => {
    const first = makeCandidate("fill-a", { selected: true });
    const second = makeCandidate("fill-b", { selected: true });
    const store = createSetCandidates([first, second]);
    const sendFillMessageWithVerify = vi.fn(async () => ({ ok: true, filledCount: 1 }));
    const isCandidateCurrent = vi.fn(async (candidate: DetectedCandidate) => candidate.block.id === "fill-b");

    const result = await runBatchFill([first, second], { isCandidateCurrent, setCandidates: store.setCandidates, sendFillMessageWithVerify });

    expect(sendFillMessageWithVerify).toHaveBeenCalledTimes(1);
    expect(sendFillMessageWithVerify).toHaveBeenCalledWith(origin.tabId, second.block, second.result);
    expect(result).toEqual({ totalFilled: 1, totalQuestions: 1 });
    expect(store.getState()[0].result).toBeUndefined();
  });

  it("stops the batch at a transaction failure without counting or sending the next candidate", async () => {
    const first = makeCandidate("fill-stop-a", { selected: true });
    const second = makeCandidate("fill-stop-b", { selected: true });
    const store = createSetCandidates([first, second]);
    const sendFillMessageWithVerify = vi.fn(async () => ({ ok: false, filledCount: 0, code: "PARTIAL_MUTATION_UNPROVABLE", stopAutomation: true, message: "PARTIAL_MUTATION_UNPROVABLE" }));
    const result = await runBatchFill([first, second], {
      isCandidateCurrent: vi.fn(async () => true),
      setCandidates: store.setCandidates,
      sendFillMessageWithVerify,
    });

    expect(sendFillMessageWithVerify).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ totalFilled: 0, totalQuestions: 0, stopCode: "PARTIAL_MUTATION_UNPROVABLE", stopMessage: "PARTIAL_MUTATION_UNPROVABLE" });
  });
});
