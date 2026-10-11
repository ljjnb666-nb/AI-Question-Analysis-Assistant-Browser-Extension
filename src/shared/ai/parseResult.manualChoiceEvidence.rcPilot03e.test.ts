import { describe, expect, it } from "vitest";
import type { QuestionBlock } from "../types";
import { buildResult, hasCompleteLabeledManualChoiceOptions } from "./parseResult";

const manualBlock: QuestionBlock = {
  id: "manual-choice-r1",
  bbox: { x: 0, y: 0, width: 420, height: 280 },
  previewText: "下列关于德育过程的说法正确的是？ 道德认识 道德情感 道德意志 道德行为",
  hasImage: true,
  imageDataUrl: "data:image/png;base64,AAAA",
  questionTypeGuess: "single_choice",
  confidence: 0.9,
  source: "manual_capture",
};

function modelChoice(recognizedText: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    questionType: "single_choice",
    answer: "B",
    confidence: 0.98,
    recognizedText,
    briefExplanation: "模型推测 B",
    detailedExplanation: "此处只是模型生成的选择题解析。",
    optionSelections: { A: false, B: true, C: false, D: false },
    ...extra,
  });
}

describe("RC-PILOT-03E R1 manual screenshot choice evidence", () => {
  it("does not assign labels to unlabelled screenshot words", () => {
    const text = "下列说法正确的是？ 道德认识 道德情感 道德意志 道德行为";
    expect(hasCompleteLabeledManualChoiceOptions(text)).toBe(false);
    const result = buildResult(manualBlock, "vision", modelChoice(text));
    expect(result.answer).toBe("需人工确认");
    expect(result.optionSelections).toBeUndefined();
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.warning).toContain("模型推测 B");
    expect(result.recognizedText).not.toMatch(/A\.\s*道德认识/);
  });

  it("rejects missing, reordered and duplicate evidence despite confident optionSelections", () => {
    for (const text of [
      "题干 A. 认识 B. 情感 C. 意志",
      "题干 B. 情感 A. 认识 C. 意志 D. 行为",
      "题干 A. 认识 B. 情感 B. 意志 D. 行为",
      "题干 A. 认识 B. 情感 C. 意志 D.",
    ]) {
      expect(hasCompleteLabeledManualChoiceOptions(text)).toBe(false);
      const result = buildResult(manualBlock, "vision", modelChoice(text));
      expect(result.answer).toBe("需人工确认");
      expect(result.confidence).toBeLessThan(0.5);
    }
  });

  it("preserves complete, explicitly labeled screenshot options and model selection", () => {
    const text = "以下哪项属于道德情感？\nA. 道德认识\nB. 道德情感\nC. 道德意志\nD. 道德行为";
    expect(hasCompleteLabeledManualChoiceOptions(text)).toBe(true);
    const result = buildResult(manualBlock, "vision", modelChoice(text));
    expect(result.answer).toBe("B");
    expect(result.confidence).toBe(0.98);
    expect(result.recognizedText).toContain("A. 道德认识");
    expect(result.recognizedText).toContain("D. 道德行为");
    expect(result.warning ?? "").not.toContain("截图选项未完整识别");
  });

  it("accepts an actual A label immediately following question punctuation", () => {
    const text = "1+1等于多少？A.1 B.2 C.3 D.4";
    expect(hasCompleteLabeledManualChoiceOptions(text)).toBe(true);
    const result = buildResult(manualBlock, "vision", modelChoice(text));
    expect(result.answer).toBe("B");
    expect(result.confidence).toBe(0.98);
  });

  it("does not accept DOM preview fallback as image evidence", () => {
    const result = buildResult(
      { ...manualBlock, previewText: "哪项是道德情感？ A. 认识 B. 情感 C. 意志 D. 行为" },
      "vision",
      modelChoice("????????????????"),
    );
    expect(hasCompleteLabeledManualChoiceOptions(result.recognizedText)).toBe(true);
    expect(result.answer).toBe("需人工确认");
    expect(result.optionSelections).toBeUndefined();
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.warning).toContain("截图选项未完整识别");
  });

  it("does not alter synthetic manual blocks without real screenshot payload", () => {
    const result = buildResult(
      { ...manualBlock, imageDataUrl: undefined },
      "text",
      modelChoice("题干无选项标签"),
    );
    expect(result.answer).toBe("B");
    expect(result.confidence).toBe(0.98);
  });

  it("does not change non-manual DOM choice authority", () => {
    const result = buildResult(
      { ...manualBlock, source: "auto_dom" },
      "text",
      modelChoice("题干未包含选择题标签"),
    );
    expect(result.answer).toBe("B");
    expect(result.confidence).toBe(0.98);
  });

  it("does not turn non-choice manual capture into an option-letter task", () => {
    const result = buildResult(manualBlock, "vision", modelChoice(
      "1+1 等于几？",
      { questionType: "short_answer", answer: "2", optionSelections: undefined },
    ));
    expect(result.questionType).toBe("short_answer");
    expect(result.answer).toBe("2");
    expect(result.warning ?? "").not.toContain("截图选项未完整识别");
  });
});
