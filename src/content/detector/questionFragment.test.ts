import { describe, expect, it } from "vitest";
import type { QuestionBlock } from "@/shared/types";
import { questionFragmentFromBlock } from "./questionFragment";

const block = (overrides: Partial<QuestionBlock> = {}): QuestionBlock => ({ id: "q", bbox: { x: 0, y: 0, width: 100, height: 80 }, previewText: "C. one D. two", hasImage: false, questionTypeGuess: "single_choice", confidence: .8, source: "auto_dom", ...overrides });
describe("questionFragmentFromBlock", () => {
  it("preserves trusted raw partial-top boundary over a clamped bbox", () => {
    expect(questionFragmentFromBlock(block({ boundary: { state: "partial-top", clippedTop: true, clippedBottom: false, confidence: .6, reasons: [] } })).viewportState).toBe("clipped-top");
  });
});
