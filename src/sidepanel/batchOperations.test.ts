import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type DetectedCandidate, type ParseResult, type QuestionBlock } from "@/shared/types";
import { runRetryVision } from "./batchOperations";

const makeBlock = (overrides: Partial<QuestionBlock> = {}): QuestionBlock => ({
  id: "block-1",
  bbox: { x: 0, y: 0, width: 120, height: 60 },
  previewText: "6-44 输出月份英文名 函数接口定义： char *getmonth( int n );",
  hasImage: false,
  questionTypeGuess: "short_answer",
  confidence: 0.9,
  source: "manual_capture",
  ...overrides,
});

const makeResult = (overrides: Partial<ParseResult> = {}): ParseResult => ({
  blockId: "block-1",
  questionType: "short_answer",
  answer: "char *getmonth(int n) {\n  return months[n - 1];\n}",
  confidence: 0.9,
  briefExplanation: "brief",
  detailedExplanation: "detail",
  recognizedText: "recognized",
  routeUsed: "vision",
  ...overrides,
});

const makeCandidate = (overrides: Partial<DetectedCandidate> = {}): DetectedCandidate => ({
  block: makeBlock(),
  selected: false,
  status: "success",
  result: makeResult(),
  ...overrides,
});

function createSetCandidates(initial: DetectedCandidate[]) {
  let state = initial;
  const setCandidates = (updater: (prev: DetectedCandidate[]) => DetectedCandidate[]) => {
    state = updater(state);
  };
  return {
    setCandidates,
    getState: () => state,
  };
}

describe("batchOperations runRetryVision", () => {
  it("does not overwrite an existing better result with a worse vision retry", async () => {
    const current = makeResult({
      answer: "char *getmonth(int n) {\n  static char *months[] = {\"January\"};\n  if (n < 1 || n > 12) return NULL;\n  return months[n - 1];\n}",
      confidence: 0.85,
    });
    const worseVision = makeResult({
      answer: "char *getmonth(int n) {\n  char *months[13] = {\"\\",
      confidence: 0.55,
      briefExplanation: "根据图片中可见的信息",
    });
    const candidate = makeCandidate({ result: current });
    const store = createSetCandidates([candidate]);
    const addHistoryEntry = vi.fn().mockResolvedValue(undefined);
    const parseQuestion = vi.fn().mockResolvedValue(worseVision);

    await runRetryVision(candidate, { id: 1 } as chrome.tabs.Tab, {
      loadSettings: async () => DEFAULT_SETTINGS,
      getProvider: () => ({ supportsVision: true }),
      requestBlockImage: async () => "data:image/png;base64,abc",
      parseQuestion,
      addHistoryEntry,
      setCandidates: store.setCandidates,
      langSafe: (_lang, zh) => zh,
      pickBatchReviewModel: () => DEFAULT_SETTINGS.apiModel,
      shouldRetryBatchParseForIncompleteResult: () => false,
      preferBatchRetryResult: (first, retry) => (retry.confidence ?? 0) > (first.confidence ?? 0),
    });

    expect(store.getState()[0].result).toEqual(current);
    expect(addHistoryEntry).toHaveBeenCalledWith(expect.objectContaining({ result: current }));
  });

  it("uses the reviewed vision result when the first retry result is still incomplete", async () => {
    const candidate = makeCandidate();
    const firstVision = makeResult({
      answer: "需人工确认",
      confidence: 0.62,
      warning: "代码题未提取到可直接填写的代码答案，请查看详情或视觉重试。",
    });
    const reviewedVision = makeResult({
      answer: "char *getmonth(int n) {\n  static char *months[] = {\"January\", \"February\"};\n  if (n < 1 || n > 12) return NULL;\n  return months[n - 1];\n}",
      confidence: 0.88,
      warning: undefined,
    });
    const store = createSetCandidates([candidate]);
    const parseQuestion = vi.fn()
      .mockResolvedValueOnce(firstVision)
      .mockResolvedValueOnce(reviewedVision);

    await runRetryVision(candidate, { id: 1 } as chrome.tabs.Tab, {
      loadSettings: async () => DEFAULT_SETTINGS,
      getProvider: () => ({ supportsVision: true }),
      requestBlockImage: async () => "data:image/png;base64,abc",
      parseQuestion,
      addHistoryEntry: vi.fn().mockResolvedValue(undefined),
      setCandidates: store.setCandidates,
      langSafe: (_lang, zh) => zh,
      pickBatchReviewModel: () => "claude-opus-4.8",
      shouldRetryBatchParseForIncompleteResult: (result) => result.answer === "需人工确认",
      preferBatchRetryResult: (first, retry) => retry.answer !== "需人工确认" || (retry.confidence ?? 0) > (first.confidence ?? 0),
    });

    expect(parseQuestion).toHaveBeenCalledTimes(2);
    expect(store.getState()[0].result).toEqual(reviewedVision);
  });

  it("keeps the existing good result when vision retry fails", async () => {
    const current = makeResult({
      answer: "char *getmonth(int n) {\n  static char *months[] = {\"January\"};\n  if (n < 1 || n > 12) return NULL;\n  return months[n - 1];\n}",
      confidence: 0.97,
    });
    const candidate = makeCandidate({ result: current });
    const store = createSetCandidates([candidate]);

    await runRetryVision(candidate, { id: 1 } as chrome.tabs.Tab, {
      loadSettings: async () => DEFAULT_SETTINGS,
      getProvider: () => ({ supportsVision: true }),
      requestBlockImage: async () => { throw new Error("截图失败"); },
      parseQuestion: vi.fn(),
      addHistoryEntry: vi.fn().mockResolvedValue(undefined),
      setCandidates: store.setCandidates,
      langSafe: (_lang, zh) => zh,
      pickBatchReviewModel: () => DEFAULT_SETTINGS.apiModel,
      shouldRetryBatchParseForIncompleteResult: () => false,
      preferBatchRetryResult: (first, retry) => (retry.confidence ?? 0) > (first.confidence ?? 0),
    });

    expect(store.getState()[0].status).toBe("success");
    expect(store.getState()[0].result).toEqual(current);
  });
});
