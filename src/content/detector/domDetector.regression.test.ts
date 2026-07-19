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
  it("skips bottom cards that are only marginally visible in the viewport", () => {
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

  it("deduplicates repeated structured stem fragments while preserving options", () => {
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

  it("detects Pintia programming problem statements as short-answer style candidates", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://pintia.cn/problem-sets/91827364500/exam/problems/type/7?problemSetProblemId=91827369803"),
    });

    document.body.innerHTML = `
      <div id="exam-app">
        <div id="layout" class="grid grid-cols-[4rem,minmax(0,1fr)] grid-rows-[auto,minmax(0,1fr)] h-screen">
          <div id="shell" class="row-start-2 row-end-3 col-start-2 col-end-3 scroll">
            <div id="wrapper" class="group/sidebar-wrapper flex h-full w-full flex-row">
              <aside id="sidebar">
                题目总览 作答 / 题数 编程题 0/3179 图例 1 2 3 4 5 当前1 - 100项，共3179项 第1页 第2页 第3页
              </aside>
              <main id="main" class="w-full h-full bg-bg-base">
                <div id="main-scroll" class="h-[calc(100%-2rem)] scroll mt-1">
                  <div id="main-column" class="flex flex-col overflow-auto scroll h-full">
                    <div id="problem-panel" class="flex flex-col overflow-auto flex-1">
                      <div id="panel-tab" class="sticky top-0 flex bg-bg-light flex-none border-b-2 border-bg-base z-10">
                        <button id="panel-tab-button">题目描述</button>
                      </div>
                      <div id="problem-body" class="flex flex-col h-full scroll">
                        <div id="problem-content" class="p-4 md:px-6 space-y-4 scroll">
                          <div id="problem-stack" class="space-y-4">
                            <div id="problem-header">
                              <div id="problem-title-row" class="flex flex-wrap space-x-2 items-center">
                                <span id="problem-title" class="text-darkest font-bold text-lg">3797 Sister's Noise</span>
                              </div>
                              <div id="problem-meta" class="flex flex-wrap gap-x-4 gap-y-1 grow">
                                作者 JIANG, Kai 单位 zoj
                              </div>
                            </div>
                            <div id="problem-description">
                              Academy City is a certain scientific place which consists of several schools and institutions
                              of higher learning. To protect the research data, each Sister has a unique SSH access key.
                              The i-th Sister's access key is the i-th lexicographical largest string that can be constructed
                              from the key table.
                            </div>
                            <div id="problem-input">输入格式 First line contains N M L. The second line contains the characters and counts.</div>
                            <div id="problem-output">输出格式 Print the M-th lexicographical key.</div>
                            <div id="problem-sample-input">样例输入 3 2 1 a 2 b 1 c 1</div>
                            <div id="problem-sample-output">样例输出 cb</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </main>
            </div>
          </div>
        </div>
      </div>
    `;

    const ids = [
      ["exam-app", 0, 0, 1440, 960],
      ["layout", 0, 0, 1440, 960],
      ["shell", 64, 57, 1376, 903],
      ["wrapper", 64, 57, 1376, 903],
      ["sidebar", 64, 57, 256, 903],
      ["main", 320, 57, 1120, 903],
      ["main-scroll", 320, 89, 1120, 871],
      ["main-column", 320, 89, 1120, 871],
      ["problem-panel", 320, 89, 1120, 871],
      ["panel-tab", 320, 89, 1120, 38],
      ["panel-tab-button", 320, 89, 92, 36],
      ["problem-body", 320, 127, 1120, 776],
      ["problem-content", 320, 127, 1120, 776],
      ["problem-stack", 344, 143, 1064, 776],
      ["problem-header", 344, 143, 980, 84],
      ["problem-title-row", 344, 143, 500, 28],
      ["problem-title", 344, 143, 180, 28],
      ["problem-meta", 344, 183, 360, 24],
      ["problem-description", 344, 239, 980, 180],
      ["problem-input", 344, 443, 980, 80],
      ["problem-output", 344, 539, 980, 64],
      ["problem-sample-input", 344, 619, 980, 64],
      ["problem-sample-output", 344, 699, 980, 64],
    ] as const;

    ids.forEach(([id, left, top, width, height]) => {
      setRect(document.getElementById(id)!, { left, top, width, height });
    });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0].questionTypeGuess).toBe("short_answer");
    expect(blocks[0].previewText).toContain("3797 Sister's Noise");
    expect(blocks[0].previewText).toContain("样例输入");
    expect(blocks[0].previewText).toContain("样例输出");
    expect(blocks[0].previewText).not.toContain("题目总览");
    expect((blocks[0].displaySegments || []).some((segment) => segment.type === "text" && segment.text.includes("3797 Sister's Noise"))).toBe(true);
  });

  it("detects Pintia function problem statements from the left pane only", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://pintia.cn/problem-sets/1995879389714477056/exam/problems/type/6?problemSetProblemId=1995879389743837199"),
    });

    document.body.innerHTML = `
      <div id="exam-app">
        <main id="main" class="w-full h-full bg-bg-base">
          <div id="main-scroll" class="h-[calc(100%-2rem)] scroll mt-1">
            <div id="main-column" class="flex flex-col overflow-auto scroll h-full">
              <div id="split" class="grow shrink splitArea_DF4tO">
                <div id="left-pane" class="left_rtQmv">
                  <div id="left-shell" class="flex flex-col h-full scroll">
                    <div id="left-content" class="p-4 md:px-6 space-y-4 scroll">
                      <div id="problem-stack" class="space-y-4">
                        <div id="problem-header">
                          <div id="problem-title">6-44 输出月份英文名</div>
                          <div id="problem-meta">作者 C课程组 单位 浙江大学</div>
                        </div>
                        <div id="problem-body" class="bg-bg-base space-y-4">
                          <div id="desc">本题要求实现函数，可以返回一个给定月份的英文名称。</div>
                          <div id="iface">函数接口定义： char *getmonth( int n );</div>
                          <div id="judge-sample">裁判测试程序样例： #include &lt;stdio.h&gt; char *getmonth( int n ); int main() { return 0; }</div>
                          <div id="limits">代码长度限制 16 KB 时间限制 400 ms 内存限制 64 MB</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div id="right-pane" class="right_rtQmv">
                  <div id="editor" class="codeEditor_CHvdZ readOnly_GnZrN cm-editor">
                    <div id="editor-content" class="cm-content">scanf("%d", &n); s = getmonth(n);</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    `;

    const ids = [
      ["exam-app", 0, 0, 1245, 902],
      ["main", 320, 57, 925, 845],
      ["main-scroll", 320, 89, 925, 813],
      ["main-column", 320, 89, 925, 813],
      ["split", 320, 146, 925, 700],
      ["left-pane", 320, 146, 463, 700],
      ["left-shell", 320, 146, 463, 700],
      ["left-content", 320, 184, 463, 662],
      ["problem-stack", 344, 200, 407, 640],
      ["problem-header", 344, 200, 407, 60],
      ["problem-title", 344, 200, 220, 28],
      ["problem-meta", 344, 232, 260, 24],
      ["problem-body", 344, 288, 407, 420],
      ["desc", 344, 288, 407, 64],
      ["iface", 344, 368, 407, 56],
      ["judge-sample", 344, 440, 407, 180],
      ["limits", 344, 636, 407, 72],
      ["right-pane", 783, 146, 462, 700],
      ["editor", 820, 240, 380, 420],
      ["editor-content", 840, 260, 340, 120],
    ] as const;

    ids.forEach(([id, left, top, width, height]) => {
      setRect(document.getElementById(id)!, { left, top, width, height });
    });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0].questionTypeGuess).toBe("short_answer");
    expect(blocks[0].previewText).toContain("6-44 输出月份英文名");
    expect(blocks[0].previewText).toContain("函数接口定义");
    expect(blocks[0].previewText).toContain("裁判测试程序样例");
    expect((blocks[0].displaySegments || []).some((segment) => segment.type === "text" && segment.text.includes("函数接口定义"))).toBe(true);
  });
  it("does not reuse Pintia programming detection on non-programming PTA pages", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://pintia.cn/problem-sets/1995879389714477056/exam/problems/type/1?problemSetProblemId=1995879389743837184"),
    });

    document.body.innerHTML = `
      <div id="layout" class="grid grid-cols-[4rem,minmax(0,1fr)] grid-rows-[auto,minmax(0,1fr)] h-screen">
        <div id="shell" class="row-start-2 row-end-3 col-start-2 col-end-3 scroll">
          <aside id="sidebar">
            题目总览 作答 / 题数 判断题 0/7 单选题 0/8 函数题 0/3 编程题 0/3 判断题 图例 1 2 3 4 5 6 7 当前1 - 7项，共7项
          </aside>
          <main id="main">
            <div id="main-scroll" class="h-[calc(100%-2rem)] scroll mt-1">
              <div id="main-column" class="flex flex-col overflow-auto scroll h-full print:overflow-visible print:h-auto">
                <div id="notice-card" class="Card-content !pb-0">
                  <div id="notice-markdown" class="rendered-markdown dark:rendered-markdown-invert">
                    考试公告 请各位同学务必在规定时间内做完，试题不会延长开放时间，此外，特别强调，务必独立完成，有不懂的，可以与老师和同学们讨论思路，但要杜绝直接参考源代码，这样极不利于编程能力的培养。
                    本课程的总评成绩中，期末考试和单元考（3次）占绝对占比，这两类考试采用功能很强的监考系统监考，不可能有作弊的机会，必须独立完成，考的是同学们的真实编程能力。
                    平时需要借助以下三类题目训练能力：判断题、单选题、函数题。
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    `;

    const ids = [
      ["layout", 0, 0, 1440, 960],
      ["shell", 64, 57, 1181, 845],
      ["sidebar", 64, 57, 256, 845],
      ["main", 320, 57, 925, 845],
      ["main-scroll", 320, 89, 925, 813],
      ["main-column", 320, 89, 925, 813],
      ["notice-card", 336, -139, 886, 288],
      ["notice-markdown", 352, -139, 854, 256],
    ] as const;

    ids.forEach(([id, left, top, width, height]) => {
      setRect(document.getElementById(id)!, { left, top, width, height });
    });

    const blocks = detectCandidatesInViewport();
    expect(blocks.some((block) => block.questionTypeGuess === "short_answer")).toBe(false);
    expect(blocks.some((block) => block.previewText.includes("考试公告"))).toBe(false);
  });

  it("keeps PTA function-problem tables structured instead of flattening them into one sentence", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://pintia.cn/problem-sets/1995879389714477056/exam/problems/type/6?problemSetProblemId=1995879389743837200"),
    });

    document.body.innerHTML = `
      <div id="shell" class="grow shrink splitArea_DF4tO">
        <div id="left" class="left_rtQmv">
          <div id="body-scroll" class="p-4 md:px-6 space-y-4 scroll">
            <div id="title">6-45 查找星期</div>
            <div id="meta">作者 张泳 单位 浙大城市学院</div>
            <div id="markdown-wrap" class="bg-bg-base space-y-4">
              <div id="markdown" class="hyphens-auto flex-1 min-w-0 break-words">
                <div class="rendered-markdown dark:rendered-markdown-invert">
                  <p id="desc">本题要求实现函数，可以根据下表查找到星期，返回对应的序号。</p>
                  <table id="weekday-table">
                    <tr><th>序号</th><th>星期</th></tr>
                    <tr><td>0</td><td>Sunday</td></tr>
                    <tr><td>1</td><td>Monday</td></tr>
                    <tr><td>2</td><td>Tuesday</td></tr>
                  </table>
                  <p id="iface-label">函数接口定义：</p>
                  <pre id="iface-code">int getindex( char *s );</pre>
                  <p id="iface-text">函数getindex应返回字符串s序号。如果传入的参数s不是一个代表星期的字符串，则返回-1。</p>
                  <p id="sample-label">裁判测试程序样例：</p>
                  <pre id="sample-code">#include &lt;stdio.h&gt;\nint getindex( char *s );</pre>
                </div>
              </div>
              <div id="limits">代码长度限制 16 KB 时间限制 400 ms 内存限制 64 MB</div>
            </div>
          </div>
        </div>
        <div id="right-pane" class="right_abc readonly_abc">editor</div>
      </div>
    `;

    const ids = [
      ["shell", 320, 145, 925, 700],
      ["left", 320, 145, 462, 700],
      ["body-scroll", 336, 183, 430, 650],
      ["title", 344, 200, 220, 28],
      ["meta", 344, 232, 260, 24],
      ["markdown-wrap", 344, 288, 407, 500],
      ["markdown", 344, 288, 407, 440],
      ["desc", 352, 296, 380, 44],
      ["weekday-table", 352, 352, 360, 180],
      ["iface-label", 352, 548, 180, 24],
      ["iface-code", 352, 580, 360, 40],
      ["iface-text", 352, 628, 380, 48],
      ["sample-label", 352, 688, 220, 24],
      ["sample-code", 352, 720, 360, 56],
      ["limits", 344, 788, 407, 48],
      ["right-pane", 783, 145, 462, 700],
    ] as const;

    ids.forEach(([id, left, top, width, height]) => {
      setRect(document.getElementById(id)!, { left, top, width, height });
    });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThan(0);
    const displayText = (blocks[0].displaySegments || [])
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.text)
      .join("\n");

    expect(displayText).toContain("序号 | 星期");
    expect(displayText).toContain("0 | Sunday");
    expect(displayText).toContain("1 | Monday");
    expect(displayText).toContain("函数接口定义");
  });

  it("detects Pintia type/1 question list items without selecting the exam notice", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://pintia.cn/problem-sets/1995879389714477056/exam/problems/type/1?problemSetProblemId=1995879389743837184"),
    });

    document.body.innerHTML = `
      <main id="main">
        <div id="notice-card" class="Card-content !pb-0">
          <div id="notice-markdown" class="rendered-markdown dark:rendered-markdown-invert">
            考试公告 请各位同学务必在规定时间内做完，试题不会延长开放时间，此外，特别强调，务必独立完成。
          </div>
        </div>
        <div id="question-list" class="flex flex-col m-4 mb-0 flex-1">
          <div id="1995879389743837184" class="pc-x pt-2 pl-4 scroll-mt-0 active_x4JQK">
            <div id="q1-header">1-1 分数 1 作者 周强 单位 青岛大学</div>
            <div id="q1-body" class="mt-4">关于C语言指针的运算：指针只有加减操作，没有乘除操作。指针可以加常数、减常数；相同类型的指针可以相加、相减。 T F</div>
          </div>
          <div id="1995879389743837185" class="pc-x pt-2 pl-4 scroll-mt-0">
            <div id="q2-header">1-2 分数 1 作者 张泳 单位 浙大城市学院</div>
            <div id="q2-body" class="mt-4">对于定义 int a[10], *p=a; 语句 p=a+1; 和 a=a+1; 都是合法的。 T F</div>
          </div>
        </div>
      </main>
    `;

    const ids = [
      ["main", 320, 89, 1280, 980],
      ["notice-card", 336, 205, 1272, 84],
      ["notice-markdown", 352, 221, 1240, 48],
      ["question-list", 336, 289, 1272, 360],
      ["1995879389743837184", 336, 289, 1272, 148],
      ["q1-header", 352, 305, 460, 24],
      ["q1-body", 352, 337, 1256, 76],
      ["1995879389743837185", 336, 438, 1272, 148],
      ["q2-header", 352, 454, 460, 24],
      ["q2-body", 352, 486, 1256, 76],
    ] as const;

    ids.forEach(([id, left, top, width, height]) => {
      setRect(document.getElementById(id)!, { left, top, width, height });
    });

    const blocks = detectCandidatesInViewport();
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks.every((block) => block.questionTypeGuess === "judge")).toBe(true);
    expect(blocks.some((block) => block.previewText.includes("关于C语言指针的运算"))).toBe(true);
    expect(blocks.some((block) => block.previewText.includes("对于定义 int a[10]"))).toBe(true);
    expect(blocks.some((block) => block.previewText.includes("考试公告"))).toBe(false);
  });
});
