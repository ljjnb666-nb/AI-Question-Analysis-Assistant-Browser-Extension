import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProtectedWorkRunAuthority } from "./protectedWorkRunAuthority";
import { handleContentMessage } from "./contentMessageRouter";
import { beginContentRuntimeGeneration } from "./contentRuntimeLifecycle";
import { detectCandidatesFullPage, cancelFullPageScan, isFullPageScanRunning } from "./detector/fullPageDetector";
import { startContentRouteLifecycleWatch, CONTENT_ROUTE_POLL_INTERVAL_MS } from "./revision/contentRouteLifecycle";
import {
  markProtectedWorkOwnerWithGeneration,
  terminateRecordedProtectedWork,
  readProtectedWorkOwners,
} from "@/shared/auth/protectedWorkOwner";

vi.mock("./detector/domDetector", () => ({ detectCandidatesInViewport: vi.fn(() => []) }));

type Authority = ReturnType<typeof createProtectedWorkRunAuthority>;
type StopMessage = { type: "STOP_AUTO_SOLVE_ALL" | "FULL_PAGE_DETECT_CANCELLED"; generationId?: string };

const session = new Map<string, unknown>();
let previousChrome: unknown;
let oldUrl = "";
let pageTop = 850;
let pageLeft = 15;
let scrollSpy: unknown;
const validId = "18aabcde-0ee2-4e98-8e12-48fdce879012";

const readSession = async (keys: string | string[] | null): Promise<Record<string, unknown>> => {
  const requested = keys === null ? [...session.keys()] : Array.isArray(keys) ? keys : [keys];
  return Object.fromEntries(requested.filter((key) => session.has(key)).map((key) => [key, session.get(key)]));
};

/** Cross-surface auth-loss messages travel through the production router. */
function dispatchStop(authority: Authority, message: StopMessage): unknown {
  let response: unknown = null;
  handleContentMessage(message as Parameters<typeof handleContentMessage>[0], (value) => { response = value; }, {
    stopAutoSolveAll: (id?: string) => authority.revoke("autoSolve", id),
    cancelFullPageScan: (id?: string) => {
      if (!authority.revoke("fullPage", id)) return false;
      cancelFullPageScan();
      return true;
    },
  } as unknown as Parameters<typeof handleContentMessage>[2]);
  return response;
}

beforeEach(() => {
  session.clear();
  previousChrome = (globalThis as { chrome?: unknown }).chrome;
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      session: {
        get: readSession,
        set: async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) session.set(key, value);
        },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) session.delete(key);
        },
      },
    },
  };
  oldUrl = location.href;
  vi.useFakeTimers();
  pageTop = 850;
  pageLeft = 15;
  document.body.innerHTML = '<form id="no-submit"><input name="answer"></form>';
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => pageTop });
  Object.defineProperty(window, "scrollX", { configurable: true, get: () => pageLeft });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
  Object.defineProperty(document.body, "scrollHeight", { configurable: true, value: 2800 });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 2800 });
  scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
    const options = args[0] as ScrollToOptions;
    pageTop = options.top ?? pageTop;
    pageLeft = options.left ?? pageLeft;
  });
});

afterEach(() => {
  cancelFullPageScan();
  vi.useRealTimers();
  vi.restoreAllMocks();
  history.replaceState(null, "", oldUrl);
  document.body.innerHTML = "";
  (globalThis as { chrome?: unknown }).chrome = previousChrome;
});

