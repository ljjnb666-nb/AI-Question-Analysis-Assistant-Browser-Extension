import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuthController } from "./useAuthController";

// The session stub records its call ORDER relative to the auth module calls,
// which is exactly what AUTH-UI-INV-14 prescribes: applyLoggedOut lands
// before any network or preparation work.
const eventLog: string[] = [];
const sessionListeners = new Set<() => void>();
const sessionStub = {
  getState: () => ({ status: "authenticated" as const, userId: "usr-1", userEmail: "u@example.com", sessionRejected: false }),
  subscribe: (l: () => void) => {
    sessionListeners.add(l);
    return () => sessionListeners.delete(l);
  },
  start: vi.fn(),
  dispose: vi.fn(),
  bootstrap: vi.fn(),
  retryValidation: vi.fn(),
  handleStorageChanged: vi.fn(),
  applyAuthenticatedSession: vi.fn(),
  applyLoggedOut: vi.fn(() => eventLog.push("applyLoggedOut")),
};

vi.mock("@/shared/auth/useAuthSession", () => ({
  useAuthSession: () => sessionStub,
}));

// logoutAccount never resolves: a hanging server must not delay the local
// fail-closed.
let releaseLogout: (() => void) | null = null;
vi.mock("@/shared/utils/auth", () => ({
  logoutAccount: vi.fn(
    () =>
      new Promise((resolve) => {
        eventLog.push("logoutAccount");
        releaseLogout = () => resolve({ serverRevoked: false, serverStatus: "network_error" });
      }),
  ),
  loginWithEmail: vi.fn(),
  registerWithEmailCode: vi.fn(),
  sendEmailVerificationCode: vi.fn(),
}));

beforeEach(() => {
  eventLog.length = 0;
  releaseLogout = null;
  sessionListeners.clear();
  vi.clearAllMocks();
});

describe("useAuthController immediate logout", () => {
  it("AUTH_UI_41_SETTINGS_LOGOUT_IMMEDIATE settings logout bypasses beforeAction and fails closed first", async () => {
    const beforeAction = vi.fn(
      () =>
        new Promise<void>((_resolve) => {
          eventLog.push("beforeAction");
          releaseLogout?.();
        }),
    );
    const { result } = renderHook(() =>
      useAuthController({ lang: "zh", variant: "settings", beforeAction }),
    );

    await act(async () => {
      result.current.handleLogout();
    });

    // The logout must NOT wait for (or even invoke) the settings-persisting
    // beforeAction: local authority drops first, network revoke second.
    expect(beforeAction).not.toHaveBeenCalled();
    expect(eventLog).toEqual(["applyLoggedOut", "logoutAccount"]);

    // Explicit release: the eventual hint may land whenever the revoke
    // settles; the session is already unauthenticated.
    releaseLogout?.();
  });

  it("AUTH_UI_41_POPUP_LOGOUT_IMMEDIATE popup logout fails closed first with no preparation", async () => {
    const { result } = renderHook(() => useAuthController({ lang: "zh", variant: "popup" }));

    await act(async () => {
      result.current.handleLogout();
    });

    expect(eventLog).toEqual(["applyLoggedOut", "logoutAccount"]);
    releaseLogout?.();
  });
});
