import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectCandidatesInViewport } from "./domDetector";
import {
  cancelFullPageScan,
  detectCandidatesFullPage,
  isFullPageScanRunning,
  resolveFullPageScrollRoot,
  type ScanProgress,
} from "./fullPageDetector";

vi.mock("./domDetector", () => ({ detectCandidatesInViewport: vi.fn(() => []) }));

describe("Issue #102 R26: hidden SPA scroll panes cannot own a full-page scan", () => {
  function setPaneMetrics(pane: HTMLElement, scrollHeight: number, top = 20): void {
    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: scrollHeight });
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 600 });
    Object.defineProperty(pane, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ x: 20, y: top, left: 20, top, right: 920, bottom: top + 600, width: 900, height: 600 }),
    });
  }

  function twoPanes(hiddenParent: string, hiddenChild = ""): { cached: HTMLElement; live: HTMLElement } {
    document.body.innerHTML = `
      <section id="cached-owner" ${hiddenParent}>
        <div id="cached-scroll" ${hiddenChild} style="overflow-y:auto;height:600px">
          <article class="question-item">旧题哪项正确？ A.甲 B.乙 C.丙 D.丁</article>
        </div>
      </section>
      <main id="live-scroll" style="overflow-y:auto;height:600px">
        <article class="question-item">当前题哪项正确？ A.甲 B.乙 C.丙 D.丁</article>
      </main>
    `;
    const cached = document.getElementById("cached-scroll")!;
    const live = document.getElementById("live-scroll")!;
    // Cached pane would win if its visibility were not checked: both hold
    // recognized question markers, and the stale pane has a larger scroll span.
    setPaneMetrics(cached, 9000);
    setPaneMetrics(live, 1800);
    return { cached, live };
  }

  beforeEach(() => {
    vi.mocked(detectCandidatesInViewport).mockReset().mockReturnValue([]);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1100 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cancelFullPageScan();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("R26-01 rejects a [hidden] cached question pane despite its larger question-bearing scroll region", () => {
    const { cached, live } = twoPanes("hidden");
    expect(cached.isConnected).toBe(true);
    expect(resolveFullPageScrollRoot()).toBe(live);
  });

  it("R26-02 rejects a pane hidden by an ancestor display:none rather than its own style", () => {
    const { live } = twoPanes('style="display:none"');
    expect(resolveFullPageScrollRoot()).toBe(live);
  });

  it("R26-03 rejects an aria-hidden ancestor's cached questions as scan scroll authority", () => {
    const { live } = twoPanes('aria-hidden="true"');
    expect(resolveFullPageScrollRoot()).toBe(live);
  });

  it("R26-04 rejects an inert ancestor's cached pane while allowing the visible question pane", () => {
    const { live } = twoPanes("inert");
    expect(resolveFullPageScrollRoot()).toBe(live);
  });

  it("R26-05 rejects an ancestor visibility:hidden pane even when its rectangle remains nonzero", () => {
    const { live } = twoPanes('style="visibility:hidden"');
    expect(resolveFullPageScrollRoot()).toBe(live);
  });

  it("R26-06 keeps aria-hidden=false panes eligible rather than rejecting every aria-hidden attribute", () => {
    const { cached } = twoPanes('aria-hidden="false"');
    // The visible cached pane has the larger legitimate scroll region;
    // rejecting all aria-hidden values would incorrectly select the live pane.
    expect(resolveFullPageScrollRoot()).toBe(cached);
  });

  it("R26-06B accepts an explicitly visible child overriding inherited CSS visibility:hidden", () => {
    const { cached } = twoPanes('style="visibility:hidden"');
    cached.style.visibility = "visible";
    expect(resolveFullPageScrollRoot()).toBe(cached);
  });

  it("R26-07 uses window when the only eligible-looking pane is hidden", () => {
    document.body.innerHTML = '<div hidden><section id="stale" style="overflow-y:auto;height:600px"><article class="question-item">历史题</article></section></div>';
    setPaneMetrics(document.getElementById("stale")!, 8000);
    expect(resolveFullPageScrollRoot()).toBe(window);
  });

  it("R26-08 scans and restores only the live pane, never touching the hidden historical pane", async () => {
    vi.useFakeTimers();
    const { cached, live } = twoPanes("hidden");
    let liveTop = 120;
    let cachedTop = 410;
    Object.defineProperty(live, "scrollTop", { configurable: true, get: () => liveTop });
    Object.defineProperty(cached, "scrollTop", { configurable: true, get: () => cachedTop });
    Object.defineProperty(live, "scrollLeft", { configurable: true, value: 0 });
    Object.defineProperty(cached, "scrollLeft", { configurable: true, value: 0 });
    const liveScroll = vi.fn((options: ScrollToOptions) => {
      liveTop = Math.min(Math.max(0, options.top ?? liveTop), 1200);
    });
    const cachedScroll = vi.fn((options: ScrollToOptions) => {
      cachedTop = options.top ?? cachedTop;
    });
    Object.defineProperty(live, "scrollTo", { configurable: true, value: liveScroll });
    Object.defineProperty(cached, "scrollTo", { configurable: true, value: cachedScroll });
    const visited: number[] = [];
    vi.mocked(detectCandidatesInViewport).mockImplementation(() => {
      visited.push(liveTop);
      return liveTop === 600 ? [{
        id: "r26-live-question",
        bbox: { x: 50, y: 120, width: 650, height: 250 },
        previewText: "现场设备安全检查哪种做法正确？ A. 核查装置 B. 忽略故障 C. 略过确认 D. 丢弃日志",
        questionTypeGuess: "single_choice" as const,
        confidence: 0.95, hasImage: false, source: "auto_dom" as const,
      }] : [];
    });
    const progress: ScanProgress[] = [];
    const scan = detectCandidatesFullPage((p) => progress.push(p));
    await vi.runAllTimersAsync();
    const blocks = await scan;
    expect(blocks).toHaveLength(1);
    expect(visited).toEqual([0, 600, 1200]);
    expect(progress.map((p) => p.currentStep)).toEqual([1, 2, 3]);
    expect(progress.every((p) => p.totalScrollSteps === 3 && p.currentStep <= 3)).toBe(true);
    expect(liveTop).toBe(120);
    expect(cachedTop).toBe(410);
    expect(cachedScroll).not.toHaveBeenCalled();
    expect(liveScroll).toHaveBeenCalledTimes(4); // initial, two steps, restore
    expect(isFullPageScanRunning()).toBe(false);
  });
});
