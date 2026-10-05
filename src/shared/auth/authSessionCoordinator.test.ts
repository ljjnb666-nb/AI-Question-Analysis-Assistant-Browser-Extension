import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeSessionCandidateFingerprint, createAuthSessionCoordinator } from "./authSessionCoordinator";
import type { AuthSessionValidationResult } from "@/shared/utils/auth";
import type * as storageModule from "@/shared/utils/storage";

type SettingsRecord = Record<string, unknown>;
type LoadSettingsFn = typeof storageModule.loadSettings;

function createHarness(initialSettings: SettingsRecord = {}) {
  let settings: SettingsRecord = { ...initialSettings };
  const storageListeners = new Set<() => void>();
  const validationCalls: Array<{ seq: number; resolve: (result: AuthSessionValidationResult) => void }> = [];
  let validationSeq = 0;
  const loadSettings = vi.fn(async () => ({ ...settings })) as unknown as LoadSettingsFn;
  const validateAuthSession = vi.fn(() => {
    return new Promise<AuthSessionValidationResult>((resolve) => {
      validationSeq += 1;
      validationCalls.push({ seq: validationSeq, resolve });
    });
  });
  const saveSettings = (patch: SettingsRecord) => {
    settings = { ...settings, ...patch };
    for (const listener of storageListeners) listener();
  };
  const subscribeToStorageChanges = (listener: () => void) => {
    storageListeners.add(listener);
    return () => storageListeners.delete(listener);
  };
  const notifyStorageChanged = () => {
    for (const listener of storageListeners) listener();
  };

  const coordinator = createAuthSessionCoordinator({
    loadSettings,
    validateAuthSession,
    subscribeToStorageChanges,
  });

  return {
    coordinator,
    loadSettings,
    validateAuthSession,
    validationCalls,
    saveSettings,
    notifyStorageChanged,
    setSettings: (patch: SettingsRecord) => {
      settings = { ...settings, ...patch };
    },
  };
}

function authenticatedResult(userId = "usr-1", userEmail = "user@example.com"): AuthSessionValidationResult {
  return { status: "authenticated", userId, userEmail, expiresAt: 4102444800000 };
}

async function settle(microtaskRounds = 3) {
  for (let round = 0; round < microtaskRounds; round += 1) {
    await Promise.resolve();
  }
}

