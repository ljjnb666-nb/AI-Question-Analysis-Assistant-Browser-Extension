/**
 * AUTH-UI-INV-15 — cross-surface protected-work ownership.
 *
 * Any START_AUTO_SOLVE_ALL / START_FULL_PAGE_DETECT, no matter which
 * extension surface sent it (Popup, Side Panel, future surfaces), must
 * record an owner record `{ active, tabId }` in a store every surface can
 * see. Auth-loss termination and manual Stop/Cancel target the RECORDED
 * owner tab — never a re-guessed "best" tab.
 *
 * chrome.storage.session is the backing store: it is extension-context-only
 * (never user config), and transient — it disappears with the browser
 * session, exactly like the runtime work it tracks.
 *
 * Storage layout: ONE KEY PER WORKFLOW KIND. Each mark/clear writes only its
 * own key, so concurrent Popup and Side Panel mutations of different kinds
 * can never overwrite each other (no shared-object read-merge-write across
 * contexts — chrome.storage.session is the visibility boundary, not a
 * transaction coordinator, and no distributed transaction is claimed).
 */
export type ProtectedWorkKind = "autoSolve" | "fullPage";

export type ProtectedWorkOwnerRecord = {
  active: boolean;
  tabId?: number;
};

export type ProtectedWorkOwners = {
  autoSolve: ProtectedWorkOwnerRecord;
  fullPage: ProtectedWorkOwnerRecord;
};

const OWNER_KEYS: Record<ProtectedWorkKind, string> = {
  autoSolve: "protectedWorkOwner:autoSolve",
  fullPage: "protectedWorkOwner:fullPage",
};

const INACTIVE: ProtectedWorkOwnerRecord = { active: false };

function sessionArea(): chrome.storage.StorageArea | null {
  try {
    return chrome.storage?.session ?? null;
  } catch {
    return null;
  }
}

function keyFor(kind: ProtectedWorkKind): string {
  return OWNER_KEYS[kind];
}

async function readOwnerRecord(kind: ProtectedWorkKind): Promise<ProtectedWorkOwnerRecord> {
  const area = sessionArea();
  if (!area) return { ...INACTIVE };
  const result = await area.get(keyFor(kind));
  const stored = result[keyFor(kind)] as ProtectedWorkOwnerRecord | undefined;
  if (!stored) return { ...INACTIVE };
  return { active: Boolean(stored.active), tabId: stored.tabId };
}

/** Read aggregation of both kinds. Never used for read-modify-write. */
export async function readProtectedWorkOwners(): Promise<ProtectedWorkOwners> {
  const [autoSolve, fullPage] = await Promise.all([
    readOwnerRecord("autoSolve"),
    readOwnerRecord("fullPage"),
  ]);
  return { autoSolve, fullPage };
}

/**
 * START path: record the exact dispatch target tab for this workflow kind.
 * A single-key write — no read of the other kind, no merge — so a concurrent
 * mark of the other kind from another surface cannot be lost.
 */
export async function markProtectedWorkOwner(
  kind: ProtectedWorkKind,
  tabId: number,
): Promise<void> {
  await sessionArea()?.set({ [keyFor(kind)]: { active: true, tabId } });
}

/**
 * Runtime progress reconciliation: once the content script reports a running
 * workflow from its tab, that tab becomes the recorded owner even if the
 * original START record was missed (recovery path, never the only path).
 * Single-key write, same cross-context safety as mark.
 */
export async function reconcileProtectedWorkOwnerFromRuntime(
  kind: ProtectedWorkKind,
  tabId: number,
): Promise<void> {
  const current = await readOwnerRecord(kind);
  if (current.active && current.tabId === tabId) return;
  await sessionArea()?.set({ [keyFor(kind)]: { active: true, tabId } });
}

/**
 * Natural completion / explicit stop: clear THIS kind's key only. When
 * `tabId` is given, the clear is a same-kind compare-then-clear (best
 * effort, not a transaction): a stale DONE from another tab never erases a
 * different active run, and the other kind's key is never touched.
 */
export async function clearProtectedWorkOwner(
  kind: ProtectedWorkKind,
  tabId?: number,
): Promise<void> {
  const current = await readOwnerRecord(kind);
  if (!current.active) return;
  if (tabId != null && current.tabId !== tabId) return;
  await sessionArea()?.set({ [keyFor(kind)]: { ...INACTIVE } });
}

/** One multi-key write resetting both kinds (used after termination). */
export async function clearAllProtectedWorkOwners(): Promise<void> {
  await sessionArea()?.set({
    [keyFor("autoSolve")]: { ...INACTIVE },
    [keyFor("fullPage")]: { ...INACTIVE },
  });
}

/**
 * Auth-loss termination (AUTH-UI-INV-11/13): send the workflow-specific
 * termination message to every recorded owner tab and clear the registry.
 * `send` is injected so shared/auth stays decoupled from tab plumbing.
 */
export async function terminateRecordedProtectedWork(
  send: (tabId: number, message: { type: string }) => Promise<unknown>,
): Promise<void> {
  const owners = await readProtectedWorkOwners();
  const jobs: Promise<unknown>[] = [];
  if (owners.autoSolve.active && owners.autoSolve.tabId != null) {
    jobs.push(
      send(owners.autoSolve.tabId, { type: "STOP_AUTO_SOLVE_ALL" }).catch(() => undefined),
    );
  }
  if (owners.fullPage.active && owners.fullPage.tabId != null) {
    jobs.push(
      send(owners.fullPage.tabId, { type: "FULL_PAGE_DETECT_CANCELLED" }).catch(() => undefined),
    );
  }
  await Promise.all(jobs);
  await clearAllProtectedWorkOwners();
}
