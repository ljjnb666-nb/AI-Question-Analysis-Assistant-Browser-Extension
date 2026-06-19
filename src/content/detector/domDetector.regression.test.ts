import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectCandidatesInViewport } from "./domDetector";

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

describe("domDetector regressions", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://example.com/quiz"),
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps leading tables that belong to the same math single-choice question", () => {
    document.body.innerHTML = `
      <div id="question-box" class="questionBox">
        <div id="title">3. 单选题（2分）</div>
        <table id="dist-table">
          <tr><th>X</th><th>1</th><th>2</th><th>3</th></tr>
          <tr><td>P</td><td>θ²</td><td>2θ(1-θ)</td><td>(1-θ)²</td></tr>
        </table>
        <div id="question-content">取样本值 x1=1,x2=2,x3=1,则参数 θ 的似然估计值 =（ ）.</div>
        <ul id="option-ul">
          <li id="opt-a">A. 4/5</li>
          <li id="opt-b">B. 3/4</li>
          <li id="opt-c">C. 5/6</li>
          <li id="opt-d">D. 2/3</li>
        </ul>
      </div>
    `;

    const questionBox = document.getElementById("question-box")!;
    const title = document.getElementById("title")!;
    const distTable = document.getElementById("dist-table")!;
    const questionContent = document.getElementById("question-content")!;
    const optionUl = document.getElementById("option-ul")!;
    const optA = document.getElementById("opt-a")!;
    const optB = document.getElementById("opt-b")!;
    const optC = document.getElementById("opt-c")!;
    const optD = document.getElementById("opt-d")!;

    setRect(questionBox, { left: 40, top: 40, width: 760, height: 340 });
    setRect(title, { left: 60, top: 54, width: 220, height: 24 });
    setRect(distTable, { left: 60, top: 88, width: 380, height: 70 });
    setRect(questionContent, { left: 60, top: 176, width: 640, height: 38 });
    setRect(optionUl, { left: 60, top: 230, width: 300, height: 120 });
    setRect(optA, { left: 80, top: 236, width: 100, height: 20 });
    setRect(optB, { left: 80, top: 266, width: 100, height: 20 });
    setRect(optC, { left: 80, top: 296, width: 100, height: 20 });
    setRect(optD, { left: 80, top: 326, width: 100, height: 20 });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);
    const best = blocks[0];
    expect(best.previewText).toContain("θ");
    expect(best.previewText).toContain("2θ(1-θ)");
    expect(best.previewText).toContain("x1=1");
  });

  it("does not merge two adjacent complete single-choice questions", () => {
    document.body.innerHTML = `
      <div id="q7" class="questionBox">
        <div id="q7-title">7. 单选题（2分）</div>
        <div id="q7-content">清漆的干燥时间样本：6.0 5.7 5.8 6.5 7.0 6.3 5.6 6.1 5.0，则μ的置信区间=（ ）.</div>
        <ul id="q7-ul">
          <li id="q7-a">A. (5.671,6.468)</li>
          <li id="q7-b">B. (5.608,6.392)</li>
          <li id="q7-c">C. (5.762,6.418)</li>
          <li id="q7-d">D. (5.403,6.735)</li>
        </ul>
      </div>
      <div id="q8" class="questionBox">
        <div id="q8-title">8. 单选题（2分）</div>
        <div id="q8-content">清漆的干燥时间样本：6.0 5.7 5.8 6.5 7.0 6.3 5.6 6.1 5.0，其中σ未知，则μ的置信区间=（ ）.</div>
        <ul id="q8-ul">
          <li id="q8-a">A. (5.671,6.468)</li>
          <li id="q8-b">B. (5.608,6.392)</li>
          <li id="q8-c">C. (5.762,6.418)</li>
          <li id="q8-d">D. (5.403,6.735)</li>
        </ul>
      </div>
    `;

    const ids = [
      ["q7", 40, 40, 820, 260],
      ["q7-title", 60, 56, 180, 24],
      ["q7-content", 60, 100, 700, 40],
      ["q7-ul", 60, 170, 260, 110],
      ["q7-a", 80, 176, 180, 20],
      ["q7-b", 80, 202, 180, 20],
      ["q7-c", 80, 228, 180, 20],
      ["q7-d", 80, 254, 180, 20],
      ["q8", 40, 320, 820, 260],
      ["q8-title", 60, 336, 180, 24],
      ["q8-content", 60, 380, 700, 40],
      ["q8-ul", 60, 450, 260, 110],
      ["q8-a", 80, 456, 180, 20],
      ["q8-b", 80, 482, 180, 20],
      ["q8-c", 80, 508, 180, 20],
      ["q8-d", 80, 534, 180, 20],
    ] as const;

    ids.forEach(([id, left, top, width, height]) => {
      setRect(document.getElementById(id)!, { left, top, width, height });
    });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks.some((b) => b.previewText.includes("7. 单选题"))).toBe(true);
    expect(blocks.some((b) => b.previewText.includes("8. 单选题"))).toBe(true);
    expect(blocks.every((b) => !(b.previewText.includes("7. 单选题") && b.previewText.includes("8. 单选题")))).toBe(true);
  });
  it.skip("skips bottom cards that are only marginally visible in the viewport", () => {
    document.body.innerHTML = `
      <div id="q1" class="question-item">
        <div id="q1-title" class="questionTit">1. single</div>
        <div id="q1-content" class="questionContent">1. first question body A. 1 B. 2 C. 3 D. 4</div>
        <ul>
          <li id="q1-a">A. 1</li>
          <li id="q1-b">B. 2</li>
          <li id="q1-c">C. 3</li>
          <li id="q1-d">D. 4</li>
        </ul>
      </div>
      <div id="q2" class="question-item">
        <div id="q2-title" class="questionTit">2. single</div>
        <div id="q2-content" class="questionContent">2. second question body A. 1 B. 2 C. 3 D. 4</div>
        <ul>
          <li id="q2-a">A. 1</li>
          <li id="q2-b">B. 2</li>
          <li id="q2-c">C. 3</li>
          <li id="q2-d">D. 4</li>
        </ul>
      </div>
      <div id="q3" class="question-item">
        <div id="q3-title" class="questionTit">3. single</div>
        <div id="q3-content" class="questionContent">3. third question body A. 1 B. 2 C. 3 D. 4</div>
        <ul>
          <li id="q3-a">A. 1</li>
          <li id="q3-b">B. 2</li>
          <li id="q3-c">C. 3</li>
          <li id="q3-d">D. 4</li>
        </ul>
      </div>
    `;

    const ids = [
      ["q1", 60, 80, 900, 320],
      ["q1-title", 80, 96, 180, 24],
      ["q1-content", 80, 144, 640, 32],
      ["q1-a", 100, 220, 120, 20],
      ["q1-b", 100, 248, 120, 20],
      ["q1-c", 100, 276, 120, 20],
      ["q1-d", 100, 304, 120, 20],
      ["q2", 60, 420, 900, 320],
      ["q2-title", 80, 436, 180, 24],
      ["q2-content", 80, 484, 640, 32],
      ["q2-a", 100, 560, 120, 20],
      ["q2-b", 100, 588, 120, 20],
      ["q2-c", 100, 616, 120, 20],
      ["q2-d", 100, 644, 120, 20],
      ["q3", 60, 760, 900, 320],
      ["q3-title", 80, 776, 180, 24],
      ["q3-content", 80, 824, 640, 32],
      ["q3-a", 100, 900, 120, 20],
      ["q3-b", 100, 928, 120, 20],
      ["q3-c", 100, 956, 120, 20],
      ["q3-d", 100, 984, 120, 20],
    ] as const;

    ids.forEach(([id, left, top, width, height]) => {
      setRect(document.getElementById(id)!, { left, top, width, height });
    });

    const blocks = detectCandidatesInViewport();
    expect(blocks.some((b) => b.previewText.includes("1. first question body"))).toBe(true);
    expect(blocks.some((b) => b.previewText.includes("2. second question body"))).toBe(true);
    expect(blocks.some((b) => b.previewText.includes("3. third question body"))).toBe(false);
  });

  it.skip("deduplicates repeated structured stem fragments while preserving options", () => {
    document.body.innerHTML = `
      <div id="question-box" class="questionBox">
        <div id="question-title" class="questionTit">5. single</div>
        <div id="question-content" class="questionContent">
          model is
          <span id="formula-text">G(s)=10+2/s+5s</span>
          choose one
          <div id="duplicate-block" class="markdown-latex-container">model is G(s)=10+2/s+5s choose one</div>
        </div>
        <ul id="options">
          <li id="opt-a">A. lead</li>
          <li id="opt-b">B. lag</li>
          <li id="opt-c">C. diff</li>
          <li id="opt-d">D. PID</li>
        </ul>
      </div>
    `;

    const ids = [
      ["question-box", 80, 80, 900, 260],
      ["question-title", 100, 96, 220, 24],
      ["question-content", 100, 140, 720, 64],
      ["formula-text", 360, 144, 120, 22],
      ["duplicate-block", 100, 176, 720, 22],
      ["options", 100, 224, 320, 96],
      ["opt-a", 120, 232, 180, 20],
      ["opt-b", 120, 256, 180, 20],
      ["opt-c", 120, 280, 180, 20],
      ["opt-d", 120, 304, 180, 20],
    ] as const;

    ids.forEach(([id, left, top, width, height]) => {
      setRect(document.getElementById(id)!, { left, top, width, height });
    });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);
    const best = blocks[0];
    expect(best.previewText).toContain("A. lead");
    expect(best.previewText).toContain("D. PID");
    expect((best.previewText.match(/G\(s\)=10\+2\/s\+5s/g) || []).length).toBe(1);
  });
});
