import { describe, expect, it } from "vitest";
import type { DetectedCandidate, ParseResult, QuestionBlock } from "@/shared/types";
import {
  isChoiceLikeResult,
  isRiskyCandidate,
  langSafe,
  looksLikePlaceholderResolvedAnswer,
  looksMathHeavy,
  pickBatchReviewModel,
  preferBatchRetryResult,
  preferVisionResult,
  shouldRetryBatchParseAfterError,
  shouldRetryBatchParseForIncompleteResult,
  shouldRetryWithVision,
} from "./batchParseHeuristics";

const makeBlock = (overrides: Partial<QuestionBlock> = {}): QuestionBlock => ({
  id: "block-1",
  bbox: { x: 0, y: 0, width: 100, height: 40 },
  previewText: "Example question",
  hasImage: false,
  questionTypeGuess: "single_choice",
  confidence: 0.8,
  source: "manual_capture",
  ...overrides,
});

const makeResult = (overrides: Partial<ParseResult> = {}): ParseResult => ({
  blockId: "block-1",
  questionType: "single_choice",
  answer: "A",
  confidence: 0.9,
  briefExplanation: "brief",
  detailedExplanation: "detail",
  recognizedText: "recognized",
  routeUsed: "text",
  ...overrides,
});

const makeCandidate = (overrides: Partial<DetectedCandidate> = {}): DetectedCandidate => ({
  block: makeBlock(),
  selected: false,
  status: "idle",
  ...overrides,
});

describe("batchParseHeuristics", () => {
  it("detects choice-like results from result type or block guess", () => {
    expect(isChoiceLikeResult(makeBlock({ questionTypeGuess: "unknown" }), makeResult())).toBe(true);
    expect(
      isChoiceLikeResult(
        makeBlock({ questionTypeGuess: "judge" }),
        makeResult({ questionType: "short_answer" }),
      ),
    ).toBe(true);
  });

  it("flags risky candidates based on status, confidence, and retry hints", () => {
    expect(isRiskyCandidate(makeCandidate({ status: "error" }))).toBe(true);
    expect(isRiskyCandidate(makeCandidate({ status: "success", result: makeResult({ confidence: 0.6 }) }))).toBe(true);
    expect(
      isRiskyCandidate(
        makeCandidate({
          status: "success",
          result: makeResult({ warning: "missing options", confidence: 0.88 }),
        }),
      ),
    ).toBe(true);
    expect(isRiskyCandidate(makeCandidate({ status: "success", result: makeResult({ confidence: 0.9 }) }))).toBe(false);
  });

  it("retries vision parsing for low confidence or incomplete hints", () => {
    expect(shouldRetryWithVision(makeResult({ confidence: 0.49 }))).toBe(true);
    expect(shouldRetryWithVision(makeResult({ briefExplanation: "missing options detected" }))).toBe(true);
    expect(shouldRetryWithVision(makeResult({ confidence: 0.9 }))).toBe(false);
  });

  it("prefers better vision results and retry results", () => {
    expect(preferVisionResult(makeResult({ confidence: 0.7 }), makeResult({ confidence: 0.83 }))).toBe(true);
    expect(
      preferVisionResult(
        makeResult({ warning: "missing options", confidence: 0.9 }),
        makeResult({ confidence: 0.91 }),
      ),
    ).toBe(true);

    const block = makeBlock({ questionTypeGuess: "single_choice" });
    expect(
      preferBatchRetryResult(
        makeResult({ answer: "需人工确认", confidence: 0.9 }),
        makeResult({ answer: "B", confidence: 0.9 }),
        block,
      ),
    ).toBe(true);
    expect(preferBatchRetryResult(makeResult({ confidence: 0.9 }), makeResult({ confidence: 0.91 }), block)).toBe(false);
    expect(preferBatchRetryResult(makeResult({ confidence: 0.9 }), makeResult({ confidence: 0.95 }), block)).toBe(true);
  });

  it("detects incomplete parse results and retryable errors", () => {
    expect(shouldRetryBatchParseAfterError(new Error("Network request failed"))).toBe(true);
    expect(shouldRetryBatchParseAfterError(new Error("Bad request"))).toBe(false);

    expect(shouldRetryBatchParseForIncompleteResult(makeResult({ confidence: 0.85 }), makeBlock())).toBe(true);
    expect(shouldRetryBatchParseForIncompleteResult(makeResult({ answer: "需人工确认" }), makeBlock())).toBe(true);
    expect(
      shouldRetryBatchParseForIncompleteResult(
        makeResult({ answer: "不是选项", confidence: 0.95 }),
        makeBlock({ questionTypeGuess: "single_choice" }),
      ),
    ).toBe(true);
    expect(
      shouldRetryBatchParseForIncompleteResult(
        makeResult({ answer: "正确", questionType: "judge", confidence: 0.95 }),
        makeBlock({ questionTypeGuess: "judge" }),
      ),
    ).toBe(false);
  });

  it("handles placeholders, math-heavy text, provider review model, and language fallback", () => {
    expect(looksLikePlaceholderResolvedAnswer("需人工确认")).toBe(true);
    expect(looksLikePlaceholderResolvedAnswer("")).toBe(true);
    expect(looksLikePlaceholderResolvedAnswer("A")).toBe(false);

    expect(looksMathHeavy("传递函数 G(s)=1/s")).toBe(true);
    expect(looksMathHeavy("plain language only")).toBe(false);

    expect(pickBatchReviewModel("openai", "gpt-4o-mini")).toBe("gpt-5.5");
    expect(langSafe("en", "中文", "English")).toBe("English");
    expect(langSafe("zh", "中文", "English")).toBe("中文");
  });
});
