import { describe, expect, it } from "vitest";
import type { ParseResult, QuestionBlock } from "@/shared/types";
import { buildValidatedAnswerPlan } from "./answerPlanValidator";
import { buildControlMapping } from "./controlMapping";

const block = (type: QuestionBlock["questionTypeGuess"] = "single_choice", previewText = "Q A. one B. two C. three") => ({ id: "q12", bbox: { x: 0, y: 0, width: 800, height: 400 }, previewText, questionTypeGuess: type, hasImage: false, confidence: 1, source: "auto_dom" } satisfies QuestionBlock);
const result = (questionType: ParseResult["questionType"], answer: string): ParseResult => ({ blockId: "q12", questionType, answer, confidence: 1, briefExplanation: "", detailedExplanation: "", recognizedText: "", routeUsed: "text" });

describe("Phase 5 safety gates", () => {
  it("AMB1 mapping is read-only and duplicate semantic controls abstain", () => {
    document.body.innerHTML = '<section><button>B. first</button><button>B. second</button></section>';
    const owner = document.querySelector("section")!; const before = owner.outerHTML;
    expect(buildControlMapping(block(), owner)).toMatchObject({ ok: false, code: "CONTROL_MAPPING_AMBIGUOUS" });
    expect(owner.outerHTML).toBe(before);
  });
  it("BOOL4 unknown judge answer never defaults to false", () => {
    document.body.innerHTML = '<section><button>A. 正确</button><button>B. 错误</button></section>';
    const mapping = buildControlMapping(block("judge"), document.querySelector("section")!);
    expect(buildValidatedAnswerPlan(block("judge"), result("judge", "无法判断"), mapping)).toMatchObject({ ok: false, code: "INVALID_ANSWER" });
  });
  it("FB4 refuses semantic and writable-control count mismatch without truncation", () => {
    document.body.innerHTML = '<section><input><input></section>';
    const candidate = block("fill_blank", "填空（1）___（2）___（3）___");
    const mapping = buildControlMapping(candidate, document.querySelector("section")!);
    expect(buildValidatedAnswerPlan(candidate, result("fill_blank", "a;b;c"), mapping)).toMatchObject({ ok: false, code: "ANSWER_BLANK_COUNT_MISMATCH" });
  });
});
