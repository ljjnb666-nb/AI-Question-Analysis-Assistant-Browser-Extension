import { describe, expect, it } from "vitest";
import type { QuestionFragment } from "./questionFragment";
import { resolveQuestionOwnership } from "./questionOwnership";

const fragment = (overrides: Partial<QuestionFragment> = {}): QuestionFragment => ({
  runtimeId: "f", text: "question", bbox: { x: 0, y: 0, width: 100, height: 80 }, questionType: "single_choice",
  optionKeys: [], hasQuestionStartSignal: false, hasStrongStemSignal: false, hasOptionSignal: false,
  hasCompleteOptionSetSignal: false, viewportState: "fully-visible", ...overrides,
});

describe("resolveQuestionOwnership", () => {
  it("B1/B2/B11 refuses a clipped option tail or complete options before a new stem", () => {
    expect(resolveQuestionOwnership(fragment({ viewportState: "clipped-top", hasOptionSignal: true }), fragment({ hasStrongStemSignal: true })).relation).toBe("different-question");
    expect(resolveQuestionOwnership(fragment({ hasCompleteOptionSetSignal: true }), fragment({ hasStrongStemSignal: true })).relation).toBe("different-question");
  });
  it("B3/B4/B6/B9 permits only complementary semantic fragments", () => {
    expect(resolveQuestionOwnership(fragment({ ordinalHint: 1, hasQuestionStartSignal: true }), fragment({ ordinalHint: 1, hasOptionSignal: true, optionKeys: ["C", "D"] })).relation).toBe("same-question");
    expect(resolveQuestionOwnership(fragment({ nativeQuestionId: "q1", hasQuestionStartSignal: true }), fragment({ nativeQuestionId: "q1", hasOptionSignal: true })).relation).toBe("same-question");
    const owner = document.createElement("section");
    expect(resolveQuestionOwnership(fragment({ ownerElement: owner, hasQuestionStartSignal: true }), fragment({ ownerElement: owner, hasOptionSignal: true, optionKeys: ["C", "D"] })).relation).toBe("same-question");
  });
  it("B5/B7/B8 rejects authoritative conflicts", () => {
    expect(resolveQuestionOwnership(fragment({ nativeQuestionId: "a" }), fragment({ nativeQuestionId: "b" })).relation).toBe("different-question");
    expect(resolveQuestionOwnership(fragment({ ordinalHint: 1 }), fragment({ ordinalHint: 2 })).relation).toBe("different-question");
    expect(resolveQuestionOwnership(fragment({ ownerElement: document.createElement("div") }), fragment({ ownerElement: document.createElement("div") })).relation).toBe("different-question");
  });
  it("B10/B12 makes geometry-only evidence unknown and native identity win over distance", () => {
    expect(resolveQuestionOwnership(fragment(), fragment()).relation).toBe("unknown");
    expect(resolveQuestionOwnership(fragment({ nativeQuestionId: "q", hasQuestionStartSignal: true }), fragment({ nativeQuestionId: "q", hasOptionSignal: true, bbox: { x: 0, y: 9000, width: 1, height: 1 } })).relation).toBe("same-question");
  });
});
