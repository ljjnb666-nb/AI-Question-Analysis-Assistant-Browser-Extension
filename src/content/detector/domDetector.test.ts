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

describe("domDetector", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://hiexam.zhihuishu.com/atHomeworkExam/stu/homeworkQ/exerciseList/1"),
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps preview text inside the cropped question area on zhihuishu-style split layout", () => {
    document.body.innerHTML = `
      <div id="root" class="questionlistall-div clearfloat">
        <div id="back">返回</div>
        <div id="left-col">
          <div id="question" class="question-item">
            <div id="stem">2. [单选题] 采用PD调节器串联校正后，系统相位裕度增加，平稳性增强，幅值穿越频率c增大，系统的响应速度( )。</div>
            <div id="opt-a">A. 振荡</div>
            <div id="opt-b">B. 不变</div>
            <div id="opt-c">C. 变快</div>
            <div id="opt-d">D. 变慢</div>
          </div>
        </div>
        <div id="score-panel">总分 100 题目数 9</div>
        <div id="answer-card">答题卡 判断题 8 9</div>
      </div>
    `;

    const root = document.getElementById("root")!;
    const back = document.getElementById("back")!;
    const leftCol = document.getElementById("left-col")!;
    const question = document.getElementById("question")!;
    const stem = document.getElementById("stem")!;
    const optA = document.getElementById("opt-a")!;
    const optB = document.getElementById("opt-b")!;
    const optC = document.getElementById("opt-c")!;
    const optD = document.getElementById("opt-d")!;
    const scorePanel = document.getElementById("score-panel")!;
    const answerCard = document.getElementById("answer-card")!;

    setRect(root, { left: 220, top: 80, width: 1200, height: 760 });
    setRect(back, { left: 240, top: 94, width: 40, height: 24 });
    setRect(leftCol, { left: 230, top: 160, width: 840, height: 360 });
    setRect(question, { left: 240, top: 170, width: 800, height: 300 });
    setRect(stem, { left: 260, top: 220, width: 760, height: 70 });
    setRect(optA, { left: 280, top: 320, width: 180, height: 26 });
    setRect(optB, { left: 280, top: 360, width: 180, height: 26 });
    setRect(optC, { left: 280, top: 400, width: 180, height: 26 });
    setRect(optD, { left: 280, top: 440, width: 180, height: 26 });
    setRect(scorePanel, { left: 1130, top: 170, width: 220, height: 120 });
    setRect(answerCard, { left: 1130, top: 330, width: 240, height: 360 });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);

    const best = blocks[0];
    expect(best.questionTypeGuess).toBe("single_choice");
    expect(best.previewText).toContain("采用PD调节器串联校正后");
    expect(best.previewText).toContain("A. 振荡");
    expect(best.previewText).not.toContain("返回");
    expect(best.previewText).not.toContain("答题卡");
    expect(best.previewText).not.toContain("判断题");
  });

  it("detects fill-blank questions as a single structured candidate with answer inputs", () => {
    document.body.innerHTML = `
      <div id="section">
        <div id="heading">二、填空题（21分）</div>
        <div id="question" class="question-item">
          <div id="stem">7. [填空题] 系统校正的目的是通过设计 ____ 装置，改善系统的 ____ 态和 ____ 态性能。</div>
          <label id="label1">7.1</label><input id="input1" placeholder="请输入答案" />
          <label id="label2">7.2</label><input id="input2" placeholder="请输入答案" />
          <label id="label3">7.3</label><input id="input3" placeholder="请输入答案" />
        </div>
      </div>
    `;

    const section = document.getElementById("section")!;
    const heading = document.getElementById("heading")!;
    const question = document.getElementById("question")!;
    const stem = document.getElementById("stem")!;
    const label1 = document.getElementById("label1")!;
    const label2 = document.getElementById("label2")!;
    const label3 = document.getElementById("label3")!;
    const input1 = document.getElementById("input1")!;
    const input2 = document.getElementById("input2")!;
    const input3 = document.getElementById("input3")!;

    setRect(section, { left: 80, top: 40, width: 920, height: 520 });
    setRect(heading, { left: 96, top: 56, width: 220, height: 30 });
    setRect(question, { left: 96, top: 110, width: 820, height: 360 });
    setRect(stem, { left: 120, top: 132, width: 700, height: 50 });
    setRect(label1, { left: 120, top: 210, width: 32, height: 24 });
    setRect(input1, { left: 190, top: 200, width: 560, height: 46 });
    setRect(label2, { left: 120, top: 298, width: 32, height: 24 });
    setRect(input2, { left: 190, top: 288, width: 560, height: 46 });
    setRect(label3, { left: 120, top: 386, width: 32, height: 24 });
    setRect(input3, { left: 190, top: 376, width: 560, height: 46 });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);

    const best = blocks[0];
    expect(best.questionTypeGuess).toBe("fill_blank");
    expect(best.previewText).toContain("7. [填空题]");
    expect(best.bbox.y).toBeGreaterThan(90);
    expect(best.bbox.y + best.bbox.height).toBeGreaterThan(410);
  });

  it("keeps judge detection scoped to the question card instead of the whole page shell", () => {
    document.body.innerHTML = `
      <div id="page-shell" class="questionlistall-div clearfloat">
        <div id="section-title">三、判断题（20分）</div>
        <div id="question" class="question-item">
          <div id="stem">8. [判断题] 前馈补偿可以在不影响稳定性前提下消除误差。</div>
          <label id="yes-label"><input id="yes" type="radio" /> 对</label>
          <label id="no-label"><input id="no" type="radio" /> 错</label>
        </div>
        <div id="footer-nav">上一题 下一题 提交作业</div>
      </div>
    `;

    const shell = document.getElementById("page-shell")!;
    const sectionTitle = document.getElementById("section-title")!;
    const question = document.getElementById("question")!;
    const stem = document.getElementById("stem")!;
    const yesLabel = document.getElementById("yes-label")!;
    const noLabel = document.getElementById("no-label")!;
    const yes = document.getElementById("yes")!;
    const no = document.getElementById("no")!;
    const footerNav = document.getElementById("footer-nav")!;

    setRect(shell, { left: 220, top: 80, width: 920, height: 920 });
    setRect(sectionTitle, { left: 246, top: 170, width: 180, height: 30 });
    setRect(question, { left: 246, top: 220, width: 820, height: 260 });
    setRect(stem, { left: 274, top: 250, width: 720, height: 56 });
    setRect(yesLabel, { left: 286, top: 348, width: 80, height: 28 });
    setRect(noLabel, { left: 286, top: 392, width: 80, height: 28 });
    setRect(yes, { left: 286, top: 354, width: 16, height: 16 });
    setRect(no, { left: 286, top: 398, width: 16, height: 16 });
    setRect(footerNav, { left: 246, top: 980, width: 320, height: 30 });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);

    const best = blocks[0];
    expect(best.questionTypeGuess).toBe("judge");
    expect(best.previewText).toContain("前馈补偿可以在不影响稳定性前提下消除误差");
    expect((best.previewText.match(/前馈补偿可以在不影响稳定性前提下消除误差/g) || []).length).toBe(1);
    expect(best.previewText).not.toContain("上一题");
    expect(best.previewText).not.toContain("提交作业");
    expect(best.bbox.y).toBeGreaterThan(180);
    expect(best.bbox.y + best.bbox.height).toBeLessThan(520);
  });

  it("prefers zhihuishu questionBox over the whole left shell", () => {
    document.body.innerHTML = `
      <div id="root" class="questionlistall-div clearfloat">
        <div id="left-shell" class="exe-questionlistall-l fl">
          <div id="scroll-view" class="el-scrollbar__view">
            <div id="classification" class="Classificationquestionall-div">
              <p id="subjecttit" class="subjecttit">一、单选题（59分）</p>
              <div id="question-box" class="questionBox">
                <div id="inner">
                  <div id="question-tit" class="questionTit">6.【单选题】(9分)</div>
                  <div id="question-content" class="questionContent">PID 控制器中，积分环节的作用是（ ）。</div>
                  <ul id="option-ul" class="optionUl">
                    <li id="opt-a">A. 减小超调</li>
                    <li id="opt-b">B. 消除稳态误差</li>
                    <li id="opt-c">C. 加快响应</li>
                    <li id="opt-d">D. 增加阻尼</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div id="right-panel" class="questionlistall-r1 fl">课堂练习 总分100 题目数9 答题卡 1 2 3 4 5 6</div>
      </div>
    `;

    const root = document.getElementById("root")!;
    const leftShell = document.getElementById("left-shell")!;
    const scrollView = document.getElementById("scroll-view")!;
    const classification = document.getElementById("classification")!;
    const subjecttit = document.getElementById("subjecttit")!;
    const questionBox = document.getElementById("question-box")!;
    const inner = document.getElementById("inner")!;
    const questionTit = document.getElementById("question-tit")!;
    const questionContent = document.getElementById("question-content")!;
    const optionUl = document.getElementById("option-ul")!;
    const optA = document.getElementById("opt-a")!;
    const optB = document.getElementById("opt-b")!;
    const optC = document.getElementById("opt-c")!;
    const optD = document.getElementById("opt-d")!;
    const rightPanel = document.getElementById("right-panel")!;

    setRect(root, { left: 420, top: 87, width: 1200, height: 915 });
    setRect(leftShell, { left: 420, top: 87, width: 880, height: 874 });
    setRect(scrollView, { left: 420, top: 87, width: 880, height: 306 });
    setRect(classification, { left: 420, top: 87, width: 880, height: 306 });
    setRect(subjecttit, { left: 420, top: 87, width: 880, height: 60 });
    setRect(questionBox, { left: 420, top: 167, width: 880, height: 226 });
    setRect(inner, { left: 470, top: 167, width: 830, height: 226 });
    setRect(questionTit, { left: 470, top: 167, width: 830, height: 23 });
    setRect(questionContent, { left: 470, top: 200, width: 830, height: 23 });
    setRect(optionUl, { left: 470, top: 233, width: 830, height: 160 });
    setRect(optA, { left: 470, top: 253, width: 800, height: 20 });
    setRect(optB, { left: 470, top: 293, width: 800, height: 20 });
    setRect(optC, { left: 470, top: 333, width: 800, height: 20 });
    setRect(optD, { left: 470, top: 373, width: 830, height: 20 });
    setRect(rightPanel, { left: 1320, top: 87, width: 300, height: 915 });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);

    const best = blocks[0];
    expect(best.questionTypeGuess).toBe("single_choice");
    expect(best.previewText).toContain("PID 控制器中，积分环节的作用是");
    expect(best.previewText).toContain("D. 增加阻尼");
    expect(best.bbox.x).toBeGreaterThanOrEqual(420);
    expect(best.bbox.y).toBeGreaterThanOrEqual(160);
    expect(best.bbox.width).toBeLessThan(900);
    expect(best.bbox.height).toBeLessThan(260);
  });

  it("trims next-question markers from the last detected option", () => {
    document.body.innerHTML = `
      <div id="root" class="questionlistall-div clearfloat">
        <div id="question-box" class="questionBox">
          <div id="question-tit" class="questionTit">5. [单选题]（10分）</div>
          <div id="question-content" class="questionContent">某系统的校正装置的数学模型为（ ）。</div>
          <ul id="option-ul" class="optionUl">
            <li id="opt-a">A. 超前校正</li>
            <li id="opt-b">B. 滞后校正</li>
            <li id="opt-c">C. 微分校正</li>
            <li id="opt-d">D. PID校正 6. [</li>
          </ul>
        </div>
      </div>
    `;

    const root = document.getElementById("root")!;
    const questionBox = document.getElementById("question-box")!;
    const questionTit = document.getElementById("question-tit")!;
    const questionContent = document.getElementById("question-content")!;
    const optionUl = document.getElementById("option-ul")!;
    const optA = document.getElementById("opt-a")!;
    const optB = document.getElementById("opt-b")!;
    const optC = document.getElementById("opt-c")!;
    const optD = document.getElementById("opt-d")!;

    setRect(root, { left: 260, top: 80, width: 900, height: 420 });
    setRect(questionBox, { left: 280, top: 120, width: 720, height: 240 });
    setRect(questionTit, { left: 300, top: 140, width: 680, height: 24 });
    setRect(questionContent, { left: 300, top: 184, width: 680, height: 28 });
    setRect(optionUl, { left: 300, top: 228, width: 680, height: 120 });
    setRect(optA, { left: 320, top: 236, width: 240, height: 22 });
    setRect(optB, { left: 320, top: 264, width: 240, height: 22 });
    setRect(optC, { left: 320, top: 292, width: 240, height: 22 });
    setRect(optD, { left: 320, top: 320, width: 300, height: 22 });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);

    const best = blocks[0];
    expect(best.previewText).toContain("D. PID校正");
    expect(best.previewText).not.toContain("PID校正 6. [");
  });

  it("keeps math and image semantic text in preview text", () => {
    document.body.innerHTML = `
      <div id="question-box" class="questionBox">
        <div id="question-tit" class="questionTit">2. [单选题]（5分）</div>
        <div id="question-content" class="questionContent">
          若开环传递函数
          <math id="math1" aria-label="G(s)H(s)"></math>
          在右半平面有P个极点，如图所示，判断闭环系统稳定性。
          <img id="fig1" alt="奈奎斯特曲线图" src="https://example.com/fig.png" />
        </div>
        <ul id="option-ul" class="optionUl">
          <li id="opt-a">A. 滞后</li>
          <li id="opt-b">B. 超前</li>
          <li id="opt-c">C. 不稳定</li>
          <li id="opt-d">D. 稳定</li>
        </ul>
      </div>
    `;

    const questionBox = document.getElementById("question-box")!;
    const questionTit = document.getElementById("question-tit")!;
    const questionContent = document.getElementById("question-content")!;
    const math1 = document.getElementById("math1")!;
    const fig1 = document.getElementById("fig1")!;
    const optionUl = document.getElementById("option-ul")!;
    const optA = document.getElementById("opt-a")!;
    const optB = document.getElementById("opt-b")!;
    const optC = document.getElementById("opt-c")!;
    const optD = document.getElementById("opt-d")!;

    setRect(questionBox, { left: 220, top: 120, width: 760, height: 260 });
    setRect(questionTit, { left: 240, top: 138, width: 700, height: 22 });
    setRect(questionContent, { left: 240, top: 176, width: 700, height: 70 });
    setRect(math1, { left: 380, top: 182, width: 80, height: 24 });
    setRect(fig1, { left: 700, top: 176, width: 120, height: 70 });
    setRect(optionUl, { left: 240, top: 268, width: 700, height: 100 });
    setRect(optA, { left: 260, top: 276, width: 180, height: 20 });
    setRect(optB, { left: 260, top: 300, width: 180, height: 20 });
    setRect(optC, { left: 260, top: 324, width: 180, height: 20 });
    setRect(optD, { left: 260, top: 348, width: 180, height: 20 });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);

    const best = blocks[0];
    expect(best.hasImage).toBe(true);
    expect(best.previewText).toContain("G(s)H(s)");
    expect(best.previewText).toContain("奈奎斯特曲线图");
  });

  it("keeps inline math formula text from svg/math nodes in single-choice preview", () => {
    document.body.innerHTML = `
      <div id="question-box" class="questionBox">
        <div id="question-content" class="questionContent">
          10. 某系统的校正装置的数学模型为
          <math id="formula" aria-label="G(s)=10+2/s+5s"></math>
          ，则该校正装置为（ ）。
        </div>
        <ul id="option-ul" class="optionUl">
          <li id="opt-a">A. 超前校正</li>
          <li id="opt-b">B. 滞后校正</li>
          <li id="opt-c">C. 微分校正</li>
          <li id="opt-d">D. PID校正</li>
        </ul>
      </div>
    `;

    const questionBox = document.getElementById("question-box")!;
    const questionContent = document.getElementById("question-content")!;
    const formula = document.getElementById("formula")!;
    const optionUl = document.getElementById("option-ul")!;
    const optA = document.getElementById("opt-a")!;
    const optB = document.getElementById("opt-b")!;
    const optC = document.getElementById("opt-c")!;
    const optD = document.getElementById("opt-d")!;

    setRect(questionBox, { left: 220, top: 120, width: 760, height: 240 });
    setRect(questionContent, { left: 240, top: 152, width: 700, height: 44 });
    setRect(formula, { left: 470, top: 156, width: 120, height: 32 });
    setRect(optionUl, { left: 240, top: 232, width: 700, height: 100 });
    setRect(optA, { left: 260, top: 240, width: 180, height: 20 });
    setRect(optB, { left: 260, top: 264, width: 180, height: 20 });
    setRect(optC, { left: 260, top: 288, width: 180, height: 20 });
    setRect(optD, { left: 260, top: 312, width: 180, height: 20 });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0].previewText).toContain("G(s)=10+2/s+5s");
  });

  it("extracts formula text from embed data-svg-latex nodes", () => {
    document.body.innerHTML = `
      <div id="question-box" class="questionBox">
        <div id="question-content" class="questionContent">
          10.某系统的校正装置的数学模型为
          <embed id="formula-embed" data-svg-latex="G(s)=10+%5Cfrac%7B2%7D%7Bs%7D%20+5s" type="image/svg+xml" />
          ，则该校正装置为（ ）。 
        </div>
        <ul id="option-ul" class="optionUl">
          <li id="opt-a">A. 超前校正</li>
          <li id="opt-b">B. 滞后校正</li>
          <li id="opt-c">C. 微分校正</li>
          <li id="opt-d">D. PID校正</li>
        </ul>
      </div>
    `;

    const questionBox = document.getElementById("question-box")!;
    const questionContent = document.getElementById("question-content")!;
    const formulaEmbed = document.getElementById("formula-embed")!;
    const optionUl = document.getElementById("option-ul")!;
    const optA = document.getElementById("opt-a")!;
    const optB = document.getElementById("opt-b")!;
    const optC = document.getElementById("opt-c")!;
    const optD = document.getElementById("opt-d")!;

    setRect(questionBox, { left: 220, top: 120, width: 760, height: 240 });
    setRect(questionContent, { left: 240, top: 152, width: 700, height: 44 });
    setRect(formulaEmbed, { left: 470, top: 156, width: 120, height: 32 });
    setRect(optionUl, { left: 240, top: 232, width: 700, height: 100 });
    setRect(optA, { left: 260, top: 240, width: 180, height: 20 });
    setRect(optB, { left: 260, top: 264, width: 180, height: 20 });
    setRect(optC, { left: 260, top: 288, width: 180, height: 20 });
    setRect(optD, { left: 260, top: 312, width: 180, height: 20 });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0].previewText).toContain("G(s)=10+2/s+5s");
  });

  it("keeps large stem images as visual content instead of flattening nearby semantic svg text", () => {
    document.body.innerHTML = `
      <div id="question-box" class="questionBox">
        <div id="question-content" class="questionContent">
          1. 设总体X的概率分布为：
          <img id="formula-img" src="https://example.com/table.png" />
          <svg id="formula-svg" viewBox="0 0 200 40">
            <text>X</text>
            <text>1</text>
            <text>2</text>
            <text>3</text>
            <text>P</text>
            <text>θ²</text>
            <text>2θ(1-θ)</text>
            <text>(1-θ)²</text>
          </svg>
          取样本值x1=1,x2=2,x3=1,则参数θ的似然估计值=（ ）.
        </div>
        <ul id="option-ul" class="optionUl">
          <li id="opt-a">A. 2/3</li>
          <li id="opt-b">B. 3/4</li>
          <li id="opt-c">C. 5/6</li>
          <li id="opt-d">D. 1/2</li>
        </ul>
      </div>
    `;

    const questionBox = document.getElementById("question-box")!;
    const questionContent = document.getElementById("question-content")!;
    const formulaImg = document.getElementById("formula-img")!;
    const formulaSvg = document.getElementById("formula-svg")!;
    const optionUl = document.getElementById("option-ul")!;
    const optA = document.getElementById("opt-a")!;
    const optB = document.getElementById("opt-b")!;
    const optC = document.getElementById("opt-c")!;
    const optD = document.getElementById("opt-d")!;

    setRect(questionBox, { left: 220, top: 120, width: 760, height: 260 });
    setRect(questionContent, { left: 240, top: 152, width: 700, height: 80 });
    setRect(formulaImg, { left: 260, top: 176, width: 320, height: 54 });
    setRect(formulaSvg, { left: 268, top: 182, width: 310, height: 40 });
    setRect(optionUl, { left: 240, top: 260, width: 700, height: 100 });
    setRect(optA, { left: 260, top: 268, width: 180, height: 20 });
    setRect(optB, { left: 260, top: 292, width: 180, height: 20 });
    setRect(optC, { left: 260, top: 316, width: 180, height: 20 });
    setRect(optD, { left: 260, top: 340, width: 180, height: 20 });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0].previewText).toContain("[图片]");
    expect(blocks[0].previewText).toMatch(/\[图片\].*取样本值/);
    expect(blocks[0].questionImageUrl).toContain("table.png");
    const displayText = (blocks[0].displaySegments || [])
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.text)
      .join(" ");
    expect(displayText).toContain("取样本值");
  });

  it("repairs infinity symbols in detected preview text for frequency-domain questions", () => {
    document.body.innerHTML = `
      <div id="question-box" class="questionBox">
        <div id="question-content" class="questionContent">
          若开环传递函数G(s)H(s)在[s]右半平面有P个极点，当ω由 - 到 + 时，若G(jw)H(jw)曲线逆时针包围(-1,j0)点P圈，则闭环系统( )。
        </div>
        <ul id="option-ul" class="optionUl">
          <li id="opt-a">A. 滞后</li>
          <li id="opt-b">B. 超前</li>
          <li id="opt-c">C. 不稳定</li>
          <li id="opt-d">D. 稳定</li>
        </ul>
      </div>
    `;

    const questionBox = document.getElementById("question-box")!;
    const questionContent = document.getElementById("question-content")!;
    const optionUl = document.getElementById("option-ul")!;
    const optA = document.getElementById("opt-a")!;
    const optB = document.getElementById("opt-b")!;
    const optC = document.getElementById("opt-c")!;
    const optD = document.getElementById("opt-d")!;

    setRect(questionBox, { left: 220, top: 120, width: 760, height: 220 });
    setRect(questionContent, { left: 240, top: 150, width: 700, height: 54 });
    setRect(optionUl, { left: 240, top: 228, width: 700, height: 100 });
    setRect(optA, { left: 260, top: 236, width: 180, height: 20 });
    setRect(optB, { left: 260, top: 260, width: 180, height: 20 });
    setRect(optC, { left: 260, top: 284, width: 180, height: 20 });
    setRect(optD, { left: 260, top: 308, width: 180, height: 20 });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0].previewText).toContain("ω由-∞到+∞");
  });

  it("keeps html subscript and superscript inline inside display segments", () => {
    document.body.innerHTML = `
      <div id="question-box" class="questionBox">
        <div id="question-tit" class="questionTit">5. 单选题（2分）</div>
        <div id="question-content" class="questionContent">
          设
          <span>X<sub>1</sub>,X<sub>2</sub>,X<sub>3</sub>,X<sub>4</sub></span>
          来自均值为 <span>θ</span> 的指数分布，其中 <span>D(T)=θ<sup>2</sup></span>。
        </div>
        <ul id="option-ul" class="optionUl">
          <li id="opt-a">A. 1/4θ^2</li>
          <li id="opt-b">B. 1/2θ^2</li>
          <li id="opt-c">C. θ^2</li>
          <li id="opt-d">D. 2θ^2</li>
        </ul>
      </div>
    `;

    const ids = [
      ["question-box", 80, 80, 900, 240],
      ["question-tit", 100, 96, 220, 24],
      ["question-content", 100, 140, 760, 50],
      ["option-ul", 100, 214, 300, 120],
      ["opt-a", 120, 222, 180, 20],
      ["opt-b", 120, 250, 180, 20],
      ["opt-c", 120, 278, 180, 20],
      ["opt-d", 120, 306, 180, 20],
    ] as const;

    ids.forEach(([id, left, top, width, height]) => {
      setRect(document.getElementById(id)!, { left, top, width, height });
    });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);

    const best = blocks[0];
    const displayText = (best.displaySegments || [])
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.text)
      .join(" ");

    expect(displayText).toContain("X1,X2,X3,X4");
    expect(displayText).toContain("θ^2");
  });
});
