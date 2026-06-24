import { describe, expect, it } from "vitest";
import type { BoundingBox, ParseResult } from "@/shared/types";
import { fillAnswerIntoScope, fillParsedAnswerInPage, normalizeChoiceAnswerKeys, splitAnswerParts, verifyAnswerInScope } from "./answerFiller";

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

  it("fills choice inputs by option text mapping", async () => {
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

    const filled = await fillAnswerIntoScope(scope, bbox, result);
    expect(filled.ok).toBe(true);
    expect((document.getElementById("d") as HTMLInputElement).checked).toBe(true);
  });

  it("fills multiple blank inputs using numbered answers", async () => {
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

    const filled = await fillAnswerIntoScope(scope, bbox, result);
    expect(filled.ok).toBe(true);
    expect((document.getElementById("blank-1") as HTMLInputElement).value).toBe("超前校正");
    expect((document.getElementById("blank-2") as HTMLInputElement).value).toBe("稳态");
    expect((document.getElementById("blank-3") as HTMLInputElement).value).toBe("动态");
  });

  it("fills custom option-item single choice by verified selected class", async () => {
    document.body.innerHTML = `
      <div id="question" class="question-item">
        <div id="opt-a" class="option-item is-choose"><div class="option-order">A.</div><div class="option-content">T1</div></div>
        <div id="opt-b" class="option-item"><div class="option-order">B.</div><div class="option-content">T2</div></div>
        <div id="opt-c" class="option-item"><div class="option-order">C.</div><div class="option-content">T3</div></div>
        <div id="opt-d" class="option-item"><div class="option-order">D.</div><div class="option-content">无法比较</div></div>
      </div>
    `;

    const question = document.getElementById("question")!;
    const bbox: BoundingBox = { x: 100, y: 100, width: 600, height: 280 };
    ["opt-a", "opt-b", "opt-c", "opt-d"].forEach((id, idx) => {
      const row = document.getElementById(id)!;
      setRect(row, { left: 120, top: 120 + idx * 44, width: 320, height: 32 });
      row.addEventListener("click", () => {
        document.querySelectorAll(".option-item").forEach((el) => el.classList.remove("is-choose"));
        row.classList.add("is-choose");
      });
    });

    const result: ParseResult = {
      blockId: "q6",
      questionType: "single_choice",
      answer: "C",
      confidence: 0.96,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "",
      routeUsed: "vision",
    };

    const filled = await fillAnswerIntoScope(question, bbox, result);
    expect(filled.ok).toBe(true);
    expect(document.getElementById("opt-a")?.className.includes("is-choose")).toBe(false);
    expect(document.getElementById("opt-c")?.className.includes("is-choose")).toBe(true);
  });

  it("relocates question by text when stored bbox no longer matches live single-choice scope", async () => {
    document.body.innerHTML = `
      <div id="question" class="question-item">
        <div class="base-question-title">4、单选题</div>
        <div id="opt-a" class="option-item is-choose"><div class="option-order">A.</div><div class="option-content">现实的社会主义事业每向前一步，也就是向着共产主义走进一步</div></div>
        <div id="opt-b" class="option-item"><div class="option-order">B.</div><div class="option-content">实现共产主义是广大人民群众的共同愿望</div></div>
        <div id="opt-c" class="option-item"><div class="option-order">C.</div><div class="option-content">无产阶级的解放与全人类的解放是完全一致的</div></div>
        <div id="opt-d" class="option-item"><div class="option-order">D.</div><div class="option-content">社会发展的规律是独立于人的社会活动的</div></div>
      </div>
      <div id="elsewhere" style="height: 1200px;"></div>
    `;

    const question = document.getElementById("question")!;
    const bbox: BoundingBox = { x: 0, y: 1200, width: 400, height: 200 };
    setRect(question, { left: 120, top: 120, width: 900, height: 280 });
    ["opt-a", "opt-b", "opt-c", "opt-d"].forEach((id, idx) => {
      const row = document.getElementById(id)!;
      setRect(row, { left: 140, top: 150 + idx * 40, width: 640, height: 28 });
      row.addEventListener("click", () => {
        document.querySelectorAll(".option-item").forEach((el) => el.classList.remove("is-choose"));
        row.classList.add("is-choose");
      });
    });

    const result: ParseResult = {
      blockId: "q4",
      questionType: "single_choice",
      answer: "D",
      optionSelections: { D: true },
      confidence: 0.95,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "4、单选题 阅读课本“实现共产主义是历史发展的必然”回答问题。下面关于共产主义社会说法错误的是（ ） A. 现实的社会主义事业每向前一步，也就是向着共产主义走进一步 B. 实现共产主义是广大人民群众的共同愿望 C. 无产阶级的解放与全人类的解放是完全一致的 D. 社会发展的规律是独立于人的社会活动的",
      routeUsed: "vision",
    };

    const filled = await fillParsedAnswerInPage({
      id: "q4",
      bbox,
      previewText: result.recognizedText,
      questionTypeGuess: "single_choice",
      hasImage: false,
      confidence: 0.95,
      source: "auto_dom",
    }, result);

    expect(filled.ok).toBe(true);
    expect(document.getElementById("opt-a")?.className.includes("is-choose")).toBe(false);
    expect(document.getElementById("opt-d")?.className.includes("is-choose")).toBe(true);
  });

  it("fills custom option-item multi choice from structured optionSelections", async () => {
    document.body.innerHTML = `
      <div id="question" class="question-item">
        <div id="opt-a" class="option-item"><i class="iconfont aloha-icon-duoxuan"></i><img class="icon-lou" /><div class="option-order">A.</div><div class="option-content"><p>社会关系高度和谐</p></div></div>
        <div id="opt-b" class="option-item"><i class="iconfont aloha-icon-duoxuan"></i><img class="icon-lou" /><div class="option-order">B.</div><div class="option-content"><p>人类文明与自然之间的高度和谐</p></div></div>
        <div id="opt-c" class="option-item"><i class="iconfont aloha-icon-duoxuan"></i><img class="icon-lou" /><div class="option-order">C.</div><div class="option-content"><p>人的自由而全面的发展</p></div></div>
        <div id="opt-d" class="option-item"><i class="iconfont aloha-icon-duoxuan"></i><img class="icon-lou" /><div class="option-order">D.</div><div class="option-content"><p>三大差别将会消亡</p></div></div>
      </div>
    `;

    const question = document.getElementById("question")!;
    const bbox: BoundingBox = { x: 100, y: 100, width: 900, height: 320 };
    ["opt-a", "opt-b", "opt-c", "opt-d"].forEach((id, idx) => {
      const row = document.getElementById(id)!;
      setRect(row, { left: 120, top: 120 + idx * 44, width: 520, height: 32 });
      setRect(row.querySelector(".option-order")!, { left: 140, top: 120 + idx * 44, width: 24, height: 24 });
      setRect(row.querySelector(".option-content")!, { left: 180, top: 120 + idx * 44, width: 320, height: 24 });
      setRect(row.querySelector("p")!, { left: 180, top: 120 + idx * 44, width: 320, height: 24 });
      setRect(row.querySelector("img")!, { left: 165, top: 120 + idx * 44, width: 12, height: 12 });
      row.addEventListener("click", () => {
        row.classList.toggle("is-choose");
        const icon = row.querySelector("i");
        if (icon) {
          icon.className = row.classList.contains("is-choose")
            ? "iconfont aloha-icon-duoxuan-xuanzhong"
            : "iconfont aloha-icon-duoxuan";
        }
      });
    });

    const result: ParseResult = {
      blockId: "q11",
      questionType: "multi_choice",
      answer: "B,C",
      optionSelections: { A: true, B: true, C: true, D: true },
      confidence: 0.98,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "",
      routeUsed: "vision",
    };

    const filled = await fillAnswerIntoScope(question, bbox, result);
    expect(filled.ok).toBe(true);
    ["opt-a", "opt-b", "opt-c", "opt-d"].forEach((id) => {
      expect(document.getElementById(id)?.className.includes("is-choose")).toBe(true);
    });
  });

  it("fills custom option-item multi choice inside scroll container using absolute bbox", async () => {
    document.body.innerHTML = `
      <div id="root" class="answer-homework-container" style="overflow-y:auto; position:relative;">
        <div id="question" class="question-item">
          <div id="opt-a" class="option-item"><div class="option-order">A.</div><div class="option-content"><p>具体劳动与抽象劳动</p></div></div>
          <div id="opt-b" class="option-item"><div class="option-order">B.</div><div class="option-content"><p>工业与农业</p></div></div>
          <div id="opt-c" class="option-item"><div class="option-order">C.</div><div class="option-content"><p>城市与农村</p></div></div>
          <div id="opt-d" class="option-item"><div class="option-order">D.</div><div class="option-content"><p>体力劳动与脑力劳动</p></div></div>
        </div>
      </div>
    `;

    const root = document.getElementById("root") as HTMLDivElement;
    const question = document.getElementById("question")!;
    Object.defineProperty(root, "clientHeight", { configurable: true, value: 700 });
    Object.defineProperty(root, "scrollHeight", { configurable: true, value: 5000 });
    Object.defineProperty(root, "scrollTop", { configurable: true, writable: true, value: 3400 });
    Object.defineProperty(root, "scrollLeft", { configurable: true, writable: true, value: 0 });
    root.scrollTo = ((arg1?: number | ScrollToOptions) => {
      if (typeof arg1 === "number") return;
      if (typeof arg1?.top === "number") root.scrollTop = arg1.top;
    }) as typeof root.scrollTo;
    document.elementsFromPoint = (() => [document.body]) as typeof document.elementsFromPoint;
    root.scrollTo({ top: root.scrollTop });
    setRect(root, { left: 0, top: 64, width: 1280, height: 700 });
    setRect(question, { left: 40, top: 240, width: 900, height: 280 });

    ["opt-a", "opt-b", "opt-c", "opt-d"].forEach((id, idx) => {
      const row = document.getElementById(id)!;
      setRect(row, { left: 80, top: 280 + idx * 44, width: 520, height: 32 });
      setRect(row.querySelector(".option-order")!, { left: 90, top: 280 + idx * 44, width: 24, height: 24 });
      setRect(row.querySelector(".option-content")!, { left: 130, top: 280 + idx * 44, width: 320, height: 24 });
      setRect(row.querySelector("p")!, { left: 130, top: 280 + idx * 44, width: 320, height: 24 });
      row.addEventListener("click", () => {
        row.classList.toggle("is-choose");
      });
    });

    const result: ParseResult = {
      blockId: "q12",
      questionType: "multi_choice",
      answer: "B,C,D",
      optionSelections: { B: true, C: true, D: true },
      confidence: 0.98,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "",
      routeUsed: "vision",
    };

    const filled = await fillParsedAnswerInPage({
      id: "q12",
      bbox: { x: 40, y: 3612, width: 900, height: 280 },
      previewText: "12、多选题",
      questionTypeGuess: "multi_choice",
      hasImage: false,
      confidence: 0.98,
      source: "auto_dom",
    }, result);
    expect(filled.ok).toBe(true);
    expect(document.getElementById("opt-a")?.className.includes("is-choose")).toBe(false);
    expect(document.getElementById("opt-b")?.className.includes("is-choose")).toBe(true);
    expect(document.getElementById("opt-c")?.className.includes("is-choose")).toBe(true);
    expect(document.getElementById("opt-d")?.className.includes("is-choose")).toBe(true);
  });

  it("clears stale custom multi-choice selections via real click fallback", async () => {
    document.body.innerHTML = `
      <div id="question" class="question-item">
        <div id="opt-a" class="option-item is-choose"><div class="option-order">A.</div><div class="option-content">A</div></div>
        <div id="opt-b" class="option-item is-choose"><div class="option-order">B.</div><div class="option-content">B</div></div>
        <div id="opt-c" class="option-item is-choose"><div class="option-order">C.</div><div class="option-content">C</div></div>
        <div id="opt-d" class="option-item is-choose"><div class="option-order">D.</div><div class="option-content">D</div></div>
      </div>
    `;

    const question = document.getElementById("question")!;
    const bbox: BoundingBox = { x: 100, y: 100, width: 900, height: 320 };
    ["opt-a", "opt-b", "opt-c", "opt-d"].forEach((id, idx) => {
      const row = document.getElementById(id)!;
      setRect(row, { left: 120, top: 120 + idx * 44, width: 520, height: 32 });
      setRect(row.querySelector(".option-order")!, { left: 140, top: 120 + idx * 44, width: 24, height: 24 });
      setRect(row.querySelector(".option-content")!, { left: 180, top: 120 + idx * 44, width: 320, height: 24 });
    });

    const originalChrome = (globalThis as { chrome?: unknown }).chrome;
    (globalThis as { chrome?: { runtime: { sendMessage: (message: { x: number; y: number; type: string }) => Promise<{ ok: boolean }> } } }).chrome = {
      runtime: {
        sendMessage: async ({ x, y }) => {
          if (y >= 164 && y < 208 && x >= 120 && x < 640) {
            document.getElementById("opt-b")?.classList.remove("is-choose");
          }
          return { ok: true };
        },
      },
    };

    try {
      const result: ParseResult = {
        blockId: "q15",
        questionType: "multi_choice",
        answer: "A,C,D",
        optionSelections: { A: true, C: true, D: true, B: false },
        confidence: 0.92,
        briefExplanation: "",
        detailedExplanation: "",
        recognizedText: "",
        routeUsed: "vision",
      };

      const filled = await fillAnswerIntoScope(question, bbox, result);
      expect(filled.ok).toBe(true);
      expect(document.getElementById("opt-a")?.className.includes("is-choose")).toBe(true);
      expect(document.getElementById("opt-b")?.className.includes("is-choose")).toBe(false);
      expect(document.getElementById("opt-c")?.className.includes("is-choose")).toBe(true);
      expect(document.getElementById("opt-d")?.className.includes("is-choose")).toBe(true);
    } finally {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  it("verifies custom option-item exact selected key", () => {
    document.body.innerHTML = `
      <div id="question" class="question-item">
        <div id="opt-a" class="option-item"><div class="option-order">A.</div><div class="option-content">T1</div></div>
        <div id="opt-b" class="option-item is-choose"><div class="option-order">B.</div><div class="option-content">T2</div></div>
        <div id="opt-c" class="option-item"><div class="option-order">C.</div><div class="option-content">T3</div></div>
        <div id="opt-d" class="option-item"><div class="option-order">D.</div><div class="option-content">无法比较</div></div>
      </div>
    `;

    const question = document.getElementById("question")!;
    const bbox: BoundingBox = { x: 100, y: 100, width: 600, height: 280 };
    ["opt-a", "opt-b", "opt-c", "opt-d"].forEach((id, idx) => {
      const row = document.getElementById(id)!;
      setRect(row, { left: 120, top: 120 + idx * 44, width: 320, height: 32 });
    });

    const result: ParseResult = {
      blockId: "q6",
      questionType: "single_choice",
      answer: "C",
      confidence: 0.96,
      briefExplanation: "",
      detailedExplanation: "",
      recognizedText: "",
      routeUsed: "vision",
    };

    const verify = verifyAnswerInScope(question, bbox, result);
    expect(verify.ok).toBe(false);
    expect(verify.expectedKeys).toEqual(["C"]);
    expect(verify.actualKeys).toEqual(["B"]);
  });

  it("does not auto-fill placeholder non-structured fill answers", async () => {
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

    const filled = await fillAnswerIntoScope(scope, bbox, result);
    expect(filled.ok).toBe(false);
    expect((document.getElementById("blank-1") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("blank-2") as HTMLInputElement).value).toBe("");
  });
});
