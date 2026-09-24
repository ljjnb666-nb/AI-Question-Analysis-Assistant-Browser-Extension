import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type HistoryEntry, type ParseResult, type QuestionBlock } from "@/shared/types";
import { logEvent } from "@/shared/utils/analytics";
import { createAutoSolveRuntimeBridge } from "./contentAutoSolveRuntimeBridge";

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

function createBridge(block: QuestionBlock, result: ParseResult, addHistoryEntryIfCurrent: (entry: HistoryEntry, isCurrent: () => boolean) => Promise<boolean>) {
  const autoSolveParsingDeps = {
    loadSettings: async () => ({ ...DEFAULT_SETTINGS, preferredRoute: "text" as const }),
    getProvider: () => ({ supportsVision: false }),
    tryCaptureBlockImageForAutoSolve: async () => null,
    parseWithTieredRetries: async () => result,
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
});
