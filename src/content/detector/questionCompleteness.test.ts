import { describe, expect, it } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import { evaluateQuestionCompleteness } from "./questionCompleteness";
const block = (overrides: Partial<QuestionBlock> = {}): QuestionBlock => ({ id: "q", bbox: { x: 0, y: 0, width: 100, height: 100 }, previewText: "Which value? A. 1 B. 2 C. 3 D. 4", hasImage: false, questionTypeGuess: "single_choice", confidence: 1, source: "auto_dom", ...overrides });
describe("evaluateQuestionCompleteness", () => {
  it("C1/C5/C6 accepts complete choices, judge, and fill blank", () => {
    expect(evaluateQuestionCompleteness(block()).state).toBe("complete");
    expect(evaluateQuestionCompleteness(block({ questionTypeGuess: "judge", previewText: "True or False: the statement is valid." })).state).toBe("complete");
    expect(evaluateQuestionCompleteness(block({ questionTypeGuess: "fill_blank", previewText: "Calculate x = ___" })).state).toBe("complete");
  });
  it("C2/C3/C4/C8 protects partial, options-only, and missing visual questions", () => {
    expect(evaluateQuestionCompleteness(block({ previewText: "C. three D. four" })).state).toBe("incomplete");
    expect(evaluateQuestionCompleteness(block({ previewText: "Which value? A. 1 B. 2", boundary: { state: "partial-bottom", clippedTop: false, clippedBottom: true, confidence: .5, reasons: [] } })).state).toBe("incomplete");
    expect(evaluateQuestionCompleteness(block({ previewText: "See the diagram and choose A. 1 B. 2 C. 3 D. 4" })).state).toBe("incomplete");
  });
});
