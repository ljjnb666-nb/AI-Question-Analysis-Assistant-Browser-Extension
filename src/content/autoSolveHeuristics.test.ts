import { describe, expect, it } from "vitest";
import type { ParseResult, QuestionBlock, HistoryEntry } from "@/shared/types";
import {
  countExpectedBlankParts,
  extractAutoSolveQuestionOrder,
  extractChoiceKeysFromResultAnswer as _extractChoiceKeysFromResultAnswer,
  findReusableHistoryEntry as _findReusableHistoryEntry,
  getAutoSolveFingerprint as _getAutoSolveFingerprint,
  inferAutoSolveQuestionType as _inferAutoSolveQuestionType,
  isLikelyIncompleteStem as _isLikelyIncompleteStem,
  isSameAutoSolveQuestion as _isSameAutoSolveQuestion,
  isStableChoiceParseResult,
  looksLowQualityNonChoiceAnswer as _looksLowQualityNonChoiceAnswer,
  looksMathHeavyForAuto as _looksMathHeavyForAuto,
  looksNonChoiceStem as _looksNonChoiceStem,
  normalizeJudgeAnswer,
  shouldForceSecondVisionReview as _shouldForceSecondVisionReview,
  shouldPersistAutoSolveParseResult,
  shouldPreferSecondVisionResult as _shouldPreferSecondVisionResult,
  shouldPreferVisionResult as _shouldPreferVisionResult,
  shouldRetryUnstableChoiceParse,
  shouldRetryWithVisionForAuto as _shouldRetryWithVisionForAuto,
  shouldStopAutoSolveAtTail as _shouldStopAutoSolveAtTail,
  shouldUseVisionForAutoSolve,
} from "./autoSolveHeuristics";

function makeJudgeResult(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    blockId: "judge-1",
    questionType: "judge",
    answer: "对",
    confidence: 0.95,
    briefExplanation: "",
    detailedExplanation: "",
    recognizedText: "1. 判断题 示例题干 对 错",
    routeUsed: "text",
    ...overrides,
  };
}

function makeBlock(overrides: Partial<QuestionBlock> = {}): QuestionBlock {
  return {
    id: "q1",
    bbox: { x: 0, y: 0, width: 100, height: 50 },
    previewText: "17. [判断题] 系统的截止频率越高，响应速度越快。 对 错",
    hasImage: false,
    questionTypeGuess: "judge",
    confidence: 1,
    source: "auto_dom",
    ...overrides,
  };
}

