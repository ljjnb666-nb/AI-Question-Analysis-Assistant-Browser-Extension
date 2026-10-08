import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  markProtectedWorkOwner,
  markProtectedWorkOwnerWithGeneration,
  readProtectedWorkOwners,
  terminateRecordedProtectedWork,
} from "@/shared/auth/protectedWorkOwner";
import { registerSidePanelRuntimeListeners } from "./sidepanelMessageBridge";

// Real bridge + real owner registry over an in-memory chrome stub; only the
// chrome.runtime/storage plumbing is faked.
type MessageListener = (msg: Record<string, unknown>, sender: chrome.runtime.MessageSender) => void;
const messageListeners = new Array<MessageListener>();
const sessionStore = new Map<string, unknown>();
const terminationSends: Array<{ tabId: number; type: string }> = [];

vi.mock("gsap", () => ({
  default: { from: vi.fn(), to: vi.fn() },
}));

beforeEach(() => {
  messageListeners.length = 0;
  sessionStore.clear();
  terminationSends.length = 0;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: {
        addListener: (fn: MessageListener) => messageListeners.push(fn),
        removeListener: (fn: MessageListener) => {
          const index = messageListeners.indexOf(fn);
          if (index >= 0) messageListeners.splice(index, 1);
        },
      },
    },
    storage: {
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
      session: {
        get: async (keys: string | string[] | null) => {
          const requested = keys == null ? [...sessionStore.keys()] : Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const key of requested) if (sessionStore.has(key)) result[key] = sessionStore.get(key);
          return result;
        },
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) sessionStore.set(key, value);
        },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) sessionStore.delete(key);
        },
      },
    },
  };
});

function dispatchRuntimeMessage(msg: Record<string, unknown>, tabId: number): void {
  for (const listener of messageListeners) {
    listener(msg, { tab: tab(tabId) } as unknown as chrome.runtime.MessageSender);
  }
}

const tab = (id: number) => ({ id, url: "https://quiz.example.com/exam" });

