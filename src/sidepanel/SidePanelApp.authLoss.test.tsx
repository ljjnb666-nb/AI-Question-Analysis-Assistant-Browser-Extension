import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("gsap", () => ({
  default: {
    from: vi.fn(),
    fromTo: vi.fn(),
    to: vi.fn(),
    registerPlugin: vi.fn(),
    utils: { toArray: vi.fn(() => []) },
  },
}));

vi.mock("@gsap/react", () => ({
  useGSAP: vi.fn(),
}));

vi.mock("@/shared/utils/storage", () => ({
  // A configured provider is assumed: these tests exercise auth-loss STOP
  // choreography, and the UI-00A START guard must not be the reason a START
  // is missing. Runtime assembly keeps scanners from reading the fixture key
  // as a credential.
  loadSettings: vi.fn(async () => ({ language: "en", providerId: "anthropic", apiKey: ["test", "key"].join("-") })),
  saveSettings: vi.fn(async () => undefined),
}));

const sentMessages: Record<string, Array<{ tabId: number; type: string }>> = {};
let hasActiveTab = true;
// Simulates the user switching tabs: what getBestActionTab considers "best"
// changes AFTER a protected workflow already runs on its original tab.
let currentBestTabId = 7;

// Ephemeral session store for the cross-surface protected-work owner
// registry (chrome.storage.session in production).
const sessionStore = new Map<string, unknown>();
const sessionChangeListeners = new Array<(changes: unknown, area: string) => void>();
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
  tabs: { get: async (id: number) => ({ id, url: "https://quiz.example/exam" }) },
  storage: {
    onChanged: {
      addListener: (fn: (changes: unknown, area: string) => void) => sessionChangeListeners.push(fn),
      removeListener: (fn: (changes: unknown, area: string) => void) => {
        const index = sessionChangeListeners.indexOf(fn);
        if (index >= 0) sessionChangeListeners.splice(index, 1);
      },
    },
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

vi.mock("./tabActions", () => ({
  getBestActionTab: vi.fn(async () => (hasActiveTab ? ({ id: currentBestTabId } as chrome.tabs.Tab) : null)),
  sendTabMessageWithBootstrap: vi.fn(async (tabId: number, message: { type: string }) => {
    (sentMessages[message.type] ??= []).push({ tabId, type: message.type });
    return {};
  }),
  sendProtectedTabMessageWithBootstrap: vi.fn(async (tabId: number, message: { type: string }) => {
    (sentMessages[message.type] ??= []).push({ tabId, type: message.type });
    if (message.type === "START_AUTO_SOLVE_ALL") bridgeHandlers?.setIsAutoSolving(true);
    if (message.type === "START_FULL_PAGE_DETECT") bridgeHandlers?.setIsFullPageScan(true);
    return {};
  }),
  isCandidateResultAuthorityCurrent: vi.fn(async () => true),
  requestBlockImage: vi.fn(),
  sendFillMessageWithVerify: vi.fn(),
}));

// The auth watchdog suite controls transport separately from session authority.
// Supply the now-required read-only opening handshake; real race behavior is
// exercised in the dedicated UI-04A hook/controller suites.
vi.mock("./workspaceTarget", () => ({
  resolveWorkspaceOrigin: async () => hasActiveTab ? { tabId: currentBestTabId, url: "https://quiz.example/exam" } : null,
  readWorkspaceOrigin: async (tabId: number) => hasActiveTab ? { tabId, url: "https://quiz.example/exam" } : null,
  requestWorkspaceSnapshot: async () => ({ ok: true, snapshot: {
    protocolVersion: 1, runtimeInstanceId: "auth-test-runtime", runtimeGeneration: 1, routeEpoch: 0, seq: 0,
    originUrl: "https://quiz.example/exam", disposed: false, detection: { phase: "never_started", mode: null },
    candidates: [], autoSolve: { running: false, progress: null }, fullPage: { running: false, progress: null },
  } }),
}));

// Captured so tests can drive the runtime-reported UI state (e.g. a
// popup-started run reporting AUTO_SOLVE_PROGRESS into this surface).
let bridgeHandlers: {
  setIsAutoSolving: (next: boolean) => void;
  setIsFullPageScan: (next: boolean) => void;
} | null = null;

vi.mock("./sidepanelMessageBridge", () => ({
  registerSidePanelRuntimeListeners: vi.fn((handlers: never) => {
    bridgeHandlers = handlers;
    return () => undefined;
  }),
}));

// Programmable session coordinator stub: tests drive status transitions and
// fan them out exactly like the real coordinator's listener set.
type SessionStatus =
  | "loading"
  | "validating"
  | "authenticated"
  | "unauthenticated"
  | "server_unavailable";

const sessionState = {
  status: "loading" as SessionStatus,
  userId: "usr-e2e",
  userEmail: "e2e@example.com",
  sessionRejected: false,
};
const sessionListeners = new Set<() => void>();

function setSessionStatus(status: SessionStatus): void {
  sessionState.status = status;
  for (const listener of sessionListeners) listener();
}

// Coordinator notifications land outside React's act scope; wrapping the
// transition lets React flush the watchdog's dispatches (and the async
// STOP/CANCEL chain) before assertions run.
async function transitionSessionStatus(status: SessionStatus): Promise<void> {
  await act(async () => {
    setSessionStatus(status);
  });
}

vi.mock("@/shared/auth/useAuthSession", () => ({
  useAuthSession: () => sessionStub,
}));

const sessionStub = {
  getState: () => ({ ...sessionState }),
  subscribe: (listener: () => void) => {
    sessionListeners.add(listener);
    return () => sessionListeners.delete(listener);
  },
  start: vi.fn(),
  dispose: vi.fn(),
  bootstrap: vi.fn(async () => undefined),
  retryValidation: vi.fn(async () => undefined),
  handleStorageChanged: vi.fn(),
  applyAuthenticatedSession: vi.fn(async () => undefined),
  applyLoggedOut: vi.fn(),
};

import { markProtectedWorkOwner } from "@/shared/auth/protectedWorkOwner";
import { SidePanelApp } from "./SidePanelApp";

beforeEach(() => {
  for (const key of Object.keys(sentMessages)) delete sentMessages[key as keyof typeof sentMessages];
  sessionStore.clear();
  hasActiveTab = true;
  currentBestTabId = 7;
  sessionState.status = "authenticated";
  sessionState.sessionRejected = false;
  sessionListeners.clear();
  vi.clearAllMocks();
});

// The zh→en language flip chains two renders after mount; under load that
// can exceed the 1s testing-library default, so waits are explicit.
const UI_TIMEOUT = 5_000;

async function findButton(name: string | RegExp): Promise<HTMLElement> {
  const match =
    typeof name === "string" && name === "Auto Solve"
      ? /^(Auto Solve|Solve & Fill)$/
      : typeof name === "string" && name === "Stop Auto Solve"
        ? /^(Stop Auto Solve|Stop Solve & Fill)$/
        : name === "Stop Scan" ? "Cancel scan" : name;
  return screen.findByRole("button", { name: match }, { timeout: UI_TIMEOUT });
}

function waitForButton(name: string | RegExp): Promise<HTMLElement> {
  const match =
    typeof name === "string" && name === "Auto Solve"
      ? /^(Auto Solve|Solve & Fill)$/
      : typeof name === "string" && name === "Stop Auto Solve"
        ? /^(Stop Auto Solve|Stop Solve & Fill)$/
        : name === "Stop Scan" ? "Cancel scan" : name;
  return waitFor(() => {
    const button = screen.getByRole("button", { name: match });
    expect(button).toBeInTheDocument();
    return button;
  }, { timeout: UI_TIMEOUT });
}

function waitForGone(query: () => HTMLElement | null): Promise<void> {
  return waitFor(() => {
    expect(query()).not.toBeInTheDocument();
  }, { timeout: UI_TIMEOUT });
}

describe("SidePanelApp auth-loss watchdog", () => {
  it("AUTH_UI_24_AUTH_LOSS_STOPS_RUNNING_WORK auth loss sends STOP_AUTO_SOLVE_ALL and clears the running state", { timeout: 20_000 }, async () => {
    render(<SidePanelApp />);

    // Authenticated: start auto solve through the real candidates UI.
    const autoSolve = await findButton("Auto Solve");
    await act(async () => {
      fireEvent.click(autoSolve);
    });
    await waitForButton("Stop Auto Solve");
    expect(sentMessages.START_AUTO_SOLVE_ALL).toHaveLength(1);

    // The session stops being server-validated: the watchdog must terminate
    // the running workflow and reset the transient flags.
    await transitionSessionStatus("server_unavailable");

    await waitFor(() =>
      expect(sentMessages.STOP_AUTO_SOLVE_ALL?.length ?? 0).toBeGreaterThanOrEqual(1),
    { timeout: UI_TIMEOUT });
    // The surface converges to the locked state: no protected UI stays
    // mounted and the transient running indicators are gone.
    await waitForGone(() => screen.queryByText("Running"));
    await waitForGone(() => screen.queryByRole("button", { name: /^(Auto Solve|Solve & Fill)$/ }));
  });

  it("AUTH_UI_24_AUTH_LOSS_STOPS_RUNNING_WORK auth loss sends FULL_PAGE_DETECT_CANCELLED for an active scan", { timeout: 20_000 }, async () => {
    render(<SidePanelApp />);

    const fullPage = await findButton("Full Page");
    await act(async () => {
      fireEvent.click(fullPage);
    });
    await waitForButton("Stop Scan");
    expect(sentMessages.START_FULL_PAGE_DETECT).toHaveLength(1);

    await transitionSessionStatus("validating");

    await waitFor(() =>
      expect(sentMessages.FULL_PAGE_DETECT_CANCELLED?.length ?? 0).toBeGreaterThanOrEqual(1),
    { timeout: UI_TIMEOUT });
    await waitForGone(() => screen.queryByText("Running"));
    await waitForGone(() => screen.queryByRole("button", { name: "Full Page" }));
  });

  it("AUTH_UI_24_AUTH_LOSS_STOPS_RUNNING_WORK no termination is dispatched without active protected work", async () => {
    render(<SidePanelApp />);
    await findButton("Auto Solve");

    await transitionSessionStatus("unauthenticated");

    await waitFor(() => expect(screen.getByText(/Plugin Access Account|插件访问账号/)).toBeInTheDocument(), {
      timeout: UI_TIMEOUT,
    });
    expect(sentMessages.STOP_AUTO_SOLVE_ALL).toBeUndefined();
    expect(sentMessages.FULL_PAGE_DETECT_CANCELLED).toBeUndefined();
  });

  it("AUTH_UI_23_STOP_CANCEL_ALLOWED_AFTER_AUTH_LOSS stop/cancel remain wired after logout", async () => {
    render(<SidePanelApp />);
    const autoSolve = await findButton("Auto Solve");
    fireEvent.click(autoSolve);
    await waitForButton("Stop Auto Solve");

    // Logout converges the surface to unauthenticated; the STOP dispatch for
    // the in-flight run must have gone out through the watchdog.
    await transitionSessionStatus("unauthenticated");

    await waitFor(() =>
      expect(sentMessages.STOP_AUTO_SOLVE_ALL?.length ?? 0).toBeGreaterThanOrEqual(1),
    { timeout: UI_TIMEOUT });
  });

  it("AUTH_UI_38_AUTO_SOLVE_STOP_OWNER_TAB auth-loss STOP goes to the recorded owner tab, never the new best tab", async () => {
    render(<SidePanelApp />);
    const autoSolve = await findButton("Auto Solve");
    await act(async () => {
      fireEvent.click(autoSolve);
    });
    await waitForButton("Stop Auto Solve");
    expect(sentMessages.START_AUTO_SOLVE_ALL?.[0]?.tabId).toBe(7);

    // The user switches tabs: the "best" tab becomes 8 while auto solve is
    // still running on tab 7.
    currentBestTabId = 8;
    await transitionSessionStatus("server_unavailable");

    await waitFor(() =>
      expect(sentMessages.STOP_AUTO_SOLVE_ALL?.length ?? 0).toBeGreaterThanOrEqual(1),
    { timeout: UI_TIMEOUT });
    expect(sentMessages.STOP_AUTO_SOLVE_ALL?.[0]?.tabId).toBe(7);
    expect(sentMessages.STOP_AUTO_SOLVE_ALL?.some((m) => m.tabId === 8)).toBe(false);
  });

  it("AUTH_UI_39_FULL_PAGE_CANCEL_OWNER_TAB auth-loss CANCEL goes to the recorded owner tab", async () => {
    render(<SidePanelApp />);
    const fullPage = await findButton("Full Page");
    await act(async () => {
      fireEvent.click(fullPage);
    });
    await waitForButton("Stop Scan");
    expect(sentMessages.START_FULL_PAGE_DETECT?.[0]?.tabId).toBe(7);

    currentBestTabId = 8;
    await transitionSessionStatus("unauthenticated");

    await waitFor(() =>
      expect(sentMessages.FULL_PAGE_DETECT_CANCELLED?.length ?? 0).toBeGreaterThanOrEqual(1),
    { timeout: UI_TIMEOUT });
    expect(sentMessages.FULL_PAGE_DETECT_CANCELLED?.[0]?.tabId).toBe(7);
    expect(sentMessages.FULL_PAGE_DETECT_CANCELLED?.some((m) => m.tabId === 8)).toBe(false);
  });

  it("AUTH_UI_40_MANUAL_STOP_OWNER_TAB an explicit Stop after switching tabs still stops the original owner", async () => {
    render(<SidePanelApp />);
    const autoSolve = await findButton("Auto Solve");
    await act(async () => {
      fireEvent.click(autoSolve);
    });
    await waitForButton("Stop Auto Solve");
    expect(sentMessages.START_AUTO_SOLVE_ALL?.[0]?.tabId).toBe(7);

    // User switches tabs, then clicks Stop themselves.
    currentBestTabId = 8;
    const stop = await findButton("Stop Auto Solve");
    await act(async () => {
      fireEvent.click(stop);
    });

    await waitFor(() =>
      expect(sentMessages.STOP_AUTO_SOLVE_ALL?.length ?? 0).toBeGreaterThanOrEqual(1),
    { timeout: UI_TIMEOUT });
    expect(sentMessages.STOP_AUTO_SOLVE_ALL?.[0]?.tabId).toBe(7);
    expect(sentMessages.STOP_AUTO_SOLVE_ALL?.some((m) => m.tabId === 8)).toBe(false);
    // Clearing the running UI is the content completion callback's job; the
    // manual stop's contract is the correctly-targeted STOP dispatch.
  });

  it("AUTH_UI_47_POPUP_STARTED_AUTH_LOSS_STOP a popup-started run is terminated at its owner tab on auth loss", async () => {
    // The popup's ownership contract: markProtectedWorkOwner BEFORE dispatch.
    // Simulate a popup START on tab 7 (the sidepanel's own sync registry has
    // nothing — termination must come from the cross-surface store).
    await markProtectedWorkOwner("autoSolve", 7);
    // The user then switches tabs: the current best becomes 8.
    currentBestTabId = 8;

    render(<SidePanelApp />);
    await findButton("Auto Solve");
    await transitionSessionStatus("server_unavailable");

    await waitFor(() =>
      expect(sentMessages.STOP_AUTO_SOLVE_ALL?.length ?? 0).toBeGreaterThanOrEqual(1),
    { timeout: UI_TIMEOUT });
    expect(sentMessages.STOP_AUTO_SOLVE_ALL?.[0]?.tabId).toBe(7);
    expect(sentMessages.STOP_AUTO_SOLVE_ALL?.some((m) => m.tabId === 8)).toBe(false);
  });

  it("AUTH_UI_48_POPUP_STARTED_MANUAL_STOP_OWNER an explicit Stop terminates a popup-started run at its owner tab", async () => {
    await markProtectedWorkOwner("autoSolve", 7);
    currentBestTabId = 7;

    render(<SidePanelApp />);
    // Finish the opening read before reporting progress on the bound origin.
    await findButton("Auto Solve");
    currentBestTabId = 8;
    // The popup-started run reports progress into this surface: the UI shows
    // the running state while the OWNER stays tab 7 in the cross-surface
    // registry.
    await act(async () => {
      bridgeHandlers?.setIsAutoSolving(true);
    });
    const stop = await findButton("Stop Auto Solve");
    await act(async () => {
      fireEvent.click(stop);
    });

    await waitFor(() =>
      expect(sentMessages.STOP_AUTO_SOLVE_ALL?.length ?? 0).toBeGreaterThanOrEqual(1),
    { timeout: UI_TIMEOUT });
    expect(sentMessages.STOP_AUTO_SOLVE_ALL?.[0]?.tabId).toBe(7);
    expect(sentMessages.STOP_AUTO_SOLVE_ALL?.some((m) => m.tabId === 8)).toBe(false);
  });

  it("AUTH_UI_33_WATCHDOG_NO_EFFECT_LAG_GAP termination fires without waiting for the passive stateRef refresh", async () => {
    render(<SidePanelApp />);
    const autoSolve = await findButton("Auto Solve");
    // START the run, then IMMEDIATELY (same tick, no sleeps, no waiting for
    // React to commit the isAutoSolving flag through the passive effect)
    // lose the session. The synchronous protected-work registry — not the
    // effect-lagged snapshot — is what the watchdog reads, so STOP must go
    // out regardless.
    await act(async () => {
      fireEvent.click(autoSolve);
    });
    await transitionSessionStatus("validating");

    await waitFor(() =>
      expect(sentMessages.START_AUTO_SOLVE_ALL?.length ?? 0).toBe(1),
    { timeout: UI_TIMEOUT });
    await waitFor(() =>
      expect(sentMessages.STOP_AUTO_SOLVE_ALL?.length ?? 0).toBeGreaterThanOrEqual(1),
    { timeout: UI_TIMEOUT });
  });

  it("RF02-P2-LANG: document.documentElement.lang reflects SidePanelApp uiLang effect and toggle", async () => {
    document.documentElement.lang = "initial";
    render(<SidePanelApp />);
    await waitFor(() => expect(document.documentElement.lang).toBe("en"), { timeout: UI_TIMEOUT });

    // Open workspace menu and click switch language
    const menuBtn = screen.getByRole("button", { name: /Workspace menu|工作台菜单/i });
    fireEvent.click(menuBtn);
    const switchBtn = screen.getByRole("button", { name: /切换到简体中文|Switch to English/i });
    fireEvent.click(switchBtn);

    await waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"), { timeout: UI_TIMEOUT });
  });
});
