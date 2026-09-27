import { isHtmlElementNode } from "./detector/domDetectorShared";
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
  let disposed = false;

  function scheduleHighlightRelayoutRescan() {
    if (disposed) return;
    if (!deps.getHighlightLayerPresent() || deps.getActiveCandidatesCount() === 0) return;
    if (relayoutRescanTimer !== null) {
      window.clearTimeout(relayoutRescanTimer);
    }
    relayoutRescanTimer = window.setTimeout(() => {
      relayoutRescanTimer = null;
      if (disposed) return;
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
    if (disposed || layoutResizeObserver || typeof ResizeObserver === "undefined") return;
    layoutResizeObserver = new ResizeObserver(() => {
      if (disposed) return;
      if (deps.getActiveDetectMode() !== "fullpage") return;
      scheduleHighlightRelayoutRescan();
    });
  }

  function refreshLayoutResizeObservation() {
    if (disposed || !layoutResizeObserver) return;

    const nextObserved = new Set<Element>();
    nextObserved.add(document.documentElement);
    if (document.body) nextObserved.add(document.body);

    if (deps.getActiveDetectMode() === "fullpage") {
      const scrollRoot = deps.resolveFullPageScrollRoot();
      if (isHtmlElementNode(scrollRoot)) {
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

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (relayoutRescanTimer !== null) {
      window.clearTimeout(relayoutRescanTimer);
      relayoutRescanTimer = null;
    }
    layoutResizeObserver?.disconnect();
    layoutResizeObserver = null;
    observedLayoutElements.clear();
  }

  return {
    dispose,
    ensureLayoutResizeObserver,
    refreshLayoutResizeObservation,
    scheduleHighlightRelayoutRescan,
    get isDisposed() { return disposed; },
    get observedElementCount() { return observedLayoutElements.size; },
    get hasPendingRelayout() { return relayoutRescanTimer !== null; },
  };
}
