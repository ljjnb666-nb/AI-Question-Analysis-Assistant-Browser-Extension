import { describe, expect, it } from "vitest";
import { isStructuredAnswerExtractionFailed } from "./displayAnswerUtils";
import type { ParseResult } from "@/shared/types";

function makeResult(partial: Partial<ParseResult>): ParseResult {
  return {
    answer: "",
    briefExplanation: "",
    detailedExplanation: "",
    confidence: 0.8,
    ...partial,
  } as ParseResult;
}

describe("isStructuredAnswerExtractionFailed (2026-10-14 device test)", () => {
  it("does not fail when the answer is real but briefExplanation is missing (long essay plain-text response)", () => {
    const result = makeResult({
      answer: "一、产品名称及简介……（500字正文）",
      briefExplanation: "(解析提取失败)",
    });
    expect(isStructuredAnswerExtractionFailed(result)).toBe(false);
  });

  it("still fails when the answer itself is a placeholder", () => {
    const result = makeResult({
      answer: "解析提取失败",
      briefExplanation: "(解析提取失败)",
    });
    expect(isStructuredAnswerExtractionFailed(result)).toBe(true);
  });

  it("still fails when the answer is empty", () => {
    const result = makeResult({ answer: "", briefExplanation: "(解析提取失败)" });
    expect(isStructuredAnswerExtractionFailed(result)).toBe(true);
  });
});