describe("Phase14B-02C-E3A integration: auth-loss transport, runtime replacement and SPA", () => {
  it("E3_AUTH_01 auth-loss STOP/CANCEL through real router revokes pending Full Page scan without scroll restore or submit", async () => {
    const identity = await markProtectedWorkOwnerWithGeneration("fullPage", 11);
    expect(identity).toBeTruthy();
    const runtime = createProtectedWorkRunAuthority();
    const lease = runtime.begin("fullPage", identity!)!;
    const progress = vi.fn();
    const submitted = vi.fn();
    document.querySelector("form")!.addEventListener("submit", submitted);
    const scan = detectCandidatesFullPage(progress, () => runtime.isCurrent("fullPage", lease));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    const responses: unknown[] = [];

    await terminateRecordedProtectedWork(async (tabId, message) => {
      expect(tabId).toBe(11);
      responses.push(dispatchStop(runtime, message));
    });
    expect(responses).toEqual([{ ok: true }]);
    expect(runtime.isCurrent("fullPage", lease)).toBe(false);
    expect(isFullPageScanRunning()).toBe(false);
    pageTop = 432;
    await vi.advanceTimersByTimeAsync(300);
    await scan;
    expect(pageTop).toBe(432);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
    expect(await readProtectedWorkOwners()).toEqual({ autoSolve: [], fullPage: [] });
  });

  it("E3_TABS_02 stale auth-loss STOP captured on tab A cannot terminate its replacement or affect tab B incorrectly", async () => {
    const idA = await markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    const idB = await markProtectedWorkOwnerWithGeneration("autoSolve", 8);
    const tabA = createProtectedWorkRunAuthority();
    const tabB = createProtectedWorkRunAuthority();
    const oldA = tabA.begin("autoSolve", idA!)!;
    const activeB = tabB.begin("autoSolve", idB!)!;
    let observed!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { observed = resolve; });
    const parked = new Promise<void>((resolve) => { release = resolve; });
    const sent: Array<{ tab: number; response: unknown; generationId?: string }> = [];

    const pendingAuthLoss = terminateRecordedProtectedWork(async (tab, message) => {
      if (tab === 7) {
        observed();
        await parked;
      }
      const response = dispatchStop(tab === 7 ? tabA : tabB, message);
      sent.push({ tab, response, generationId: message.generationId });
    });
    await entered;
    // An old workflow finished and a new login/START took ownership before the queued old STOP arrived.
    tabA.finish("autoSolve", oldA);
    const replacementId = await markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    const replacementLease = tabA.begin("autoSolve", replacementId!)!;
    release();
    await pendingAuthLoss;

    expect(sent).toEqual([
      { tab: 8, response: { ok: true }, generationId: idB },
      { tab: 7, response: { ok: false, error: "STALE_WORK_GENERATION" }, generationId: idA },
    ]);
    expect(tabA.isCurrent("autoSolve", replacementLease)).toBe(true);
    expect(tabB.isCurrent("autoSolve", activeB)).toBe(false);
    expect(await readProtectedWorkOwners()).toEqual({ autoSolve: [{ tabId: 7 }], fullPage: [] });
  });

  it("E3_REINJECT_03 old Runtime generation cannot scroll or clear newer scan after reinjection", async () => {
    const oldGeneration = beginContentRuntimeGeneration();
    const first = detectCandidatesFullPage(vi.fn(), oldGeneration.isCurrent);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    const nextGeneration = beginContentRuntimeGeneration();
    expect(oldGeneration.isCurrent()).toBe(false);
    expect(nextGeneration.isCurrent()).toBe(true);
    expect(isFullPageScanRunning()).toBe(false);

    const second = detectCandidatesFullPage(vi.fn(), nextGeneration.isCurrent);
    expect(isFullPageScanRunning()).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    await first;
    expect(isFullPageScanRunning()).toBe(true);
    await vi.runAllTimersAsync();
    await second;
    expect(isFullPageScanRunning()).toBe(false);
    nextGeneration.invalidate();
    oldGeneration.invalidate();
  });

  it("E3_SPA_04 URL-only pushState invalidates scan before postponed scroll restoration", async () => {
    const runtime = createProtectedWorkRunAuthority();
    const lease = runtime.begin("fullPage", validId)!;
    const events = vi.fn(() => {
      runtime.reset();
      cancelFullPageScan();
    });
    const stopWatch = startContentRouteLifecycleWatch(events);
    try {
      const progress = vi.fn();
      const scan = detectCandidatesFullPage(progress, () => runtime.isCurrent("fullPage", lease));
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      history.pushState({}, "", "/e3-route-changed");
      await vi.advanceTimersByTimeAsync(CONTENT_ROUTE_POLL_INTERVAL_MS);
      expect(events).toHaveBeenCalledOnce();
      pageTop = 621;
      await vi.advanceTimersByTimeAsync(300);
      await scan;
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(pageTop).toBe(621);
      expect(progress).not.toHaveBeenCalled();
      expect(dispatchStop(runtime, { type: "FULL_PAGE_DETECT_CANCELLED", generationId: validId }))
        .toEqual({ ok: false, error: "STALE_WORK_GENERATION" });
    } finally {
      stopWatch();
    }
  });

  it("E3_FRAME_05 detached scroll-root element loses mutation and restoration authority mid-scan", async () => {
    const container = document.createElement("div");
    container.style.cssText = "overflow-y:auto;height:560px;width:800px";
    container.className = "question-scroll-content";
    Object.defineProperty(container, "scrollHeight", { configurable: true, value: 2600 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 560 });
    container.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 560,
      width: 800, height: 560, toJSON: () => ({}),
    });
    const containerScroll = vi.spyOn(container, "scrollTo").mockImplementation(() => {});
    document.body.append(container);
    const progress = vi.fn();
    const scan = detectCandidatesFullPage(progress);
    expect(containerScroll).toHaveBeenCalledOnce();
    container.remove();
    expect(isFullPageScanRunning()).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    await scan;
    expect(containerScroll).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalled();
  });
});
