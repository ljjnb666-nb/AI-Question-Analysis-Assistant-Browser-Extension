import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetStorageCacheForTests,
  addHistoryEntry,
  clearHistory,
  getOrCreateDeviceId,
  loadHistory,
  loadSettings,
  pruneIfNeeded,
  sanitizeHistoryEntry,
  saveSettings,
} from "./storage";
import { DEFAULT_SETTINGS } from "../types";
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

describe("storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetStorageCacheForTests();
  });

  describe("saveSettings", () => {
    it("merges with existing settings and encrypts sensitive settings", async () => {
      const existingSettings = { ...DEFAULT_SETTINGS, apiKey: "old-key" };
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        appSettings: existingSettings,
      } as never);

      await saveSettings({ apiKey: "new-key", authToken: "auth-token-123" });

      expect(chrome.storage.local.set).toHaveBeenCalled();
      const savedSettings = vi.mocked(chrome.storage.local.set).mock.calls[0][0].appSettings;
      expect(savedSettings.apiKey).not.toBe("new-key");
      expect(savedSettings.authToken).not.toBe("auth-token-123");
      expect(savedSettings.providerId).toBe(existingSettings.providerId);
      expect(savedSettings.apiModel).toBe(existingSettings.apiModel);
    });
  });

  describe("loadSettings", () => {
    it("returns default settings when storage is empty", async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({} as never);

      const settings = await loadSettings();

      expect(settings.providerId).toEqual(DEFAULT_SETTINGS.providerId);
      expect(settings.analyticsBaseUrl).toEqual(DEFAULT_SETTINGS.analyticsBaseUrl);
      expect(settings.deviceId).toBeTruthy();
    });

    it("merges stored settings with defaults and decrypts API key", async () => {
      const encryptedKey = "mockEncryptedKey1234567890abcdefghijklmnopqrstuvwxyz";
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        appSettings: { apiKey: encryptedKey },
      } as never);

      const settings = await loadSettings();

      expect(settings.apiKey).toBe("");
      expect(settings.providerId).toBe(DEFAULT_SETTINGS.providerId);
    });

    it("clears unreadable encrypted auth tokens", async () => {
      const encryptedToken = "mockEncryptedToken1234567890abcdefghijklmnopqrstuvwxyz";
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        appSettings: { authToken: encryptedToken },
      } as never);

      const settings = await loadSettings();

      expect(settings.authToken).toBe("");
    });

    it("reuses the in-memory cache for repeated reads", async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        appSettings: { providerId: "gemini" },
      } as never);

      const first = await loadSettings();
      const second = await loadSettings();

      expect(first.providerId).toBe("gemini");
      expect(second.providerId).toBe("gemini");
      expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("getOrCreateDeviceId", () => {
    it("reuses an existing device id", async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        appSettings: { deviceId: "dev-existing" },
      } as never);

      const deviceId = await getOrCreateDeviceId();

      expect(deviceId).toBe("dev-existing");
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it("creates and persists a device id when missing", async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({} as never);

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

  describe("loadHistory", () => {
    it("returns an empty array when no history exists", async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({} as never);

      const history = await loadHistory();

      expect(history).toEqual([]);
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
