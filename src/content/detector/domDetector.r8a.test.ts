import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { buildPreviewTextForBbox } from "./domDetectorPreview";
import { createDomCandidateDiagnostics, detectCandidatesInViewport } from "./domDetector";

function rect(el: Element, left: number, top: number, width: number, height: number) {
  Object.defineProperty(el, "getBoundingClientRect", { configurable: true,
    value: () => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top }) });
}

function stageDom(html: string) {
  document.body.innerHTML = html;
  rect(document.body, 0, 0, 1400, 900);
  document.querySelectorAll<HTMLElement>("body *").forEach((el, i) => {
    rect(el, 90 + (el.tagName === "P" ? 15 : 0), el.id === "r8a-card" ? 95 : 110 + i * 24,
      el.id === "r8a-card" ? 800 : 730, el.id === "r8a-card" ? 640 : 30);
  });
}

describe("RC03B-R8A DOM admission and numeric diagnostics", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "location", { configurable: true,
      value: new URL("https://www.koolearn.com/shiti/tk-4-28-0-0-1.html") });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  });
  afterEach(() => { document.body.innerHTML = ""; });

  it("R8A-01 retains a complete long question whose D option is after char 420", () => {
    const lead = "根据教育教学评价案例，下列哪一项体现正确的课程设计原则？";
    const background = "课堂教师针对实际教学情境进行了具体的学习反馈记录与观察分析。".repeat(14);
    // Keep each leaf below the extraction limit (320), while the complete
    // question body extends beyond the 420-character display preview.
    const parts = background.match(/.{1,180}/gu) || [];
    stageDom('<div id="r8a-card"><p>' + lead + '</p>' +
      parts.map(part => '<p>' + part + '</p>').join('') +
      '<p>A. 体现学生主体地位</p><p>B. 只考虑课程分数</p>' +
      '<p>C. 取消教学评价</p><p>D. 根据学习效果调整课程</p></div>');
    const card = document.getElementById("r8a-card")!;
    const full = buildPreviewTextForBbox(card, { x: 90, y: 95, width: 800, height: 640 }, card.textContent || "");
    expect(full.length).toBeGreaterThan(420);
    expect(full.indexOf("D.")).toBeGreaterThan(420);
    const diag = createDomCandidateDiagnostics();
    const candidates = detectCandidatesInViewport(diag);
    expect(candidates.some(x => x.previewText.includes("课程设计原则"))).toBe(true);
    expect(candidates.every(x => x.previewText.length <= 420)).toBe(true);
    expect(diag.acceptedCandidates).toBeGreaterThan(0);
  });

  it("R8A-02 keeps Koolearn-style standalone A/B/C/D letter-and-body lines together", () => {
    stageDom('<div id="r8a-card"><p>凡是符合自己维护的道德观念时就产生积极情绪，这属于哪种品德心理结构？</p>' +
      '<div>A</div><div>道德认识</div><div>B</div><div>道德情感</div>' +
      '<div>C</div><div>道德意志</div><div>D</div><div>道德行为</div></div>');
    const card = document.getElementById("r8a-card")!;
    Object.defineProperty(card, "innerText", { configurable: true, value:
      "凡是符合自己维护的道德观念时就产生积极情绪，这属于哪种品德心理结构？\nA\n道德认识\nB\n道德情感\nC\n道德意志\nD\n道德行为" });
    const diag = createDomCandidateDiagnostics();
    const result = detectCandidatesInViewport(diag);
    expect(result.some(x => x.previewText.includes("道德观念") && x.previewText.includes("D."))).toBe(true);
    expect(diag.acceptedCandidates).toBeGreaterThan(0);
  });

  it("R8A-03 rejects a menu with fake ABCD choices", () => {
    stageDom('<div id="r8a-menu">课程分类与考试资料及快速入口汇总方便查阅，以下为网站导航而非试题' +
      '<a href="#a">A. 课程首页</a><a href="#b">B. 新闻公告</a>' +
      '<a href="#c">C. 学习资料</a><a href="#d">D. 咨询服务</a>' +
      '<a href="#e">报名导航</a><a href="#f">考试分类</a><a href="#g">更多课程</a></div>');
    const diag = createDomCandidateDiagnostics();
    expect(detectCandidatesInViewport(diag)).toHaveLength(0);
    expect(diag.probedElements).toBeGreaterThan(0);
    expect(diag.acceptedCandidates).toBe(0);
  });

  it("R8A-04 attributes incomplete choice rejection with no raw question content", () => {
    stageDom('<div id="r8a-card">' +
      '<p>下列哪种品德心理结构符合题意？请选择最合适的说法。</p>' +
      '<p>A. 道德认识</p><p>B. 道德情感</p><p>C. 道德意志</p></div>');
    const diag = createDomCandidateDiagnostics();
    expect(detectCandidatesInViewport(diag)).toHaveLength(0);
    expect(diag.probedElements).toBeGreaterThan(0);
    expect(diag.rejected.completeness).toBeGreaterThan(0);
    const json = JSON.stringify(diag);
    expect(json).not.toContain("道德情感");
    expect(json).not.toContain("r8a-card");
    expect(Object.values(diag.rejected).every(x => Number.isSafeInteger(x) && x >= 0)).toBe(true);
  });
});
