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
    expect(owners.autoSolve).toEqual([{ tabId: 7 }]);
    expect(owners.fullPage).toEqual([{ tabId: 8 }]);
    // Nothing lost, from either client's view.
    const ownersFromOtherContext = await sidePanel.readProtectedWorkOwners();
    expect(ownersFromOtherContext.autoSolve).toEqual([{ tabId: 7 }]);
    expect(ownersFromOtherContext.fullPage).toEqual([{ tabId: 8 }]);
  });

  it("AUTH_UI_53_CLEAR_ONE_KIND_PRESERVES_OTHER clearing autoSolve leaves fullPage intact, and the reverse", async () => {
    const clientA = await freshClient();
    const clientB = await freshClient();

    await clientA.markProtectedWorkOwner("autoSolve", 7);
    await clientB.markProtectedWorkOwner("fullPage", 8);

    await clientB.clearProtectedWorkOwner("autoSolve", 7);
    let owners = await clientA.readProtectedWorkOwners();
    expect(owners.autoSolve).toEqual([]);
    expect(owners.fullPage).toEqual([{ tabId: 8 }]);

    // Reverse direction: clearing fullPage leaves the (re-marked) autoSolve.
    await clientA.markProtectedWorkOwner("autoSolve", 7);
    await clientA.clearProtectedWorkOwner("fullPage", 8);
    owners = await clientA.readProtectedWorkOwners();
    expect(owners.autoSolve).toEqual([{ tabId: 7 }]);
    expect(owners.fullPage).toEqual([]);
  });

  it("AUTH_UI_55_SAME_KIND_MULTITAB_MARK same-kind marks on two tabs from two contexts both survive", async () => {
    // Popup marks tab 7; Side Panel (independent context) concurrently marks
    // tab 8 — SAME kind. The per-kind-per-tab keys make the interleaved
    // writes independent, so neither owner can be lost.
    requireInterleave = true;
    const popup = await freshClient();
    const sidePanel = await freshClient();

    await Promise.all([
      popup.markProtectedWorkOwner("autoSolve", 7),
      sidePanel.markProtectedWorkOwner("autoSolve", 8),
    ]);

    const owners = await popup.readProtectedWorkOwners();
    expect(owners.autoSolve).toEqual([{ tabId: 7 }, { tabId: 8 }]);
    const ownersFromOtherContext = await sidePanel.readProtectedWorkOwners();
    expect(ownersFromOtherContext.autoSolve).toEqual([{ tabId: 7 }, { tabId: 8 }]);
  });

  it("AUTH_UI_55_SAME_KIND_MULTITAB_MARK done on one tab preserves the other same-kind owner", async () => {
    const client = await freshClient();
    await client.markProtectedWorkOwner("autoSolve", 7);
    await client.markProtectedWorkOwner("autoSolve", 8);

    await client.clearProtectedWorkOwner("autoSolve", 7);
    const owners = await client.readProtectedWorkOwners();
    expect(owners.autoSolve).toEqual([{ tabId: 8 }]);

    // Full-page kind: the same per-tab isolation.
    await client.markProtectedWorkOwner("fullPage", 9);
    await client.markProtectedWorkOwner("fullPage", 10);
    await client.clearProtectedWorkOwner("fullPage", 10);
    const fullPageOwners = await client.readProtectedWorkOwners();
    expect(fullPageOwners.fullPage).toEqual([{ tabId: 9 }]);
  });

  it("AUTH_UI_56_AUTH_LOSS_STOPS_ALL_SAME_KIND termination targets every same-kind owner exactly once", async () => {
    const clientA = await freshClient();
    const clientB = await freshClient();

    await clientA.markProtectedWorkOwner("autoSolve", 7);
    await clientB.markProtectedWorkOwner("autoSolve", 8);
    await clientA.markProtectedWorkOwner("fullPage", 9);

    const sends: Array<{ tabId: number; type: string }> = [];
    await clientA.terminateRecordedProtectedWork(async (tabId, message) => {
      sends.push({ tabId, type: message.type });
      return {};
    });

    expect(sends).toEqual([
      { tabId: 7, type: "STOP_AUTO_SOLVE_ALL" },
      { tabId: 8, type: "STOP_AUTO_SOLVE_ALL" },
      { tabId: 9, type: "FULL_PAGE_DETECT_CANCELLED" },
    ]);
    // Every captured owner is cleared; nothing survives.
    const owners = await clientB.readProtectedWorkOwners();
    expect(owners.autoSolve).toEqual([]);
    expect(owners.fullPage).toEqual([]);
  });

  it("AUTH_UI_57_DONE_ONE_TAB_PRESERVES_OTHER same-kind done on one tab preserves the coexisting owner for termination", async () => {
    const clientA = await freshClient();
    const clientB = await freshClient();

    await clientA.markProtectedWorkOwner("autoSolve", 7);
    await clientB.markProtectedWorkOwner("autoSolve", 8);
    await clientA.clearProtectedWorkOwner("autoSolve", 7);

    const sends: Array<{ tabId: number; type: string }> = [];
    await clientB.terminateRecordedProtectedWork(async (tabId, message) => {
      sends.push({ tabId, type: message.type });
      return {};
    });
    expect(sends).toEqual([{ tabId: 8, type: "STOP_AUTO_SOLVE_ALL" }]);
  });

  it("AUTH_UI_58_LATE_NEW_OWNER_SURVIVES_TERMINATION an owner marked during termination survives the snapshot clear", async () => {
    const client = await freshClient();
    await client.markProtectedWorkOwner("autoSolve", 7);

    // Termination holds its STOP send open. While it is in flight (the
    // snapshot has already captured tab 7), a NEW owner appears on tab 8.
    const stopResolvers: Array<(value: unknown) => void> = [];
    const sends: Array<{ tabId: number; type: string }> = [];
    const termination = client.terminateRecordedProtectedWork(async (tabId, message) => {
      sends.push({ tabId, type: message.type });
      await new Promise((resolve) => stopResolvers.push(resolve));
      return {};
    });

    await vi.waitFor(() => {
      expect(sends).toEqual([{ tabId: 7, type: "STOP_AUTO_SOLVE_ALL" }]);
    }, { timeout: 2000, interval: 10 });

    await client.markProtectedWorkOwner("autoSolve", 8);
    for (const resolveStop of stopResolvers) resolveStop(undefined);

    await termination;

    // Tab 7's owner was captured and cleared; the newer tab 8 owner MUST
    // survive — a global clear would have erased it.
    const owners = await client.readProtectedWorkOwners();
    expect(owners.autoSolve).toEqual([{ tabId: 8 }]);
  });

  it("PHASE14B_01 same-kind same-tab new generation must survive older STOP cleanup", async () => {
    const oldContext = await freshClient();
    const newContext = await freshClient();
    await oldContext.markProtectedWorkOwner("autoSolve", 7);

    // STOP is already in flight for the old generation when a new
    // authorized session starts autoSolve in the SAME tab.
    let unblockStop!: () => void;
    const stopBlocked = new Promise<void>((resolve) => { unblockStop = resolve; });
    let stopObserved!: () => void;
    const stopEntered = new Promise<void>((resolve) => { stopObserved = resolve; });
    const sent: string[] = [];
    const terminating = oldContext.terminateRecordedProtectedWork(async (tabId, message) => {
      sent.push(`${tabId}:${message.type}`);
      stopObserved();
      await stopBlocked;
      return {};
    });
    await stopEntered;
    await newContext.markProtectedWorkOwner("autoSolve", 7);
    unblockStop();
    await terminating;
    expect(sent).toEqual(["7:STOP_AUTO_SOLVE_ALL"]);
    expect((await newContext.readProtectedWorkOwners()).autoSolve).toEqual([{ tabId: 7 }]);
  });

  it("PHASE14B_02 same-tab full-page new generation must survive old cancel cleanup", async () => {
    const oldContext = await freshClient();
    const newContext = await freshClient();
    await oldContext.markProtectedWorkOwner("fullPage", 11);

    let unblockStop!: () => void;
    const parked = new Promise<void>((resolve) => { unblockStop = resolve; });
    let observed!: () => void;
    const entered = new Promise<void>((resolve) => { observed = resolve; });
    const stopping = oldContext.terminateRecordedProtectedWork(async (tabId, message) => {
      expect(tabId).toBe(11);
      expect(message.type).toBe("FULL_PAGE_DETECT_CANCELLED");
      observed();
      await parked;
      return {};
    });
    await entered;
    await newContext.markProtectedWorkOwner("fullPage", 11);
    unblockStop();
    await stopping;
    expect((await newContext.readProtectedWorkOwners()).fullPage).toEqual([{ tabId: 11 }]);
  });

  it("AUTH_UI_59_MANUAL_STOP_ALL_RECORDED_OWNERS stop terminates every recorded owner and clears them", async () => {
    const clientA = await freshClient();
    const clientB = await freshClient();

    await clientA.markProtectedWorkOwner("autoSolve", 7);
    await clientB.markProtectedWorkOwner("autoSolve", 8);

    const sends: Array<{ tabId: number; type: string }> = [];
    const ownersBefore = await clientA.readProtectedWorkOwners();
    expect(ownersBefore.autoSolve).toEqual([{ tabId: 7 }, { tabId: 8 }]);

    // The manual-stop contract (useSidePanelActions.handleStopAutoSolve):
    // STOP every recorded owner, then clear each captured entry.
    const stopTabs = new Set<number>();
    for (const entry of ownersBefore.autoSolve) stopTabs.add(entry.tabId);
    await Promise.all(
      [...stopTabs].map(async (tabId) => {
        sends.push({ tabId, type: "STOP_AUTO_SOLVE_ALL" });
        await clientB.clearProtectedWorkOwner("autoSolve", tabId);
      }),
    );

    expect(sends.map((s) => s.tabId).sort((a, b) => a - b)).toEqual([7, 8]);
    expect(await clientA.readProtectedWorkOwners()).toEqual({ autoSolve: [], fullPage: [] });
  });

  it("AUTH_UI_54_STALE_DONE_OTHER_TAB_SAFE a mismatched-tab clear never erases the active owner", async () => {
    const clientA = await freshClient();
    const clientB = await freshClient();

    // Active run on tab 8; a stale DONE arrives claiming tab 7.
    await clientA.markProtectedWorkOwner("autoSolve", 8);
    await clientB.clearProtectedWorkOwner("autoSolve", 7);
    let owners = await clientA.readProtectedWorkOwners();
    expect(owners.autoSolve).toEqual([{ tabId: 8 }]);

    // Same contract for the full-page kind.
    await clientA.markProtectedWorkOwner("fullPage", 8);
    await clientB.clearProtectedWorkOwner("fullPage", 7);
    owners = await clientB.readProtectedWorkOwners();
    expect(owners.fullPage).toEqual([{ tabId: 8 }]);

    // And a matching-tab clear still works.
    await clientA.clearProtectedWorkOwner("autoSolve", 8);
    owners = await clientA.readProtectedWorkOwners();
    expect(owners.autoSolve).toEqual([]);
    expect(owners.fullPage).toEqual([{ tabId: 8 }]);
  });
});
