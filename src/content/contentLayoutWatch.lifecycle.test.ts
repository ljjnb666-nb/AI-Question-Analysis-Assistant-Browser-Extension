import { afterEach, describe, expect, it, vi } from "vitest";
import { createLayoutWatchController } from "./contentLayoutWatch";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

describe("layout watch lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("P10B-LAYOUT-01 disconnects the observer and clears pending rescan work", () => {
    vi.useFakeTimers();
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const onRefreshFullPage = vi.fn();
    const onRefreshViewport = vi.fn();
    const controller = createLayoutWatchController({
      getActiveCandidatesCount: () => 2,
      getActiveDetectMode: () => "fullpage",
      getHighlightLayerPresent: () => true,
      getLastFullPageLayoutKey: () => "old",
      getFullPageLayoutKey: () => "new",
      onRefreshFullPage,
      onRefreshViewport,
      resolveFullPageScrollRoot: () => document.documentElement,
      setLastFullPageLayoutKey: vi.fn(),
    });

    controller.ensureLayoutResizeObserver();
    controller.refreshLayoutResizeObservation();
    const observer = FakeResizeObserver.instances[0]!;
    expect(observer.observe).toHaveBeenCalledTimes(2);
    expect(controller.observedElementCount).toBe(2);

    controller.scheduleHighlightRelayoutRescan();
    expect(controller.hasPendingRelayout).toBe(true);
    controller.dispose();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(controller.observedElementCount).toBe(0);
    expect(controller.hasPendingRelayout).toBe(false);

    observer.fire();
    vi.advanceTimersByTime(500);
    expect(onRefreshFullPage).not.toHaveBeenCalled();
    expect(onRefreshViewport).not.toHaveBeenCalled();
    controller.ensureLayoutResizeObserver();
    controller.refreshLayoutResizeObservation();
    expect(FakeResizeObserver.instances).toHaveLength(1);
  });
});
