import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelFullPageScan,
  detectCandidatesFullPage,
  isFullPageScanRunning,
} from "./fullPageDetector";
import { refineFullPageCandidatesViaManualPipeline } from "../fullPagePlan";

vi.mock("./domDetector", () => ({ detectCandidatesInViewport: vi.fn(() => []) }));

describe("Phase14B-02C-E2 Full Page scroll lease and cancellation", () => {
  let top = 820;
  let left = 23;
  let scrollTo: unknown;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "<main>Scroll lease fixture</main>";
    top = 820;
    left = 23;
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => top });
    Object.defineProperty(window, "scrollX", { configurable: true, get: () => left });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    Object.defineProperty(document.body, "scrollHeight", { configurable: true, value: 2500 });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 2500 });
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
      const options = args[0] as ScrollToOptions;
      top = options.top ?? top;
      left = options.left ?? left;
    });
  });

  afterEach(() => {
    cancelFullPageScan();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("E2_SCAN_01 STOP during first render pause cannot restore or scan old page", async () => {
    const progress = vi.fn();
    const run = detectCandidatesFullPage(progress);
    expect(isFullPageScanRunning()).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    cancelFullPageScan();
    expect(isFullPageScanRunning()).toBe(false);
    top = 444; // user scrolls after STOP
    await vi.advanceTimersByTimeAsync(300);
    await run;
    expect(progress).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(top).toBe(444);
  });

  it("E2_SCAN_02 STOP during later scroll pause does not restore original position", async () => {
    const progress = vi.fn();
    const run = detectCandidatesFullPage(progress);
    await vi.advanceTimersByTimeAsync(300);
    expect(progress).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledTimes(2);
    cancelFullPageScan();
    top = 376; // user moves to a new reading position
    await vi.advanceTimersByTimeAsync(300);
    await run;
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(top).toBe(376);
  });

  it("E2_SCAN_03 cancellation inside progress callback prohibits next scroll", async () => {
    const progress = vi.fn(() => cancelFullPageScan());
    const run = detectCandidatesFullPage(progress);
    await vi.advanceTimersByTimeAsync(300);
    await run;
    expect(progress).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("E2_SCAN_04 route or generation loss releases old scan; old finally cannot clear replacement", async () => {
    let oldCurrent = true;
    const oldRun = detectCandidatesFullPage(vi.fn(), () => oldCurrent);
    oldCurrent = false; // route epoch / generation invalidated without explicit cancel
    expect(isFullPageScanRunning()).toBe(false);

    const newRun = detectCandidatesFullPage(vi.fn(), () => true);
    expect(isFullPageScanRunning()).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300);
    await oldRun;
    // The new scan is still in its own loop: old finally did not clear its slot.
    expect(isFullPageScanRunning()).toBe(true);
    await vi.runAllTimersAsync();
    await newRun;
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("E2_SCAN_05 a normally completed, current scan restores its own scroll position", async () => {
    const originalTop = top;
    const originalLeft = left;
    const progress = vi.fn();
    const run = detectCandidatesFullPage(progress);
    await vi.runAllTimersAsync();
    await run;
    expect(progress).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: originalTop, left: originalLeft, behavior: "instant",
    });
    expect(isFullPageScanRunning()).toBe(false);
  });

  it("E2_REFINE_01 cancelled secondary refinement cannot restore a stale scroll", async () => {
    let release!: () => void;
    let current = true;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const candidate = { id: "q1", bbox: { x: 0, y: 900, width: 330, height: 90 }, previewText: "What is B?" };
    const setScrollPosition = vi.fn();
    const deps = {
      resolveFullPageScrollRoot: () => window,
      getScrollTop: () => 820,
      getScrollLeft: () => 23,
      setScrollPosition,
      pauseFullPage: () => pending,
      autoSolveStopRequested: () => false,
      isRuntimeCurrent: () => current,
    } as unknown as Parameters<typeof refineFullPageCandidatesViaManualPipeline>[1];
    const run = refineFullPageCandidatesViaManualPipeline([candidate] as never, deps);
    expect(setScrollPosition).toHaveBeenCalledOnce();
    current = false;
    release();
    expect(await run).toEqual([]);
    expect(setScrollPosition).toHaveBeenCalledTimes(1);
  });

  it("E2_REFINE_02 valid refinement keeps the original restore behavior", async () => {
    const candidate = { id: "q2", bbox: { x: 0, y: 900, width: 330, height: 90 }, previewText: "Which answer is B?" };
    const setScrollPosition = vi.fn();
    const deps = {
      resolveFullPageScrollRoot: () => window,
      getScrollTop: () => 820,
      getScrollLeft: () => 23,
      setScrollPosition,
      pauseFullPage: async () => {},
      autoSolveStopRequested: () => false,
      isRuntimeCurrent: () => true,
      refineViewportCandidate: () => ({
        finalViewportBBox: candidate.bbox,
        hasImage: false,
        imageUrl: undefined,
        matchedCandidate: null,
        matchedVisibleCandidate: null,
        previewText: candidate.previewText,
        typeGuess: "unknown",
      }),
      projectViewportBboxToAbsolute: (bbox: unknown) => bbox,
      getAutoSolveTextFingerprint: () => "q2",
      extractAutoSolveQuestionOrder: () => 2,
    } as unknown as Parameters<typeof refineFullPageCandidatesViaManualPipeline>[1];
    const result = await refineFullPageCandidatesViaManualPipeline([candidate] as never, deps);
    expect(result).toHaveLength(1);
    expect(setScrollPosition).toHaveBeenLastCalledWith(window, 820, 23);
    expect(setScrollPosition).toHaveBeenCalledTimes(2);
  });
});
