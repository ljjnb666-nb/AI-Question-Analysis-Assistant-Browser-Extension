import { beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import { renderHook } from "@testing-library/react";
import type { DetectedCandidate } from "@/shared/types";
import { DEFAULT_SETTINGS } from "@/shared/types";
import { useSidePanelActions } from "./useSidePanelActions";

const sentMessages: Array<{ tabId: number; type: string }> = [];

// Controllable handles for deterministic TOCTOU tests: when armed, the next
// getBestActionTab / isCandidateResultAuthorityCurrent call parks on a
// promise the test resolves explicitly.
let parkNextTabLookup = false;
const deferredTabResolvers: Array<(tab: chrome.tabs.Tab | null) => void> = [];
let parkNextCandidateAuthority = false;
const deferredCandidateResolvers: Array<(current: boolean) => void> = [];

vi.mock("./tabActions", () => ({
  getBestActionTab: vi.fn(() => {
    if (parkNextTabLookup) {
      parkNextTabLookup = false;
      return new Promise<chrome.tabs.Tab | null>((resolve) => deferredTabResolvers.push(resolve));
    }
    return Promise.resolve({ id: 7 } as chrome.tabs.Tab | null);
  }),
  sendTabMessageWithBootstrap: vi.fn(async (tabId: number, message: { type: string }) => {
    sentMessages.push({ tabId, type: message.type });
    return {};
  }),
  sendProtectedTabMessageWithBootstrap: vi.fn(async (tabId: number, message: { type: string }) => {
    sentMessages.push({ tabId, type: message.type });
    return {};
  }),
  requestBlockImage: vi.fn(),
  sendFillMessageWithVerify: vi.fn(),
  isCandidateResultAuthorityCurrent: vi.fn(() => {
    if (parkNextCandidateAuthority) {
      parkNextCandidateAuthority = false;
      return new Promise<boolean>((resolve) => deferredCandidateResolvers.push(resolve));
    }
    return Promise.resolve(true);
  }),
}));

vi.mock("./batchOperations", () => ({
  runBatchParse: vi.fn(async () => undefined),
  runBatchFill: vi.fn(async () => ({ totalFilled: 0, totalQuestions: 0 })),
  runFillCandidate: vi.fn(async () => ({ ok: true })),
  runRetryRisky: vi.fn(async () => undefined),
  runRetryVision: vi.fn(async () => undefined),
}));

vi.mock("@/shared/utils/parseRouter", () => ({
  getProvider: vi.fn(() => ({ defaultModel: "m", baseUrl: "b", models: [] })),
  hasSufficientPreviewText: vi.fn(() => true),
  parseQuestion: vi.fn(),
}));

vi.mock("@/shared/utils/analytics", () => ({
  logEvent: vi.fn(),
}));

// The cross-surface owner registry is mocked so the owner-commit promise can
// be parked deterministically (AUTH_UI_61/62).
vi.mock("@/shared/auth/protectedWorkOwner", () => ({
  markProtectedWorkOwner: vi.fn(async () => undefined),
  clearProtectedWorkOwner: vi.fn(async () => undefined),
  readProtectedWorkOwners: vi.fn(async () => ({ autoSolve: [], fullPage: [] })),
}));

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
    markProtectedWork: vi.fn(),
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

// The gate under test mirrors the live coordinator: the hook must consult
// this getter at invocation time, never a cached snapshot.
let authenticated = false;

// The Auto Solve START path guards on provider configuration (UI-00A) before
// its auth TOCTOU choreography; these tests exercise that choreography with a
// configured provider. Assembled at runtime so security scanners do not
// mistake this synthetic test fixture for a committed credential.
(chrome.storage.local.get as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({
  appSettings: { ...DEFAULT_SETTINGS, apiKey: ["test", "key"].join("-") },
});

beforeEach(() => {
  sentMessages.length = 0;
  authenticated = false;
  parkNextTabLookup = false;
  parkNextCandidateAuthority = false;
  deferredTabResolvers.length = 0;
  deferredCandidateResolvers.length = 0;
  vi.clearAllMocks();
});

describe("useSidePanelActions authority gate", () => {
  it("AUTH_UI_22_SIDEPANEL_HANDLER_GATE protected handlers dispatch nothing while unauthenticated", async () => {
    const setters = {
      setIsDetecting: vi.fn(),
      setIsFullPageScan: vi.fn(),
      setIsAutoSolving: vi.fn(),
      setIsBatchParsing: vi.fn(),
      setIsBatchFilling: vi.fn(),
      setIsRetryingRisky: vi.fn(),
    };
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions(setters),
    });

    await result.current.handleDetect();
    await result.current.handleFullPageDetect();
    await result.current.handleStartAutoSolve();
    await result.current.handleBatchParse();
    await result.current.handleBatchFill();
    await result.current.handleFillCandidate(makeCandidate());
    await result.current.handleRetryVision(makeCandidate());
    await result.current.handleRetryRisky();
    result.current.toggleSelect("block-1");
    await result.current.handleFlash("block-1");
    result.current.handleSelectAll();
    result.current.handleSelectRisky();
    result.current.handleClearSelection();

    expect(sentMessages).toEqual([]);
    // No protected flag may have been raised by a gated handler.
    for (const setter of Object.values(setters)) {
      expect(setter).not.toHaveBeenCalledWith(true);
    }
  });

  it("AUTH_UI_22_SIDEPANEL_HANDLER_GATE gate covers validating and server_unavailable states", async () => {
    // The getter is the contract: any non-authenticated status — validating,
    // server_unavailable, unauthenticated — must read as false at call time.
    for (const status of ["validating", "server_unavailable", "unauthenticated", "loading"]) {
      authenticated = status === "authenticated";
      const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
        initialProps: makeOptions(),
      });
      await result.current.handleDetect();
      await result.current.handleStartAutoSolve();
      expect(sentMessages, `status=${status} must not dispatch`).toEqual([]);
    }
  });

  it("AUTH_UI_22_SIDEPANEL_HANDLER_GATE gate opens exactly when the coordinator is authenticated", async () => {
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions(),
    });
    authenticated = true;
    await result.current.handleDetect();
    expect(sentMessages).toEqual([{ tabId: 7, type: "START_AUTO_DETECT" }]);
  });

  it("AUTH_UI_22_SIDEPANEL_HANDLER_GATE auth loss invalidates in-flight batch commits via isCandidateCurrent", async () => {
    const { runBatchParse } = await import("./batchOperations");
    authenticated = true;
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions(),
    });
    await result.current.handleBatchParse();
    expect(runBatchParse).toHaveBeenCalledTimes(1);
    const deps = vi.mocked(runBatchParse).mock.calls[0][1];
    const candidate = makeCandidate();

    authenticated = true;
    expect(await deps.isCandidateCurrent(candidate)).toBe(true);
    // Between async work and the committed side effect the session stopped
    // being validated: the commit authority must flip to false immediately.
    authenticated = false;
    expect(await deps.isCandidateCurrent(candidate)).toBe(false);
  });

  it("AUTH_UI_23_STOP_CANCEL_ALLOWED_AFTER_AUTH_LOSS stop and cancel stay available when logged out", async () => {
    authenticated = false;
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions(),
    });

    await result.current.handleStopAutoSolve();
    expect(sentMessages).toEqual([{ tabId: 7, type: "STOP_AUTO_SOLVE_ALL" }]);

    sentMessages.length = 0;
    await result.current.handleCancelFullPage();
    expect(sentMessages).toEqual([{ tabId: 7, type: "FULL_PAGE_DETECT_CANCELLED" }]);
  });

  // AUTH-UI-INV-12: the entry gate is necessary but not sufficient — the
  // authority must also hold after the tab lookup await, immediately before
  // the protected dispatch.
  it("AUTH_UI_28_START_AUTO_SOLVE_TOCTOU no START when auth is lost during the tab lookup", async () => {
    authenticated = true;
    parkNextTabLookup = true;
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions(),
    });

    const running = result.current.handleStartAutoSolve();
    // The provider-configuration guard (UI-00A) awaits settings before the
    // tab lookup; the parked lookup appears once that await settles.
    await vi.waitFor(() => expect(deferredTabResolvers.length).toBe(1));
    // Auth is lost while the tab lookup is still pending.
    authenticated = false;
    deferredTabResolvers[0]({ id: 7 } as chrome.tabs.Tab);
    await running;

    expect(sentMessages).toEqual([]);
  });

  it("AUTH_UI_29_FULL_PAGE_START_TOCTOU no full-page START when auth is lost during the tab lookup", async () => {
    authenticated = true;
    parkNextTabLookup = true;
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions(),
    });

    const running = result.current.handleFullPageDetect();
    authenticated = false;
    deferredTabResolvers[0]({ id: 7 } as chrome.tabs.Tab);
    await running;

    expect(sentMessages).toEqual([]);
  });

  it("AUTH_UI_30_DETECT_FLASH_SELECTION_TOCTOU detect dispatches nothing after mid-flight auth loss", async () => {
    authenticated = true;
    parkNextTabLookup = true;
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions(),
    });
    const running = result.current.handleDetect();
    authenticated = false;
    deferredTabResolvers[0]?.({ id: 7 } as chrome.tabs.Tab);
    await running;
    expect(sentMessages).toEqual([]);
  });

  it("AUTH_UI_30_DETECT_FLASH_SELECTION_TOCTOU highlight dispatches nothing after mid-flight auth loss", async () => {
    authenticated = true;
    parkNextTabLookup = true;
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions(),
    });
    const running = result.current.handleFlash("block-1");
    authenticated = false;
    deferredTabResolvers[0]?.({ id: 7 } as chrome.tabs.Tab);
    await running;
    expect(sentMessages).toEqual([]);
  });

  it("AUTH_UI_30_DETECT_FLASH_SELECTION_TOCTOU selection sync dispatches nothing after mid-flight auth loss", async () => {
    authenticated = true;
    parkNextTabLookup = true;
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({
        setCandidates: vi.fn(((updater: (prev: DetectedCandidate[]) => DetectedCandidate[]) =>
          updater([])) as React.Dispatch<React.SetStateAction<DetectedCandidate[]>>),
      }),
    });
    result.current.toggleSelect("block-1");
    authenticated = false;
    deferredTabResolvers[0]?.({ id: 7 } as chrome.tabs.Tab);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sentMessages).toEqual([]);
  });

  it("AUTH_UI_42_FULL_PAGE_AUTHORITY_LOST_AFTER_BOOTSTRAP a rejected START never enters running UI state", async () => {
    const { sendProtectedTabMessageWithBootstrap } = await import("./tabActions");
    authenticated = true;
    vi.mocked(sendProtectedTabMessageWithBootstrap).mockResolvedValueOnce({
      ok: false,
      error: "AUTHORITY_LOST_DURING_RETRY",
    });
    const setIsFullPageScan = vi.fn();
    const setScanProgress = vi.fn();
    const markProtectedWork = vi.fn();
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({ setIsFullPageScan, setScanProgress, markProtectedWork }),
    });

    await result.current.handleFullPageDetect();

    // The dispatch was blocked after bootstrap: no running UI state, no
    // progress, and the protected-work registry is cleared again.
    expect(setIsFullPageScan).not.toHaveBeenCalledWith(true);
    expect(setScanProgress).not.toHaveBeenCalledWith(expect.objectContaining({ progress: expect.anything() }));
    expect(markProtectedWork).toHaveBeenLastCalledWith("fullPage", false, 7);
    expect(sentMessages).toEqual([]);
  });

  it("AUTH_UI_43_DETECT_AUTHORITY_LOST_AFTER_BOOTSTRAP a blocked detect leaves no stale running state", async () => {
    const { sendProtectedTabMessageWithBootstrap } = await import("./tabActions");
    authenticated = true;
    vi.mocked(sendProtectedTabMessageWithBootstrap).mockResolvedValueOnce({
      ok: false,
      error: "AUTHORITY_LOST_DURING_RETRY",
    });
    const setIsDetecting = vi.fn();
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({ setIsDetecting }),
    });

    await result.current.handleDetect();

    expect(setIsDetecting).not.toHaveBeenCalledWith(true);
    expect(sentMessages).toEqual([]);
  });

  it("AUTH_UI_51_DETECT_POST_AWAIT_AUTH_LOSS a late-resolving successful detect cannot revive running UI", async () => {
    const { sendProtectedTabMessageWithBootstrap } = await import("./tabActions");
    authenticated = true;
    // Park the protected send itself: the authority recheck after the await
    // is what must gate the running-state flip.
    let resolveSend: (value: { ok: boolean }) => void = () => undefined;
    vi.mocked(sendProtectedTabMessageWithBootstrap).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );
    const setIsDetecting = vi.fn();
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({ setIsDetecting }),
    });

    const running = result.current.handleDetect();
    authenticated = false;
    resolveSend({ ok: true });
    await running;
    // Drain every microtask the blocked handler left behind: a suspended
    // chain here would starve the NEXT test's awaited dispatches.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The dispatch "succeeded" at transport level, but the authority had
    // already lapsed: no running UI state may be entered.
    expect(setIsDetecting).not.toHaveBeenCalledWith(true);
    expect(sentMessages).toEqual([]);
  });

  it("AUTH_UI_31_CANDIDATE_AUTHORITY_TOCTOU commit authority flips false when auth is lost mid-check", async () => {
    const { runBatchFill } = await import("./batchOperations");
    authenticated = true;
    parkNextCandidateAuthority = true;
    // UI-00B PART E gates zero-fillable selections before runBatchFill; this
    // TOCTOU exercises the authority check inside the fill run, so the
    // candidate must be fill-ready.
    const fillReady = makeCandidate({
      status: "success",
      result: {
        blockId: "block-1",
        questionType: "single_choice",
        answer: "B",
        confidence: 0.9,
        briefExplanation: "",
        detailedExplanation: "",
        recognizedText: "",
        routeUsed: "text",
        resultSource: "provider",
      },
    });
    const { result } = renderHook((options: HookOptions) => useSidePanelActions(options), {
      initialProps: makeOptions({ candidates: [fillReady] }),
    });

    await result.current.handleBatchFill();
    const deps = vi.mocked(runBatchFill).mock.calls[0][1];
    const candidate = makeCandidate();

    // AUTH holds while the candidate authority check is issued, then is
    // lost while it is pending, and the underlying check would have said
    // "current". The commit authority must still end up false.
    const authority = deps.isCandidateCurrent(candidate);
    authenticated = false;
    deferredCandidateResolvers[0](true);
    expect(await authority).toBe(false);
    // With no runtime dispatch authority, no fill side effect may follow.
    expect(sentMessages.filter((m) => m.type === "FILL_PARSED_ANSWER")).toEqual([]);
  });
});

vi.mock("@/shared/utils/legacyRuntimeSettingsCompat", async () => {
  const storage = await import("@/shared/utils/storage");
  const { getProvider } = await import("@/shared/ai/providers");
  return {
    loadLegacyRuntimeSettingsCompat: () => storage.loadSettings(),
    getAIConnectionReadiness: async () => {
      const fixture = await storage.loadSettings();
      return { ready: getProvider(fixture.providerId).keyOptional === true || Boolean(fixture.apiKey?.trim()) };
    },
  };
});
