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
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("stops when a scroll trap prevents forward motion instead of scanning the same view", async () => {
    // A site intercepts window.scrollTo and ignores every request.
    scrollTo.mockImplementation(() => undefined);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    await scan;
    expect(progress).toHaveLength(1);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    expect(progress[0].currentStep).toBe(1);
    expect(progress[0].totalScrollSteps).toBe(15);
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
