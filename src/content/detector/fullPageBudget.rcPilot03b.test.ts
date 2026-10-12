import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectCandidatesInViewport } from "./domDetector";
import {
  cancelFullPageScan,
  detectCandidatesFullPage,
  isFullPageScanRunning,
  type ScanProgress,
} from "./fullPageDetector";

vi.mock("./domDetector", () => ({ detectCandidatesInViewport: vi.fn(() => []) }));

describe("RC-PILOT-03B immutable full-page scan budget", () => {
  let top: number;
  let pageHeight: number;
  let scrollTo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(detectCandidatesInViewport).mockReset().mockReturnValue([]);
    document.body.innerHTML = "<main>Public question page fixture</main>";
    document.body.removeAttribute("aria-busy"); // Isolate readiness fixtures across tests.
    top = 200;
    pageHeight = 9000; // (9000 - 600) / 600 + 1 = 15 expected steps
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => top });
    Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    Object.defineProperty(document.body, "scrollHeight", { configurable: true, get: () => pageHeight });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => pageHeight });
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
      const options = args[0] as ScrollToOptions;
      top = Math.min(Math.max(0, options.top ?? top), Math.max(0, pageHeight - 600));
    });
  });

  afterEach(() => {
    cancelFullPageScan();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
    document.body.removeAttribute("aria-busy");
  });

  it("RC03B-R2 revisits a pending first viewport once without inventing scan steps", async () => {
    pageHeight = 1200;
    document.body.setAttribute("aria-busy", "true");
    const candidate = {
      id: "public-question", bbox: { x: 50, y: 150, width: 680, height: 310 },
      previewText: "这属于哪种品德心理结构？ A. 道德认识 B. 道德情感 C. 道德意志 D. 道德行为 题型：单选题",
      questionTypeGuess: "single_choice" as const, confidence: 0.94,
      source: "auto_dom" as const, hasImage: false,
    };
    let detects = 0;
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      detects++;
      if (detects === 1) return [];
      document.body.removeAttribute("aria-busy");
      return [candidate];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    const candidates = await scan;
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.previewText).toContain("题型：单选题");
    expect(detects).toBe(3); // first empty, one same-position recheck, one next step
    expect(progress.map((p) => p.currentStep)).toEqual([1, 2]);
    expect(progress.every((p) => p.totalScrollSteps === 2)).toBe(true);
    expect(isFullPageScanRunning()).toBe(false);
  });


  it("R8B-01 retries an unmarked SPA mount once without adding a scroll step", async () => {
    pageHeight = 600;
    const question = {
      id: "spa-mounted-question", bbox: { x: 40, y: 140, width: 680, height: 310 },
      previewText: "下列哪一种学习方式更主动？ A. 探索讨论 B. 被动抄写 C. 放弃练习 D. 忽略反馈",
      questionTypeGuess: "single_choice" as const, confidence: 0.9,
      source: "auto_dom" as const, hasImage: false,
    };
    vi.mocked(detectCandidatesInViewport).mockImplementation(() =>
      document.querySelector("[data-spa-ready]") ? [question] : []);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    setTimeout(() => {
      const mounted = document.createElement("div");
      mounted.setAttribute("data-spa-ready", "");
      document.querySelector("main")!.append(mounted);
    }, 450); // Between initial 300ms scroll pause and bounded 650ms readiness window.
    await vi.runAllTimersAsync();
    const result = await scan;
    expect(result).toHaveLength(1);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(2);
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(progress[0].totalScrollSteps).toBe(1);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R8B-02 does not re-probe a genuinely unchanged first viewport", async () => {
    pageHeight = 600;
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    expect(await scan).toEqual([]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R8B-03 ignores extension UI mutations as SPA readiness evidence", async () => {
    pageHeight = 600;
    const scan = detectCandidatesFullPage(() => undefined);
    setTimeout(() => {
      const overlay = document.createElement("div");
      overlay.id = "qs-floating-host";
      document.body.append(overlay);
      overlay.append(document.createElement("span"));
    }, 450);
    await vi.runAllTimersAsync();
    expect(await scan).toEqual([]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
  });

  it("R8B-04 STOP during an unmarked SPA mutation window fences retry and progress", async () => {
    pageHeight = 600;
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.advanceTimersByTimeAsync(350);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    cancelFullPageScan();
    const mounted = document.createElement("div");
    mounted.setAttribute("data-spa-ready", "");
    document.body.append(mounted);
    await vi.runAllTimersAsync();
    expect(await scan).toEqual([]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    expect(progress).toHaveLength(0);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R9A-01 recovers a late-mounted second viewport question without extra steps", async () => {
    pageHeight = 1800;
    const initial = {
      id: "first-card", bbox: { x: 40, y: 160, width: 680, height: 300 },
      previewText: "下列哪种方式属于合作学习？ A. 分组讨论 B. 个人抄写 C. 回避任务 D. 机械重复",
      questionTypeGuess: "single_choice" as const, confidence: 0.91,
      source: "auto_dom" as const, hasImage: false,
    };
    const late = {
      ...initial, id: "late-card", bbox: { x: 40, y: 160, width: 680, height: 300 },
      previewText: "关于课堂管理的正确说法是什么？ A. 明确规则 B. 忽略需求 C. 取消反馈 D. 随意变更",
    };
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      if (top === 0) return [initial];
      return top === 600 && document.querySelector("[data-r9a-late]") ? [late] : [];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage(p => progress.push(p));
    setTimeout(() => {
      const card = document.createElement("article");
      card.setAttribute("data-r9a-late", "");
      document.querySelector("main")!.append(card);
    }, 750); // After step 2 enters its 650ms late-mount window.
    await vi.runAllTimersAsync();
    const result = await scan;
    expect(result).toHaveLength(2);
    expect(result.map(r => r.previewText)).toEqual(expect.arrayContaining([
      expect.stringContaining("合作学习"), expect.stringContaining("课堂管理"),
    ]));
    expect(progress.map(p => p.currentStep)).toEqual([1, 2, 3]);
    expect(progress.every(p => p.totalScrollSteps === 3 && p.currentStep <= 3)).toBe(true);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(4);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R9A-02 STOP fences a later viewport mutation and forbids stale progress/restore", async () => {
    pageHeight = 1800;
    const initial = {
      id: "first-card", bbox: { x: 40, y: 160, width: 680, height: 300 },
      previewText: "下列哪种行为属于有效沟通？ A. 主动倾听 B. 打断他人 C. 忽略反馈 D. 拒绝讨论",
      questionTypeGuess: "single_choice" as const, confidence: 0.91,
      source: "auto_dom" as const, hasImage: false,
    };
    vi.mocked(detectCandidatesInViewport).mockImplementation(() =>
      top === 0 ? [initial] : []);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage(p => progress.push(p));
    await vi.advanceTimersByTimeAsync(650); // second viewport is waiting
    expect(progress.map(p => p.currentStep)).toEqual([1]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(2);
    cancelFullPageScan();
    document.querySelector("main")!.append(document.createElement("article"));
    await vi.runAllTimersAsync();
    expect(await scan).toHaveLength(1);
    expect(progress.map(p => p.currentStep)).toEqual([1]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenCalledTimes(2); // initial and step 2; no restore
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R9A-03 later readiness stays bounded when all 15 scan steps remain empty", async () => {
    pageHeight = 9000;
    let probes = 0;
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      probes++;
      if (probes === 1) pageHeight = 120_000;
      return [];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage(p => progress.push(p));
    setTimeout(() => document.querySelector("main")!.append(document.createElement("article")), 500);
    setTimeout(() => document.querySelector("main")!.append(document.createElement("section")), 1450);
    await vi.runAllTimersAsync();
    expect(await scan).toEqual([]);
    expect(progress.map(p => p.currentStep)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(progress.every(p => p.totalScrollSteps === 15 && p.currentStep <= 15)).toBe(true);
    expect(probes).toBe(17); // 15 real steps + at most two bounded same-step rechecks
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R13D preserves an accepted long choice question when its option D is after preview truncation", async () => {
    pageHeight = 600;
    const question = {
      id: "long-choice", bbox: { x: 50, y: 150, width: 680, height: 310 },
      previewText: "非常完整且很长的题干".repeat(43) + " A. 选项甲 B. 选项乙 C. 选项丙 D. 选项丁",
      questionTypeGuess: "single_choice" as const, confidence: 0.94,
      source: "auto_dom" as const, hasImage: false,
    };
    expect(question.previewText.length).toBeGreaterThan(420);
    vi.mocked(detectCandidatesInViewport).mockReturnValue([question]);
    const scan = detectCandidatesFullPage(() => undefined);
    await vi.runAllTimersAsync();
    const result = await scan;
    expect(result).toHaveLength(1);
    expect(result[0].previewText).toHaveLength(420);
    expect(result[0].id).toMatch(/^fullpage-/);
  });

  it("R8A-05 sends immutable numeric-only DOM counts and STOP never publishes another scan step", async () => {
    pageHeight = 9000;
    vi.mocked(detectCandidatesInViewport).mockImplementation((d) => {
      if (d) {
        d.probedElements += 3;
        d.rejected.completeness += 2;
        d.acceptedCandidates += 1;
      }
      return [];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => {
      progress.push(p);
      cancelFullPageScan();
    });
    await vi.runAllTimersAsync();
    expect(await scan).toEqual([]);
    expect(progress).toHaveLength(1);
    expect(progress[0].domDiagnostics).toMatchObject({
      probedElements: 3, acceptedCandidates: 1, rejected: { completeness: 2 },
    });
    expect(JSON.stringify(progress[0].domDiagnostics)).not.toContain("Public question page fixture");
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("RC03B-R3 CANCEL during readiness recheck cannot revive old scan authority", async () => {
    document.body.setAttribute("aria-busy", "true");
    const scan = detectCandidatesFullPage(() => undefined);
    await vi.advanceTimersByTimeAsync(300);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledOnce();
    cancelFullPageScan();
    await vi.runAllTimersAsync();
    expect(await scan).toEqual([]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledOnce();
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("never reports or executes 31/15 when content grows after the first viewport", async () => {
    let viewCount = 0;
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      viewCount += 1;
      if (viewCount === 1) pageHeight = 120_000;
      return [];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    expect(await scan).toEqual([]);
    expect(progress).toHaveLength(15);
    expect(viewCount).toBe(15);
    expect(progress.map((p) => p.currentStep)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(progress.every((p) => p.totalScrollSteps === 15 && p.currentStep <= p.totalScrollSteps)).toBe(true);
    expect(progress.every((p) => p.progress >= 0 && p.progress <= 99)).toBe(true);
    expect(progress.slice(0, -1).every((p) => p.budgetExhausted === undefined)).toBe(true);
    expect(progress[progress.length - 1]?.budgetExhausted).toBe(true);
    expect(top).toBe(200); // a completed, current run still restores its scroll lease
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("does not loop beyond the original step budget when the page shrinks", async () => {
    let viewCount = 0;
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      viewCount += 1;
      if (viewCount === 1) pageHeight = 2100;
      return [];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    await scan;
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.length).toBeLessThanOrEqual(15);
    expect(progress.every((p) => p.totalScrollSteps === 15 && p.currentStep <= 15)).toBe(true);
    expect(viewCount).toBeLessThanOrEqual(15);
    expect(progress.every((p) => p.budgetExhausted !== true)).toBe(true);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("stops when a scroll trap prevents forward motion instead of scanning the same view", async () => {
    // A site intercepts window.scrollTo and ignores every request.
    scrollTo.mockImplementation(() => undefined);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    await scan;
    expect(progress.map(p => p.currentStep)).toEqual([1, 1]); // terminal evidence is not a new scan step
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    expect(progress[0].totalScrollSteps).toBe(15);
    expect(progress[1].scrollStalled).toBe(true);
    expect(progress[1].budgetExhausted).toBeUndefined();
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R12 preserves a recognized choice question even when scroll motion is blocked", async () => {
    scrollTo.mockImplementation(() => undefined);
    vi.mocked(detectCandidatesInViewport).mockReturnValue([{
      id: "stalled-q", bbox: { x: 40, y: 170, width: 650, height: 300 },
      previewText: "以下哪项属于正确的安全操作？ A. 先检查设备 B. 忽略警告 C. 跳过确认 D. 强制提交",
      questionTypeGuess: "single_choice", confidence: 0.94, hasImage: false, source: "auto_dom",
    }]);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage(p => progress.push(p));
    await vi.runAllTimersAsync();
    expect(await scan).toHaveLength(1);
    expect(progress.map(p => p.currentStep)).toEqual([1, 1]);
    expect(progress[1]).toMatchObject({ scrollStalled: true, found: 1, totalScrollSteps: 15 });
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R13 detects a short-window question between old fixed 600px samples", async () => {
    pageHeight = 1500;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 320 });
    scrollTo.mockImplementation((...args: unknown[]) => {
      const options = args[0] as ScrollToOptions;
      top = Math.min(Math.max(0, options.top ?? top), pageHeight - 320);
    });
    const visited: number[] = [];
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      visited.push(top);
      // Absolute question at 420-480: outside both [0,320] and [600,920].
      return top <= 420 && top + 320 >= 480 ? [{
        id: "narrow-viewport-question", bbox: { x: 30, y: 150, width: 660, height: 60 },
        previewText: "哪一个操作符合设备安全规范？ A. 上电前检查 B. 跳过检查 C. 关闭防护 D. 忽略告警",
        questionTypeGuess: "single_choice", confidence: 0.94, hasImage: false, source: "auto_dom",
      }] : [];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage(p => progress.push(p));
    await vi.runAllTimersAsync();
    const result = await scan;
    expect(result).toHaveLength(1);
    expect(result[0].previewText).toContain("上电前检查");
    expect(visited).toEqual([0, 320, 640, 960, 1180]);
    expect(progress.map(p => p.currentStep)).toEqual([1, 2, 3, 4, 5]);
    expect(progress.every(p => p.totalScrollSteps === 5 && p.budgetExhausted !== true)).toBe(true);
    expect(top).toBe(200);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R13 bounds the stride using a nested question pane instead of window height", async () => {
    pageHeight = 9000; // Window metrics must not govern the selected inner pane.
    document.body.innerHTML = '<main id="paper-scroll-r13" style="overflow-y:auto;height:350px"></main>';
    const pane = document.getElementById("paper-scroll-r13")!;
    let paneTop = 90;
    Object.defineProperty(pane, "scrollTop", { configurable: true, get: () => paneTop });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 350 });
    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 1400 });
    Object.defineProperty(pane, "getBoundingClientRect", { configurable: true,
      value: () => ({ left: 20, top: 30, right: 820, bottom: 380, width: 800, height: 350 }) });
    const paneScrollTo = vi.fn((options: ScrollToOptions) => {
      paneTop = Math.min(Math.max(0, options.top ?? paneTop), 1050);
    });
    Object.defineProperty(pane, "scrollTo", { configurable: true, value: paneScrollTo });
    const visited: number[] = [];
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      visited.push(paneTop);
      return paneTop <= 440 && paneTop + 350 >= 490 ? [{
        id: "inner-pane-question", bbox: { x: 45, y: 120, width: 680, height: 80 },
        previewText: "选出正确的校园实验操作？ A. 记录步骤 B. 随意接线 C. 跳过验证 D. 忽略提示",
        questionTypeGuess: "single_choice", confidence: 0.93, hasImage: false, source: "auto_dom",
      }] : [];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage(p => progress.push(p));
    await vi.runAllTimersAsync();
    expect(await scan).toHaveLength(1);
    expect(visited).toEqual([0, 350, 700, 1050]);
    expect(progress.every(p => p.totalScrollSteps === 4 && p.budgetExhausted !== true)).toBe(true);
    expect(paneTop).toBe(90);
    expect(scrollTo).not.toHaveBeenCalled(); // No writes to the wrong (window) scroll root.
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R13 keeps the original budget while shrinking scroll stride after resize", async () => {
    pageHeight = 1800;
    const visited: number[] = [];
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      visited.push(top);
      if (visited.length === 1) {
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 240 });
      }
      return [];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage(p => progress.push(p));
    await vi.runAllTimersAsync();
    expect(await scan).toEqual([]);
    expect(visited).toEqual([0, 600, 840]); // Dynamic stride, never 0,600,1200.
    expect(progress.map(p => p.currentStep)).toEqual([1, 2, 3]);
    expect(progress.every(p => p.totalScrollSteps === 3)).toBe(true);
    expect(progress[2].budgetExhausted).toBe(true); // Shrink reduced coverage, not authority.
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R14 keeps two distant reading questions with the same first 96 characters", async () => {
    pageHeight = 1800; // scan positions 0, 600 and 1200
    const sharedMaterial = "阅读下面的材料，分析其中的实验步骤与观察记录。".repeat(8);
    const first = sharedMaterial + " 第一问：哪项准备正确？ A. 检查设备 B. 跳过检查 C. 忽略异常 D. 放弃记录";
    const second = sharedMaterial + " 第二问：哪项记录正确？ A. 随意删改 B. 保留原始数据 C. 混合样本 D. 忽略时间";
    expect(first.replace(/[^\\u4e00-\\u9fa5A-Za-z0-9]/g, "").slice(0, 96))
      .toBe(second.replace(/[^\\u4e00-\\u9fa5A-Za-z0-9]/g, "").slice(0, 96));
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      const previewText = top === 0 ? first : top === 1200 ? second : null;
      if (!previewText) return [];
      return [{
        id: top === 0 ? "reading-question-one" : "reading-question-two",
        bbox: { x: 40, y: 130, width: 680, height: 320 },
        previewText, questionTypeGuess: "single_choice", confidence: 0.94,
        hasImage: false, source: "auto_dom",
      }];
    });
    const progress: ScanProgress[] = [];
    const run = detectCandidatesFullPage(p => progress.push(p));
    await vi.runAllTimersAsync();
    const candidates = await run;
    expect(candidates).toHaveLength(2);
    expect(candidates.map(c => c.previewText)).toEqual(expect.arrayContaining([first, second]));
    expect(new Set(candidates.map(c => c.bbox.y)).size).toBe(2);
    expect(progress.map(p => p.currentStep)).toEqual([1, 2, 3]);
    expect(top).toBe(200);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R14 still deduplicates the same question seen in overlapping scroll windows", async () => {
    pageHeight = 1200; // positions 0 and 600 both contain the same absolute card at y=450
    const text = "在安全实验中应如何操作？ A. 先检查设备 B. 随意接线 C. 关闭报警 D. 跳过验证";
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => [{
      id: `repeat-at-${top}`,
      bbox: { x: 40, y: 450 - top, width: 680, height: 180 },
      previewText: text, questionTypeGuess: "single_choice", confidence: 0.93,
      hasImage: false, source: "auto_dom",
    }]);
    const progress: ScanProgress[] = [];
    const run = detectCandidatesFullPage(p => progress.push(p));
    await vi.runAllTimersAsync();
    const candidates = await run;
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.bbox.y).toBe(450);
    expect(progress.map(p => p.currentStep)).toEqual([1, 2]);
    expect(top).toBe(200);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("preserves cancellation safety when the page grows during a run", async () => {
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      pageHeight = 120_000;
      return [];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => {
      progress.push(p);
      cancelFullPageScan();
    });
    await vi.runAllTimersAsync();
    await scan;
    expect(progress).toHaveLength(1);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledTimes(1); // initial scroll; no next mutation/restoration
    expect(isFullPageScanRunning()).toBe(false);
  });
});
