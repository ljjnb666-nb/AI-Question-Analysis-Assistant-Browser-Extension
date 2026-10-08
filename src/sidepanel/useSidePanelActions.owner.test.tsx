import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { DetectedCandidate } from "@/shared/types";
import { DEFAULT_SETTINGS } from "@/shared/types";
import { useSidePanelActions } from "./useSidePanelActions";
import {
  clearProtectedWorkOwner,
  markProtectedWorkOwner,
  terminateRecordedProtectedWorkKind,
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
  terminateRecordedProtectedWorkKind: vi.fn(async () => 1),
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


describe("UI04A bound workspace dispatch", () => {
  it("blocks START while opening hydration is pending", async () => {
    const options = makeOptions({ isWorkspaceReadyNow: () => false, getWorkspaceOrigin: () => ({ tabId: 7, url: "https://quiz.example.com/page" }) });
    const { result } = renderHook(() => useSidePanelActions(options));
    await result.current.handleFullPageDetect();
    expect(sentMessages).toEqual([]);
    expect(options.markProtectedWork).not.toHaveBeenCalled();
  });

  it("invalidates a waiting START if its bound origin changes during the owner commit", async () => {
    let origin = { tabId: 7, url: "https://quiz.example.com/page" };
    vi.stubGlobal("chrome", { ...chrome, tabs: { ...chrome.tabs, get: vi.fn(async () => ({ id: 7, url: origin.url })) } });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const markProtectedWork = vi.fn(async (_kind, active) => { if (active) await pending; });
    const options = makeOptions({ isWorkspaceReadyNow: () => true, getWorkspaceOrigin: () => origin, markProtectedWork });
    const { result } = renderHook(() => useSidePanelActions(options));
    const running = result.current.handleFullPageDetect();
    await vi.waitFor(() => expect(markProtectedWork).toHaveBeenCalledWith("fullPage", true, 7));
    origin = { tabId: 7, url: "https://quiz.example.com/next" };
    release();
    await running;
    expect(sentMessages).toEqual([]);
    expect(markProtectedWork).toHaveBeenLastCalledWith("fullPage", false, 7);
    vi.unstubAllGlobals();
  });
});

// This suite isolates auth/owner choreography with a configured AI readiness fixture.
vi.mock("@/shared/utils/aiSolvePreferences", async () => {
  const storage = await import("@/shared/utils/storage");
  return { loadParsePreferences: async () => { const { preferredRoute, language } = await storage.loadSettings(); return { preferredRoute, language }; }, getAIConnectionReadiness: async () => ({ ready: true }), getRuntimeCaptureInfo: async () => ({ name: "anthropic", baseUrl: "https://api.anthropic.com", supportsVision: true }) };
});

describe("Phase14B-02B manual STOP/CANCEL dispatch bridge", () => {
  it("routes manual autoSolve STOP through a single snapshot-fenced cleanup", async () => {
    const protectedWork = { current: {
      autoSolve: { active: true, tabId: 7 },
      fullPage: { active: false, tabId: undefined as number | undefined },
    } };
    const clearProtectedWorkIntent = vi.fn((kind: "autoSolve" | "fullPage") => {
      if (kind === "autoSolve") protectedWork.current.autoSolve.active = false;
      else protectedWork.current.fullPage.active = false;
    });
    const { result } = renderHook(() => useSidePanelActions(makeOptions({ protectedWork, clearProtectedWorkIntent })));
    await result.current.handleStopAutoSolve();
    expect(terminateRecordedProtectedWorkKind).toHaveBeenCalledWith("autoSolve", expect.any(Function), 7);
    expect(protectedWork.current.autoSolve.active).toBe(false);
    expect(clearProtectedWorkOwner).not.toHaveBeenCalled();
  });

  it("routes manual fullPage CANCEL through a single snapshot-fenced cleanup", async () => {
    const protectedWork = { current: {
      autoSolve: { active: false, tabId: undefined as number | undefined },
      fullPage: { active: true, tabId: 7 },
    } };
    const clearProtectedWorkIntent = vi.fn((kind: "autoSolve" | "fullPage") => {
      if (kind === "autoSolve") protectedWork.current.autoSolve.active = false;
      else protectedWork.current.fullPage.active = false;
    });
    const { result } = renderHook(() => useSidePanelActions(makeOptions({ protectedWork, clearProtectedWorkIntent })));
    await result.current.handleCancelFullPage();
    expect(terminateRecordedProtectedWorkKind).toHaveBeenCalledWith("fullPage", expect.any(Function), 7);
    expect(protectedWork.current.fullPage.active).toBe(false);
    expect(clearProtectedWorkOwner).not.toHaveBeenCalled();
  });
});

describe("Phase14B-02C SidePanel generation-aware START and rollback", () => {
  const generationId = "18aabcde-0ee2-4e98-8e12-48fdce879012";

  it("P14B02C_UI_01 dispatch carries the UUID returned by the committed owner", async () => {
    const { sendProtectedTabMessageWithBootstrap } = await import("./tabActions");
    const markProtectedWorkGeneration = vi.fn(async () => generationId);
    const clearProtectedWorkGeneration = vi.fn(async () => undefined);
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({ markProtectedWorkGeneration, clearProtectedWorkGeneration }),
    });
    await result.current.handleStartAutoSolve();
    expect(markProtectedWorkGeneration).toHaveBeenCalledWith("autoSolve", 7);
    expect(sendProtectedTabMessageWithBootstrap).toHaveBeenCalledWith(
      7, { type: "START_AUTO_SOLVE_ALL", generationId }, expect.any(Function),
    );
    expect(clearProtectedWorkGeneration).not.toHaveBeenCalled();
  });

  it("P14B02C_UI_02 denied START rolls back only that exact generation", async () => {
    const { sendProtectedTabMessageWithBootstrap } = await import("./tabActions");
    vi.mocked(sendProtectedTabMessageWithBootstrap).mockResolvedValueOnce({ ok: false, error: "DENIED" });
    const markProtectedWorkGeneration = vi.fn(async () => generationId);
    const clearProtectedWorkGeneration = vi.fn(async () => undefined);
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({ markProtectedWorkGeneration, clearProtectedWorkGeneration }),
    });
    await result.current.handleStartAutoSolve();
    expect(clearProtectedWorkGeneration).toHaveBeenCalledTimes(1);
    expect(clearProtectedWorkGeneration).toHaveBeenCalledWith("autoSolve", 7, generationId);
  });

  it("P14B02C_UI_03 unavailable owner store sends no START", async () => {
    const { sendProtectedTabMessageWithBootstrap } = await import("./tabActions");
    const markProtectedWorkGeneration = vi.fn(async () => null);
    const clearProtectedWorkGeneration = vi.fn(async () => undefined);
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({ markProtectedWorkGeneration, clearProtectedWorkGeneration }),
    });
    await result.current.handleStartAutoSolve();
    expect(sendProtectedTabMessageWithBootstrap).not.toHaveBeenCalled();
  });
});

