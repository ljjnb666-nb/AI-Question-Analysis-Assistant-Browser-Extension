import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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
