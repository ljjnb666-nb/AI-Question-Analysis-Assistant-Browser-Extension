import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings, type HistoryEntry, type ParseResult, type QuestionBlock } from "@/shared/types";
import {
  parseBlockForAutoSolve,
  parseBlockForAutoSolveQuickReview,
  parseBlockForAutoSolveReview,
  recordAutoSolveHistory,
} from "./autoSolveParsing";
import { attachRuntimeRoot } from "./roots/rootContext";

// Assembled at runtime so security scanners do not mistake this synthetic
// test fixture for a committed credential.
const TEST_API_KEY = ["test", "key"].join("-");

function makeBlock(overrides: Partial<QuestionBlock> = {}): QuestionBlock {
  return {
    id: "q-1",
    bbox: { x: 0, y: 0, width: 320, height: 120 },
    previewText: "1. 下列说法正确的是 A. 甲 B. 乙 C. 丙 D. 丁",
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
    confidence: 0.95,
    briefExplanation: "",
    detailedExplanation: "",
    recognizedText: "1. 下列说法正确的是 A. 甲 B. 乙 C. 丙 D. 丁",
    routeUsed: "text",
    optionSelections: { A: true, B: false, C: false, D: false },
    ...overrides,
  };
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    providerId: "anthropic",
    apiKey: TEST_API_KEY,
    apiModel: "claude-opus-4.8",
    preferredRoute: "auto",
    language: "zh",
    enableAnalytics: false,
    customProviderProtocol: "openai",
    ...overrides,
  };
}

function createDeps() {
  const withTimeout = <T>(promise: Promise<T>) => promise;
  return {
    loadSettings: vi.fn(async () => makeSettings()),
    getProvider: vi.fn(() => ({ supportsVision: true })),
    tryCaptureBlockImageForAutoSolve: vi.fn(async () => "data:image/png;base64,abc"),
    parseWithTieredRetries: vi.fn(async () => makeResult()),
    withTimeout,
    parseQuestion: vi.fn(async () => makeResult()),
    addHistoryEntryIfCurrent: vi.fn(async (_entry, isCurrent) => isCurrent()),
  };
}

const defaultTimeouts = {
  parseTimeoutMs: 45_000,
  reviewTimeoutMs: 60_000,
  quickReviewTimeoutMs: 15_000,
  reviewConfidenceThreshold: 0.9,
};

describe("autoSolveParsing", () => {
  it("does not capture an image for text-sufficient auto-solve questions", async () => {
    const deps = createDeps();

    const result = await parseBlockForAutoSolve(makeBlock(), defaultTimeouts, deps);

    expect(result.answer).toBe("A");
    expect(deps.tryCaptureBlockImageForAutoSolve).not.toHaveBeenCalled();
    const [usedBlock, usedSettings] = ((deps.parseWithTieredRetries.mock.calls[0] ?? []) as unknown) as [QuestionBlock, AppSettings];
    expect(usedBlock).not.toHaveProperty("imageDataUrl");
    expect(usedSettings).toMatchObject({ preferredRoute: "auto" });
  });

  it("captures an image when auto-solve heuristics clearly require vision", async () => {
    const deps = createDeps();
    const block = makeBlock({
      hasImage: true,
      previewText: "根据下图波形判断系统稳定性，下列说法正确的是 A. 稳定 B. 临界稳定 C. 不稳定 D. 无法判断",
    });

    await parseBlockForAutoSolve(block, defaultTimeouts, deps);

    expect(deps.tryCaptureBlockImageForAutoSolve).toHaveBeenCalledTimes(1);
    const [usedBlock, usedSettings] = ((deps.parseWithTieredRetries.mock.calls[0] ?? []) as unknown) as [QuestionBlock, AppSettings];
    expect(usedBlock).toMatchObject({ imageDataUrl: "data:image/png;base64,abc", hasImage: true });
    expect(usedSettings).toMatchObject({ preferredRoute: "vision" });
  });

  it("keeps quick review text-only when the block does not need vision", async () => {
    const deps = createDeps();

    await parseBlockForAutoSolveQuickReview(makeBlock(), defaultTimeouts, deps);

    expect(deps.tryCaptureBlockImageForAutoSolve).not.toHaveBeenCalled();
    const [usedBlock, usedSettings] = ((deps.parseQuestion.mock.calls[0] ?? []) as unknown) as [QuestionBlock, AppSettings];
    expect(usedBlock).not.toHaveProperty("imageDataUrl");
    expect(usedSettings).toMatchObject({ preferredRoute: "auto" });
  });

  it("keeps review text-only when the block does not need vision", async () => {
    const deps = createDeps();

    await parseBlockForAutoSolveReview(makeBlock(), null, defaultTimeouts, deps);

    expect(deps.tryCaptureBlockImageForAutoSolve).not.toHaveBeenCalled();
    const [usedBlock, usedSettings] = ((deps.parseWithTieredRetries.mock.calls[0] ?? []) as unknown) as [QuestionBlock, AppSettings];
    expect(usedBlock).not.toHaveProperty("imageDataUrl");
    expect(usedSettings).toMatchObject({ preferredRoute: "auto" });
  });

  it("drops transient runtime ownership before history enters memory or storage", async () => {
    const owner = document.createElement("div");
    document.body.append(owner);
    const block = makeBlock({
      identity: {
        stableId: "question-q-1",
        contentFingerprint: "fingerprint-q-1",
        identityVersion: 1,
        strategy: "content-only",
        signals: { nativeId: false, content: true, options: true, media: false, structure: true },
      },
      runtimeOwnerKey: "owner-q-1",
    });
    const bound = attachRuntimeRoot(block, {
      rootKey: "root-top",
      rootGeneration: 0,
      kind: "top-document",
    }, owner);
    bound.runtimeQuestionHandle = "rqh_0123456789abcdef0123456789abcdef";
    const history: HistoryEntry[] = [];
    const deps = createDeps();

    await recordAutoSolveHistory(history, bound, makeResult(), deps);

    expect(history[0]?.block.runtimeQuestionHandle).toBeUndefined();
    expect(history[0]?.block.runtimeOwnerKey).toBeUndefined();
    expect(Object.getOwnPropertySymbols(history[0]!.block)).toHaveLength(0);
    expect(deps.addHistoryEntryIfCurrent).toHaveBeenCalledWith(expect.objectContaining({
      block: expect.objectContaining({ runtimeQuestionHandle: undefined, runtimeOwnerKey: undefined }),
    }), expect.any(Function));
    owner.remove();
  });
});
