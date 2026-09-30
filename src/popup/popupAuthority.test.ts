import { describe, expect, it, vi } from "vitest";
import { computeSessionCandidateFingerprint, createAuthSessionCoordinator } from "@/shared/auth/authSessionCoordinator";
import { createPopupAuthority } from "./popupAuthority";
import type { AuthSessionValidationResult } from "@/shared/utils/auth";
import type * as storageModule from "@/shared/utils/storage";

type LoadSettingsFn = typeof storageModule.loadSettings;

function createSessionHarness(initialSettings: Record<string, unknown>) {
  let settings = { ...initialSettings };
  const listeners = new Set<() => void>();
  const pendingValidations: Array<(result: AuthSessionValidationResult) => void> = [];
  const loadSettings = vi.fn(async () => ({ ...settings })) as unknown as LoadSettingsFn;
  const validateAuthSession = vi.fn(
    () => new Promise<AuthSessionValidationResult>((resolve) => pendingValidations.push(resolve)),
  );
  const coordinator = createAuthSessionCoordinator({
    loadSettings,
    validateAuthSession,
    subscribeToStorageChanges: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return {
    coordinator,
    validate: pendingValidations,
    notifyStorage: () => {
      for (const listener of listeners) listener();
    },
    setSettings: (patch: Record<string, unknown>) => {
      settings = { ...settings, ...patch };
    },
  };
}

describe("popupAuthority", () => {
  it("AUTH_UI_27_POPUP_HANDLER_USES_CURRENT_AUTHORITY reads the coordinator live, not a render snapshot", async () => {
    const h = createSessionHarness({
      userId: "usr-1",
      userEmail: "user@example.com",
      authToken: "tok-1",
    });
    const authority = createPopupAuthority(h.coordinator);
    h.coordinator.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // While validation is pending the handler authority is already false —
    // before any React render or passive effect has observed the state.
    expect(authority.isAuthenticatedNow()).toBe(false);

    h.validate[0]({ status: "authenticated", userId: "usr-1", userEmail: "user@example.com" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(authority.isAuthenticatedNow()).toBe(true);

    // The coordinator flips to non-authenticated (e.g. logout broadcast);
    // the getter must reflect the CURRENT state immediately, with no
    // effect-lagged window a stale handler could slip through.
    h.coordinator.applyLoggedOut();
    expect(authority.isAuthenticatedNow()).toBe(false);

    h.coordinator.dispose();
  });

  it("AUTH_UI_27_POPUP_HANDLER_USES_CURRENT_AUTHORITY server_unavailable and validating never authorize", async () => {
    const h = createSessionHarness({
      userId: "usr-1",
      userEmail: "user@example.com",
      authToken: "tok-1",
    });
    const authority = createPopupAuthority(h.coordinator);
    h.coordinator.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.validate[0]({ status: "server_unavailable" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(authority.isAuthenticatedNow()).toBe(false);

    // Retry schedules a fresh validation (not awaited: it cannot settle
    // until the fake server answers); until then the handler stays
    // unauthorized.
    void h.coordinator.retryValidation();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(authority.isAuthenticatedNow()).toBe(false);
    expect(h.validate.length).toBe(2);
    h.validate[1]({ status: "unauthenticated" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(authority.isAuthenticatedNow()).toBe(false);

    h.coordinator.dispose();
  });

  it("AUTH_UI_27_POPUP_HANDLER_USES_CURRENT_AUTHORITY forged storage writes never authorize", async () => {
    const h = createSessionHarness({ userId: "", authToken: "" });
    const authority = createPopupAuthority(h.coordinator);
    h.coordinator.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(authority.isAuthenticatedNow()).toBe(false);

    h.setSettings({ userId: "usr-forge", userEmail: "forge@example.com", authToken: "tok-forge" });
    h.notifyStorage();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Forged credentials only ever mean validating against the server.
    expect(authority.isAuthenticatedNow()).toBe(false);
    expect(computeSessionCandidateFingerprint({ userId: "u", authToken: "t" })).not.toBe("");

    h.validate[0]({ status: "unauthenticated" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(authority.isAuthenticatedNow()).toBe(false);

    h.coordinator.dispose();
  });
});
