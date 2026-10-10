import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPopupRegistrationDraft,
  loadPopupRegistrationDraft,
  normalizePopupRegistrationDraft,
  POPUP_REGISTRATION_DRAFT_KEY,
  POPUP_REGISTRATION_DRAFT_TTL_MS,
  savePopupRegistrationDraft,
} from "./popupRegistrationDraft";

const entries = new Map<string, unknown>();
let writes: string[] = [];

beforeEach(() => {
  entries.clear();
  writes = [];
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: entries.get(key) })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          writes.push("set");
          for (const [key, value] of Object.entries(items)) entries.set(key, value);
        }),
        remove: vi.fn(async (key: string) => {
          writes.push("remove");
          entries.delete(key);
        }),
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("Popup registration non-authoritative session draft", () => {
  it("restores email, recipient-bound code field, and deadline after the 60-second cooldown", async () => {
    const now = Date.now();
    entries.set(POPUP_REGISTRATION_DRAFT_KEY, {
      version: 1,
      updatedAt: now - 120_000,
      email: "pilot@example.test",
      sentForEmail: "pilot@example.test",
      codeExpiresAt: now + 240_000,
      cooldownUntil: now - 60_000,
      backendUrl: "http://127.0.0.1:8787",
    });
    expect(await loadPopupRegistrationDraft()).toEqual({
      email: "pilot@example.test",
      sentForEmail: "pilot@example.test",
      codeExpiresAt: now + 240_000,
      cooldownUntil: now - 60_000,
      backendUrl: "http://127.0.0.1:8787",
    });
  });

  it("retains only the email after the server code expires", () => {
    const now = Date.now();
    expect(normalizePopupRegistrationDraft({
      version: 1,
      updatedAt: now - 500_000,
      email: "pilot@example.test",
      sentForEmail: "pilot@example.test",
      codeExpiresAt: now - 1,
      cooldownUntil: now - 450_000,
      backendUrl: "http://127.0.0.1:8787",
    }, now)).toEqual({ email: "pilot@example.test" });
  });

  it("never trusts code metadata when the destination email differs", () => {
    const now = Date.now();
    expect(normalizePopupRegistrationDraft({
      version: 1,
      updatedAt: now,
      email: "second@example.test",
      sentForEmail: "first@example.test",
      codeExpiresAt: now + 500_000,
      cooldownUntil: now + 40_000,
      backendUrl: "http://127.0.0.1:8787",
    }, now)).toEqual({ email: "second@example.test" });
  });

  it("rejects expired or malformed snapshots instead of resurrecting stale forms", () => {
    const now = Date.now();
    expect(normalizePopupRegistrationDraft({
      version: 1,
      updatedAt: now - POPUP_REGISTRATION_DRAFT_TTL_MS - 1,
      email: "pilot@example.test",
    }, now)).toBeNull();
    expect(normalizePopupRegistrationDraft({
      version: 1, updatedAt: now, email: "x".repeat(255),
    }, now)).toBeNull();
    expect(normalizePopupRegistrationDraft({
      version: 2, updatedAt: now, email: "pilot@example.test",
    }, now)).toBeNull();
  });

  it("persists only allowlisted non-secret fields, never password, token or OTP", async () => {
    const draft = {
      email: "pilot@example.test",
      sentForEmail: "pilot@example.test",
      codeExpiresAt: Date.now() + 500_000,
      cooldownUntil: Date.now() + 60_000,
      backendUrl: "http://127.0.0.1:8787",
      password: "never-persist-password",
      verificationCode: "123456",
      authToken: "never-persist-auth-token",
    };
    expect(await savePopupRegistrationDraft(draft)).toBe(true);
    const stored = entries.get(POPUP_REGISTRATION_DRAFT_KEY);
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain("never-persist-password");
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("never-persist-auth-token");
    expect(Object.keys(stored as Record<string, unknown>).sort()).toEqual([
      "backendUrl", "codeExpiresAt", "cooldownUntil", "email", "sentForEmail", "updatedAt", "version",
    ].sort());
  });

  it("serializes rapid email edits and the successful send snapshot in order", async () => {
    const first = savePopupRegistrationDraft({ email: "first@example.test" });
    const second = savePopupRegistrationDraft({ email: "second@example.test" });
    const third = savePopupRegistrationDraft({
      email: "second@example.test",
      sentForEmail: "second@example.test",
      codeExpiresAt: Date.now() + 500_000,
      cooldownUntil: Date.now() + 60_000,
      backendUrl: "http://127.0.0.1:8787",
    });
    expect(await Promise.all([first, second, third])).toEqual([true, true, true]);
    expect((await loadPopupRegistrationDraft())?.sentForEmail).toBe("second@example.test");
    expect(writes).toEqual(["set", "set", "set"]);
  });

  it("removes all progress on explicit clear and on a blank email", async () => {
    await savePopupRegistrationDraft({ email: "pilot@example.test" });
    expect(await clearPopupRegistrationDraft()).toBe(true);
    expect(await loadPopupRegistrationDraft()).toBeNull();
    await savePopupRegistrationDraft({ email: "pilot@example.test" });
    expect(await savePopupRegistrationDraft({ email: "" })).toBe(true);
    expect(await loadPopupRegistrationDraft()).toBeNull();
  });

  it("fails safely when session storage is unavailable", async () => {
    vi.stubGlobal("chrome", { storage: {} });
    expect(await loadPopupRegistrationDraft()).toBeNull();
    expect(await savePopupRegistrationDraft({ email: "pilot@example.test" })).toBe(false);
    expect(await clearPopupRegistrationDraft()).toBe(false);
  });
});
