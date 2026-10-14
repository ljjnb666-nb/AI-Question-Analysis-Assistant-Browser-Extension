import { describe, expect, it } from "vitest";
import { buildResult } from "./parseResult";
import type { QuestionBlock } from "../types";

function makeBlock(overrides: Partial<QuestionBlock> = {}): QuestionBlock {
  return {
    id: "test-1",
    bbox: { x: 0, y: 0, width: 100, height: 100 },
    previewText: "请撰写一份产品开发设计方案，字数不少于500字。",
    questionTypeGuess: "short_answer",
    confidence: 0.9,
    source: "auto_dom",
    ...overrides,
  } as QuestionBlock;
}

describe("buildResult essay fallback (2026-10-14 device test)", () => {
  it("uses plain-text prose as the answer when JSON parsing fails for short_answer", () => {
    const prose = "一、产品名称及简介：本产品为美白保湿霜，具有温和不刺激的优点，与市场上同类产品比较……（此处省略400字）";
    const result = buildResult(makeBlock(), "text", prose);
    expect(result.answer).toContain("一、产品名称及简介");
    expect(result.answer).not.toBe("—");
  });

  it("does not apply the prose fallback to choice questions", () => {
    const prose = "这道题考察的是产品开发的基本流程，需要从多个方面进行分析。";
    const result = buildResult(makeBlock({ questionTypeGuess: "single_choice" }), "text", prose);
    // Choice questions keep the strict behavior: no A-D found -> placeholder.
    expect(result.answer).toBe("—");
  });

  it("does not use trivially short prose as the answer", () => {
    const result = buildResult(makeBlock(), "text", "好的");
    expect(result.answer).toBe("—");
  });
});

describe("buildResult essay fallback with partial JSON (2026-10-14)", () => {
  it("uses raw prose when JSON has fields but no usable answer", async () => {
    const { buildResult } = await import("./parseResult");
    const block = {
      id: "test-2",
      bbox: { x: 0, y: 0, width: 100, height: 100 },
      previewText: "请简述产品开发流程。",
      questionTypeGuess: "short_answer",
      confidence: 0.9,
      source: "auto_dom",
    } as never;
    // JSON with recognizedText but no answer field.
    const raw = `{"recognizedText": "请简述产品开发流程。", "briefExplanation": "(解析提取失败)"}\n\n一、产品名称及简介：本产品为美白保湿霜……（正文）`;
    const result = buildResult(block, "text", raw);
    expect(result.answer).toContain("一、产品名称及简介");
    expect(result.answer).not.toBe("—");
  });
});

describe("stripConversationalWrappers (2026-10-14)", () => {
  it("removes preamble and postscript but keeps the essay core", async () => {
    const { stripConversationalWrappers } = await import("./parseResultNormalization");
    const input = [
      "好的，我来为你撰写这份产品开发设计方案：",
      "",
      "一、产品名称及简介：本产品为美白保湿霜，具有温和不刺激的优点。",
      "",
      "二、原料配方：包括中药和基质原料及其他辅助原料。",
      "",
      "希望以上内容对你有帮助，祝你取得好成绩！",
    ].join("\n");
    const out = stripConversationalWrappers(input);
    expect(out).not.toContain("我来为你");
    expect(out).not.toContain("希望以上内容");
    expect(out).toContain("一、产品名称及简介");
    expect(out).toContain("二、原料配方");
  });

  it("leaves single-paragraph answers untouched", async () => {
    const { stripConversationalWrappers } = await import("./parseResultNormalization");
    const input = "本产品为美白保湿霜，具有温和不刺激的优点。";
    expect(stripConversationalWrappers(input)).toBe(input);
  });

  it("does not strip substantive paragraphs that look like wrappers", async () => {
    const { stripConversationalWrappers } = await import("./parseResultNormalization");
    const longPreambleLike = "好的，" + "本产品经过严格的安全性评价，包括急性经口毒性试验、多次皮肤刺激性试验等。".repeat(5);
    const input = [longPreambleLike, "", "一、结论：安全可靠。"].join("\n");
    const out = stripConversationalWrappers(input);
    // Long paragraph is substantive -> kept even though it starts with 好的.
    expect(out).toContain("安全性评价");
  });
});
