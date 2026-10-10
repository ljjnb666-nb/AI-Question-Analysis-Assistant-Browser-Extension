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
    top = 200;
    pageHeight = 9000; // (9000 - 600) / 600 + 1 = 15 expected steps
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => top });
    Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    Object.defineProperty(document.body, "scrollHeight", { configurable: true, get: () => pageHeight });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => pageHeight });
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((options: ScrollToOptions) => {
      top = Math.min(Math.max(0, options.top ?? top), Math.max(0, pageHeight - 600));
    });
  });

  afterEach(() => {
    cancelFullPageScan();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
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