describe("authSessionCoordinator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AUTH_UI_INV_02_STARTUP_FAILS_CLOSED starts unauthenticated without a server call when no credentials exist", async () => {
    const h = createHarness({ userId: "", authToken: "" });
    h.coordinator.start();
    await settle();

    expect(h.validateAuthSession).not.toHaveBeenCalled();
    expect(h.coordinator.getState().status).toBe("unauthenticated");
    h.coordinator.dispose();
  });

  it("AUTH_UI_INV_02_STARTUP_FAILS_CLOSED validates a local candidate before authenticated", async () => {
    const h = createHarness({ userId: "usr-1", userEmail: "user@example.com", authToken: "tok-1" });
    h.coordinator.start();
    await settle();

    expect(h.coordinator.getState().status).toBe("validating");
    h.validationCalls[0].resolve(authenticatedResult());
    await settle();

    const state = h.coordinator.getState();
    expect(state.status).toBe("authenticated");
    expect(state.userId).toBe("usr-1");
    expect(state.userEmail).toBe("user@example.com");
    h.coordinator.dispose();
  });

  it("AUTH_UI_INV_03_SERVER_UNAVAILABLE_IS_NOT_AUTHENTICATED keeps credentials but stays locked, retry recovers", async () => {
    const h = createHarness({ userId: "usr-1", userEmail: "user@example.com", authToken: "tok-1" });
    h.coordinator.start();
    await settle();
    h.validationCalls[0].resolve({ status: "server_unavailable" });
    await settle();

    expect(h.coordinator.getState().status).toBe("server_unavailable");
    // Credentials must be retained for later recovery.
    expect(h.loadSettings).toHaveBeenCalled();

    const retryPromise = h.coordinator.retryValidation();
    await settle();
    h.validationCalls[1].resolve(authenticatedResult());
    await retryPromise;
    expect(h.coordinator.getState().status).toBe("authenticated");
    h.coordinator.dispose();
  });

  it("AUTH_UI_INV_04_INVALID_SESSION converges unauthenticated and reports sessionRejected", async () => {
    const h = createHarness({ userId: "usr-1", userEmail: "user@example.com", authToken: "tok-forged" });
    h.coordinator.start();
    await settle();
    h.validationCalls[0].resolve({ status: "unauthenticated" });
    await settle();

    const state = h.coordinator.getState();
    expect(state.status).toBe("unauthenticated");
    expect(state.sessionRejected).toBe(true);
    h.coordinator.dispose();
  });

  it("AUTH_UI_12_VALIDATION_RACE_LOGOUT stale success cannot reauthenticate after logout", async () => {
    const h = createHarness({ userId: "usr-1", userEmail: "user@example.com", authToken: "tok-1" });
    h.coordinator.start();
    await settle();

    // Logout lands while validation A is still in flight.
    h.coordinator.applyLoggedOut();
    h.saveSettings({ userId: undefined, userEmail: undefined, authToken: undefined });
    h.validationCalls[0].resolve(authenticatedResult());
    await settle();

    expect(h.coordinator.getState().status).toBe("unauthenticated");
    expect(h.coordinator.getState().userId).toBe("");
    h.coordinator.dispose();
  });

  it("AUTH_UI_13_VALIDATION_RACE_RELOGIN an older validation cannot overwrite a newer login session", async () => {
    const h = createHarness({ userId: "usr-old", userEmail: "old@example.com", authToken: "tok-A" });
    h.coordinator.start();
    await settle();
    expect(h.validationCalls.length).toBe(1);

    // Re-login with token B while validation A is in flight. The login flow
    // persists the new credentials before reporting the server result.
    h.setSettings({ userId: "usr-new", userEmail: "new@example.com", authToken: "tok-B" });
    await h.coordinator.applyAuthenticatedSession("usr-new", "new@example.com");
    h.validationCalls[0].resolve({ status: "server_unavailable" });
    await settle();

    const state = h.coordinator.getState();
    // The stale result (even a failure) must not clobber the fresh session...
    expect(state.status).toBe("authenticated");
    expect(state.userId).toBe("usr-new");

    // ...and the storage echo of the new credentials must not re-validate.
    const callsBefore = h.validateAuthSession.mock.calls.length;
    h.notifyStorageChanged();
    await settle();
    expect(h.validateAuthSession.mock.calls.length).toBe(callsBefore);
    h.coordinator.dispose();
  });

  it("AUTH_UI_14_STORAGE_CHANGE_NO_VALIDATION_LOOP unrelated settings writes and identity refresh echoes do not re-validate", async () => {
    const h = createHarness({ userId: "usr-1", userEmail: "user@example.com", authToken: "tok-1" });
    h.coordinator.start();
    await settle();
    h.validationCalls[0].resolve(authenticatedResult());
    await settle();
    expect(h.validateAuthSession).toHaveBeenCalledTimes(1);

    // validateAuthSession adopts the server identity via a settings write:
    // the resulting storage event must not schedule another validation.
    h.saveSettings({ language: "en" });
    await settle();
    h.saveSettings({ userEmail: "user@example.com" });
    await settle();
    expect(h.validateAuthSession).toHaveBeenCalledTimes(1);

    // A changed candidate does trigger exactly one new validation.
    h.setSettings({ authToken: "tok-2" });
    h.notifyStorageChanged();
    await settle();
    expect(h.validateAuthSession).toHaveBeenCalledTimes(2);
    h.validationCalls[1].resolve(authenticatedResult());
    await settle();

    // And a burst of duplicate notifications for the same candidate coalesce.
    h.notifyStorageChanged();
    h.notifyStorageChanged();
    h.notifyStorageChanged();
    await settle();
    expect(h.validateAuthSession).toHaveBeenCalledTimes(2);
    h.coordinator.dispose();
  });

  it("AUTH_UI_INV_06_STORAGE_CHANGE_TRIGGERS_REVALIDATION_NOT_TRUST a forged credential write validates against the server instead of unlocking", async () => {
    const h = createHarness({ userId: "", authToken: "" });
    h.coordinator.start();
    await settle();
    expect(h.coordinator.getState().status).toBe("unauthenticated");

    // An attacker forges local credentials; the UI must start validating, not
    // flip to authenticated.
    h.setSettings({ userId: "usr-forge", userEmail: "forge@example.com", authToken: "tok-forge" });
    h.notifyStorageChanged();
    await settle();

    expect(h.coordinator.getState().status).toBe("validating");
    h.validationCalls[0].resolve({ status: "unauthenticated" });
    await settle();
    expect(h.coordinator.getState().status).toBe("unauthenticated");
    h.coordinator.dispose();
  });

  it("AUTH_UI_CASE_C mount guard: results ignored after dispose", async () => {
    const h = createHarness({ userId: "usr-1", userEmail: "user@example.com", authToken: "tok-1" });
    h.coordinator.start();
    await settle();
    h.coordinator.dispose();
    h.validationCalls[0].resolve(authenticatedResult());
    await settle();

    expect(h.coordinator.getState().status).not.toBe("authenticated");
  });

  it("login echo writes are fingerprinted so no validation storm follows applyAuthenticatedSession", async () => {
    const h = createHarness({});
    h.coordinator.start();
    await settle();

    h.setSettings({ userId: "usr-1", userEmail: "user@example.com", authToken: "tok-login" });
    await h.coordinator.applyAuthenticatedSession("usr-1", "user@example.com");
    // saveSettings would now fire; simulate the echo:
    h.notifyStorageChanged();
    await settle();

    expect(h.validateAuthSession).not.toHaveBeenCalled();
    expect(h.coordinator.getState().status).toBe("authenticated");
    h.coordinator.dispose();
  });

  it("computeSessionCandidateFingerprint changes only with userId/token/backend", () => {
    const base = { userId: "u", authToken: "t", analyticsBaseUrl: "https://a" };
    expect(computeSessionCandidateFingerprint(base)).toBe(computeSessionCandidateFingerprint({ ...base }));
    expect(computeSessionCandidateFingerprint(base)).not.toBe(
      computeSessionCandidateFingerprint({ ...base, authToken: "t2" }),
    );
    expect(computeSessionCandidateFingerprint(base)).not.toBe(
      computeSessionCandidateFingerprint({ ...base, userId: "" }),
    );
    expect(computeSessionCandidateFingerprint({ userId: "u", authToken: "" })).toBe("");
  });
});

