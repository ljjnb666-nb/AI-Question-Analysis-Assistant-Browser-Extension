import { vi } from "vitest";

/** Real background handlers behind the test transport; no writer queue is mocked. */
export function installSettingsMessaging() {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(async message => {
    if (String((message as unknown as { type?: unknown })?.type).startsWith("APP_SETTINGS_")) {
      const { handleAppSettingsCommand } = await import("../background/appSettingsAuthority");
      return handleAppSettingsCommand(message, { id: chrome.runtime.id, url: chrome.runtime.getURL("sidepanel/sidepanel.html") });
    }
    const { handleAIConnectionCommand } = await import("../background/aiConnectionAuthority");
    return handleAIConnectionCommand(message, { id: chrome.runtime.id, url: chrome.runtime.getURL("sidepanel/sidepanel.html") });
  });
}
