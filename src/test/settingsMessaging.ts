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
 * Single task-turn quiescence barrier. Yields one macrotask boundary so every
 * microtask continuation scheduled by just-settled transport promises — in
 * particular caller code whose continuation enqueues a follow-up message —
 * has fully run before the drain loop re-checks the in-flight set. This is a
 * semantic event-loop barrier, not a delay: no wall-clock time is consumed
 * beyond yielding the current turn, and it never gates on timing guesses.
 */
function quiescenceTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Resolves only when the transport is transitively idle: no message is in
 * flight AND one full task turn has passed in which no caller continuation
 * enqueued a follow-up message. Settlement-driven; no arbitrary sleeps.
 */
export async function awaitSettingsMessagingIdle(): Promise<void> {
  for (;;) {
    while (inFlightMessages.size > 0) {
      await Promise.allSettled([...inFlightMessages]);
    }
    await quiescenceTurn();
    if (inFlightMessages.size === 0) return;
  }
}

/**
 * Real background handlers behind the test transport; no writer queue is
 * mocked. The mock is deliberately NON-async and returns the exact tracked
 * promise, so application code awaiting sendMessage awaits the very promise
 * the idle drain observes (no outer wrapper promise to fall out of sync).
 */
export function installSettingsMessaging() {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(message =>
    trackInFlight(
      (async () => {
        if (String((message as unknown as { type?: unknown })?.type).startsWith("APP_SETTINGS_")) {
          const { handleAppSettingsCommand } = await import("../background/appSettingsAuthority");
          return handleAppSettingsCommand(message, { id: chrome.runtime.id, url: chrome.runtime.getURL("sidepanel/sidepanel.html") });
        }
        const { handleAIConnectionCommand } = await import("../background/aiConnectionAuthority");
        return handleAIConnectionCommand(message, { id: chrome.runtime.id, url: chrome.runtime.getURL("sidepanel/sidepanel.html") });
      })(),
    ),
  );
}
