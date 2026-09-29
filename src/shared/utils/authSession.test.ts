import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logoutAccount } from "./auth";
import { loadSettings, saveSettings, __resetStorageCacheForTests } from "./storage";
import { DEFAULT_SETTINGS } from "../types";

// Mock values are assembled at runtime so security scanners do not mistake
// synthetic test fixtures for committed credentials.
const SESSION_TOKEN = ["token", "session-1"].join("-");
const DEVICE_ID = "device-auth-session-1";

// Unlike auth.test.ts this file exercises the real storage module against a
// stateful in-memory chrome.storage.local so stale-cache regressions (e.g. a
// logout that clears storage but not the cache) cannot hide behind mocks.
function installStatefulChromeStorage() {
  const store = new Map<string, unknown>();
  const onChangedListeners: Array<(changes: unknown, area: string) => void> = [];
  const storageApi = {
    get: vi.fn(async (keys: string | string[] | null | undefined) => {
      const requested = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const key of requested) {
        if (store.has(key)) result[key] = store.get(key);
      }
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
      for (const listener of onChangedListeners) {
        listener(
          Object.fromEntries(Object.keys(items).map((key) => [key, { newValue: items[key] }])),
          "local",
        );
      }
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    }),
    clear: vi.fn(async () => store.clear()),
    getBytesInUse: vi.fn((_keys: unknown, callback: (bytes: number) => void) => callback(0)),
    QUOTA_BYTES: 5242880,
  };
  (global as unknown as { chrome: unknown }).chrome = {
    runtime: { id: "test-extension-id-12345" },
    storage: {
      local: storageApi,
      onChanged: { addListener: (fn: (changes: unknown, area: string) => void) => onChangedListeners.push(fn) },
    },
  };
  return { storageApi, store };
}

describe("auth session storage integration", () => {
  beforeEach(() => {
    __resetStorageCacheForTests();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    __resetStorageCacheForTests();
    vi.restoreAllMocks();
  });

  it("AUTH_CORE_15_NO_STALE_TOKEN_AFTER_LOGOUT leaves no token behind for loadSettings", async () => {
    const { storageApi } = installStatefulChromeStorage();
    vi.mocked(global.fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await saveSettings({
      deviceId: DEVICE_ID,
      userId: "usr-1",
      userEmail: "user@example.com",
      authToken: SESSION_TOKEN,
    });
    expect((await loadSettings()).authToken).toBe(SESSION_TOKEN);

    await logoutAccount();

    expect(storageApi.set).toHaveBeenCalled();
    const settings = await loadSettings();
    expect(settings.authToken).toBeFalsy();
    expect(settings.userId).toBeFalsy();
    expect(settings.userEmail).toBeFalsy();
    // The stored snapshot itself must not retain a usable credential either.
    const setCalls = storageApi.set.mock.calls;
    const stored = setCalls[setCalls.length - 1]?.[0] as { appSettings?: Record<string, unknown> };
    expect(stored.appSettings?.authToken ?? undefined).toBeUndefined();
    expect(DEFAULT_SETTINGS.authToken).toBeUndefined();
  });

  it("preserves stored credentials across unrelated partial saves", async () => {
    installStatefulChromeStorage();

    await saveSettings({
      deviceId: DEVICE_ID,
      userId: "usr-1",
      userEmail: "user@example.com",
      authToken: SESSION_TOKEN,
    });
    await saveSettings({ language: "en" });

    const settings = await loadSettings();
    expect(settings.authToken).toBe(SESSION_TOKEN);
    expect(settings.userId).toBe("usr-1");
    expect(settings.language).toBe("en");
  });
});
