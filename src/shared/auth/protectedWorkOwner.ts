/**
 * AUTH-UI-INV-15 + INV-16 — cross-surface, multi-tab protected-work
 * ownership.
 *
 * Any START_AUTO_SOLVE_ALL / START_FULL_PAGE_DETECT, no matter which
 * extension surface sent it (Popup, Side Panel, future surfaces), must
 * record an owner entry for the EXACT dispatch target tab. Content runtime
 * concurrency guards are TAB-LOCAL, so several tabs may run the same
 * workflow kind at once: owner identity is `kind + tabId`, and multiple
 * owners per kind coexist.
 *
 * Storage layout: ONE KEY PER OWNER (`protectedWorkOwner:<kind>:<tabId>`).
 * Every mutation writes only its own key — concurrent marks from different
 * surfaces and different tabs can never overwrite each other, and chrome
 * .storage.session is the visibility boundary (transient, extension-context
 * only, never user config), not a transaction coordinator.
 */
export type ProtectedWorkKind = "autoSolve" | "fullPage";

export type ProtectedWorkOwnerEntry = {
  tabId: number;
};

export type ProtectedWorkOwners = {
  autoSolve: ProtectedWorkOwnerEntry[];
  fullPage: ProtectedWorkOwnerEntry[];
};

const KEY_PREFIX = "protectedWorkOwner:";

function keyFor(kind: ProtectedWorkKind, tabId: number): string {
  return `${KEY_PREFIX}${kind}:${tabId}`;
}

function parseOwnerKey(key: string): { kind: ProtectedWorkKind; tabId: number } | null {
  const match = /^protectedWorkOwner:(autoSolve|fullPage):(\d+)$/.exec(key);
  if (!match) return null;
  return { kind: match[1] as ProtectedWorkKind, tabId: Number(match[2]) };
}

function sessionArea(): chrome.storage.StorageArea | null {
  try {
    return chrome.storage?.session ?? null;
  } catch {
    return null;
  }
}

/** Read aggregation over all per-tab owner keys. Never used for writes. */
export async function readProtectedWorkOwners(): Promise<ProtectedWorkOwners> {
  const owners: ProtectedWorkOwners = { autoSolve: [], fullPage: [] };
  const area = sessionArea();
  if (!area) return owners;
  const everything = await area.get(null);
  for (const key of Object.keys(everything)) {
    const parsed = parseOwnerKey(key);
    if (!parsed) continue;
    const record = everything[key] as { active?: boolean } | undefined;
    if (!record?.active) continue;
    owners[parsed.kind].push({ tabId: parsed.tabId });
  }
  // Deterministic ordering for callers and tests.
  owners.autoSolve.sort((a, b) => a.tabId - b.tabId);
  owners.fullPage.sort((a, b) => a.tabId - b.tabId);
  return owners;
}

/**
 * START path: record the exact dispatch target tab. A single-key write — no
 * read of other owners, no merge — so a concurrent mark of the SAME kind
 * from another surface/tab cannot be lost (AUTH-UI-INV-16).
 */
export async function markProtectedWorkOwner(
  kind: ProtectedWorkKind,
  tabId: number,
): Promise<void> {
  await sessionArea()?.set({ [keyFor(kind, tabId)]: { active: true, tabId } });
}

/**
 * Runtime progress reconciliation: once a tab reports a running workflow,
 * its owner entry must exist (recovery path, never the only path).
 */
export async function reconcileProtectedWorkOwnerFromRuntime(
  kind: ProtectedWorkKind,
  tabId: number,
): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  const key = keyFor(kind, tabId);
  const existing = await area.get(key);
  const record = existing[key] as { active?: boolean } | undefined;
  if (record?.active) return;
  await area.set({ [key]: { active: true, tabId } });
}

/**
 * Natural completion / explicit stop: remove THIS tab's key only. Other
 * tabs running the same kind are untouched. The tabId is required —
 * callers must know exactly whose owner they are clearing.
 */
export async function clearProtectedWorkOwner(
  kind: ProtectedWorkKind,
  tabId: number,
): Promise<void> {
  await sessionArea()?.remove(keyFor(kind, tabId));
}

/** Test/reset helper: remove every owner key. Never used by termination. */
export async function resetProtectedWorkOwnersForTests(): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  const everything = await area.get(null);
  const ownerKeys = Object.keys(everything).filter((key) => key.startsWith(KEY_PREFIX));
  if (ownerKeys.length) await area.remove(ownerKeys);
}

/**
 * Auth-loss termination (AUTH-UI-INV-11/13/16): send the workflow-specific
 * termination message to EVERY recorded owner tab — several tabs may run
 * the same kind — and clear exactly the owner entries this snapshot
 * captured. Owners marked after the snapshot (a newer run) are left alone:
 * no global clear here.
 */
export async function terminateRecordedProtectedWork(
  send: (tabId: number, message: { type: string }) => Promise<unknown>,
): Promise<void> {
  const snapshot = await readProtectedWorkOwners();
  const captured: Array<{ kind: ProtectedWorkKind; tabId: number }> = [];
  const jobs: Promise<unknown>[] = [];
  for (const { tabId } of snapshot.autoSolve) {
    captured.push({ kind: "autoSolve", tabId });
    jobs.push(send(tabId, { type: "STOP_AUTO_SOLVE_ALL" }).catch(() => undefined));
  }
  for (const { tabId } of snapshot.fullPage) {
    captured.push({ kind: "fullPage", tabId });
    jobs.push(send(tabId, { type: "FULL_PAGE_DETECT_CANCELLED" }).catch(() => undefined));
  }
  await Promise.all(jobs);
  // Clear only what this termination captured — a newer owner that appeared
  // mid-termination survives.
  await Promise.all(captured.map(({ kind, tabId }) => clearProtectedWorkOwner(kind, tabId)));
}
