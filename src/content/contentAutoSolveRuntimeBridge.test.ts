import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type HistoryEntry, type ParseResult, type QuestionBlock } from "@/shared/types";
import { logEvent } from "@/shared/utils/analytics";
import { createAutoSolveRuntimeBridge } from "./contentAutoSolveRuntimeBridge";
import { activeQuestionRevisionAttempt } from "./revision/questionRevisionRuntime";
import type { ParseQuestionRuntimeContext } from "@/shared/utils/parseRouter";

vi.mock("@/shared/utils/analytics", () => ({ logEvent: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function makeBlock(): QuestionBlock {
  return {
    id: "q-history-commit",
    identity: {
      stableId: "stable-q-history-commit",
      contentFingerprint: "fingerprint-q-history-commit",
      identityVersion: 1,
      strategy: "content-only",
      signals: { nativeId: false, content: true, options: true, media: false, structure: true },
    },
    bbox: { x: 0, y: 0, width: 320, height: 120 },
    previewText: "A short text question with sufficient context",
    hasImage: false,
    questionTypeGuess: "short_answer",
    confidence: 0.95,
    source: "auto_dom",
  };
}

function makeResult(): ParseResult {
  return {
    blockId: "q-history-commit",
    questionType: "short_answer",
    answer: "answer",
    confidence: 0.95,
    briefExplanation: "",
    detailedExplanation: "",
    recognizedText: "A short text question with sufficient context",
    routeUsed: "text",
  };
}

function createBridge(
  block: QuestionBlock,
  result: ParseResult,
  addHistoryEntryIfCurrent: (entry: HistoryEntry, isCurrent: () => boolean) => Promise<boolean>,
  options: {
    isRuntimeCurrent?: () => boolean;
    parseWithTieredRetries?: (runtimeContext?: ParseQuestionRuntimeContext) => Promise<ParseResult>;
  } = {},
) {
  const autoSolveParsingDeps = {
    loadSettings: async () => ({ ...DEFAULT_SETTINGS, preferredRoute: "text" as const }),
    getRuntimeCaptureInfo: async () => ({ supportsVision: false }),
    tryCaptureBlockImageForAutoSolve: async () => null,
    parseWithTieredRetries: (
      _block: QuestionBlock,
      _settings: Pick<typeof DEFAULT_SETTINGS, "preferredRoute" | "language">,
      _supportsVision: boolean,
      _onStream: (partial: string) => void,
      runtimeContext?: ParseQuestionRuntimeContext,
    ) =>
      options.parseWithTieredRetries?.(runtimeContext) ?? Promise.resolve(result),
    withTimeout: <T>(promise: Promise<T>) => promise,
    parseQuestion: async () => result,
    addHistoryEntryIfCurrent,
  };

  return createAutoSolveRuntimeBridge({
    autoSolveParsingDeps,
    autoSolveParsingTimeouts: { parseTimeoutMs: 1000, reviewTimeoutMs: 1000, quickReviewTimeoutMs: 1000, reviewConfidenceThreshold: 0.9 },
    clickNextQuestionButtonCore: () => false,
    detectZhihuishuCurrentQuestionBlockCore: () => block,
    extractAutoSolveQuestionOrder: () => null,
    extractQuestionImageUrlFromBBox: () => null,
    extractRichQuestionPreviewFromElement: () => block.previewText,
    findNextQuestionButtonCore: () => null,
    getAutoSolveFingerprint: () => block.id,
    hasVisibleAutoSolveMedia: () => false,
    inferAutoSolveQuestionType: () => block.questionTypeGuess,
    isElementVisible: () => true,
    isExtensionUiElement: () => false,
    parseQuestionNavDeps: {
      normalizeQuestionText: (text) => text,
      isExtensionUiElement: () => false,
      isElementVisible: () => true,
    },
    resolveQuestionBlockFromBBox: (bbox) => ({ refinedBBox: bbox, finalBBox: bbox, previewText: block.previewText, matchedCandidate: null }),
    sendAutoSolveDoneCore: () => {},
    sendAutoSolveProgressCore: () => {},
    stopRequestedRef: () => false,
    waitForQuestionAdvanceCore: async () => false,
    isRuntimeCurrent: options.isRuntimeCurrent,
  });
}

describe("auto-solve history commit telemetry", () => {
  afterEach(() => {
    vi.mocked(logEvent).mockClear();
  });

  it("keeps parse_success for a committed history write that becomes stale while storage is pending", async () => {
    const block = makeBlock();
    const result = makeResult();
    const storageWrite = deferred<boolean>();
    const writeDispatched = deferred<void>();
    const history: HistoryEntry[] = [];
    const addHistoryEntryIfCurrent = vi.fn(async (_entry: HistoryEntry, isCurrent: () => boolean) => {
      if (!isCurrent()) return false;
      writeDispatched.resolve();
      return storageWrite.promise;
    });
    const bridge = createBridge(block, result, addHistoryEntryIfCurrent);

    const parsed = await bridge.parseBlockForAutoSolve(block);
    const commit = bridge.recordAutoSolveHistory(history, block, parsed);
    await writeDispatched.promise;
    bridge.abortCurrentSolveAttempt();
    storageWrite.resolve(true);

    await expect(commit).resolves.toBe(true);
    expect(history).toHaveLength(1);
    expect(bridge.isCurrentAutoSolveResult(block, parsed)).toBe(false);
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith("parse_success", expect.objectContaining({ source: "auto_solve_commit" }));
    expect(logEvent).not.toHaveBeenCalledWith("provider_result_discarded_stale", expect.anything());
  });

  it("E3B2B2B1-LATE-AI-01 rejects a resolved old provider completion while a replacement run commits", async () => {
    const block = makeBlock();
    const oldReply = deferred<ParseResult>();
    const newReply = deferred<ParseResult>();
    const oldAnswer = { ...makeResult(), answer: "stale-old-answer" };
    const newAnswer = { ...makeResult(), answer: "authorized-new-answer" };
    const history: HistoryEntry[] = [];
    const contexts: ParseQuestionRuntimeContext[] = [];
    const addHistoryEntryIfCurrent = vi.fn(async (entry: HistoryEntry, isCurrent: () => boolean) => {
      if (!isCurrent()) return false;
      history.push(entry);
      return true;
    });
    const bridge = createBridge(block, newAnswer, addHistoryEntryIfCurrent, {
      parseWithTieredRetries: (runtimeContext) => {
        if (!runtimeContext) throw new Error("MISSING_REAL_RUNTIME_CONTEXT");
        contexts.push(runtimeContext);
        if (contexts.length === 1) return oldReply.promise;
        if (contexts.length === 2) return newReply.promise;
        throw new Error("UNEXPECTED_PROVIDER_REQUEST");
      },
    });

    // Both starts go through the actual auto-solve parsing bridge. Deliberately
    // ignore the first AbortSignal inside the simulated provider, so its
    // Promise DOES resolve after STOP and after the new attempt starts.
    const oldPending = bridge.parseBlockForAutoSolve(block);
    await vi.waitFor(() => expect(contexts).toHaveLength(1));
    bridge.abortCurrentSolveAttempt();
    expect(contexts[0].signal?.aborted).toBe(true);

    const newPending = bridge.parseBlockForAutoSolve(block);
    await vi.waitFor(() => expect(contexts).toHaveLength(2));
    expect(contexts[1].signal?.aborted).toBe(false);

    // This explicitly exercises application-side receipt of stale completion;
    // unlike HTTP route.fetch, it cannot be vacuously satisfied by cancellation.
    oldReply.resolve(oldAnswer);
    await expect(oldPending).rejects.toThrow("STALE_QUESTION_REVISION");
    expect(bridge.isCurrentAutoSolveResult(block, oldAnswer)).toBe(false);
    await expect(bridge.recordAutoSolveHistory(history, block, oldAnswer)).resolves.toBe(false);
    expect(addHistoryEntryIfCurrent).not.toHaveBeenCalled();
    expect(history).toEqual([]);
    expect(contexts[1].signal?.aborted).toBe(false);

    newReply.resolve(newAnswer);
    const parsedNew = await newPending;
    expect(parsedNew.answer).toBe("authorized-new-answer");
    expect(bridge.isCurrentAutoSolveResult(block, parsedNew)).toBe(true);
    await expect(bridge.recordAutoSolveHistory(history, block, parsedNew)).resolves.toBe(true);
    expect(addHistoryEntryIfCurrent).toHaveBeenCalledTimes(1);
    expect(history).toHaveLength(1);
    expect(logEvent).toHaveBeenCalledWith("parse_success", expect.objectContaining({ source: "auto_solve_commit" }));
  });

  it("P10B-AUTOSOLVE-SHUTDOWN-01 rejects a late provider result after the runtime generation is invalidated", async () => {
    const block = makeBlock();
    const result = makeResult();
    const provider = deferred<ParseResult>();
    const history: HistoryEntry[] = [];
    let runtimeCurrent = true;
    const addHistoryEntryIfCurrent = vi.fn(async (entry: HistoryEntry, isCurrent: () => boolean) => {
      if (!isCurrent()) return false;
      history.push(entry);
      return true;
    });
    const bridge = createBridge(block, result, addHistoryEntryIfCurrent, {
      isRuntimeCurrent: () => runtimeCurrent,
      parseWithTieredRetries: () => provider.promise,
    });

    const pending = bridge.parseBlockForAutoSolve(block);
    expect(activeQuestionRevisionAttempt()).not.toBeNull();
    runtimeCurrent = false;
    bridge.abortCurrentSolveAttempt();
    expect(activeQuestionRevisionAttempt()).toBeNull();
    provider.resolve(result);

    await expect(pending).rejects.toThrow("STALE_QUESTION_REVISION");
    expect(bridge.isCurrentAutoSolveResult(block, result)).toBe(false);
    await expect(bridge.recordAutoSolveHistory(history, block, result)).resolves.toBe(false);
    expect(addHistoryEntryIfCurrent).not.toHaveBeenCalled();
    expect(history).toEqual([]);
  });
});