describe("autoSolveHeuristics", () => {
  it("normalizes judge answers", () => {
    expect(normalizeJudgeAnswer("对")).toBe("对");
    expect(normalizeJudgeAnswer("正确")).toBe("对");
    expect(normalizeJudgeAnswer("true")).toBe("对");
    expect(normalizeJudgeAnswer("错")).toBe("错");
    expect(normalizeJudgeAnswer("错误")).toBe("错");
    expect(normalizeJudgeAnswer("false")).toBe("错");
  });

  it("treats valid judge parse results as stable", () => {
    const result = makeJudgeResult({ answer: "对" });
    expect(isStableChoiceParseResult(result)).toBe(true);
    expect(shouldPersistAutoSolveParseResult(result)).toBe(true);
    expect(shouldRetryUnstableChoiceParse(result)).toBe(false);
  });

  it("does not retry high-confidence invalid judge parse results", () => {
    const result = makeJudgeResult({ answer: "A" });
    expect(isStableChoiceParseResult(result)).toBe(false);
    expect(shouldPersistAutoSolveParseResult(result)).toBe(false);
    expect(shouldRetryUnstableChoiceParse(result)).toBe(false);
  });

  it("does not retry high-confidence choice mismatches without low-quality signals", () => {
    const result: ParseResult = {
      blockId: "choice-1",
      questionType: "single_choice",
      answer: "A",
      confidence: 0.92,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "1. sample A. x B. y C. z D. w",
      routeUsed: "text",
      optionSelections: { B: true, A: false, C: false, D: false },
    };

    expect(isStableChoiceParseResult(result)).toBe(false);
    expect(shouldPersistAutoSolveParseResult(result)).toBe(false);
    expect(shouldRetryUnstableChoiceParse(result)).toBe(false);
  });

  it("retries low-confidence choice results with missing selections", () => {
    const result: ParseResult = {
      blockId: "choice-2",
      questionType: "single_choice",
      answer: "A",
      confidence: 0.42,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "1. sample A. x B. y C. z D. w",
      routeUsed: "text",
      optionSelections: {},
    };

    expect(isStableChoiceParseResult(result)).toBe(false);
    expect(shouldPersistAutoSolveParseResult(result)).toBe(false);
    expect(shouldRetryUnstableChoiceParse(result)).toBe(true);
  });

  it("does not force vision for complete text-only judge questions", () => {
    expect(shouldUseVisionForAutoSolve(makeBlock(), "auto")).toBe(false);
  });

  it("forces vision for figure-dependent questions during auto solve", () => {
    const block = makeBlock({
      questionTypeGuess: "single_choice",
      hasImage: true,
      previewText:
        "根据下图波形判断系统稳定性，下列说法正确的是（ ）。A. 稳定 B. 临界稳定 C. 不稳定 D. 无法判断",
    });
    expect(shouldUseVisionForAutoSolve(block, "auto")).toBe(true);
  });

  it("retries choice results with explicit retry warning signals", () => {
    const result: ParseResult = {
      blockId: "choice-3",
      questionType: "single_choice",
      answer: "需人工确认",
      confidence: 0.75,
      briefExplanation: "选项结构化结论需人工确认",
      detailedExplanation: "",
      recognizedText: "1. sample A. x B. y",
      routeUsed: "text",
      optionSelections: {},
    };

    expect(shouldRetryUnstableChoiceParse(result)).toBe(true);
  });

  it("retries choice results with incomplete stem signals", () => {
    const result: ParseResult = {
      blockId: "choice-4",
      questionType: "single_choice",
      answer: "?",
      confidence: 0.65,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "题干不完整",
      routeUsed: "text",
      warning: "missing options",
      optionSelections: {},
    };

    expect(shouldRetryUnstableChoiceParse(result)).toBe(true);
  });

  it("treats stable multi-choice results as ready to persist", () => {
    const result: ParseResult = {
      blockId: "multi-1",
      questionType: "multi_choice",
      answer: "A,C,D",
      confidence: 0.92,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "1. sample A. x B. y C. z D. w",
      routeUsed: "vision",
      optionSelections: { A: true, C: true, D: true },
    };

    expect(isStableChoiceParseResult(result)).toBe(true);
    expect(shouldPersistAutoSolveParseResult(result)).toBe(true);
  });

  it("rejects single-choice results with multiple selections", () => {
    const result: ParseResult = {
      blockId: "single-bad",
      questionType: "single_choice",
      answer: "A,B",
      confidence: 0.88,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "1. sample A. x B. y",
      routeUsed: "text",
      optionSelections: { A: true, B: true },
    };

    expect(isStableChoiceParseResult(result)).toBe(false);
    expect(shouldPersistAutoSolveParseResult(result)).toBe(false);
  });

  it("treats non-choice question types as always stable", () => {
    const fillResult: ParseResult = {
      blockId: "fill-1",
      questionType: "fill_blank",
      answer: "(1) 超前校正；(2) 稳态",
      confidence: 0.85,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "填空题",
      routeUsed: "text",
    };

    expect(isStableChoiceParseResult(fillResult)).toBe(true);
    expect(shouldPersistAutoSolveParseResult(fillResult)).toBe(true);
    expect(shouldRetryUnstableChoiceParse(fillResult)).toBe(false);

    const shortResult: ParseResult = {
      blockId: "short-1",
      questionType: "short_answer",
      answer: "系统的稳定性取决于特征方程的根",
      confidence: 0.90,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "简答题",
      routeUsed: "vision",
    };

    expect(isStableChoiceParseResult(shortResult)).toBe(true);
    expect(shouldPersistAutoSolveParseResult(shortResult)).toBe(true);
  });
});
