import { vi } from "vitest";

/**
 * Every promise produced by the mocked chrome.runtime.sendMessage is tracked
 * here until it settles. A message started in test N can otherwise complete
 * during test N+1 and write into the next test's store; teardown drains this
 * set so background handlers always finish against their own generation.
 */
const inFlightMessages = new Set<Promise<unknown>>();

function trackInFlight<T>(promise: Promise<T>): Promise<T> {
  inFlightMessages.add(promise);
  const release = () => inFlightMessages.delete(promise);
  promise.then(release, release);
  return promise;
}

/**
 * Resolves only when every message handed to the mocked transport has
 * settled. Loops because a settling handler can enqueue follow-up messages.
 * No arbitrary sleeps: purely settlement-driven.
 */
export async function awaitSettingsMessagingIdle(): Promise<void> {
  while (inFlightMessages.size > 0) {
    await Promise.allSettled([...inFlightMessages]);
  }
}

/** Real background handlers behind the test transport; no writer queue is mocked. */
export function installSettingsMessaging() {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(async message => {
    return trackInFlight((async () => {
      if (String((message as unknown as { type?: unknown })?.type).startsWith("APP_SETTINGS_")) {
        const { handleAppSettingsCommand } = await import("../background/appSettingsAuthority");
        return handleAppSettingsCommand(message, { id: chrome.runtime.id, url: chrome.runtime.getURL("sidepanel/sidepanel.html") });
      }
      const { handleAIConnectionCommand } = await import("../background/aiConnectionAuthority");
      return handleAIConnectionCommand(message, { id: chrome.runtime.id, url: chrome.runtime.getURL("sidepanel/sidepanel.html") });
    })());
  });
}
