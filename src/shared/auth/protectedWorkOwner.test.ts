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

  it("PHASE14B_02A local pending STOP joins global owners, deduplicates tabs and preserves newer same-tab owner", async () => {
    const popup = await freshClient();
    const panel = await freshClient();
    await popup.markProtectedWorkOwner("autoSolve", 7);
    await popup.markProtectedWorkOwner("fullPage", 9);

    const sends: string[] = [];
    let sendStarted!: () => void;
    const entered = new Promise<void>((resolve) => { sendStarted = resolve; });
    let releaseStop!: () => void;
    const parked = new Promise<void>((resolve) => { releaseStop = resolve; });

    const stop = panel.terminateRecordedProtectedWork(async (tabId, message) => {
      sends.push(`${tabId}:${message.type}`);
      if (tabId === 7) {
        sendStarted();
        await parked;
      }
    }, { autoSolve: 7, fullPage: 10 });
    await entered;
    // The next authorized generation writes the SAME kind+tab while the old
    // Side Panel STOP is pending. It must not be deleted by stale cleanup.
    await popup.markProtectedWorkOwner("autoSolve", 7);
    releaseStop();
    await stop;
    expect(sends).toEqual([
      "7:STOP_AUTO_SOLVE_ALL",
      "9:FULL_PAGE_DETECT_CANCELLED",
      "10:FULL_PAGE_DETECT_CANCELLED",
    ]);
    expect(await popup.readProtectedWorkOwners()).toEqual({
      autoSolve: [{ tabId: 7 }],
      fullPage: [],
    });
  });

  it("PHASE14B_02A local pending tab STOP works without a persisted storage generation", async () => {
    const panel = await freshClient();
    const sends: string[] = [];
    await panel.terminateRecordedProtectedWork(async (tabId, message) => {
      sends.push(`${tabId}:${message.type}`);
    }, { autoSolve: 8, fullPage: 12 });
    expect(sends).toEqual([
      "8:STOP_AUTO_SOLVE_ALL",
      "12:FULL_PAGE_DETECT_CANCELLED",
    ]);
    expect(await panel.readProtectedWorkOwners()).toEqual({ autoSolve: [], fullPage: [] });
  });

  it("PHASE14B_03 multiple same-tab generations emit only one STOP but remove all captured keys", async () => {
    const first = await freshClient();
    const second = await freshClient();
    await first.markProtectedWorkOwner("autoSolve", 7);
    await second.markProtectedWorkOwner("autoSolve", 7);
    await second.markProtectedWorkOwner("autoSolve", 8);
    expect((await first.readProtectedWorkOwners()).autoSolve).toEqual([{ tabId: 7 }, { tabId: 8 }]);

    const messages: string[] = [];
    await first.terminateRecordedProtectedWork(async (tabId, message) => {
      messages.push(`${tabId}:${message.type}`);
      return {};
    });
    expect(messages).toEqual(["7:STOP_AUTO_SOLVE_ALL", "8:STOP_AUTO_SOLVE_ALL"]);
    expect((await second.readProtectedWorkOwners()).autoSolve).toEqual([]);
  });

  it("PHASE14B_04 legacy single-owner storage keys remain readable and clearable", async () => {
    const client = await freshClient();
    sessionStore.set("protectedWorkOwner:autoSolve:7", { active: true, tabId: 7 });
    sessionStore.set("protectedWorkOwner:fullPage:9", { active: true, tabId: 9 });
    sessionStore.set("protectedWorkOwner:autoSolve:8", { active: false, tabId: 8 });
    sessionStore.set("protectedWorkOwner:autoSolve:10", { active: true, tabId: 999 });
    expect(await client.readProtectedWorkOwners()).toEqual({
      autoSolve: [{ tabId: 7 }],
      fullPage: [{ tabId: 9 }],
    });

    await client.terminateRecordedProtectedWork(async () => ({}));
    expect(await client.readProtectedWorkOwners()).toEqual({ autoSolve: [], fullPage: [] });
    await client.clearProtectedWorkOwner("autoSolve", 8);
    expect(sessionStore.has("protectedWorkOwner:autoSolve:8")).toBe(false);
  });

  it("PHASE14B_05 delayed completion removes captured keys but never a new same-tab generation", async () => {
    const area = installSharedSessionStub();
    const first = await freshClient();
    const second = await freshClient();
    await first.markProtectedWorkOwner("autoSolve", 7);

    const normalRemove = area.remove.bind(area);
    let signalRemoval!: () => void;
    let releaseRemoval!: () => void;
    const removeEntered = new Promise<void>((resolve) => { signalRemoval = resolve; });
    const holdRemove = new Promise<void>((resolve) => { releaseRemoval = resolve; });
    area.remove = async (keys) => {
      signalRemoval();
      await holdRemove;
      await normalRemove(keys);
    };
    const clearOld = first.clearProtectedWorkOwner("autoSolve", 7);
    await removeEntered;
    await second.markProtectedWorkOwner("autoSolve", 7);
    releaseRemoval();
    await clearOld;
    expect((await first.readProtectedWorkOwners()).autoSolve).toEqual([{ tabId: 7 }]);
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

describe("Phase14B-02B manual termination owner-generation snapshot fence", () => {
  it("PHASE14B_02B_01 old same-tab manual STOP cannot erase a new autoSolve owner", async () => {
    const first = await freshClient();
    const next = await freshClient();
    await first.markProtectedWorkOwner("autoSolve", 7);
    await first.markProtectedWorkOwner("fullPage", 11);
    let resolveSend!: () => void;
    let enteredSend!: () => void;
    const parked = new Promise<void>((resolve) => { resolveSend = resolve; });
    const entered = new Promise<void>((resolve) => { enteredSend = resolve; });
    const sends: string[] = [];
    const terminating = first.terminateRecordedProtectedWorkKind("autoSolve", async (tab, msg) => {
      sends.push(`${tab}:${msg.type}`);
      enteredSend();
      await parked;
    });
    await entered;
    await next.markProtectedWorkOwner("autoSolve", 7);
    resolveSend();
    expect(await terminating).toBe(1);
    expect(sends).toEqual(["7:STOP_AUTO_SOLVE_ALL"]);
    expect(await next.readProtectedWorkOwners()).toEqual({
      autoSolve: [{ tabId: 7 }],
      fullPage: [{ tabId: 11 }],
    });
  });

  it("PHASE14B_02B_02 old same-tab manual CANCEL cannot erase a new fullPage owner", async () => {
    const first = await freshClient();
    const next = await freshClient();
    await first.markProtectedWorkOwner("fullPage", 9);
    await first.markProtectedWorkOwner("autoSolve", 5);
    let resolveSend!: () => void;
    let enteredSend!: () => void;
    const parked = new Promise<void>((resolve) => { resolveSend = resolve; });
    const entered = new Promise<void>((resolve) => { enteredSend = resolve; });
    const sends: string[] = [];
    const cancel = first.terminateRecordedProtectedWorkKind("fullPage", async (tab, msg) => {
      sends.push(`${tab}:${msg.type}`);
      enteredSend();
      await parked;
    });
    await entered;
    await next.markProtectedWorkOwner("fullPage", 9);
    resolveSend();
    expect(await cancel).toBe(1);
    expect(sends).toEqual(["9:FULL_PAGE_DETECT_CANCELLED"]);
    expect(await next.readProtectedWorkOwners()).toEqual({
      autoSolve: [{ tabId: 5 }],
      fullPage: [{ tabId: 9 }],
    });
  });

  it("PHASE14B_02B_03 deduplicates tabs, includes unpersisted local owner and handles failed sends", async () => {
    const client = await freshClient();
    await client.markProtectedWorkOwner("autoSolve", 7);
    await client.markProtectedWorkOwner("autoSolve", 7);
    await client.markProtectedWorkOwner("autoSolve", 8);
    const sends: string[] = [];
    const count = await client.terminateRecordedProtectedWorkKind("autoSolve", async (tab, msg) => {
      sends.push(`${tab}:${msg.type}`);
      if (tab === 7) throw new Error("closed tab");
    }, 9);
    expect(count).toBe(3);
    expect(sends).toEqual([
      "7:STOP_AUTO_SOLVE_ALL", "8:STOP_AUTO_SOLVE_ALL", "9:STOP_AUTO_SOLVE_ALL",
    ]);
    expect((await client.readProtectedWorkOwners()).autoSolve).toEqual([]);
    expect(await client.terminateRecordedProtectedWorkKind("fullPage", async () => {
      throw Error("unexpected send");
    })).toBe(0);
  });
});

describe("Phase 14B-02B run generation token authority API", () => {
  it("P14B02B_GEN_01 a stale same-tab autoSolve DONE clears only its own UUID", async () => {
    const oldContext = await freshClient();
    const newContext = await freshClient();
    const oldId = await oldContext.markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    const newId = await newContext.markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    expect(oldId).toMatch(/^[0-9a-f]{8}-/);
    expect(newId).not.toBe(oldId);
    expect(await oldContext.clearProtectedWorkOwnerGeneration("autoSolve", 7, oldId!)).toBe(true);
    expect((await newContext.readProtectedWorkOwners()).autoSolve).toEqual([{ tabId: 7 }]);
    // Replay is a no-op and cannot sweep the new generation.
    expect(await oldContext.clearProtectedWorkOwnerGeneration("autoSolve", 7, oldId!)).toBe(false);
    expect((await newContext.readProtectedWorkOwners()).autoSolve).toEqual([{ tabId: 7 }]);
    expect(await newContext.clearProtectedWorkOwnerGeneration("autoSolve", 7, newId!)).toBe(true);
    expect((await oldContext.readProtectedWorkOwners()).autoSolve).toEqual([]);
  });

  it("P14B02B_GEN_02 fullPage stale DONE, wrong kind/tab and invalid ID fail closed", async () => {
    const first = await freshClient();
    const other = await freshClient();
    const oldId = await first.markProtectedWorkOwnerWithGeneration("fullPage", 9);
    const newId = await other.markProtectedWorkOwnerWithGeneration("fullPage", 9);
    const autoId = await other.markProtectedWorkOwnerWithGeneration("autoSolve", 9);
    expect(await first.clearProtectedWorkOwnerGeneration("fullPage", 9, "invalid")).toBe(false);
    expect(await first.clearProtectedWorkOwnerGeneration("fullPage", 10, oldId!)).toBe(false);
    expect(await first.clearProtectedWorkOwnerGeneration("autoSolve", 9, oldId!)).toBe(false);
    expect(await first.clearProtectedWorkOwnerGeneration("fullPage", 9, autoId!)).toBe(false);
    expect(await first.clearProtectedWorkOwnerGeneration("fullPage", 9, oldId!)).toBe(true);
    expect(await other.readProtectedWorkOwners()).toEqual({
      autoSolve: [{ tabId: 9 }],
      fullPage: [{ tabId: 9 }],
    });
    expect(await other.clearProtectedWorkOwnerGeneration("fullPage", 9, newId!)).toBe(true);
  });

  it("P14B02B_GEN_03 delayed DONE removal cannot race away a newly marked same-tab run", async () => {
    const area = installSharedSessionStub();
    const oldContext = await freshClient();
    const newContext = await freshClient();
    const oldId = await oldContext.markProtectedWorkOwnerWithGeneration("autoSolve", 15);
    const remove = area.remove.bind(area);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const parked = new Promise<void>((resolve) => { release = resolve; });
    area.remove = async (keys) => {
      enter();
      await parked;
      await remove(keys);
    };
    const pending = oldContext.clearProtectedWorkOwnerGeneration("autoSolve", 15, oldId!);
    await entered;
    const newId = await newContext.markProtectedWorkOwnerWithGeneration("autoSolve", 15);
    release();
    expect(await pending).toBe(true);
    expect((await newContext.readProtectedWorkOwners()).autoSolve).toEqual([{ tabId: 15 }]);
    expect(await newContext.clearProtectedWorkOwnerGeneration("autoSolve", 15, newId!)).toBe(true);
  });

  it("P14B02B_GEN_04 no session storage fails closed without inventing ownership", async () => {
    const client = await freshClient();
    (globalThis as unknown as { chrome: unknown }).chrome = { storage: {} };
    expect(await client.markProtectedWorkOwnerWithGeneration("autoSolve", 7)).toBeNull();
    expect(await client.clearProtectedWorkOwnerGeneration("autoSolve", 7, crypto.randomUUID())).toBe(false);
  });
});

describe("Phase14B-02B-02B incoming DONE authority: tagged versus legacy", () => {
  it("P14B02B_WIRE_01 old untagged DONE only clears legacy owners, never the new tagged owner", async () => {
    const context = await freshClient();
    await context.markProtectedWorkOwner("autoSolve", 7);
    const tagged = await context.markProtectedWorkOwnerWithGeneration("autoSolve", 7);
    expect(tagged).toBeTruthy();
    expect(await context.clearProtectedWorkOwnerFromRuntimeDone("autoSolve", 7)).toBe(true);
    expect((await context.readProtectedWorkOwners()).autoSolve).toEqual([{ tabId: 7 }]);
    expect(await context.clearProtectedWorkOwnerFromRuntimeDone("autoSolve", 7)).toBe(false);
    expect(await context.clearProtectedWorkOwnerFromRuntimeDone("autoSolve", 7, tagged)).toBe(true);
    expect((await context.readProtectedWorkOwners()).autoSolve).toEqual([]);
  });

  it("P14B02B_WIRE_02 invalid tagged DONE fails closed rather than falling back to tab-wide deletion", async () => {
    const context = await freshClient();
    const tagged = await context.markProtectedWorkOwnerWithGeneration("fullPage", 12);
    expect(await context.clearProtectedWorkOwnerFromRuntimeDone("fullPage", 12, null)).toBe(false);
    expect(await context.clearProtectedWorkOwnerFromRuntimeDone("fullPage", 12, "bad-id")).toBe(false);
    expect(await context.clearProtectedWorkOwnerFromRuntimeDone("fullPage", 13, tagged)).toBe(false);
    expect((await context.readProtectedWorkOwners()).fullPage).toEqual([{ tabId: 12 }]);
    expect(await context.clearProtectedWorkOwnerFromRuntimeDone("fullPage", 12, tagged)).toBe(true);
    expect(await context.clearProtectedWorkOwnerFromRuntimeDone("fullPage", 12, tagged)).toBe(false);
  });
});
