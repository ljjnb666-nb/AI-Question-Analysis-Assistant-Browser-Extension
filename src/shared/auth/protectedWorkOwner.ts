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

const OWNERS_KEY = "protectedWorkOwners";

const EMPTY_OWNERS: ProtectedWorkOwners = {
  autoSolve: { active: false },
  fullPage: { active: false },
};

function sessionArea(): chrome.storage.StorageArea | null {
  try {
    return chrome.storage?.session ?? null;
  } catch {
    return null;
  }
}

// storage.session has no transactions: get→merge→set is serialized through
// this queue so concurrent mark/clear calls from different surfaces cannot
// lose updates.
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(job, job);
  writeQueue = run.catch(() => undefined);
  return run;
}

async function readOwnersRaw(): Promise<ProtectedWorkOwners> {
  const area = sessionArea();
  if (!area) return { ...EMPTY_OWNERS };
  const result = await area.get(OWNERS_KEY);
  const stored = (result[OWNERS_KEY] ?? {}) as Partial<ProtectedWorkOwners>;
  return {
    autoSolve: { active: Boolean(stored.autoSolve?.active), tabId: stored.autoSolve?.tabId },
    fullPage: { active: Boolean(stored.fullPage?.active), tabId: stored.fullPage?.tabId },
  };
}

export function readProtectedWorkOwners(): Promise<ProtectedWorkOwners> {
  return enqueue(readOwnersRaw);
}

/** START path: record the exact dispatch target tab for the workflow. */
export function markProtectedWorkOwner(kind: ProtectedWorkKind, tabId: number): Promise<void> {
  return enqueue(async () => {
    const owners = await readOwnersRaw();
    owners[kind] = { active: true, tabId };
    await sessionArea()?.set({ [OWNERS_KEY]: owners });
  });
}

/**
 * Runtime progress reconciliation: once the content script reports a running
 * workflow from its tab, that tab becomes the recorded owner even if the
 * original START record was missed (recovery path, never the only path).
 */
export function reconcileProtectedWorkOwnerFromRuntime(
  kind: ProtectedWorkKind,
  tabId: number,
): Promise<void> {
  return enqueue(async () => {
    const owners = await readOwnersRaw();
    if (!owners[kind].active || owners[kind].tabId !== tabId) {
      owners[kind] = { active: true, tabId };
      await sessionArea()?.set({ [OWNERS_KEY]: owners });
    }
  });
}

/**
 * Natural completion / explicit stop: clear the owner. When `tabId` is
 * given, only a matching owner is cleared so a stale DONE from another tab
 * cannot erase a different active run.
 */
export function clearProtectedWorkOwner(kind: ProtectedWorkKind, tabId?: number): Promise<void> {
  return enqueue(async () => {
    const owners = await readOwnersRaw();
    if (!owners[kind].active) return;
    if (tabId != null && owners[kind].tabId !== tabId) return;
    owners[kind] = { active: false };
    await sessionArea()?.set({ [OWNERS_KEY]: owners });
  });
}

export function clearAllProtectedWorkOwners(): Promise<void> {
  return enqueue(async () => {
    await sessionArea()?.set({ [OWNERS_KEY]: { ...EMPTY_OWNERS } });
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
