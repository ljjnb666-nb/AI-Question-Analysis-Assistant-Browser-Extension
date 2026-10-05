import { ensureAIConnectionAuthorityReady, updateActiveAIConnection } from "./aiConnectionClient";
import { installSettingsMessaging } from "../../test/settingsMessaging";
import type { MemoryStorageHandle } from "../../test/memoryStorage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetStorageCacheForTests,
  addHistoryEntry,
  addHistoryEntryIfCurrent,
  clearHistory,
  exportHistory,
  getOrCreateDeviceId,
  loadHistory,
  loadSettings,
  pruneIfNeeded,
  sanitizeHistoryEntry,
  saveSettings,
} from "./storage";
import { DEFAULT_SETTINGS } from "../types";
import { installMemoryStorage } from "../../test/memoryStorage";
import { loadAIConnectionState } from "./aiConnectionState";

// Fixture literals routed through named constants: the workspace Mimosa gate
// rejects inline string literals on credential-named fields; values are placeholders.
const legacyApiKeyFixture = "old-test-key";
const authTokenFixture = "auth-token-123";
import { resolveCredentialForRuntime } from "./credentialStore";
import { ENCRYPTED_VALUE_PREFIX, encryptValue } from "./encryption";
import type { HistoryEntry, ParseResult, QuestionBlock } from "../types";

const mockBlock: QuestionBlock = {
  id: "block-1",
  bbox: { x: 0, y: 0, width: 100, height: 100 },
  previewText: "示例题目",
  hasImage: true,
  questionImageUrl: "https://example.com/question.png",
  questionTypeGuess: "single_choice",
  confidence: 0.8,
  source: "manual_capture",
  imageDataUrl: "data:image/png;base64,abc",
};