describe("runtime reconciliation of protected-work owners", () => {
  it("AUTH_UI_49_RUNTIME_DONE_CLEARS_OWNER a finished auto solve clears its owner and blocks stale termination", async () => {
    registerSidePanelRuntimeListeners({
      loadLanguage: async () => "en" as const,
      setUiLang: vi.fn(),
      setCandidates: vi.fn(),
      setIsDetecting: vi.fn(),
      setIsFullPageScan: vi.fn(),
      setScanProgress: vi.fn(),
      setExpandedIds: vi.fn(),
      setIsAutoSolving: vi.fn(),
      setAutoSolveProgress: vi.fn(),
      setFillFeedback: vi.fn(),
    });

    // A run on tab 7 reports progress, then finishes.
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_PROGRESS", running: true }, 7);
    // Observe the public registry contract, not the legacy per-tab storage
    // key layout: each START/progress generation now owns an immutable key.
    await vi.waitFor(async () => {
      expect((await readProtectedWorkOwners()).autoSolve).toEqual([{ tabId: 7 }]);
    }, { timeout: 2000, interval: 20 });
    const owners = await readProtectedWorkOwners();
    expect(owners.autoSolve).toEqual([{ tabId: 7 }]);

    dispatchRuntimeMessage({ type: "AUTO_SOLVE_DONE", ok: true, solved: 3, filled: 3, total: 3, message: "done" }, 7);
    await vi.waitFor(async () => {
      expect((await readProtectedWorkOwners()).autoSolve).toEqual([]);
    }, { timeout: 2000, interval: 20 });

    // A later auth loss must NOT send a stale STOP at the finished tab.
    await terminateRecordedProtectedWork(async (tabId, message) => {
      terminationSends.push({ tabId, type: message.type });
      return {};
    });
    expect(terminationSends).toEqual([]);
  });

  it("AUTH_UI_49_RUNTIME_DONE_CLEARS_OWNER a finished full-page scan clears its owner the same way", async () => {
    registerSidePanelRuntimeListeners({
      loadLanguage: async () => "en" as const,
      setUiLang: vi.fn(),
      setCandidates: vi.fn(),
      setIsDetecting: vi.fn(),
      setIsFullPageScan: vi.fn(),
      setScanProgress: vi.fn(),
      setExpandedIds: vi.fn(),
      setIsAutoSolving: vi.fn(),
      setAutoSolveProgress: vi.fn(),
      setFillFeedback: vi.fn(),
    });

    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_PROGRESS", progress: 50, found: 2 }, 9);
    await vi.waitFor(async () => {
      expect((await readProtectedWorkOwners()).fullPage).toEqual([{ tabId: 9 }]);
    }, { timeout: 2000, interval: 20 });

    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_DONE", candidates: [] }, 9);
    await vi.waitFor(async () => {
      expect((await readProtectedWorkOwners()).fullPage).toEqual([]);
    }, { timeout: 2000, interval: 20 });

    await terminateRecordedProtectedWork(async (tabId, message) => {
      terminationSends.push({ tabId, type: message.type });
      return {};
    });
    expect(terminationSends).toEqual([]);
  });

  it("AUTH_UI_50_RUNTIME_PROGRESS_RECONCILES_OWNER progress messages claim the cross-surface owner per tab", async () => {
    registerSidePanelRuntimeListeners({
      loadLanguage: async () => "en" as const,
      setUiLang: vi.fn(),
      setCandidates: vi.fn(),
      setIsDetecting: vi.fn(),
      setIsFullPageScan: vi.fn(),
      setScanProgress: vi.fn(),
      setExpandedIds: vi.fn(),
      setIsAutoSolving: vi.fn(),
      setAutoSolveProgress: vi.fn(),
      setFillFeedback: vi.fn(),
    });

    // Recovery path: an auto solve whose START owner record was missed claims
    // the owner from its own progress reporting.
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_PROGRESS", running: true }, 7);
    await vi.waitFor(async () => {
      expect((await readProtectedWorkOwners()).autoSolve).toEqual([{ tabId: 7 }]);
    }, { timeout: 2000, interval: 20 });

    // And a full-page scan running on a different tab owns that tab.
    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_PROGRESS", progress: 10, found: 0 }, 8);
    await vi.waitFor(async () => {
      expect((await readProtectedWorkOwners()).fullPage).toEqual([{ tabId: 8 }]);
    }, { timeout: 2000, interval: 20 });

    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("AUTH_UI_50_RUNTIME_PROGRESS_RECONCILES_OWNER a non-running progress report does not claim ownership", async () => {
    registerSidePanelRuntimeListeners({
      loadLanguage: async () => "en" as const,
      setUiLang: vi.fn(),
      setCandidates: vi.fn(),
      setIsDetecting: vi.fn(),
      setIsFullPageScan: vi.fn(),
      setScanProgress: vi.fn(),
      setExpandedIds: vi.fn(),
      setIsAutoSolving: vi.fn(),
      setAutoSolveProgress: vi.fn(),
      setFillFeedback: vi.fn(),
    });

    dispatchRuntimeMessage({ type: "AUTO_SOLVE_PROGRESS", running: false }, 7);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await readProtectedWorkOwners()).autoSolve).toEqual([]);
  });
});

