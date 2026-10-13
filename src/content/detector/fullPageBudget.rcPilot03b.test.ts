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
    const observedViewportTops: number[] = [];
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      detects++;
      observedViewportTops.push(top);
      if (detects === 1) return [];
      document.body.removeAttribute("aria-busy");
      // The card is located at document Y=150-460; after advancing to Y=600
      // it cannot remain a viewport candidate. Do not fabricate a duplicate.
      return top === 0 ? [candidate] : [];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    const candidates = await scan;
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.previewText).toContain("题型：单选题");
    expect(detects).toBe(3); // first empty, one same-position recheck, one next step
    expect(observedViewportTops).toEqual([0, 0, 600]);
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

  it.each(["hidden", "aria-hidden", "class", "style"] as const)(
    "Issue102 R22 recognizes a question revealed only through %s changes",
    async (attribute) => {
      pageHeight = 600; // One immutable viewport, no scroll budget extension.
      top = 0; // A non-scrollable 600px document cannot start at scrollTop=200.
      const card = document.createElement("article");
      const main = document.querySelector("main")!;
      main.append(card); // Node exists BEFORE the MutationObserver starts.
      if (attribute === "hidden") card.setAttribute("hidden", "");
      if (attribute === "aria-hidden") card.setAttribute("aria-hidden", "true");
      if (attribute === "class") card.className = "question-hidden";
      if (attribute === "style") card.style.display = "none";
      const visible = () => attribute === "hidden" ? !card.hasAttribute("hidden")
        : attribute === "aria-hidden" ? card.getAttribute("aria-hidden") === "false"
          : attribute === "class" ? card.classList.contains("question-visible")
            : card.style.display !== "none";
      vi.mocked(detectCandidatesInViewport).mockImplementation(() => visible() ? [{
        id: `r22-${attribute}-question`,
        bbox: { x: 40, y: 140, width: 680, height: 310 },
        previewText: "哪种方法能保证设备安全？ A. 事先检查 B. 忽略告警 C. 跳过确认 D. 删除记录",
        questionTypeGuess: "single_choice" as const,
        confidence: 0.94, source: "auto_dom" as const, hasImage: false,
      }] : []);
      const progress: ScanProgress[] = [];
      const scan = detectCandidatesFullPage((p) => progress.push(p));
      setTimeout(() => {
        if (attribute === "hidden") card.removeAttribute("hidden");
        if (attribute === "aria-hidden") card.setAttribute("aria-hidden", "false");
        if (attribute === "class") card.className = "question-visible";
        if (attribute === "style") card.style.display = "block";
      }, 450); // Between the initial 300ms and the sole 650ms readiness check.
      await vi.runAllTimersAsync();
      const blocks = await scan;
      expect(blocks).toHaveLength(1);
      expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(2);
      expect(progress.map((p) => p.currentStep)).toEqual([1]);
      expect(progress[0].totalScrollSteps).toBe(1);
      expect(top).toBe(0);
      expect(isFullPageScanRunning()).toBe(false);
    },
  );

  it("Issue102 R22 refreshes a recycled virtual question on class-only visibility change", async () => {
    pageHeight = 1800; // Fixed three-step budget.
    const existing = document.createElement("article");
    document.querySelector("main")!.append(existing);
    const firstText = "第一题哪项最安全？ A. 先检查 B. 跳过检查 C. 删除日志 D. 忽略告警";
    const secondText = "第二题哪项最安全？ A. 核验记录 B. 忽略异常 C. 隐瞒错误 D. 关闭监控";
    const thirdText = "第三题哪项最安全？ A. 正确备份 B. 任意删除 C. 不记日志 D. 跳过复核";
    const visited: number[] = [];
    const choice = (previewText: string) => ({
      id: "r22-recycled-question", bbox: { x: 40, y: 150, width: 680, height: 270 },
      previewText, questionTypeGuess: "single_choice" as const,
      confidence: 0.94, source: "auto_dom" as const, hasImage: false,
    });
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      visited.push(top);
      if (top === 0) return [choice(firstText)];
      if (top === 600) return [choice(existing.classList.contains("new-question") ? secondText : firstText)];
      return top === 1200 ? [choice(thirdText)] : [];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    setTimeout(() => { existing.classList.add("new-question"); }, 800);
    await vi.runAllTimersAsync();
    expect(visited).toEqual([0, 600, 600, 1200]);
    expect((await scan).map((b) => b.previewText)).toEqual([firstText, secondText, thirdText]);
    expect(progress.map((p) => p.currentStep)).toEqual([1, 2, 3]);
    expect(progress.every((p) => p.totalScrollSteps === 3 && p.currentStep <= 3)).toBe(true);
    expect(top).toBe(200);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R22 ignores extension overlays and irrelevant data attributes as readiness", async () => {
    pageHeight = 600;
    const pageCard = document.createElement("article");
    document.querySelector("main")!.append(pageCard);
    const overlay = document.createElement("div");
    overlay.id = "qs-floating-host";
    overlay.className = "old-overlay";
    document.body.append(overlay);
    const scan = detectCandidatesFullPage(() => undefined);
    setTimeout(() => {
      overlay.className = "new-overlay";
      overlay.setAttribute("hidden", "");
      pageCard.setAttribute("data-r22-irrelevant", "new");
    }, 450);
    await vi.runAllTimersAsync();
    expect(await scan).toEqual([]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R22 STOP during attribute-only readiness cannot revive the old scan", async () => {
    pageHeight = 600;
    const card = document.createElement("article");
    card.setAttribute("hidden", "");
    document.querySelector("main")!.append(card);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.advanceTimersByTimeAsync(350); // Already in the only bounded readiness window.
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    cancelFullPageScan();
    card.removeAttribute("hidden");
    await vi.runAllTimersAsync();
    expect(await scan).toEqual([]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    expect(progress).toHaveLength(0);
    expect(scrollTo).toHaveBeenCalledTimes(1); // Only the initial scroll, no stale restore.
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

  it("Issue102 R21 replaces recycled stale question after a bounded next-viewport DOM mount", async () => {
    pageHeight = 1800; // Immutable 3-step budget.
    const firstText = "第一题哪项符合实验规范？ A. 检查仪器 B. 删除记录 C. 忽略异常 D. 跳过复核";
    const secondText = "第二题哪项属于安全操作？ A. 核对清单 B. 跳过检查 C. 丢弃证据 D. 忽略报警";
    const thirdText = "第三题哪项符合现场要求？ A. 完整记录 B. 随意操作 C. 隐瞒结果 D. 关闭防护";
    const observed: number[] = [];
    const choice = (text: string) => ({
      id: "virtualized-recycled-card",
      bbox: { x: 40, y: 160, width: 680, height: 270 },
      previewText: text, questionTypeGuess: "single_choice" as const,
      confidence: 0.94, hasImage: false, source: "auto_dom" as const,
    });
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      observed.push(top);
      if (top === 0) return [choice(firstText)];
      if (top === 600) {
        return [choice(document.querySelector("[data-r21-next-mounted]") ? secondText : firstText)];
      }
      return top === 1200 ? [choice(thirdText)] : [];
    });
    // Step 2 begins at 600ms, after the 300ms scroll render pause. The
    // existing card remains visible but is replaced at 800ms, so "nonempty"
    // is not a reliable readiness signal on a recycled virtualized node.
    setTimeout(() => document.querySelector("main")!.append(
      Object.assign(document.createElement("article"), { id: "r21-mount-evidence" }),
    ), 800);
    setTimeout(() => document.getElementById("r21-mount-evidence")!.setAttribute(
      "data-r21-next-mounted", "",
    ), 800);
    // Mutation evidence must come from the DOM, not from an attribute alone.
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    const result = await scan;
    expect(observed).toEqual([0, 600, 600, 1200]);
    expect(result).toHaveLength(3);
    expect(result.map((v) => v.previewText)).toEqual([firstText, secondText, thirdText]);
    expect(result.filter((v) => v.previewText === firstText)).toHaveLength(1);
    expect(progress.map((p) => p.currentStep)).toEqual([1, 2, 3]);
    expect(progress.every((p) => p.totalScrollSteps === 3 && p.currentStep <= 3)).toBe(true);
    expect(top).toBe(200);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R21 retains a genuine repeated question on a separate page position", async () => {
    pageHeight = 1200;
    const previewText = "两处完全相同的题目哪项正确？ A. 检查安全 B. 放弃记录 C. 隐瞒异常 D. 忽略警报";
    const observed: number[] = [];
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      observed.push(top);
      return [{
        id: `r21-repeated-${top}`,
        bbox: { x: 45, y: 160, width: 660, height: 180 },
        previewText, questionTypeGuess: "single_choice" as const,
        confidence: 0.94, hasImage: false, source: "auto_dom" as const,
      }];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    const result = await scan;
    expect(observed).toEqual([0, 600]); // No DOM mutation: no second detect.
    expect(result).toHaveLength(2);
    expect(result.map((q) => q.bbox.y)).toEqual([160, 760]);
    expect(progress.map((p) => p.currentStep)).toEqual([1, 2]);
    expect(progress.every((p) => p.totalScrollSteps === 2)).toBe(true);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R21 STOP during recycled-card mutation window forbids stale scan progress", async () => {
    pageHeight = 1200;
    const first = {
      id: "r21-old-owner",
      bbox: { x: 40, y: 150, width: 680, height: 270 },
      previewText: "回收前的第一题应选什么？ A. 留存日志 B. 删除数据 C. 跳过检查 D. 忽略异常",
      questionTypeGuess: "single_choice" as const,
      confidence: 0.94, hasImage: false, source: "auto_dom" as const,
    };
    vi.mocked(detectCandidatesInViewport).mockReturnValue([first]);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.advanceTimersByTimeAsync(650); // Second viewport in its 650ms window.
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(2);
    cancelFullPageScan();
    document.querySelector("main")!.append(document.createElement("article"));
    await vi.runAllTimersAsync();
    expect(await scan).toHaveLength(1);
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenCalledTimes(2); // STOP forbids scroll restoration.
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R21 does not mistake two capped long previews for one recycled question", async () => {
    pageHeight = 1200;
    const prefix = "阅读并分析以下详细材料，判断给出的选项是否符合要求。".repeat(23);
    const first = prefix + " 第一问：应如何操作？ A. 检查设备 B. 跳过检查 C. 忽略异常 D. 删除日志";
    const second = prefix + " 第二问：应如何记录？ A. 保存凭证 B. 隐瞒异常 C. 放弃审计 D. 删除备份";
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => [{
      id: `r21-long-${top}`,
      bbox: { x: 40, y: 140, width: 680, height: 280 },
      previewText: top === 0 ? first : second,
      questionTypeGuess: "single_choice" as const,
      confidence: 0.93, hasImage: false, source: "auto_dom" as const,
    }]);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    const blocks = await scan;
    expect(prefix.length).toBeGreaterThan(420);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(2);
    expect(blocks).toHaveLength(2);
    expect(progress.map((p) => p.currentStep)).toEqual([1, 2]);
    expect(top).toBe(200);
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

  it("Issue102 R19 keeps scanning when a temporarily short scroll root regrows during candidate detection", async () => {
    pageHeight = 1800; // Immutable budget: 3 steps.
    const views: number[] = [];
    const makeQuestion = (n: number) => ({
      id: `r19-question-${n}`,
      bbox: { x: 40, y: 140, width: 680, height: 320 },
      previewText: `第${n}道安全操作题哪项符合要求？ A. 检查仪器 B. 删除记录 C. 忽略报警 D. 取消复核`,
      questionTypeGuess: "single_choice" as const,
      confidence: 0.95, source: "auto_dom" as const, hasImage: false,
    });
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      views.push(top);
      if (top === 0) {
        pageHeight = 1200; // SPA temporarily shrinks before the second sample.
        return [makeQuestion(1)];
      }
      if (top === 600) {
        pageHeight = 1800; // The second viewport looked like the bottom on entry.
        return [makeQuestion(2)];
      }
      return top === 1200 ? [makeQuestion(3)] : [];
    });

    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    const questions = await scan;

    expect(views).toEqual([0, 600, 1200]);
    expect(questions).toHaveLength(3);
    expect(questions.map((q) => q.previewText)).toEqual(expect.arrayContaining([
      expect.stringContaining("第1道安全操作题"),
      expect.stringContaining("第2道安全操作题"),
      expect.stringContaining("第3道安全操作题"),
    ]));
    expect(progress.map((p) => p.currentStep)).toEqual([1, 2, 3]);
    expect(progress.every((p) => p.totalScrollSteps === 3 && p.currentStep <= 3)).toBe(true);
    expect(progress.some((p) => p.budgetExhausted === true)).toBe(false);
    expect(top).toBe(200);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R19 observes regrowth during the bounded SPA readiness window without inventing steps", async () => {
    pageHeight = 1800; // Immutable budget: 3 steps.
    const visited: number[] = [];
    const makeQuestion = (n: number) => ({
      id: `r19-late-question-${n}`,
      bbox: { x: 40, y: 140, width: 680, height: 320 },
      previewText: `第${n}道现场考核题正确答案是哪项？ A. 核查设备 B. 随意操作 C. 丢弃日志 D. 忽视异常`,
      questionTypeGuess: "single_choice" as const,
      confidence: 0.95, source: "auto_dom" as const, hasImage: false,
    });
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      visited.push(top);
      if (top === 0) {
        pageHeight = 1200;
        return [makeQuestion(1)];
      }
      if (top === 600) return document.querySelector("[data-r19-spa-ready]") ? [makeQuestion(2)] : [];
      return top === 1200 ? [makeQuestion(3)] : [];
    });
    // After the second viewport enters its 650ms bounded unmarked SPA window,
    // question content mounts and the page expands again.
    setTimeout(() => {
      const ready = document.createElement("article");
      ready.setAttribute("data-r19-spa-ready", "");
      document.querySelector("main")!.append(ready);
      pageHeight = 1800;
    }, 850);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();

    expect((await scan).map((b) => b.previewText)).toHaveLength(3);
    expect(visited).toEqual([0, 600, 600, 1200]);
    expect(progress.map((p) => p.currentStep)).toEqual([1, 2, 3]);
    expect(progress.every((p) => p.totalScrollSteps === 3 && p.currentStep <= 3)).toBe(true);
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

  it("Issue102 R20 waits once for a delayed virtual-scroll position without a new scan step", async () => {
    pageHeight = 1200; // Fixed budget: 2 steps.
    const visited: number[] = [];
    scrollTo.mockImplementation((...args: unknown[]) => {
      const requested = (args[0] as ScrollToOptions).top ?? top;
      if (requested === 0 || requested === 200) {
        top = requested;
      } else {
        // The virtual page commits scroll after the ordinary 300ms render pause.
        setTimeout(() => { top = requested; }, 480);
      }
    });
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      visited.push(top);
      return [{
        id: `r20-delayed-question-${top}`,
        bbox: { x: 40, y: 150, width: 680, height: 300 },
        previewText: top === 0
          ? "第一道规范题中哪项正确？ A. 检查安全装置 B. 忽略告警 C. 跳过复核 D. 删除日志"
          : "第二道规范题中哪项正确？ A. 核验记录 B. 拒绝检查 C. 跳过监控 D. 隐瞒故障",
        questionTypeGuess: "single_choice" as const,
        confidence: 0.95, hasImage: false, source: "auto_dom" as const,
      }];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    const blocks = await scan;
    expect(visited).toEqual([0, 600]);
    expect(blocks).toHaveLength(2);
    expect(progress.map((p) => p.currentStep)).toEqual([1, 2]);
    expect(progress.every((p) => p.totalScrollSteps === 2 && !p.scrollStalled)).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(3); // Top, advance, restore; NO resend.
    expect(top).toBe(200);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R20 STOP during the delayed-scroll settle forbids late progress and restoration", async () => {
    pageHeight = 1200;
    scrollTo.mockImplementation((...args: unknown[]) => {
      const requested = (args[0] as ScrollToOptions).top ?? top;
      if (requested === 0) top = 0; // The later scroll remains blocked.
    });
    vi.mocked(detectCandidatesInViewport).mockReturnValue([{
      id: "r20-stop-first-question",
      bbox: { x: 40, y: 150, width: 680, height: 300 },
      previewText: "停止扫描前已识别的问题是哪项？ A. 保存记录 B. 删除数据 C. 跳过检查 D. 忽略告警",
      questionTypeGuess: "single_choice", confidence: 0.95, hasImage: false, source: "auto_dom",
    }]);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.advanceTimersByTimeAsync(650); // 300ms initial + 300ms step + 50ms settle.
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    cancelFullPageScan();
    await vi.runAllTimersAsync();
    expect(await scan).toHaveLength(1);
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(scrollTo).toHaveBeenCalledTimes(2); // No stale restore or scroll resend.
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
    // The viewport shrank to 240 during detection. Advancing by the old
    // 600px stride would skip an unobserved region [240, 600].
    expect(visited).toEqual([0, 240, 480]);
    expect(visited.slice(1).every((pos, i) => pos - visited[i] <= 240)).toBe(true);
    expect(progress.map(p => p.currentStep)).toEqual([1, 2, 3]);
    expect(progress.every(p => p.totalScrollSteps === 3)).toBe(true);
    expect(progress[2].budgetExhausted).toBe(true); // Shrink reduced coverage, not authority.
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R19 detects a question that an obsolete pre-resize stride would skip", async () => {
    pageHeight = 1800;
    const visited: number[] = [];
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      visited.push(top);
      if (top === 0) {
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 240 });
      }
      return top === 240 ? [{
        id: "r19-resize-question",
        bbox: { x: 40, y: 60, width: 680, height: 140 },
        previewText: "设备检查时以下哪项符合要求？ A. 上电前检查 B. 忽略异常 C. 跳过验证 D. 丢弃日志",
        questionTypeGuess: "single_choice" as const,
        confidence: 0.95, source: "auto_dom" as const, hasImage: false,
      }] : [];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    const candidates = await scan;
    expect(visited).toEqual([0, 240, 480]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].previewText).toContain("上电前检查");
    expect(progress.map(p => p.currentStep)).toEqual([1, 2, 3]);
    expect(progress.every(p => p.totalScrollSteps === 3 && p.currentStep <= 3)).toBe(true);
    expect(progress[2].budgetExhausted).toBe(true);
    expect(top).toBe(200);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R14 keeps two distant reading questions with the same first 96 characters", async () => {
    pageHeight = 1800; // scan positions 0, 600 and 1200
    const sharedMaterial = "阅读下面的材料，分析其中的实验步骤与观察记录。".repeat(8);
    const first = sharedMaterial + " 第一问：哪项准备正确？ A. 检查设备 B. 跳过检查 C. 忽略异常 D. 放弃记录";
    const second = sharedMaterial + " 第二问：哪项记录正确？ A. 随意删改 B. 保留原始数据 C. 混合样本 D. 忽略时间";
    expect(sharedMaterial.length).toBeGreaterThan(96);
    expect(first.slice(0, 96)).toBe(second.slice(0, 96));
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

  it("Issue102 R15 keeps adjacent questions sharing a 96-character reading stem", async () => {
    pageHeight = 1200;
    const material = "阅读实验记录，比较采样步骤并分析数据可靠性。".repeat(8);
    const first = material + " 第一题：如何提高准确性？ A. 校准仪器 B. 省略校准 C. 随意修改 D. 丢弃样本";
    const second = material + " 第二题：如何保存记录？ A. 擅自删除 B. 如实记录 C. 隐藏异常 D. 不写日期";
    expect(material.length).toBeGreaterThan(96);
    expect(first.slice(0, 96)).toBe(second.slice(0, 96));
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => top === 0 ? [
      {
        id: "near-reading-one", bbox: { x: 40, y: 130, width: 680, height: 130 },
        previewText: first, questionTypeGuess: "single_choice",
        confidence: 0.93, hasImage: false, source: "auto_dom",
      },
      {
        id: "near-reading-two", bbox: { x: 40, y: 365, width: 680, height: 130 },
        previewText: second, questionTypeGuess: "single_choice",
        confidence: 0.94, hasImage: false, source: "auto_dom",
      },
    ] : []);
    const progress: ScanProgress[] = [];
    const run = detectCandidatesFullPage(p => progress.push(p));
    await vi.runAllTimersAsync();
    const candidates = await run;
    expect(candidates).toHaveLength(2);
    expect(candidates.map(c => c.previewText)).toEqual(expect.arrayContaining([first, second]));
    expect(candidates.map(c => c.bbox.y)).toEqual([130, 365]);
    expect(progress.map(p => p.currentStep)).toEqual([1, 2]);
    expect(top).toBe(200);
  });

  it("Issue102 R15 preserves separate repeated questions with identical text", async () => {
    pageHeight = 1200;
    const text = "以下哪个选项符合校园实验室操作规范？ A. 操作前检查 B. 忽略异常 C. 强制跳过 D. 无视警告";
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => top === 0 ? [
      {
        id: "repeated-question-one", bbox: { x: 50, y: 140, width: 670, height: 135 },
        previewText: text, questionTypeGuess: "single_choice",
        confidence: 0.92, hasImage: false, source: "auto_dom",
      },
      {
        id: "repeated-question-two", bbox: { x: 50, y: 365, width: 670, height: 135 },
        previewText: text, questionTypeGuess: "single_choice",
        confidence: 0.92, hasImage: false, source: "auto_dom",
      },
    ] : []);
    const run = detectCandidatesFullPage(() => undefined);
    await vi.runAllTimersAsync();
    const candidates = await run;
    expect(candidates).toHaveLength(2);
    expect(candidates.map(c => c.bbox.y)).toEqual([140, 365]);
    expect(top).toBe(200);
  });

  it("Issue102 R15 still merges the same overlapping candidate with minor geometry drift", async () => {
    pageHeight = 1200;
    const text = "下面哪种做法能保证实验安全？ A. 正确接地 B. 拆除护罩 C. 跳过预检 D. 忽略故障";
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => top === 0 ? [
      {
        id: "first-geometry", bbox: { x: 45, y: 160, width: 670, height: 260 },
        previewText: text, questionTypeGuess: "single_choice",
        confidence: 0.92, hasImage: false, source: "auto_dom",
      },
      {
        id: "shifted-geometry", bbox: { x: 45, y: 310, width: 670, height: 260 },
        previewText: text, questionTypeGuess: "single_choice",
        confidence: 0.94, hasImage: false, source: "auto_dom",
      },
    ] : []);
    const run = detectCandidatesFullPage(() => undefined);
    await vi.runAllTimersAsync();
    expect(await run).toHaveLength(1);
    expect(top).toBe(200);
  });

  it("Issue102 R16 keeps two strongly overlapping question regions when their texts differ", async () => {
    pageHeight = 1200;
    const stem = "请阅读实验调查说明并依据内容完成以下选择题：".repeat(4);
    const first = stem + " 第一题，记录步骤应选什么？ A. 校验 B. 随意 C. 忽视 D. 丢弃";
    const second = stem + " 第二题，实验结果应如何保存？ A. 隐瞒 B. 造假 C. 原样留存 D. 删除";
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => top === 0 ? [
      {
        id: "large-reading-parent", bbox: { x: 40, y: 140, width: 690, height: 340 },
        previewText: first, questionTypeGuess: "single_choice",
        confidence: 0.91, hasImage: false, source: "auto_dom",
      },
      {
        id: "nested-reading-question", bbox: { x: 50, y: 160, width: 650, height: 300 },
        previewText: second, questionTypeGuess: "single_choice",
        confidence: 0.93, hasImage: false, source: "auto_dom",
      },
    ] : []);
    const run = detectCandidatesFullPage(() => undefined);
    await vi.runAllTimersAsync();
    const found = await run;
    expect(found).toHaveLength(2);
    expect(found.map(x => x.previewText)).toEqual(expect.arrayContaining([first, second]));
    expect(top).toBe(200);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R16 merges identical text despite strong bbox nesting", async () => {
    pageHeight = 1200;
    const text = "哪项操作能够保证校园实验规范？ A. 检查 B. 断线 C. 跳过 D. 忽略";
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => top === 0 ? [
      {
        id: "same-large", bbox: { x: 40, y: 140, width: 690, height: 340 },
        previewText: text, questionTypeGuess: "single_choice",
        confidence: 0.91, hasImage: false, source: "auto_dom",
      },
      {
        id: "same-nested", bbox: { x: 50, y: 160, width: 650, height: 300 },
        previewText: text, questionTypeGuess: "single_choice",
        confidence: 0.93, hasImage: false, source: "auto_dom",
      },
    ] : []);
    const run = detectCandidatesFullPage(() => undefined);
    await vi.runAllTimersAsync();
    expect(await run).toHaveLength(1);
    expect(top).toBe(200);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R16 keeps dedup when strongly overlapping text varies only in whitespace", async () => {
    pageHeight = 1200;
    const plain = "校园实验中如何安全操作？ A. 先检查 B. 乱接线 C. 取消预检 D. 忽略故障";
    const multiline = "校园实验中如何安全操作？  A. 先检查\n B. 乱接线  C. 取消预检\n D. 忽略故障";
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => top === 0 ? [
      {
        id: "same-first", bbox: { x: 40, y: 140, width: 690, height: 340 },
        previewText: plain, questionTypeGuess: "single_choice",
        confidence: 0.91, hasImage: false, source: "auto_dom",
      },
      {
        id: "same-second", bbox: { x: 50, y: 160, width: 650, height: 300 },
        previewText: multiline, questionTypeGuess: "single_choice",
        confidence: 0.93, hasImage: false, source: "auto_dom",
      },
    ] : []);
    const run = detectCandidatesFullPage(() => undefined);
    await vi.runAllTimersAsync();
    expect(await run).toHaveLength(1);
    expect(top).toBe(200);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R17 keeps high-overlap correct/incorrect questions despite high Bigram similarity", async () => {
    pageHeight = 1200;
    const shared = "阅读下面的自然科学调查分析、实验原理、定量测量和安全操作材料，依据观察记录与统计结果选择合适的结论。".repeat(5);
    const first = shared + "以下说法哪项正确？ A. 检查设备 B. 保持记录 C. 关注安全 D. 遵守规程";
    const second = shared + "以下说法哪项错误？ A. 检查设备 B. 保持记录 C. 关注安全 D. 遵守规程";
    expect(first).not.toBe(second);
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => top === 0 ? [
      {
        id: "correct-choice", bbox: { x: 40, y: 140, width: 690, height: 340 },
        previewText: first, questionTypeGuess: "single_choice",
        confidence: 0.95, hasImage: false, source: "auto_dom",
      },
      {
        id: "incorrect-choice", bbox: { x: 50, y: 160, width: 650, height: 300 },
        previewText: second, questionTypeGuess: "single_choice",
        confidence: 0.95, hasImage: false, source: "auto_dom",
      },
    ] : []);
    const progress: ScanProgress[] = [];
    const run = detectCandidatesFullPage(p => progress.push(p));
    await vi.runAllTimersAsync();
    const blocks = await run;
    expect(blocks).toHaveLength(2);
    expect(blocks.map(b => b.previewText)).toEqual(expect.arrayContaining([first, second]));
    expect(progress.map(p => p.currentStep)).toEqual([1, 2]);
    expect(top).toBe(200);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R17 retains distinct one-character option variants inside overlapping reading cards", async () => {
    pageHeight = 1200;
    const shared = "根据考试研究材料、实验设备检测记录和安全评价报告，分析下列装置的正确操作步骤。".repeat(5);
    const first = shared + "应当如何操作？ A. 设备检查 B. 数据记录 C. 程序复核 D. 安全校验";
    const second = shared + "应当如何操作？ A. 设备检查 B. 数据记录 C. 程序复核 D. 安全检验";
    expect(first).not.toBe(second);
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => top === 0 ? [
      {
        id: "option-variant-one", bbox: { x: 40, y: 140, width: 690, height: 340 },
        previewText: first, questionTypeGuess: "single_choice",
        confidence: 0.94, hasImage: false, source: "auto_dom",
      },
      {
        id: "option-variant-two", bbox: { x: 50, y: 160, width: 650, height: 300 },
        previewText: second, questionTypeGuess: "single_choice",
        confidence: 0.94, hasImage: false, source: "auto_dom",
      },
    ] : []);
    const run = detectCandidatesFullPage(() => undefined);
    await vi.runAllTimersAsync();
    const blocks = await run;
    expect(blocks).toHaveLength(2);
    expect(blocks.map(b => b.previewText)).toEqual(expect.arrayContaining([first, second]));
    expect(top).toBe(200);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R17 guards question differences beyond the DOM 420-character preview cap", async () => {
    pageHeight = 1200;
    const shared = "阅读材料并判断实验记录。 A. 检查 B. 记录 C. 审核 D. 报告 " +
      "以下为同一阅读材料的背景数据、定量信息和操作说明。".repeat(25);
    const first = shared + "以下陈述正确吗？";
    const second = shared + "以下陈述错误吗？";
    const publishedPreview = first.slice(0, 420);
    expect(first.length).toBeGreaterThan(420);
    expect(second.slice(0, 420)).toBe(publishedPreview);
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => top === 0 ? [
      {
        id: "long-first", bbox: { x: 40, y: 140, width: 690, height: 340 },
        previewText: publishedPreview, identitySourceText: first,
        questionTypeGuess: "single_choice", confidence: 0.95,
        hasImage: false, source: "auto_dom",
      },
      {
        id: "long-second", bbox: { x: 50, y: 160, width: 650, height: 300 },
        previewText: publishedPreview, identitySourceText: second,
        questionTypeGuess: "single_choice", confidence: 0.95,
        hasImage: false, source: "auto_dom",
      },
    ] : []);
    const run = detectCandidatesFullPage(() => undefined);
    await vi.runAllTimersAsync();
    const blocks = await run;
    expect(blocks).toHaveLength(2);
    expect(blocks.map(b => b.identitySourceText)).toEqual(expect.arrayContaining([first, second]));
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R17 retains capped previews without comparable full source authority", async () => {
    pageHeight = 1200;
    const preview = "以下说法正确的是？ A. 检查 B. 记录 C. 审核 D. 报告 " +
      "无可信完整题目身份时不得依据截断预览删除候选。".repeat(30);
    const capped = preview.slice(0, 420);
    expect(capped).toHaveLength(420);
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => top === 0 ? [
      {
        id: "missing-source", bbox: { x: 40, y: 140, width: 690, height: 340 },
        previewText: capped, questionTypeGuess: "single_choice",
        confidence: 0.95, hasImage: false, source: "auto_dom",
      },
      {
        id: "also-missing-source", bbox: { x: 50, y: 160, width: 650, height: 300 },
        previewText: capped, questionTypeGuess: "single_choice",
        confidence: 0.95, hasImage: false, source: "auto_dom",
      },
    ] : []);
    const run = detectCandidatesFullPage(() => undefined);
    await vi.runAllTimersAsync();
    expect(await run).toHaveLength(2);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("Issue102 R17 still deduplicates identical complete source despite capped preview", async () => {
    pageHeight = 1200;
    const full = "以下说法正确的是？ A. 检查 B. 记录 C. 审核 D. 报告 " +
      "同一道长题卡在相邻采样视口中应只保留一份。".repeat(30);
    const capped = full.slice(0, 420);
    expect(full.length).toBeGreaterThan(420);
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => top === 0 ? [
      {
        id: "same-one", bbox: { x: 40, y: 140, width: 690, height: 340 },
        previewText: capped, identitySourceText: full,
        questionTypeGuess: "single_choice", confidence: 0.95,
        hasImage: false, source: "auto_dom",
      },
      {
        id: "same-two", bbox: { x: 50, y: 160, width: 650, height: 300 },
        previewText: capped, identitySourceText: full,
        questionTypeGuess: "single_choice", confidence: 0.95,
        hasImage: false, source: "auto_dom",
      },
    ] : []);
    const run = detectCandidatesFullPage(() => undefined);
    await vi.runAllTimersAsync();
    expect(await run).toHaveLength(1);
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
