import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDomCandidateDiagnostics, detectCandidatesInViewport } from "./domDetector";
import { createCandidateWorkspaceRuntime } from "../candidateWorkspaceRuntime";
import { viewportDetectionSnapshotFeedback } from "../../sidepanel/viewportDetectionFeedback.rcPilot03a";

function setRect(el: Element, top: number, height = 160) {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 100, top, width: 800, height,
      right: 900, bottom: top + height, x: 100, y: top,
      toJSON: () => ({}),
    }),
  });
}

const CARD_HTML = `
  <div class="card">
    <div class="q"><p>1. [单选题] 中国的首都是哪座城市？请选择正确答案。</p>
      <label><input type="radio" name="q1"> A. 北京</label>
      <label><input type="radio" name="q1"> B. 上海</label>
      <label><input type="radio" name="q1"> C. 广州</label>
      <label><input type="radio" name="q1"> D. 深圳</label></div>
    <div class="q"><p>2. [单选题] 世界上面积最大的国家是哪个国家？请认真作答。</p>
      <label><input type="radio" name="q2"> A. 中国</label>
      <label><input type="radio" name="q2"> B. 美国</label>
      <label><input type="radio" name="q2"> C. 俄罗斯</label>
      <label><input type="radio" name="q2"> D. 加拿大</label></div>
    <div class="q"><p>3. [单选题] 以下哪种动物属于哺乳动物？请认真作答仔细阅读。</p>
      <label><input type="radio" name="q3"> A. 鲨鱼</label>
      <label><input type="radio" name="q3"> B. 鲸鱼</label>
      <label><input type="radio" name="q3"> C. 章鱼</label>
      <label><input type="radio" name="q3"> D. 海豚</label></div>
  </div>`;

describe("Phase 1 diagnostics attribution", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(window, "location", {
      configurable: true, value: new URL("https://example.com/quiz"),
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  });

  it("DG-001: group competition losers are counted, not silently dropped", () => {
    document.body.innerHTML = CARD_HTML;
    let top = 60;
    document.body.querySelectorAll("div, p, label").forEach((el) => { setRect(el, top); top += 200; });
    const diag = createDomCandidateDiagnostics();
    const blocks = detectCandidatesInViewport(diag);
    // 3 questions collapse to 1 winner; losers must leave a diagnostic trace.
    expect(blocks.length).toBe(1);
    expect(diag.rejected.grouped).toBeGreaterThanOrEqual(1);
  });

  it("DG-002: dedup loser is counted in diagnostics.rejected.duplicate", () => {
    document.body.innerHTML = `
      <div class="question"><p>1. [单选题] 中国的首都是哪座城市？请选择正确答案。</p>
        <p>A. 北京 B. 上海 C. 广州 D. 深圳</p></div>
      <div class="question"><p>1. [单选题] 中国的首都是哪座城市？请选择正确答案。</p>
        <p>A. 北京 B. 上海 C. 广州 D. 深圳</p></div>`;
    const qs = document.body.querySelectorAll("div.question");
    setRect(qs[0], 60, 120);
    setRect(qs[1], 150, 120);
    const diag = createDomCandidateDiagnostics();
    const blocks = detectCandidatesInViewport(diag);
    expect(blocks.length).toBe(1);
    expect(diag.rejected.duplicate).toBeGreaterThanOrEqual(1);
  });

  const makeSnapshotWithDiagnostics = (rejected: Record<string, number>) => {
    const origin = { tabId: 7, url: "https://example.com/quiz" };
    const id = "18aabcde-0ee2-4e98-8e12-48fdce879012";
    const runtime = createCandidateWorkspaceRuntime({ url: () => origin.url, send: vi.fn() });
    runtime.beginDetection("viewport", id);
    runtime.observe({
      type: "AUTO_DETECT_RESULT_READY",
      candidates: [{ block: { id: "q-0", previewText: "Question 0" }, selected: false, status: "idle" }],
      domDiagnostics: {
        probedElements: 8, acceptedCandidates: 1, rejected: {
          geometry: 0, text: 0, controls: 0, navigation: 0, signal: 0,
          confidence: 0, completeness: 0, grouped: 0, fragment: 0, duplicate: 0,
          ...rejected,
        },
      },
    });
    return { origin, id, payload: runtime.snapshot(origin.url) };
  };

  it("DG-003: success feedback warns when lossy filters dropped candidates", () => {
    const { origin, id, payload } = makeSnapshotWithDiagnostics({ grouped: 2 });
    const withDrops = viewportDetectionSnapshotFeedback("zh", origin, payload, id);
    expect(withDrops.code).toBe("VIEWPORT_DETECT_CANDIDATES");
    expect(withDrops.message).toContain("识别到 1 道候选题");
    expect(withDrops.message).toContain("手动框选");
  });

  it("DG-003: no warning when nothing was dropped by lossy filters", () => {
    const { origin, id, payload } = makeSnapshotWithDiagnostics({ geometry: 3, text: 1 });
    const clean = viewportDetectionSnapshotFeedback("zh", origin, payload, id);
    expect(clean.code).toBe("VIEWPORT_DETECT_CANDIDATES");
    expect(clean.message).toContain("识别到 1 道候选题");
    expect(clean.message).not.toContain("手动框选");
  });
});