describe("Phase14B-02C current-generation dispatch lease", () => {
  it("P14B02C_UI_04 a same-tab superseded START cannot dispatch and only rolls back its own token", async () => {
    const { sendProtectedTabMessageWithBootstrap } = await import("./tabActions");
    const generationId = "18aabcde-0ee2-4e98-8e12-48fdce879012";
    const markProtectedWorkGeneration = vi.fn(async () => generationId);
    const clearProtectedWorkGeneration = vi.fn(async () => undefined);
    const isProtectedWorkGenerationCurrent = vi.fn(() => false);
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({
        markProtectedWorkGeneration,
        clearProtectedWorkGeneration,
        isProtectedWorkGenerationCurrent,
      }),
    });
    await result.current.handleStartAutoSolve();
    expect(sendProtectedTabMessageWithBootstrap).not.toHaveBeenCalled();
    expect(clearProtectedWorkGeneration).toHaveBeenCalledWith("autoSolve", 7, generationId);
    expect(isProtectedWorkGenerationCurrent).toHaveBeenCalledWith("autoSolve", 7, generationId);
  });
});

describe("Phase14B-02C-B SidePanel Full Page generation-aware START", () => {
  const generationId = "18aabcde-0ee2-4e98-8e12-48fdce879012";
  it("P14B02C_FULLPAGE_07 dispatches only after owner generation commit", async () => {
    const { sendProtectedTabMessageWithBootstrap } = await import("./tabActions");
    const markProtectedWorkGeneration = vi.fn(async () => generationId);
    const clearProtectedWorkGeneration = vi.fn(async () => undefined);
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({ markProtectedWorkGeneration, clearProtectedWorkGeneration }),
    });
    await result.current.handleFullPageDetect();
    expect(markProtectedWorkGeneration).toHaveBeenCalledWith("fullPage", 7);
    expect(sendProtectedTabMessageWithBootstrap).toHaveBeenCalledWith(
      7, { type: "START_FULL_PAGE_DETECT", generationId }, expect.any(Function),
    );
  });
  it("P14B02C_FULLPAGE_08 failed dispatch rolls back only its own owner token", async () => {
    const { sendProtectedTabMessageWithBootstrap } = await import("./tabActions");
    vi.mocked(sendProtectedTabMessageWithBootstrap).mockResolvedValueOnce({ ok: false, error: "DENIED" });
    const clearProtectedWorkGeneration = vi.fn(async () => undefined);
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({
        markProtectedWorkGeneration: vi.fn(async () => generationId),
        clearProtectedWorkGeneration,
      }),
    });
    await result.current.handleFullPageDetect();
    expect(clearProtectedWorkGeneration).toHaveBeenCalledWith("fullPage", 7, generationId);
  });
  it("P14B02C_FULLPAGE_09 missing owner storage refuses START", async () => {
    const { sendProtectedTabMessageWithBootstrap } = await import("./tabActions");
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({
        markProtectedWorkGeneration: vi.fn(async () => null),
        clearProtectedWorkGeneration: vi.fn(async () => undefined),
      }),
    });
    await result.current.handleFullPageDetect();
    expect(sendProtectedTabMessageWithBootstrap).not.toHaveBeenCalled();
  });
});
