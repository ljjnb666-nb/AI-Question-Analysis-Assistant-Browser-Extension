import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectCandidatesInViewport } from "./domDetector";
import {
  cancelFullPageScan,
  detectCandidatesFullPage,
  isFullPageScanRunning,
  type ScanProgress,
} from "./fullPageDetector";

vi.mock("./domDetector", () => ({ detectCandidatesInViewport: vi.fn(() => []) }));

describe("Issue #102 R24: disclosure-only SPA readiness, bounded by the original scan lease", () => {
  let top: number;
  let scrollTo: ReturnType<typeof vi.spyOn>;

  const question = (n: number) => ({
    id: `r24-question-${n}`,
    bbox: { x: 40, y: n === 1 ? 80 : 325, width: 660, height: 165 },
    previewText: `第${n}题：哪项操作符合实验安全要求？ A. 检查设备 B. 跳过检查 C. 忽略报警 D. 删除记录`,
    questionTypeGuess: "single_choice" as const,
    source: "auto_dom" as const,
    confidence: 0.94,
    hasImage: false,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(detectCandidatesInViewport).mockReset().mockReturnValue([]);
    document.body.innerHTML = "<main></main>";
    top = 0;
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => top });
    Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    Object.defineProperty(document.body, "scrollHeight", { configurable: true, value: 600 });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 600 });
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
      const options = args[0] as ScrollToOptions;
      top = options.top ?? top;
    });
  });

  afterEach(() => {
    cancelFullPageScan();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("R24-01 sees a pre-mounted native details question revealed by open-only change", async () => {
    document.querySelector("main")!.innerHTML = "<details><summary>展开题目</summary><article>选项已存在</article></details>";
    const details = document.querySelector("details")!;
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => details.open ? [question(1)] : []);
    const progress: ScanProgress[] = [];
    const run = detectCandidatesFullPage((p) => progress.push(p));
    setTimeout(() => { details.open = true; }, 450);
    await vi.runAllTimersAsync();
    expect((await run).map((b) => b.id)).toHaveLength(1);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(2);
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(progress[0]?.totalScrollSteps).toBe(1);
    expect(progress[0]?.budgetExhausted).toBeUndefined();
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R24-02 sees a CSS disclosure driven only by aria-expanded", async () => {
    document.querySelector("main")!.innerHTML = '<section aria-expanded="false"><article>预挂载的题目</article></section>';
    const section = document.querySelector("section")!;
    vi.mocked(detectCandidatesInViewport).mockImplementation(() =>
      section.getAttribute("aria-expanded") === "true" ? [question(1)] : []);
    const progress: ScanProgress[] = [];
    const run = detectCandidatesFullPage((p) => progress.push(p));
    setTimeout(() => { section.setAttribute("aria-expanded", "true"); }, 450);
    await vi.runAllTimersAsync();
    expect((await run)).toHaveLength(1);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(2);
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R24-03 does not miss a late second details question after a valid first card", async () => {
    document.querySelector("main")!.innerHTML = '<article>第一题</article><details><summary>下一题</summary><article>第二题</article></details>';
    const details = document.querySelector("details")!;
    vi.mocked(detectCandidatesInViewport).mockImplementation(() =>
      [question(1), ...(details.open ? [question(2)] : [])]);
    const progress: ScanProgress[] = [];
    const run = detectCandidatesFullPage((p) => progress.push(p));
    setTimeout(() => { details.open = true; }, 450);
    await vi.runAllTimersAsync();
    const blocks = await run;
    expect(blocks).toHaveLength(2);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(2);
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(progress[0]?.totalScrollSteps).toBe(1);
    expect(top).toBe(0);
  });

  it("R24-04 STOP while observing a disclosure forbids retry, progress and scroll restoration", async () => {
    document.querySelector("main")!.innerHTML = "<details><summary>题目</summary><article>正文</article></details>";
    const details = document.querySelector("details")!;
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => details.open ? [question(1)] : []);
    const progress: ScanProgress[] = [];
    const run = detectCandidatesFullPage((p) => progress.push(p));
    await vi.advanceTimersByTimeAsync(350);
    expect(isFullPageScanRunning()).toBe(true);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    cancelFullPageScan();
    details.open = true;
    await vi.runAllTimersAsync();
    expect(await run).toEqual([]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    expect(progress).toHaveLength(0);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R24-05 does not promote extension-overlay open/aria-expanded churn into site readiness", async () => {
    const overlay = document.createElement("div");
    overlay.id = "qs-overlay-root";
    document.body.append(overlay);
    const progress: ScanProgress[] = [];
    const run = detectCandidatesFullPage((p) => progress.push(p));
    setTimeout(() => {
      overlay.setAttribute("open", "");
      overlay.setAttribute("aria-expanded", "true");
    }, 450);
    await vi.runAllTimersAsync();
    expect(await run).toEqual([]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(progress[0]?.totalScrollSteps).toBe(1);
    expect(isFullPageScanRunning()).toBe(false);
  });
});
