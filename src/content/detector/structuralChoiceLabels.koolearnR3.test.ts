import { afterEach, describe, expect, it } from "vitest";
import { recoverStructuralChoiceLabels } from "./structuralChoiceLabels";
import { getElementReadableText, buildPreviewTextForBbox } from "./domDetectorPreview";
import { detectCandidatesInViewport, createDomCandidateDiagnostics } from "./domDetector";
import { countOptionMarkersInText, inferQuestionType } from "./domText";
import { isLikelyCompleteQuestionText } from "./domDetectorPostprocess";

function card(stem = "凡是符合自己的认识或自己所维护的道德观念时，就会产生积极的情绪体验。这属于哪种品德心理结构？") {
  return `<div data-card>
    <div class="q-statement">${stem}</div>
    <div class="q-options">
      <div><span>A</span><span>道德认识</span></div>
      <div><span>B</span><span>道德情感</span></div>
      <div><span>C</span><span>道德意志</span></div>
      <div><span>D</span><span>道德行为</span></div>
      <p>题型：单选题</p><a href="#view">查看答案及解析</a>
    </div>
  </div>`;
}

describe("Koolearn isolated DOM card structural choice recovery", () => {
  afterEach(() => { document.body.innerHTML = ""; });
  it("recovers A/B/C/D when innerText has no line breaks or dotted markers", () => {
    document.body.innerHTML = card();
    const el = document.querySelector("[data-card]")!;
    const out = recoverStructuralChoiceLabels(el)!;
    expect(out).toContain("A. 道德认识");
    expect(out).toContain("B. 道德情感");
    expect(out).toContain("C. 道德意志");
    expect(out).toContain("D. 道德行为");
    expect(out).not.toContain("题型：");
    expect(countOptionMarkersInText(out)).toBe(4);
    expect(inferQuestionType(out)).toBe("single_choice");
    expect(isLikelyCompleteQuestionText(out, "single_choice")).toBe(true);
    expect(getElementReadableText(el)).toContain("D. 道德行为");
  });

  it("admits a visible complete real-style card through the full viewport detector", () => {
    document.body.innerHTML = card();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 960 });
    const host = document.querySelector("[data-card]")!;
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, right: left + width, bottom: top + height,
        x: left, y: top, width, height });
    Object.defineProperty(host, "getBoundingClientRect", { configurable: true,
      value: () => rect(523, 372, 690, 216) });
    host.querySelectorAll("*").forEach((el, index) => Object.defineProperty(el, "getBoundingClientRect", {
      configurable: true, value: () => rect(535, 385 + index * 8, 660, 20),
    }));
    const bbox = { x: 523, y: 372, width: 690, height: 216 };
    const recovered = buildPreviewTextForBbox(host, bbox, host.textContent ?? "");
    expect(recovered).toContain("A. 道德认识");
    expect(recovered).toContain("D. 道德行为");
    const diagnostics = createDomCandidateDiagnostics();
    const candidates = detectCandidatesInViewport(diagnostics);
    expect(candidates.some(c => c.previewText.includes("D. 道德行为"))).toBe(true);
    expect(diagnostics.acceptedCandidates).toBeGreaterThan(0);
  });

  it("R4 assigns one candidate per nested structural card, never its enclosing list", () => {
    document.body.innerHTML = `<main><section data-list>
      <div data-wrapper>${card()}</div>
      <div data-wrapper>${card("下列哪一种课堂教学活动能够更充分体现学生主动学习与合作探究？")}</div>
    </section></main>`;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 960 });
    const boxes = Array.from(document.querySelectorAll("[data-card]"));
    const rect = (top: number) => ({
      x: 523, y: top, left: 523, top, right: 1213,
      bottom: top + 216, width: 690, height: 216,
    });
    boxes.forEach((box, index) => {
      const top = 140 + index * 320;
      Object.defineProperty(box, "getBoundingClientRect", { configurable: true, value: () => rect(top) });
      box.querySelectorAll("*").forEach((node, i) => {
        const childTop = top + 8 + (i % 16) * 8;
        Object.defineProperty(node, "getBoundingClientRect", { configurable: true,
          value: () => ({
            ...rect(childTop), x: 535, left: 535, width: 660, height: 16,
            right: 1195, bottom: childTop + 16,
          }),
        });
      });
    });
    const diagnostics = createDomCandidateDiagnostics();
    const found = detectCandidatesInViewport(diagnostics);
    expect(found.filter(x => x.previewText.includes("品德心理结构"))).toHaveLength(1);
    expect(found.filter(x => x.previewText.includes("课堂教学活动"))).toHaveLength(1);
    expect(found).toHaveLength(2);
    expect(new Set(found.map(x => x.runtimeOwnerKey)).size).toBe(2);
  });

  it("never merges four choices across two independent question cards", () => {
    document.body.innerHTML = `<section id="list">${card()}${card("下列哪一种课堂教学活动能够更充分体现学生主动学习与合作探究？")}</section>`;
    const list = document.getElementById("list")!;
    expect(recoverStructuralChoiceLabels(list)).toBeNull();
    expect(Array.from(list.querySelectorAll("[data-card]"))
      .map(c => recoverStructuralChoiceLabels(c)?.match(/A\./g)?.length))
      .toEqual([1, 1]);
  });

  it("refuses a linked menu even when its text looks like a question", () => {
    document.body.innerHTML = `<nav id="menu"><div>
      <p>下列哪项信息可以帮助考生准备考试？</p>
      <a href="#a"><span>A</span><span>题库入口</span></a>
      <a href="#b"><span>B</span><span>报名入口</span></a>
      <a href="#c"><span>C</span><span>课程入口</span></a>
      <a href="#d"><span>D</span><span>咨询入口</span></a>
    </div></nav>`;
    expect(recoverStructuralChoiceLabels(document.querySelector("#menu div")!)).toBeNull();
  });

  it("does not invent a missing choice, empty option or stand-alone labels", () => {
    document.body.innerHTML = card();
    const el = document.querySelector("[data-card]")!;
    const labels = el.querySelectorAll(".q-options span");
    labels[6]!.textContent = "";
    expect(recoverStructuralChoiceLabels(el)).toBeNull();
    labels[6]!.textContent = "D";
    labels[7]!.textContent = "";
    expect(recoverStructuralChoiceLabels(el)).toBeNull();
    document.body.innerHTML = `<div><span>A</span><span>甲</span><span>B</span><span>乙</span><span>C</span><span>丙</span><span>D</span><span>丁</span></div>`;
    expect(recoverStructuralChoiceLabels(document.body.firstElementChild!)).toBeNull();
  });
});
