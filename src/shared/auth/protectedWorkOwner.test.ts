import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as protectedWorkOwnerModule from "./protectedWorkOwner";

/** Independent module instance under test (imported per test via resetModules). */
type OwnerClient = typeof protectedWorkOwnerModule;

/**
 * AUTH_UI_52..54 — cross-context atomicity of the protected-work owner
 * registry. Two INDEPENDENT module instances (simulating Popup and Side
 * Panel JS contexts) share one chrome.storage.session backing store. The
 * storage `set` is instrumented so the first writer deterministically yields
 * until a second writer enters — forcing genuine interleaving instead of
 * relying on same-context queue ordering.
 */

const sessionStore = new Map<string, unknown>();

// Overlapping-write instrumentation: when armed, the first concurrent set
// parks until a second set begins, guaranteeing the two context writes
// genuinely interleave. Only the concurrency test arms it.
let inFlightSets = 0;
let requireInterleave = false;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

type SessionAreaStub = {
  get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
};

function installSharedSessionStub(): SessionAreaStub {
  const area: SessionAreaStub = {
    get: async (keys) => {
      const requested = keys == null ? [...sessionStore.keys()] : Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const key of requested) if (sessionStore.has(key)) result[key] = sessionStore.get(key);
      return result;
    },
    set: async (items) => {
      inFlightSets += 1;
      try {
        if (requireInterleave && inFlightSets === 1) {
          // Park the first writer until a second writer enters: without
          // per-kind keys a shared-object read-merge-write would now lose
          // one side's update.
          const deadline = Date.now() + 2000;
          while (inFlightSets < 2 && Date.now() < deadline) {
            await tick();
          }
        }
        for (const [key, value] of Object.entries(items)) sessionStore.set(key, value);
      } finally {
        inFlightSets -= 1;
      }
    },
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) sessionStore.delete(key);
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { session: area },
  };
  return area;
}

beforeEach(() => {
  sessionStore.clear();
  inFlightSets = 0;
  requireInterleave = false;
  installSharedSessionStub();
});

afterEach(() => {
  vi.resetModules();
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

async function freshClient(): Promise<OwnerClient> {
  vi.resetModules();
  return import("./protectedWorkOwner");
}

describe("cross-context protected-work owner registry", () => {
  it("AUTH_UI_52_CROSS_CONTEXT_NO_LOST_UPDATE concurrent marks of different kinds from two contexts both survive", async () => {
    // Two independent module instances = two extension JS contexts sharing
    // the same storage.session backing store.
    const popup = await freshClient();
    const sidePanel = await freshClient();
    expect(popup).not.toBe(sidePanel);

    // Interleaved by the stub: popup's write parks until sidePanel's write
    // starts, then both complete.
    requireInterleave = true;
    await Promise.all([
      popup.markProtectedWorkOwner("autoSolve", 7),
      sidePanel.markProtectedWorkOwner("fullPage", 8),
    ]);

    const owners = await popup.readProtectedWorkOwners();
    expect(owners.autoSolve).toEqual({ active: true, tabId: 7 });
    expect(owners.fullPage).toEqual({ active: true, tabId: 8 });
    // Nothing lost, from either client's view.
    const ownersFromOtherContext = await sidePanel.readProtectedWorkOwners();
    expect(ownersFromOtherContext.autoSolve).toEqual({ active: true, tabId: 7 });
    expect(ownersFromOtherContext.fullPage).toEqual({ active: true, tabId: 8 });
  });

  it("AUTH_UI_53_CLEAR_ONE_KIND_PRESERVES_OTHER clearing autoSolve leaves fullPage intact, and the reverse", async () => {
    const clientA = await freshClient();
    const clientB = await freshClient();

    await clientA.markProtectedWorkOwner("autoSolve", 7);
    await clientB.markProtectedWorkOwner("fullPage", 8);

    await clientB.clearProtectedWorkOwner("autoSolve");
    let owners = await clientA.readProtectedWorkOwners();
    expect(owners.autoSolve.active).toBe(false);
    expect(owners.fullPage).toEqual({ active: true, tabId: 8 });

    // Reverse direction: clearing fullPage leaves the (re-marked) autoSolve.
    await clientA.markProtectedWorkOwner("autoSolve", 7);
    await clientA.clearProtectedWorkOwner("fullPage");
    owners = await clientA.readProtectedWorkOwners();
    expect(owners.autoSolve).toEqual({ active: true, tabId: 7 });
    expect(owners.fullPage.active).toBe(false);
  });

  it("AUTH_UI_54_STALE_DONE_OTHER_TAB_SAFE a mismatched-tab clear never erases the active owner", async () => {
    const clientA = await freshClient();
    const clientB = await freshClient();

    // Active run on tab 8; a stale DONE arrives claiming tab 7.
    await clientA.markProtectedWorkOwner("autoSolve", 8);
    await clientB.clearProtectedWorkOwner("autoSolve", 7);
    let owners = await clientA.readProtectedWorkOwners();
    expect(owners.autoSolve).toEqual({ active: true, tabId: 8 });

    // Same contract for the full-page kind.
    await clientA.markProtectedWorkOwner("fullPage", 8);
    await clientB.clearProtectedWorkOwner("fullPage", 7);
    owners = await clientB.readProtectedWorkOwners();
    expect(owners.fullPage).toEqual({ active: true, tabId: 8 });

    // And a matching-tab clear still works.
    await clientA.clearProtectedWorkOwner("autoSolve", 8);
    owners = await clientA.readProtectedWorkOwners();
    expect(owners.autoSolve.active).toBe(false);
    expect(owners.fullPage).toEqual({ active: true, tabId: 8 });
  });
});
