import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveSettings, loadSettings, addHistoryEntry, loadHistory, clearHistory } from "./storage";
import { DEFAULT_SETTINGS } from "../types";
import type { HistoryEntry } from "../types";

describe("storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("saveSettings", () => {
    it("should merge with existing settings and encrypt API key", async () => {
      const existingSettings = { ...DEFAULT_SETTINGS, apiKey: "old-key" };
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        appSettings: existingSettings,
      } as any);

      await saveSettings({ apiKey: "new-key" });

      expect(chrome.storage.local.set).toHaveBeenCalled();
      const savedSettings = vi.mocked(chrome.storage.local.set).mock.calls[0][0].appSettings;

      // API key should be encrypted (not plaintext)
      expect(savedSettings.apiKey).not.toBe("new-key");
      expect(savedSettings.apiKey.length).toBeGreaterThan(20);

      // Other settings should be preserved
      expect(savedSettings.providerId).toBe(existingSettings.providerId);
      expect(savedSettings.apiModel).toBe(existingSettings.apiModel);
    });
  });

  describe("loadSettings", () => {
    it("should return default settings when storage is empty", async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({} as any);

      const settings = await loadSettings();

      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it("should merge stored settings with defaults and decrypt API key", async () => {
      // Mock encrypted API key
      const encryptedKey = "mockEncryptedKey1234567890abcdefghijklmnopqrstuvwxyz";
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        appSettings: { apiKey: encryptedKey },
      } as any);

      const settings = await loadSettings();

      // Should attempt to decrypt (will fail in test, returns empty string)
      expect(settings.apiKey).toBe("");
      expect(settings.providerId).toBe(DEFAULT_SETTINGS.providerId);
    });
  });

  describe("addHistoryEntry", () => {
    it("should prepend new entry to history", async () => {
      const existingHistory: HistoryEntry[] = [
        {
          id: "old-1",
          timestamp: Date.now() - 1000,
          block: {} as any,
          result: {} as any,
          host: "example.com",
        },
      ];

      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        parseHistory: existingHistory,
      } as any);

      const newEntry: HistoryEntry = {
        id: "new-1",
        timestamp: Date.now(),
        block: {} as any,
        result: {} as any,
        host: "test.com",
      };

      await addHistoryEntry(newEntry);

      const savedHistory = vi.mocked(chrome.storage.local.set).mock.calls[0][0].parseHistory;
      expect(savedHistory[0].id).toBe("new-1");
      expect(savedHistory[1].id).toBe("old-1");
    });

    it("should limit history to 50 entries", async () => {
      const existingHistory: HistoryEntry[] = Array.from({ length: 50 }, (_, i) => ({
        id: `old-${i}`,
        timestamp: Date.now() - i * 1000,
        block: {} as any,
        result: {} as any,
        host: "example.com",
      }));

      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        parseHistory: existingHistory,
      } as any);

      const newEntry: HistoryEntry = {
        id: "new-1",
        timestamp: Date.now(),
        block: {} as any,
        result: {} as any,
        host: "test.com",
      };

      await addHistoryEntry(newEntry);

      const savedHistory = vi.mocked(chrome.storage.local.set).mock.calls[0][0].parseHistory;
      expect(savedHistory).toHaveLength(50);
      expect(savedHistory[0].id).toBe("new-1");
      expect(savedHistory[49].id).toBe("old-48"); // Last item is old-48, not old-0 (old-49 is dropped)
    });
  });

  describe("loadHistory", () => {
    it("should return empty array when no history", async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({} as any);

      const history = await loadHistory();

      expect(history).toEqual([]);
    });

    it("should return stored history", async () => {
      const mockHistory: HistoryEntry[] = [
        {
          id: "test-1",
          timestamp: Date.now(),
          block: {} as any,
          result: {} as any,
          host: "example.com",
        },
      ];

      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        parseHistory: mockHistory,
      } as any);

      const history = await loadHistory();

      expect(history).toEqual(mockHistory);
    });
  });

  describe("clearHistory", () => {
    it("should remove history from storage", async () => {
      await clearHistory();

      expect(chrome.storage.local.remove).toHaveBeenCalledWith("parseHistory");
    });
  });
});
