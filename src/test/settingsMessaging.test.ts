import { afterEach, describe, expect, it, vi } from "vitest";
import {
  awaitSettingsMessagingIdle,
  installSettingsMessaging,
} from "./settingsMessaging";

/**
 * Regressions for the cross-test async message leak: a message started in one
 * test generation must settle against that generation's store during teardown
 * (driven by awaitSettingsMessagingIdle), never against the next generation's
 * fresh store. Uses the real transport helper and the real background
 * settings handler; delays are gate-controlled promises, never sleeps.
 */

type MemoryFacade = { store: Map<string, unknown> };
type GetFn = (keys: unknown) => Promise<Record<string, unknown>>;

function chromeGlobal() {
  return globalThis as unknown as {
    chrome: {
      runtime: { id: string; sendMessage: (message: unknown) => Promise<unknown> };
      storage: { local: Record<string, unknown> };
    };
  };
}

function installFakeStorage(facade: MemoryFacade) {
  chromeGlobal().chrome.storage.local = {
    get: async (keys: unknown) => {
      const requested =
        keys == null ? [...facade.store.keys()] : Array.isArray(keys) ? keys : [keys as string];
      const result: Record<string, unknown> = {};
      for (const key of requested) if (facade.store.has(key)) result[key] = facade.store.get(key);
      return result;
    },
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) facade.store.set(key, value);
    },
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) facade.store.delete(key);
    },
    clear: async () => facade.store.clear(),
    getBytesInUse: (_keys: unknown, cb: (n: number) => void) => cb(0),
    QUOTA_BYTES: 5242880,
  };
}

/** Gates only the FIRST storage read; later reads pass through untouched. */
function gateFirstStorageGet(gate: Promise<Record<string, unknown>>) {
  const storageLocal = chromeGlobal().chrome.storage.local;
  const realGet = storageLocal.get as unknown as GetFn;
  let calls = 0;
  storageLocal.get = (keys: unknown) => {
    calls += 1;
    return calls === 1 ? gate : realGet(keys);
  };
  return () => {
    storageLocal.get = realGet;
  };
}

function sendFireAndForget(message: unknown): { settled: () => boolean } {
  let done = false;
  const send = chromeGlobal().chrome.runtime.sendMessage as unknown as (message: unknown) => Promise<unknown>;
  void send(message).then(
    () => { done = true; },
    () => { done = true; },
  );
  return { settled: () => done };
}

describe("settings messaging transport isolation", () => {
  afterEach(async () => {
    await awaitSettingsMessagingIdle();
    vi.restoreAllMocks();
  });

  it("tracks in-flight messages: idle stays pending until the handler settles", async () => {
    const generationA: MemoryFacade = { store: new Map() };
    installFakeStorage(generationA);
    installSettingsMessaging();

    let releaseGet!: (value: Record<string, unknown>) => void;
    const getGate = new Promise<Record<string, unknown>>((resolve) => {
      releaseGet = resolve;
    });
    gateFirstStorageGet(getGate);

    const message = sendFireAndForget({ type: "APP_SETTINGS_UPDATE", patch: { language: "en" } });

    const idle = awaitSettingsMessagingIdle();
    let idleSettled = false;
    void idle.then(
      () => { idleSettled = true; },
      () => { idleSettled = true; },
    );

    // A few microtask hops: idle must still be waiting on the gated handler.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(idleSettled).toBe(false);
    expect(message.settled()).toBe(false);
    expect(generationA.store.has("appSettings")).toBe(false);

    releaseGet({});
    await idle;
    expect(idleSettled).toBe(true);
    expect(message.settled()).toBe(true);
    // The drain drove the handler to completion against generation A's store.
    expect((generationA.store.get("appSettings") as Record<string, unknown>)?.language).toBe("en");
  });

  it("generation A teardown drain completes its handler before generation B starts", async () => {
    // --- generation A: start a delayed settings message, then "teardown" ---
    const generationA: MemoryFacade = { store: new Map() };
    installFakeStorage(generationA);
    installSettingsMessaging();

    let releaseGet!: (value: Record<string, unknown>) => void;
    const getGate = new Promise<Record<string, unknown>>((resolve) => {
      releaseGet = resolve;
    });
    gateFirstStorageGet(getGate);

    const message = sendFireAndForget({ type: "APP_SETTINGS_UPDATE", patch: { language: "en" } });
    expect(message.settled()).toBe(false);

    // Teardown drain: the delayed handler must finish HERE, against A.
    releaseGet({});
    await awaitSettingsMessagingIdle();
    expect(message.settled()).toBe(true);
    expect((generationA.store.get("appSettings") as Record<string, unknown>)?.language).toBe("en");

    // --- generation B: fresh store; A's handler cannot mutate it ---
    const generationB: MemoryFacade = { store: new Map() };
    installFakeStorage(generationB);
    installSettingsMessaging();
    expect(generationB.store.size).toBe(0);

    await awaitSettingsMessagingIdle();
    expect(generationB.store.size).toBe(0);
    expect(generationB.store.get("appSettings")).toBeUndefined();
  });
});