describe("Phase14B-02B tagged runtime DONE replay fence", () => {
  const register = (renderWorkspace: boolean) => registerSidePanelRuntimeListeners({
    renderWorkspace,
    loadLanguage: async () => "en" as const,
    setUiLang: vi.fn(),
    setCandidates: vi.fn(),
    setIsDetecting: vi.fn(),
    setIsFullPageScan: vi.fn(),
    setScanProgress: vi.fn(),
    setExpandedIds: vi.fn(),
    setIsAutoSolving: vi.fn(),
    setAutoSolveProgress: vi.fn(),
    setFillFeedback: vi.fn(),
  });

  it("P14B02B_WIRE_03 old autoSolve DONE cannot clear a newer tagged owner (snapshot mode)", async () => {
    register(false);
    const oldId = await markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    const newId = await markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    expect(oldId).not.toBe(newId);
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_DONE", generationId: oldId, ok: true }, 7);
    await vi.waitFor(() => {
      const keys = [...sessionStore.keys()].filter((key) => key.startsWith("protectedWorkOwner:autoSolve:7:"));
      expect(keys).toHaveLength(1);
      expect(keys[0]).toContain(newId!);
    });
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_DONE", generationId: oldId, ok: true }, 7);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await readProtectedWorkOwners()).autoSolve).toEqual([{ tabId: 7 }]);
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_DONE", generationId: newId, ok: true }, 7);
    await vi.waitFor(async () => expect((await readProtectedWorkOwners()).autoSolve).toEqual([]));
  });

  it("P14B02B_WIRE_04 old untagged fullPage DONE cannot clear newer tagged owner (legacy UI mode)", async () => {
    register(true);
    await markProtectedWorkOwner("fullPage", 9);
    const newId = await markProtectedWorkOwnerWithGeneration("fullPage", 9);
    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_DONE", candidates: [] }, 9);
    await vi.waitFor(() => {
      const keys = [...sessionStore.keys()].filter((key) => key.startsWith("protectedWorkOwner:fullPage:9:"));
      expect(keys).toHaveLength(1);
      expect(keys[0]).toContain(newId!);
    });
    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_DONE", generationId: null, candidates: [] }, 9);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await readProtectedWorkOwners()).fullPage).toEqual([{ tabId: 9 }]);
    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_DONE", generationId: newId, candidates: [] }, 9);
    await vi.waitFor(async () => expect((await readProtectedWorkOwners()).fullPage).toEqual([]));
  });
});

describe("Phase14B-02C tagged runtime progress cannot resurrect an owner", () => {
  it("P14B02C_PROGRESS_01 a late tagged progress after DONE creates no legacy owner", async () => {
    registerSidePanelRuntimeListeners({
      renderWorkspace: false,
      loadLanguage: async () => "en" as const,
      setUiLang: vi.fn(),
      setCandidates: vi.fn(),
      setIsDetecting: vi.fn(),
      setIsFullPageScan: vi.fn(),
      setScanProgress: vi.fn(),
      setExpandedIds: vi.fn(),
      setIsAutoSolving: vi.fn(),
      setAutoSolveProgress: vi.fn(),
      setFillFeedback: vi.fn(),
    });
    const token = await markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_DONE", generationId: token, ok: true }, 7);
    await vi.waitFor(async () => {
      expect((await readProtectedWorkOwners()).autoSolve).toEqual([]);
    });
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_PROGRESS", generationId: token, running: true }, 7);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await readProtectedWorkOwners()).autoSolve).toEqual([]);
  });

  it("P14B02C_PROGRESS_02 malformed tagged running progress never falls back to legacy reconciliation", async () => {
    registerSidePanelRuntimeListeners({
      renderWorkspace: true,
      loadLanguage: async () => "en" as const,
      setUiLang: vi.fn(),
      setCandidates: vi.fn(),
      setIsDetecting: vi.fn(),
      setIsFullPageScan: vi.fn(),
      setScanProgress: vi.fn(),
      setExpandedIds: vi.fn(),
      setIsAutoSolving: vi.fn(),
      setAutoSolveProgress: vi.fn(),
      setFillFeedback: vi.fn(),
    });
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_PROGRESS", generationId: null, running: true }, 7);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await readProtectedWorkOwners()).autoSolve).toEqual([]);
  });
});

