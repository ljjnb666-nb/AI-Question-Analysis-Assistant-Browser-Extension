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
  loadSettings: vi.fn(async () => ({ language: "en" })),
  saveSettings: vi.fn(async () => undefined),
}));

const sentMessages: Record<string, Array<{ tabId: number; type: string }>> = {};
let hasActiveTab = true;

vi.mock("./tabActions", () => ({
  getBestActionTab: vi.fn(async () => (hasActiveTab ? ({ id: 7 } as chrome.tabs.Tab) : null)),
  sendTabMessageWithBootstrap: vi.fn(async (tabId: number, message: { type: string }) => {
    (sentMessages[message.type] ??= []).push({ tabId, type: message.type });
    return {};
  }),
  isCandidateResultAuthorityCurrent: vi.fn(async () => true),
  requestBlockImage: vi.fn(),
  sendFillMessageWithVerify: vi.fn(),
}));

vi.mock("./sidepanelMessageBridge", () => ({
  registerSidePanelRuntimeListeners: vi.fn(() => vi.fn()),
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

import { SidePanelApp } from "./SidePanelApp";

beforeEach(() => {
  for (const key of Object.keys(sentMessages)) delete sentMessages[key as keyof typeof sentMessages];
  hasActiveTab = true;
  sessionState.status = "authenticated";
  sessionState.sessionRejected = false;
  sessionListeners.clear();
  vi.clearAllMocks();
});

// The zh→en language flip chains two renders after mount; under load that
// can exceed the 1s testing-library default, so waits are explicit.
const UI_TIMEOUT = 5_000;

async function findButton(name: string): Promise<HTMLElement> {
  return screen.findByRole("button", { name }, { timeout: UI_TIMEOUT });
}

function waitForButton(name: string): Promise<HTMLElement> {
  return waitFor(() => {
    const button = screen.getByRole("button", { name });
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
    await waitForGone(() => screen.queryByRole("button", { name: "Auto Solve" }));
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
});
