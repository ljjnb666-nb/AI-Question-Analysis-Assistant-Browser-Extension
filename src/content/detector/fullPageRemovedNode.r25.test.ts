import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectCandidatesInViewport } from "./domDetector";
import {
  cancelFullPageScan, detectCandidatesFullPage, isFullPageScanRunning, type ScanProgress,
} from "./fullPageDetector";

vi.mock("./domDetector", () => ({ detectCandidatesInViewport: vi.fn(() => []) }));

describe("Issue #102 R25: removed DOM node ownership during bounded readiness", () => {
  let top: number;
  let scrollTo: ReturnType<typeof vi.spyOn>;

  const question = (n: number) => ({
    id: `r25-question-${n}`,
    bbox: { x: 40, y: n === 1 ? 80 : 320, width: 660, height: 170 },
    previewText: `第${n}题：哪项操作符合实验安全规范？ A. 检查设备 B. 略过检测 C. 忽略告警 D. 删除记录`,
    questionTypeGuess: "single_choice" as const, source: "auto_dom" as const,
    confidence: 0.94, hasImage: false,
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
      top = (args[0] as ScrollToOptions).top ?? top;
    });
  });
  afterEach(() => {
    cancelFullPageScan();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("R25-01 reprobes a mounted question when the site's only loading text node is removed", async () => {
    const main = document.querySelector("main")!;
    const placeholder = document.createTextNode("加载中");
    main.append(placeholder, document.createElement("article"));
    vi.mocked(detectCandidatesInViewport).mockImplementation(() =>
      main.contains(placeholder) ? [] : [question(1)]);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    setTimeout(() => { main.removeChild(placeholder); }, 450);
    await vi.runAllTimersAsync();
    expect(await scan).toHaveLength(1);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(2);
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(progress[0]?.totalScrollSteps).toBe(1);
    expect(progress[0]?.budgetExhausted).toBeUndefined();
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R25-02 finds a later same-viewport question exposed by text removal at apparent bottom", async () => {
    const main = document.querySelector("main")!;
    main.append(document.createElement("article"));
    const placeholder = document.createTextNode("加载第二题");
    main.append(placeholder, document.createElement("article"));
    vi.mocked(detectCandidatesInViewport).mockImplementation(() =>
      [question(1), ...(!main.contains(placeholder) ? [question(2)] : [])]);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    setTimeout(() => { main.removeChild(placeholder); }, 450);
    await vi.runAllTimersAsync();
    expect(await scan).toHaveLength(2);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(2);
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(progress[0]?.totalScrollSteps).toBe(1);
    expect(top).toBe(0);
  });

  it("R25-03 ignores removal of a detached unmarked child from the extension's own overlay", async () => {
    const overlay = document.createElement("div");
    overlay.id = "qs-floating-host";
    const child = document.createElement("span"); // No qs- identifier of its own.
    overlay.append(child);
    document.body.append(overlay);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    setTimeout(() => { overlay.removeChild(child); }, 450);
    await vi.runAllTimersAsync();
    expect(await scan).toEqual([]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
    expect(progress[0]?.totalScrollSteps).toBe(1);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R25-04 STOP during site-text removal cannot emit stale probe, progress or scroll restoration", async () => {
    const main = document.querySelector("main")!;
    const placeholder = document.createTextNode("加载中");
    main.append(placeholder, document.createElement("article"));
    vi.mocked(detectCandidatesInViewport).mockImplementation(() =>
      main.contains(placeholder) ? [] : [question(1)]);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.advanceTimersByTimeAsync(350);
    expect(isFullPageScanRunning()).toBe(true);
    cancelFullPageScan();
    const scrollsAtStop = scrollTo.mock.calls.length;
    main.removeChild(placeholder);
    await vi.runAllTimersAsync();
    expect(await scan).toEqual([]);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(1);
    expect(progress).toHaveLength(0);
    expect(scrollTo).toHaveBeenCalledTimes(scrollsAtStop);
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("R25-05 ordinary removed site element remains a readiness signal", async () => {
    const main = document.querySelector("main")!;
    const placeholder = document.createElement("p");
    placeholder.textContent = "加载中";
    main.append(placeholder, document.createElement("article"));
    vi.mocked(detectCandidatesInViewport).mockImplementation(() =>
      main.contains(placeholder) ? [] : [question(1)]);
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    setTimeout(() => { placeholder.remove(); }, 450);
    await vi.runAllTimersAsync();
    expect(await scan).toHaveLength(1);
    expect(vi.mocked(detectCandidatesInViewport)).toHaveBeenCalledTimes(2);
    expect(progress.map((p) => p.currentStep)).toEqual([1]);
  });
});