describe("Phase14B-02C-D stale PROGRESS/DONE UI projection fence", () => {
  const newHandlers = (renderWorkspace: boolean, bound = true) => {
    const setIsAutoSolving = vi.fn();
    const setAutoSolveProgress = vi.fn();
    const setIsFullPageScan = vi.fn();
    const setScanProgress = vi.fn();
    const setCandidates = vi.fn();
    const setExpandedIds = vi.fn();
    const setFillFeedback = vi.fn();
    const dispose = registerSidePanelRuntimeListeners({
      renderWorkspace,
      ...(bound ? { getFeedbackOrigin: () => ({ tabId: 7, url: tab(7).url }) } : {}),
      loadLanguage: async () => "en" as const,
      setUiLang: vi.fn(),
      setCandidates, setIsDetecting: vi.fn(), setIsFullPageScan,
      setScanProgress, setExpandedIds, setIsAutoSolving,
      setAutoSolveProgress, setFillFeedback,
    });
    return { dispose, setIsAutoSolving, setAutoSolveProgress,
      setIsFullPageScan, setScanProgress, setCandidates, setExpandedIds, setFillFeedback };
  };

  it("P14B02C_UI_D01 an old tagged Auto Solve DONE/PROGRESS cannot stop or overwrite the newer UI", async () => {
    const ui = newHandlers(true);
    const old = await markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    const next = await markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_PROGRESS", generationId: old, running: false, solved: 99 }, 7);
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_DONE", generationId: old, ok: true }, 7);
    await vi.waitFor(async () => {
      const keys = [...sessionStore.keys()].filter(k => k.startsWith("protectedWorkOwner:autoSolve:7:"));
      expect(keys).toHaveLength(1);
      expect(keys[0]).toContain(next!);
    });
    expect(ui.setIsAutoSolving).not.toHaveBeenCalled();
    expect(ui.setAutoSolveProgress).not.toHaveBeenCalled();
    expect(ui.setFillFeedback).not.toHaveBeenCalled();

    dispatchRuntimeMessage({ type: "AUTO_SOLVE_PROGRESS", generationId: next, running: true, solved: 1 }, 7);
    await vi.waitFor(() => expect(ui.setIsAutoSolving).toHaveBeenCalledWith(true));
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_DONE", generationId: next, ok: true, solved: 1, filled: 1, total: 1 }, 7);
    await vi.waitFor(() => expect(ui.setIsAutoSolving).toHaveBeenCalledWith(false));
    await vi.waitFor(() => expect(ui.setFillFeedback).toHaveBeenCalledTimes(1));
    expect(ui.setAutoSolveProgress).toHaveBeenCalledWith(null);
    ui.dispose();
  });

  it("P14B02C_UI_D02 stale Full Page DONE cannot reset candidates, progress, or scanning state", async () => {
    const ui = newHandlers(true);
    const old = await markProtectedWorkOwnerWithGeneration("fullPage", 7);
    const next = await markProtectedWorkOwnerWithGeneration("fullPage", 7);
    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_PROGRESS", generationId: old, progress: 90 }, 7);
    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_DONE", generationId: old, candidates: [] }, 7);
    await vi.waitFor(async () => {
      expect((await readProtectedWorkOwners()).fullPage).toEqual([{ tabId: 7 }]);
      expect([...sessionStore.keys()].filter(k => k.startsWith("protectedWorkOwner:fullPage:7:"))).toHaveLength(1);
    });
    expect(ui.setIsFullPageScan).not.toHaveBeenCalled();
    expect(ui.setScanProgress).not.toHaveBeenCalled();
    expect(ui.setCandidates).not.toHaveBeenCalled();
    expect(ui.setExpandedIds).not.toHaveBeenCalled();

    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_PROGRESS", generationId: next, progress: 5, found: 2 }, 7);
    await vi.waitFor(() => expect(ui.setIsFullPageScan).toHaveBeenCalledWith(true));
    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_DONE", generationId: next, candidates: [] }, 7);
    await vi.waitFor(() => expect(ui.setIsFullPageScan).toHaveBeenCalledWith(false));
    expect(ui.setCandidates).toHaveBeenCalledTimes(1);
    expect(ui.setExpandedIds).toHaveBeenCalledWith({});
    ui.dispose();
  });

  it("P14B02C_UI_D03 snapshot feedback ignores a stale same-tab DONE but accepts current token", async () => {
    const ui = newHandlers(false);
    const old = await markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    const next = await markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_DONE", generationId: old, ok: true }, 7);
    await vi.waitFor(async () => {
      expect([...sessionStore.keys()].filter(k => k.startsWith("protectedWorkOwner:autoSolve:7:"))).toHaveLength(1);
    });
    expect(ui.setFillFeedback).not.toHaveBeenCalled();
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_DONE", generationId: next, ok: true }, 7);
    await vi.waitFor(() => expect(ui.setFillFeedback).toHaveBeenCalledTimes(1));
    expect(ui.setIsAutoSolving).not.toHaveBeenCalled();
    ui.dispose();
  });

  it("P14B02C_UI_D04 async language completion must not show old DONE after newer START", async () => {
    let release!: (lang: "en") => void;
    const languagePending = new Promise<"en">(resolve => { release = resolve; });
    let call = 0;
    const setFillFeedback = vi.fn();
    const dispose = registerSidePanelRuntimeListeners({
      renderWorkspace: false,
      getFeedbackOrigin: () => ({ tabId: 7, url: tab(7).url }),
      loadLanguage: () => ++call === 1 ? Promise.resolve("en") : languagePending,
      setUiLang: vi.fn(), setCandidates: vi.fn(), setIsDetecting: vi.fn(),
      setIsFullPageScan: vi.fn(), setScanProgress: vi.fn(), setExpandedIds: vi.fn(),
      setIsAutoSolving: vi.fn(), setAutoSolveProgress: vi.fn(), setFillFeedback,
    });
    const old = await markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_DONE", generationId: old, ok: true }, 7);
    await vi.waitFor(() => expect(call).toBe(2));
    const replacement = await markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    release("en");
    await vi.waitFor(async () => expect((await readProtectedWorkOwners()).autoSolve).toEqual([{ tabId: 7 }]));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(setFillFeedback).not.toHaveBeenCalled();
    expect(replacement).not.toBe(old);
    dispose();
  });

  it("P14B02C_UI_D05 legacy untagged PROGRESS cannot override tagged owner or resurrect an owner", async () => {
    const ui = newHandlers(true);
    const owner = await markProtectedWorkOwnerWithGeneration("fullPage", 7);
    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_PROGRESS", progress: 95, found: 10 }, 7);
    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_DONE", generationId: null, candidates: [] }, 7);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(ui.setIsFullPageScan).not.toHaveBeenCalled();
    expect(ui.setCandidates).not.toHaveBeenCalled();
    expect((await readProtectedWorkOwners()).fullPage).toEqual([{ tabId: 7 }]);
    expect(owner).toBeTruthy();
    ui.dispose();
  });

  it("P14B02C_UI_D06 snapshot completion requires matching bound tab and origin", async () => {
    const ui = newHandlers(false);
    const otherOwner = await markProtectedWorkOwnerWithGeneration("autoSolve", 8);
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_DONE", generationId: otherOwner, ok: true }, 8);
    await vi.waitFor(async () => expect((await readProtectedWorkOwners()).autoSolve).toEqual([]));
    expect(ui.setFillFeedback).not.toHaveBeenCalled();
    ui.dispose();
  });

  it("P14B02C_UI_D07 after tagged DONE, late legacy PROGRESS cannot resurrect old owner or scan buttons", async () => {
    const ui = newHandlers(true);
    const a = await markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    const f = await markProtectedWorkOwnerWithGeneration("fullPage", 7);
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_DONE", generationId: a, ok: true }, 7);
    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_DONE", generationId: f, candidates: [] }, 7);
    await vi.waitFor(async () => expect(await readProtectedWorkOwners()).toEqual({ autoSolve: [], fullPage: [] }));
    const oldAutoCalls = ui.setIsAutoSolving.mock.calls.length;
    const oldFullCalls = ui.setIsFullPageScan.mock.calls.length;
    dispatchRuntimeMessage({ type: "AUTO_SOLVE_PROGRESS", running: true, solved: 88 }, 7);
    dispatchRuntimeMessage({ type: "FULL_PAGE_DETECT_PROGRESS", progress: 88, found: 88 }, 7);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await readProtectedWorkOwners()).toEqual({ autoSolve: [], fullPage: [] });
    expect(ui.setIsAutoSolving).toHaveBeenCalledTimes(oldAutoCalls);
    expect(ui.setIsFullPageScan).toHaveBeenCalledTimes(oldFullCalls);
    ui.dispose();
  });

});
