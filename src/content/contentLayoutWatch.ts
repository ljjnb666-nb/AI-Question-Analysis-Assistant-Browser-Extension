type DetectMode = "viewport" | "fullpage" | null;

type LayoutWatchDeps = {
  getActiveCandidatesCount: () => number;
  getActiveDetectMode: () => DetectMode;
  getHighlightLayerPresent: () => boolean;
  getLastFullPageLayoutKey: () => string;
  getFullPageLayoutKey: (scrollRoot: Element | Window) => string;
  onRefreshFullPage: () => void;
  onRefreshViewport: () => void;
  resolveFullPageScrollRoot: () => Element | Window;
  setLastFullPageLayoutKey: (nextKey: string) => void;
};

export function createLayoutWatchController(deps: LayoutWatchDeps) {
  let relayoutRescanTimer: number | null = null;
  let layoutResizeObserver: ResizeObserver | null = null;
  let observedLayoutElements = new Set<Element>();

  function scheduleHighlightRelayoutRescan() {
    if (!deps.getHighlightLayerPresent() || deps.getActiveCandidatesCount() === 0) return;
    if (relayoutRescanTimer !== null) {
      window.clearTimeout(relayoutRescanTimer);
    }
    relayoutRescanTimer = window.setTimeout(() => {
      relayoutRescanTimer = null;
      if (deps.getActiveDetectMode() === "viewport") {
        deps.onRefreshViewport();
        return;
      }
      if (deps.getActiveDetectMode() === "fullpage") {
        const scrollRoot = deps.resolveFullPageScrollRoot();
        const layoutKey = deps.getFullPageLayoutKey(scrollRoot);
        if (layoutKey !== deps.getLastFullPageLayoutKey()) {
          deps.setLastFullPageLayoutKey(layoutKey);
          deps.onRefreshFullPage();
        }
      }
    }, 180);
  }

  function ensureLayoutResizeObserver() {
    if (layoutResizeObserver || typeof ResizeObserver === "undefined") return;
    layoutResizeObserver = new ResizeObserver(() => {
      if (deps.getActiveDetectMode() !== "fullpage") return;
      scheduleHighlightRelayoutRescan();
    });
  }

  function refreshLayoutResizeObservation() {
    if (!layoutResizeObserver) return;

    const nextObserved = new Set<Element>();
    nextObserved.add(document.documentElement);
    if (document.body) nextObserved.add(document.body);

    if (deps.getActiveDetectMode() === "fullpage") {
      const scrollRoot = deps.resolveFullPageScrollRoot();
      if (scrollRoot instanceof HTMLElement) {
        nextObserved.add(scrollRoot);
        if (scrollRoot.parentElement) nextObserved.add(scrollRoot.parentElement);
      }
    }

    for (const el of observedLayoutElements) {
      if (!nextObserved.has(el)) {
        layoutResizeObserver.unobserve(el);
      }
    }

    for (const el of nextObserved) {
      if (!observedLayoutElements.has(el)) {
        layoutResizeObserver.observe(el);
      }
    }

    observedLayoutElements = nextObserved;
  }

  return {
    ensureLayoutResizeObserver,
    refreshLayoutResizeObservation,
    scheduleHighlightRelayoutRescan,
  };
}
