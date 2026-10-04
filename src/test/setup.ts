import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock chrome API
global.chrome = {
  storage: {
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      getBytesInUse: vi.fn((keys, callback) => callback(0)),
      QUOTA_BYTES: 5242880,
    },
  },
  runtime: {
    sendMessage: vi.fn(async (message) => {
      if (String(message?.type).startsWith("APP_SETTINGS_")) {
        const { handleAppSettingsCommand } = await import("../background/appSettingsAuthority");
        return handleAppSettingsCommand(message, { id: chrome.runtime.id, url: chrome.runtime.getURL("sidepanel/sidepanel.html") });
      }
    }),
    getURL: vi.fn((path: string) => `chrome-extension://test-extension-id-12345/${path.replace(/^\//, "")}`),
    getManifest: vi.fn(() => ({ version: "0.2.0" })),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onInstalled: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    lastError: null,
    id: "test-extension-id-12345",
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
    captureVisibleTab: vi.fn(),
  },
  sidePanel: {
    open: vi.fn(),
  },
} as any;