describe("E2B2B ordinary-read timing and rejected-session hint", () => {
  it("retains the server rejection hint when its credential-clear event arrives first", async () => {
    const h = createHarness({ userId: "usr-1", authToken: "forged" });
    h.coordinator.start(); await settle();
    h.saveSettings({ userId: undefined, authToken: undefined }); await settle();
    expect(h.coordinator.getState().status).toBe("unauthenticated");
    h.validationCalls[0].resolve({ status: "unauthenticated" }); await settle();
    expect(h.coordinator.getState()).toMatchObject({ status: "unauthenticated", sessionRejected: true, userId: "" });
    h.coordinator.dispose();
  });
  it.each(["logout", "login", "dispose"])("an old rejection cannot overwrite a newer %s action", async action => {
    const h = createHarness({ userId: "old", authToken: "old-token" });
    h.coordinator.start(); await settle();
    h.saveSettings({ userId: undefined, authToken: undefined }); await settle();
    if (action === "login") {
      h.setSettings({ userId: "new", authToken: "new-token" });
      await h.coordinator.applyAuthenticatedSession("new", "new@example.test");
    } else if (action === "logout") h.coordinator.applyLoggedOut();
    else h.coordinator.dispose();
    h.validationCalls[0].resolve({ status: "unauthenticated" }); await settle();
    expect(h.coordinator.getState().sessionRejected).toBe(false);
    expect(h.coordinator.getState().status).toBe(action === "login" ? "authenticated" : "unauthenticated");
    h.coordinator.dispose();
  });
});
