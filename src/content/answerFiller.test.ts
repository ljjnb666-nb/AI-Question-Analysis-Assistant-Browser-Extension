import { describe, expect, it } from "vitest";
import type { BoundingBox, ParseResult } from "@/shared/types";
import { fillAnswerIntoScope, normalizeChoiceAnswerKeys, splitAnswerParts } from "./answerFiller";

function setRect(el: Element, rect: { left: number; top: number; width: number; height: number }) {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }),
  });
}

describe("answerFiller", () => {
  it("normalizes judge and choice answer keys", () => {
    expect(normalizeChoiceAnswerKeys("B", "single_choice")).toEqual(["B"]);
    expect(normalizeChoiceAnswerKeys("D,A,C", "multi_choice")).toEqual(["A", "C", "D"]);
    expect(normalizeChoiceAnswerKeys("正确", "judge")).toEqual(["对"]);
    expect(normalizeChoiceAnswerKeys("False", "judge")).toEqual(["错"]);
  });

  it("splits numbered fill answers in order", () => {
    expect(splitAnswerParts("(1) 超前校正；(2) 稳态；(3) 动态", 3)).toEqual(["超前校正", "稳态", "动态"]);
  });

  it("splits decimal-index fill answers in order", () => {
    expect(splitAnswerParts("6.1 正弦；6.2 稳", 2)).toEqual(["正弦", "稳"]);
    expect(splitAnswerParts("7.1: n-m；7.2: -90°", 2)).toEqual(["n-m", "-90°"]);
  });

  it("strips plain numeric prefixes from fill answers", () => {
    expect(splitAnswerParts("1: n-m；2: -90°", 2)).toEqual(["n-m", "-90°"]);
    expect(splitAnswerParts("1. 正弦；2. 稳", 2)).toEqual(["正弦", "稳"]);
  });

  it("fills choice inputs by option text mapping", () => {
    document.body.innerHTML = `
      <div id="scope">
        <label id="opt-a"><input id="a" type="radio" name="q1" /> A. 超前校正</label>
        <label id="opt-b"><input id="b" type="radio" name="q1" /> B. 滞后校正</label>
        <label id="opt-c"><input id="c" type="radio" name="q1" /> C. 微分校正</label>
        <label id="opt-d"><input id="d" type="radio" name="q1" /> D. PID校正</label>
      </div>
    `;

    const scope = document.getElementById("scope")!;
    const bbox: BoundingBox = { x: 100, y: 100, width: 500, height: 240 };
    for (const [idx, id] of ["opt-a", "opt-b", "opt-c", "opt-d"].entries()) {
      const row = document.getElementById(id)!;
      setRect(row, { left: 120, top: 120 + idx * 40, width: 260, height: 28 });
      const input = row.querySelector("input")!;
      setRect(input, { left: 126, top: 126 + idx * 40, width: 16, height: 16 });
    }

    const result: ParseResult = {
      blockId: "q1",
      questionType: "single_choice",
      answer: "D",
      confidence: 0.95,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "",
      routeUsed: "vision",
    };

    const filled = fillAnswerIntoScope(scope, bbox, result);
    expect(filled.ok).toBe(true);
    expect((document.getElementById("d") as HTMLInputElement).checked).toBe(true);
  });

  it("fills multiple blank inputs using numbered answers", () => {
    document.body.innerHTML = `
      <div id="scope">
        <input id="blank-1" />
        <input id="blank-2" />
        <input id="blank-3" />
      </div>
    `;

    const scope = document.getElementById("scope")!;
    const bbox: BoundingBox = { x: 80, y: 80, width: 600, height: 260 };
    ["blank-1", "blank-2", "blank-3"].forEach((id, idx) => {
      const input = document.getElementById(id)!;
      setRect(input, { left: 120, top: 120 + idx * 60, width: 300, height: 34 });
    });

    const result: ParseResult = {
      blockId: "q7",
      questionType: "fill_blank",
      answer: "(1) 超前校正；(2) 稳态；(3) 动态",
      confidence: 0.96,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "",
      routeUsed: "vision",
    };

    const filled = fillAnswerIntoScope(scope, bbox, result);
    expect(filled.ok).toBe(true);
    expect((document.getElementById("blank-1") as HTMLInputElement).value).toBe("超前校正");
    expect((document.getElementById("blank-2") as HTMLInputElement).value).toBe("稳态");
    expect((document.getElementById("blank-3") as HTMLInputElement).value).toBe("动态");
  });
  it("does not auto-fill placeholder non-structured fill answers", () => {
    document.body.innerHTML = `
      <div id="scope">
        <input id="blank-1" />
        <input id="blank-2" />
      </div>
    `;

    const scope = document.getElementById("scope")!;
    const bbox: BoundingBox = { x: 80, y: 80, width: 600, height: 260 };
    ["blank-1", "blank-2"].forEach((id, idx) => {
      const input = document.getElementById(id)!;
      setRect(input, { left: 120, top: 120 + idx * 60, width: 300, height: 34 });
    });

    const result: ParseResult = {
      blockId: "q7",
      questionType: "fill_blank",
      answer: "需人工确认",
      confidence: 0.95,
      briefExplanation: "该题需要结合图像逐空判断。",
      detailedExplanation: "因为题干信息不完整，所以建议按小问分点作答。",
      recognizedText: "",
      routeUsed: "vision",
    };

    const filled = fillAnswerIntoScope(scope, bbox, result);
    expect(filled.ok).toBe(false);
    expect((document.getElementById("blank-1") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("blank-2") as HTMLInputElement).value).toBe("");
  });
});
