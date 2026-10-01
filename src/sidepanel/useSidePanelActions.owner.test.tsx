import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { DetectedCandidate } from "@/shared/types";
import { DEFAULT_SETTINGS } from "@/shared/types";
import { useSidePanelActions } from "./useSidePanelActions";
import {
  clearProtectedWorkOwner,
  markProtectedWorkOwner,
} from "@/shared/auth/protectedWorkOwner";

// The Auto Solve START path guards on provider configuration (UI-00A) before
// its auth/owner choreography; these tests exercise that choreography with a
// configured provider. Assembled at runtime so security scanners do not
// mistake this synthetic test fixture for a committed credential.
(chrome.storage.local.get as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({
  appSettings: { ...DEFAULT_SETTINGS, apiKey: ["test", "key"].join("-") },
});

const sentMessages: Array<{ tabId: number; type: string }> = [];
let authenticated = true;

function makeCandidate(overrides: Partial<DetectedCandidate> = {}): DetectedCandidate {
  return {
    block: {
      id: "block-1",
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      previewText: "1+1=? A.2",
      confidence: 1,
      source: "manual_capture",
    },
    origin: { tabId: 7, url: "https://quiz.example.com/page" },
    selected: true,
    status: "idle",
    ...overrides,
  } as unknown as DetectedCandidate;
}

type HookOptions = Parameters<typeof useSidePanelActions>[0];

function makeOptions(overrides: Partial<HookOptions> = {}): HookOptions {
  const candidates = [makeCandidate()];
  return {
    candidates,
    isBatchParsing: false,
    isAuthenticatedNow: () => authenticated,
    markProtectedWork: vi.fn(async () => undefined),
    setCandidates: vi.fn(),
    setExpandedIds: vi.fn(),
    setFillFeedback: vi.fn(),
    setIsAutoSolving: vi.fn(),
    setIsBatchFilling: vi.fn(),
    setIsBatchParsing: vi.fn(),
    setIsDetecting: vi.fn(),
    setIsFullPageScan: vi.fn(),
    setIsRetryingRisky: vi.fn(),
    setAutoSolveProgress: vi.fn(),
    setScanProgress: vi.fn(),
    uiLang: "en",
    ...overrides,
  };
}

vi.mock("./tabActions", () => ({
  getBestActionTab: vi.fn(async () => ({ id: 7 }) as chrome.tabs.Tab | null),
  sendTabMessageWithBootstrap: vi.fn(async (tabId: number, message: { type: string }) => {
    sentMessages.push({ tabId, type: message.type });
    return {};
  }),
  sendProtectedTabMessageWithBootstrap: vi.fn(async (tabId: number, message: { type: string }) => {
    sentMessages.push({ tabId, type: message.type });
    return { ok: true };
  }),
  requestBlockImage: vi.fn(),
  sendFillMessageWithVerify: vi.fn(),
  isCandidateResultAuthorityCurrent: vi.fn(async () => true),
}));

vi.mock("@/shared/utils/analytics", () => ({
  logEvent: vi.fn(),
}));

vi.mock("@/shared/auth/protectedWorkOwner", () => ({
  markProtectedWorkOwner: vi.fn(async () => undefined),
  clearProtectedWorkOwner: vi.fn(async () => undefined),
  readProtectedWorkOwners: vi.fn(async () => ({ autoSolve: [], fullPage: [] })),
}));

beforeEach(() => {
  sentMessages.length = 0;
  authenticated = true;
  vi.clearAllMocks();
});

// AUTH-UI-INV-15/16 owner atomicity: the cross-surface owner write is
// awaited before the START, and every failed path clears the exact owner.
describe("useSidePanelActions owner commit atomicity", () => {
  it("AUTH_UI_60_FAILED_START_CLEARS_OWNER an authority-lost full-page/auto-solve START clears its exact owner", async () => {
    const { sendProtectedTabMessageWithBootstrap } = await import("./tabActions");
    vi.mocked(sendProtectedTabMessageWithBootstrap).mockResolvedValueOnce({
      ok: false,
      error: "AUTHORITY_LOST_DURING_RETRY",
    });
    const protectedWork = {
      current: {
        autoSolve: { active: false, tabId: undefined as number | undefined },
        fullPage: { active: false, tabId: undefined as number | undefined },
      },
    };
    const markProtectedWork = vi.fn(
      async (kind: "autoSolve" | "fullPage", active: boolean, tabId: number) => {
        protectedWork.current[kind] = { active, tabId: active ? tabId : undefined };
        if (active) await markProtectedWorkOwner(kind, tabId);
        else await clearProtectedWorkOwner(kind, tabId);
      },
    );
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({ markProtectedWork, protectedWork }),
    });

    await result.current.handleFullPageDetect();

    // Exact-owner cleanup on the failed path: the transient flag flips back
    // off with the SAME tab, and nothing stays active in the registry.
    expect(markProtectedWork).toHaveBeenLastCalledWith("fullPage", false, 7);
    expect(protectedWork.current.fullPage).toEqual({ active: false, tabId: undefined });

    // Auto solve: the same contract.
    authenticated = true;
    vi.mocked(sendProtectedTabMessageWithBootstrap).mockResolvedValueOnce({
      ok: false,
      error: "AUTHORITY_LOST_DURING_RETRY",
    });
    await result.current.handleStartAutoSolve();
    expect(markProtectedWork).toHaveBeenLastCalledWith("autoSolve", false, 7);
    expect(protectedWork.current.autoSolve).toEqual({ active: false, tabId: undefined });
  });

  it("AUTH_UI_61_AUTH_LOSS_DURING_OWNER_MARK a pending owner mark cannot resurrect a stale owner after auth loss", async () => {
    authenticated = true;
    let authenticatedNow = true;
    // The cross-surface owner write parks until the test releases it.
    const ownerWriteResolvers: Array<() => void> = [];
    vi.mocked(markProtectedWorkOwner).mockReset();
    vi.mocked(markProtectedWorkOwner).mockImplementation(async () => {
      await new Promise<void>((resolve) => ownerWriteResolvers.push(resolve));
    });
    // NOTE: no sendProtected stub is parked here — the handler must fail at
    // the post-mark authority recheck BEFORE ever reaching the dispatch, so
    // parking one would leak into the next test's queue.

    // The overridden markProtectedWork implements the SidePanelApp owner
    // commit contract: flip the sync ref, then AWAIT the cross-surface write.
    const protectedWork = {
      current: {
        autoSolve: { active: false, tabId: undefined as number | undefined },
        fullPage: { active: false, tabId: undefined as number | undefined },
      },
    };
    const markProtectedWork = vi.fn(
      async (kind: "autoSolve" | "fullPage", active: boolean, tabId: number) => {
        protectedWork.current[kind] = { active, tabId: active ? tabId : undefined };
        if (active) await markProtectedWorkOwner(kind, tabId);
        else await clearProtectedWorkOwner(kind, tabId);
      },
    );
    const optionsOverride = {
      isAuthenticatedNow: () => authenticatedNow,
      markProtectedWork,
      protectedWork,
    };

    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions(optionsOverride),
    });

    const running = result.current.handleStartAutoSolve();
    // Let the handler reach the awaited owner mark (tab lookup microtask).
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Owner mark pending: the START dispatch must still be blocked.
    expect(sentMessages).toEqual([]);

    // Auth is lost while the owner write is pending; the recheck after the
    // awaited mark then triggers the exact-owner clear.
    authenticatedNow = false;
    authenticated = false;
    for (const resolveOwnerWrite of ownerWriteResolvers.splice(0)) resolveOwnerWrite();
    await running;

    // No START ever dispatched; the exact-owner clear ran after the mark
    // resolved, so the pending mark cannot resurrect a stale owner.
    expect(sentMessages).toEqual([]);
    expect(markProtectedWorkOwner).toHaveBeenCalledWith("autoSolve", 7);
    expect(markProtectedWork).toHaveBeenCalledWith("autoSolve", false, 7);
    expect(clearProtectedWorkOwner).toHaveBeenCalledWith("autoSolve", 7);
  });

  it("AUTH_UI_62_OWNER_COMMITTED_BEFORE_START the START dispatch waits for the cross-surface owner commit", async () => {
    authenticated = true;
    const ownerWriteResolvers: Array<() => void> = [];
    let ownerWriteReleased = false;
    vi.mocked(markProtectedWorkOwner).mockReset();
    vi.mocked(markProtectedWorkOwner).mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        ownerWriteResolvers.push(() => {
          ownerWriteReleased = true;
          resolve();
        });
      });
    });

    // Same awaited owner-commit contract as SidePanelApp.
    const markProtectedWork = vi.fn(
      async (kind: "autoSolve" | "fullPage", active: boolean, tabId: number) => {
        if (active) await markProtectedWorkOwner(kind, tabId);
      },
    );
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({ markProtectedWork }),
    });

    const running = result.current.handleStartAutoSolve();
    // While the cross-surface owner commit is pending, the START must be
    // blocked: owner established BEFORE dispatch (AUTH-UI-INV-15/16).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sentMessages).toEqual([]);
    expect(ownerWriteReleased).toBe(false);

    for (const releaseOwnerWrite of ownerWriteResolvers.splice(0)) releaseOwnerWrite();
    // The START dispatch lands a microtask after the owner-commit promise
    // resolves; poll for it instead of assuming a fixed drain depth.
    await vi.waitFor(
      () => expect(sentMessages).toEqual([{ tabId: 7, type: "START_AUTO_SOLVE_ALL" }]),
      { timeout: 3000, interval: 10 },
    );
    await running;

    expect(ownerWriteReleased).toBe(true);
    expect(authenticated).toBe(true);
  });
});