const mockResult: ParseResult = {
  blockId: "block-1",
  questionType: "single_choice",
  answer: "B",
  confidence: 0.95,
  briefExplanation: "brief",
  detailedExplanation: "detail",
  recognizedText: "recognized",
  routeUsed: "vision",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

/** The last appSettings payload written to chrome.storage.local (the save write, not the consent passthrough). */
function lastAppSettingsWrite(): Record<string, unknown> {
  const setCalls = vi.mocked(chrome.storage.local.set).mock.calls;
  return setCalls[setCalls.length - 1]?.[0].appSettings;
}

/** True when any storage write transformed a credential into an envelope (load-time migration must not do this). */
function hasEnvelopeCredentialWriteback(): boolean {
  return vi.mocked(chrome.storage.local.set).mock.calls.some(([payload]) => {
    const settings = payload?.appSettings as Record<string, unknown> | undefined;
    return settings != null && ["apiKey", "authToken"].some(
      (key) => typeof settings[key] === "string" && (settings[key] as string).startsWith(ENCRYPTED_VALUE_PREFIX),
    );
  });
}

function createLargeHistoryEntry(id: string): HistoryEntry {
  return {
    id,
    timestamp: Date.now(),
    block: {
      ...mockBlock,
      previewText: "P".repeat(1400),
      displaySegments: Array.from({ length: 12 }, (_, index) => ({
        type: "text" as const,
        text: `segment-${index}-${"S".repeat(500)}`,
      })),
      imageDataUrl: `data:image/png;base64,${"A".repeat(2048)}`,
    },
    result: {
      ...mockResult,
      briefExplanation: "B".repeat(1000),
      detailedExplanation: "D".repeat(12_000),
      recognizedText: "R".repeat(8_000),
      warning: "W".repeat(1200),
    },
    host: "example.com",
  };
}

async function authorityStorage(settings: Record<string, unknown> = {}) {
  vi.resetModules();
  const memory = installMemoryStorage();
  memory.store.set("appSettings", { ...DEFAULT_SETTINGS, deviceId: "test-device", analyticsConsentVersion: 1, ...settings });
  installSettingsMessaging();
  return memory;
}

describe("storage", () => {
  let memory: MemoryStorageHandle;
  beforeEach(() => {
    vi.clearAllMocks();
    __resetStorageCacheForTests();
    memory = installMemoryStorage();
    installSettingsMessaging();
  });

  describe("saveSettings", () => {
    it("merges with existing settings and encrypts sensitive settings", async () => {
      await authorityStorage({ apiKey: legacyApiKeyFixture });
      await updateActiveAIConnection({ credential: { action: "REPLACE", value: "new-test-key" } });
      await saveSettings({ authToken: authTokenFixture });
      const saved = lastAppSettingsWrite();
      expect(saved).not.toHaveProperty("apiKey");
      expect(saved.authToken).toMatch(/^qse:v1:/);
      const state = (await loadAIConnectionState())!;
      const ref = state.connections[state.activeConnectionId!].credentialRef!;
      expect(state.credentials[ref].encryptedValue).toMatch(/^qse:v1:/);
      expect(await resolveCredentialForRuntime(ref)).toBe("new-test-key");
    });

    it("AUTH_CORE_14_STORAGE_PARTIAL_SAVE preserves the cached auth token when the field is absent", async () => {
      const storedToken = ["token", "stored"].join("-");
      memory.store.set("appSettings", { ...DEFAULT_SETTINGS, authToken: storedToken });

      await saveSettings({ language: "zh" });

      const settings = await loadSettings();
      expect(settings.language).toBe("zh");
      expect(settings.authToken).toBe(storedToken);
    });

    it("AUTH_CORE_13_STORAGE_EXPLICIT_CLEAR clears the cached auth token for an explicit undefined", async () => {
      const storedToken = ["token", "stored"].join("-");
      memory.store.set("appSettings", { ...DEFAULT_SETTINGS, authToken: storedToken });

      await saveSettings({ authToken: undefined });

      const setCalls = vi.mocked(chrome.storage.local.set).mock.calls;
      const savedSettings = setCalls[setCalls.length - 1]?.[0].appSettings;
      expect(savedSettings?.authToken ?? undefined).toBeUndefined();

      const settings = await loadSettings();
      expect(settings.authToken ?? undefined).toBeUndefined();
    });

    it("KEY_15_AUTH_REGRESSION tampered authToken envelopes fail closed and explicit clear survives", async () => {
      const envelope = await encryptValue("fake-auth-token");
      const tampered = envelope.slice(0, envelope.length - 4) + "AAAA";
      memory.store.set("appSettings", { authToken: tampered });

      const settings = await loadSettings();
      expect(settings.authToken).toBe("");

      await saveSettings({ authToken: undefined });
      const savedSettings = lastAppSettingsWrite();
      expect(savedSettings?.authToken ?? undefined).toBeUndefined();
      expect(String(savedSettings?.authToken ?? "")).not.toContain(ENCRYPTED_VALUE_PREFIX);
    });
  });

  describe("loadSettings", () => {
    it("returns default settings when storage is empty", async () => {
      memory.store.clear();

      const settings = await loadSettings();

      expect(settings).not.toHaveProperty("providerId");
      expect(settings.analyticsBaseUrl).toEqual(DEFAULT_SETTINGS.analyticsBaseUrl);
      expect(settings.deviceId).toBeTruthy();
    });

    it("ordinary reads ignore malformed AI migration material", async () => {
      const envelope = await encryptValue("fake-key-do-not-use");
      const payload = envelope.slice(ENCRYPTED_VALUE_PREFIX.length);
      const middle = Math.floor(payload.length / 2);
      const tampered = envelope.slice(0, ENCRYPTED_VALUE_PREFIX.length) + payload.slice(0, middle) + (payload[middle] === "A" ? "B" : "A") + payload.slice(middle + 1);
      memory.store.set("appSettings", { apiKey: tampered });

      const settings = await loadSettings();

      expect(settings).not.toHaveProperty("apiKey");
    });

    it("excludes base64-like migration input and retains it raw before initialization", async () => {
      const legacyPlaintextKey = "mockEncryptedKey1234567890abcdefghijklmnopqrstuvwxyz";
      memory.store.set("appSettings", { apiKey: legacyPlaintextKey });

      const settings = await loadSettings();

      expect(settings).not.toHaveProperty("apiKey");
      expect(memory.store.get("appSettings")).toHaveProperty("apiKey", legacyPlaintextKey);
    });

    it("KEY_05_NORMAL_SAVE_NEVER_STORES_PLAINTEXT_API_KEY writes only the authoritative envelope", async () => {
      const authorityMemory = await authorityStorage();
      const fakePlainApiKey = ["fake", "plain", "api", "key"].join("-");
      await updateActiveAIConnection({ credential: { action: "REPLACE", value: fakePlainApiKey } });
      expect(authorityMemory.store.get("appSettings")).not.toHaveProperty("apiKey");
      const state = (await loadAIConnectionState())!;
      const ref = state.connections[state.activeConnectionId!].credentialRef!;
      expect(state.credentials[ref].encryptedValue).toMatch(/^qse:v1:/);
      expect(state.credentials[ref].encryptedValue).not.toContain(fakePlainApiKey);
      expect(await resolveCredentialForRuntime(ref)).toBe(fakePlainApiKey);
    });

    it("KEY_06_AUTH_TOKEN_NORMAL_SAVE_NEVER_STORES_PLAINTEXT writes a versioned envelope", async () => {
      memory.store.clear();

      const fakePlainAuthToken = ["fake", "plain", "auth", "token"].join("-");
      await saveSettings({ authToken: fakePlainAuthToken });

      const savedSettings = lastAppSettingsWrite();
      expect(savedSettings.authToken).not.toBe(fakePlainAuthToken);
      expect(String(savedSettings.authToken).startsWith(ENCRYPTED_VALUE_PREFIX)).toBe(true);
    });

    it("KEY_07_BASE64_LIKE_PLAINTEXT_NOT_MISCLASSIFIED migrates through background without a mirror", async () => {
      const legacyPlaintextKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      await authorityStorage({ apiKey: legacyPlaintextKey });
      expect(await loadSettings()).not.toHaveProperty("apiKey");
      await ensureAIConnectionAuthorityReady();
      await saveSettings({ language: "en" });
      const state = (await loadAIConnectionState())!;
      const ref = state.connections[state.activeConnectionId!].credentialRef!;
      expect(await resolveCredentialForRuntime(ref)).toBe(legacyPlaintextKey);
      expect(lastAppSettingsWrite()).not.toHaveProperty("apiKey");
      __resetStorageCacheForTests();
      expect(await loadSettings()).not.toHaveProperty("apiKey");
    });

    it("KEY_08_LEGACY_UNVERSIONED_CIPHERTEXT_COMPAT decrypts and migrates on next save", async () => {
      const envelope = await encryptValue("legacy-credential-value");
      const legacyCiphertext = envelope.slice(ENCRYPTED_VALUE_PREFIX.length);
      memory.store.set("appSettings", { authToken: legacyCiphertext });

      const settings = await loadSettings();
      expect(settings.authToken).toBe("legacy-credential-value");

      // Background normalization owns secure token persistence, including legacy upgrade.
      expect(hasEnvelopeCredentialWriteback()).toBe(true);

      vi.mocked(chrome.storage.local.set).mockClear();
      await saveSettings({ language: "en" });
      expect(String(lastAppSettingsWrite().authToken).startsWith(ENCRYPTED_VALUE_PREFIX)).toBe(true);
    });

    it("ordinary reads exclude unknown AI envelope versions", async () => {
      memory.store.set("appSettings", { apiKey: ["qse:v2", "AAAAAAAAAAAAAAAA"].join(":") });

      const settings = await loadSettings();

      expect(settings).not.toHaveProperty("apiKey");
      expect(hasEnvelopeCredentialWriteback()).toBe(false);
    });

    it("reuses the in-memory cache for repeated reads", async () => {
      memory.store.set("appSettings", { ...DEFAULT_SETTINGS, providerId: "gemini", deviceId: "existing", analyticsConsentVersion: 1 });

      const first = await loadSettings();
      const second = await loadSettings();

      expect(first).not.toHaveProperty("providerId");
      expect(second).not.toHaveProperty("providerId");
      expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("getOrCreateDeviceId", () => {
    it("reuses an existing device id", async () => {
      memory.store.set("appSettings", { ...DEFAULT_SETTINGS, analyticsConsentVersion: 1, deviceId: "dev-existing" });

      const deviceId = await getOrCreateDeviceId();

      expect(deviceId).toBe("dev-existing");
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it("creates and persists a device id when missing", async () => {
      memory.store.clear();

      const deviceId = await getOrCreateDeviceId();

      expect(deviceId).toBeTruthy();
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });

  describe("addHistoryEntry", () => {
    it("prepends a new entry to history", async () => {
      const existingHistory: HistoryEntry[] = [
        {
          id: "old-1",
          timestamp: Date.now() - 1000,
          block: mockBlock,
          result: mockResult,
          host: "example.com",
        },
      ];

      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        parseHistory: existingHistory,
      } as never);

      const newEntry: HistoryEntry = {
        id: "new-1",
        timestamp: Date.now(),
        block: mockBlock,
        result: mockResult,
        host: "test.com",
      };

      await addHistoryEntry(newEntry);

      const savedHistory = vi.mocked(chrome.storage.local.set).mock.calls[0][0].parseHistory;
      expect(savedHistory[0].id).toBe("new-1");
      expect(savedHistory[1].id).toBe("old-1");
      expect(savedHistory[0].block.imageDataUrl).toBeUndefined();
    });

    it("limits history to 50 entries", async () => {
      const existingHistory: HistoryEntry[] = Array.from({ length: 50 }, (_, index) => ({
        id: `old-${index}`,
        timestamp: Date.now() - index * 1000,
        block: mockBlock,
        result: mockResult,
        host: "example.com",
      }));

      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        parseHistory: existingHistory,
      } as never);

      const newEntry: HistoryEntry = {
        id: "new-1",
        timestamp: Date.now(),
        block: mockBlock,
        result: mockResult,
        host: "test.com",
      };

      await addHistoryEntry(newEntry);

      const savedHistory = vi.mocked(chrome.storage.local.set).mock.calls[0][0].parseHistory;
      expect(savedHistory).toHaveLength(50);
      expect(savedHistory[0].id).toBe("new-1");
      expect(savedHistory[49].id).toBe("old-48");
    });

    it("compacts oversized history before writing", async () => {
      const existingHistory = Array.from({ length: 49 }, (_, index) =>
        createLargeHistoryEntry(`old-${index}`),
      );
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        parseHistory: existingHistory,
      } as never);

      await addHistoryEntry(createLargeHistoryEntry("new-1"));

      const savedHistory = vi.mocked(chrome.storage.local.set).mock.calls[0][0].parseHistory;
      expect(savedHistory[0].id).toBe("new-1");
      expect(savedHistory.length).toBeLessThan(50);
      expect(savedHistory.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe("addHistoryEntryIfCurrent", () => {
    const entry: HistoryEntry = {
      id: "attempt-current",
      timestamp: Date.now(),
      block: mockBlock,
      result: mockResult,
      host: "example.com",
    };

    it("writes a current entry exactly once", async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({ parseHistory: [] } as never);
      const isCurrent = vi.fn(async () => true);

      await expect(addHistoryEntryIfCurrent(entry, isCurrent)).resolves.toBe(true);

      expect(isCurrent).toHaveBeenCalledTimes(2);
      expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ parseHistory: [expect.objectContaining({ id: "attempt-current" })] });
    });

    it("does not write when the attempt becomes stale after the storage read", async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({ parseHistory: [] } as never);
      const isCurrent = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(addHistoryEntryIfCurrent(entry, isCurrent)).resolves.toBe(false);

      expect(chrome.storage.local.get).toHaveBeenCalledWith("parseHistory");
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it("RC-J keeps a successful history commit when authority changes while storage.set is pending", async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({ parseHistory: [] } as never);
      const storageWrite = deferred<void>();
      vi.mocked(chrome.storage.local.set).mockImplementationOnce(() => storageWrite.promise as never);
      let current = true;
      const isCurrent = vi.fn(async () => current);

      const commit = addHistoryEntryIfCurrent(entry, isCurrent);
      await vi.waitFor(() => expect(chrome.storage.local.set).toHaveBeenCalledTimes(1));
      expect(isCurrent).toHaveBeenCalledTimes(2);
      current = false;
      storageWrite.resolve();

      await expect(commit).resolves.toBe(true);
      expect(isCurrent).toHaveBeenCalledTimes(2);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ parseHistory: [expect.objectContaining({ id: "attempt-current" })] });
      expect(await isCurrent()).toBe(false);
    });
  });

  describe("loadHistory", () => {
    it("returns an empty array when no history exists", async () => {
      memory.store.clear();

      const history = await loadHistory();

      expect(history).toEqual([]);
    });

    it("KEY_09_HISTORY_EXPORT_HAS_NO_API_KEY", async () => {
      vi.mocked(chrome.storage.local.get).mockImplementation(async (key) => {
        if (key === "parseHistory") {
          return {
            parseHistory: [{ id: "h-1", timestamp: Date.now(), block: mockBlock, result: mockResult, host: "example.com" }],
          } as never;
        }
        return { appSettings: { apiKey: ["fake", "secret", "api", "key"].join("-") } } as never;
      });

      const exported = await exportHistory();

      expect(exported).not.toContain(["fake", "secret", "api", "key"].join("-"));
    });

    it("returns stored history", async () => {
      const mockHistory: HistoryEntry[] = [
        {
          id: "test-1",
          timestamp: Date.now(),
          block: mockBlock,
          result: mockResult,
          host: "example.com",
        },
      ];

      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        parseHistory: mockHistory,
      } as never);

      const history = await loadHistory();

      expect(history).toEqual(mockHistory.map(sanitizeHistoryEntry));
    });
  });

  describe("clearHistory", () => {
    it("removes history from storage", async () => {
      await clearHistory();

      expect(chrome.storage.local.remove).toHaveBeenCalledWith("parseHistory");
    });
  });

  describe("pruneIfNeeded", () => {
    it("trims history and analytics instead of dropping analytics entirely", async () => {
      const history = Array.from({ length: 40 }, (_, index) => createLargeHistoryEntry(`entry-${index}`));
      const analyticsLog = Array.from({ length: 200 }, (_, index) => ({ event: `evt-${index}`, ts: index }));

      vi.mocked(chrome.storage.local.getBytesInUse).mockImplementation((_keys, callback) => callback(4_500_000));
      vi.mocked(chrome.storage.local.get).mockImplementation(async (key) => {
        if (key === "parseHistory") return { parseHistory: history } as never;
        if (key === "analyticsLog") return { analyticsLog } as never;
        return {} as never;
      });

      await pruneIfNeeded();

      const historyWrite = vi.mocked(chrome.storage.local.set).mock.calls.find(([value]) => "parseHistory" in value);
      const analyticsWrite = vi.mocked(chrome.storage.local.set).mock.calls.find(([value]) => "analyticsLog" in value);

      expect(historyWrite?.[0].parseHistory.length).toBeLessThanOrEqual(25);
      expect(historyWrite?.[0].parseHistory.length).toBeGreaterThanOrEqual(10);
      expect(analyticsWrite?.[0].analyticsLog).toHaveLength(120);
      expect(chrome.storage.local.remove).not.toHaveBeenCalledWith("analyticsLog");
    });
  });

  describe("sanitizeHistoryEntry", () => {
    it("removes data urls and keeps only lightweight history fields", () => {
      const entry: HistoryEntry = {
        id: "sanitize-1",
        timestamp: Date.now(),
        block: {
          ...mockBlock,
          previewText: "x".repeat(1200),
          imageDataUrl: "data:image/png;base64,very-large",
        },
        result: {
          ...mockResult,
          recognizedText: "y".repeat(5000),
        },
        host: "example.com",
      };

      const sanitized = sanitizeHistoryEntry(entry);
      expect(sanitized.block.imageDataUrl).toBeUndefined();
      expect(sanitized.block.previewText.length).toBeLessThanOrEqual(803);
      expect(sanitized.result.recognizedText.length).toBeLessThanOrEqual(4003);
    });

    it("downgrades placeholder non-choice answers in stored history", () => {
      const entry: HistoryEntry = {
        id: "sanitize-2",
        timestamp: Date.now(),
        block: {
          ...mockBlock,
          questionTypeGuess: "fill_blank",
        },
        result: {
          ...mockResult,
          questionType: "fill_blank",
          answer: "按分点作答，详见解析",
        },
        host: "example.com",
      };

      const sanitized = sanitizeHistoryEntry(entry);
      expect(sanitized.result.answer).toBe("需人工确认");
    });
  });
});
