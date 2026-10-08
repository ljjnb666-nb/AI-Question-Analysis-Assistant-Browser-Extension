/**
 * AUTH-UI-INV-15/16 and PHASE14B_OWNER_FENCE — cross-surface, multi-tab owner
 * records. Chrome storage.session has no compare-and-swap transaction.
 *
 * Use a NEW IMMUTABLE key for every owner generation:
 *   protectedWorkOwner:<kind>:<tabId>:<uuid>
 * rather than overwriting protectedWorkOwner:<kind>:<tabId>.
 * A STOP started before another context marks a new generation must only
 * clear its captured keys; no later mark can be erased by that STOP's clear.
 *
 * Legacy per-tab keys (before this change) remain readable and clearable.
 * The public read view deduplicates generations by tab, since a STOP is
 * targeted to a tab, not to an individual generation.
 *
 * Warning: clearProtectedWorkOwner(kind, tabId) is an explicit ALL-generations
 * clear for normal completion/manual stop; it has no run-generation argument.
 * It must not be used to implement snapshot-based auth-loss termination.
 */
export type ProtectedWorkKind = "autoSolve" | "fullPage";

export type ProtectedWorkOwnerEntry = { tabId: number };

export type ProtectedWorkOwners = {
  autoSolve: ProtectedWorkOwnerEntry[];
  fullPage: ProtectedWorkOwnerEntry[];
};

const KEY_PREFIX = "protectedWorkOwner:";

type StoredOwner = {
  key: string;
  kind: ProtectedWorkKind;
  tabId: number;
};

function legacyKeyFor(kind: ProtectedWorkKind, tabId: number): string {
  return `${KEY_PREFIX}${kind}:${tabId}`;
}

function keyForNewGeneration(kind: ProtectedWorkKind, tabId: number): string {
  return `${legacyKeyFor(kind, tabId)}:${globalThis.crypto.randomUUID()}`;
}

function parseOwnerKey(key: string): { kind: ProtectedWorkKind; tabId: number } | null {
  // Optional UUID suffix supports previous extension versions whose session
  // records still use the single-key-per-tab layout.
  const match = /^protectedWorkOwner:(autoSolve|fullPage):(\d+)(?::[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/.exec(key);
  if (!match) return null;
  const tabId = Number(match[2]);
  if (!Number.isSafeInteger(tabId) || tabId <= 0) return null;
  return { kind: match[1] as ProtectedWorkKind, tabId };
}

function sessionArea(): chrome.storage.StorageArea | null {
  try {
    return chrome.storage?.session ?? null;
  } catch {
    return null;
  }
}

function activeOwnerRecords(everything: Record<string, unknown>): StoredOwner[] {
  const records: StoredOwner[] = [];
  for (const [key, value] of Object.entries(everything)) {
    const parsed = parseOwnerKey(key);
    if (!parsed) continue;
    const record = value as { active?: boolean; tabId?: unknown } | null;
    if (!record?.active) continue;
    // The persisted value must match the key's authoritative Tab identity.
    if (record.tabId !== undefined && record.tabId !== parsed.tabId) continue;
    records.push({ key, ...parsed });
  }
  return records;
}

function ownerRecordsFor(
  everything: Record<string, unknown>,
  kind: ProtectedWorkKind,
  tabId: number,
): StoredOwner[] {
  return activeOwnerRecords(everything).filter((owner) => owner.kind === kind && owner.tabId === tabId);
}

/** Read aggregation over all owner generations. Never used for writes. */
export async function readProtectedWorkOwners(): Promise<ProtectedWorkOwners> {
  const owners: ProtectedWorkOwners = { autoSolve: [], fullPage: [] };
  const area = sessionArea();
  if (!area) return owners;
  const snapshot = activeOwnerRecords(await area.get(null));
  const byKind = {
    autoSolve: new Set<number>(),
    fullPage: new Set<number>(),
  };
  for (const { kind, tabId } of snapshot) byKind[kind].add(tabId);
  owners.autoSolve = [...byKind.autoSolve].sort((a, b) => a - b).map((tabId) => ({ tabId }));
  owners.fullPage = [...byKind.fullPage].sort((a, b) => a - b).map((tabId) => ({ tabId }));
  return owners;
}

/**
 * START writes only its own generation key. Different contexts never
 * overwrite the same key even when they mark the same kind + same tab.
 */
export async function markProtectedWorkOwner(
  kind: ProtectedWorkKind,
  tabId: number,
): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.set({ [keyForNewGeneration(kind, tabId)]: { active: true, tabId } });
}

/**
 * Runtime progress reconciliation: mark only when no active generation for
 * this kind + tab currently exists. A racing START may create an extra
 * generation; read and termination remain deduplicated by tab.
 */
export async function reconcileProtectedWorkOwnerFromRuntime(
  kind: ProtectedWorkKind,
  tabId: number,
): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  if (ownerRecordsFor(await area.get(null), kind, tabId).length > 0) return;
  await markProtectedWorkOwner(kind, tabId);
}

/**
 * Normal completion or explicit manual stop: clear all generations for this
 * tab/kind captured at this call's storage snapshot. A later independent
 * mark cannot reuse any captured key.
 *
 * This is intentionally NOT a per-run compare-and-swap. Callers clearing
 * after a newer generation was already written need run-specific identity;
 * do not use this function for auth-loss snapshot cleanup.
 */
export async function clearProtectedWorkOwner(
  kind: ProtectedWorkKind,
  tabId: number,
): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  const keys = ownerRecordsFor(await area.get(null), kind, tabId).map((entry) => entry.key);
  // Also discard malformed/inactive matching legacy keys on explicit cleanup.
  const legacyKey = legacyKeyFor(kind, tabId);
  const all = await area.get(legacyKey);
  if (Object.prototype.hasOwnProperty.call(all, legacyKey) && !keys.includes(legacyKey)) keys.push(legacyKey);
  if (keys.length) await area.remove(keys);
}

/** Test-only: purge all namespaced owner keys. Never used by termination. */
export async function resetProtectedWorkOwnersForTests(): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  const everything = await area.get(null);
  const keys = Object.keys(everything).filter((key) => key.startsWith(KEY_PREFIX));
  if (keys.length) await area.remove(keys);
}

/**
 * Auth-loss termination: capture immutable generation KEYS once, send one
 * STOP per logical kind/tab, and remove EXACTLY those captured keys. A new
 * generation marked after the snapshot, including on the same tab, survives.
 * A failed STOP send remains best effort as in the existing contract.
 */
export async function terminateRecordedProtectedWork(
  send: (tabId: number, message: { type: string }) => Promise<unknown>,
): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  const captured = activeOwnerRecords(await area.get(null));
  const byKind = {
    autoSolve: new Set<number>(),
    fullPage: new Set<number>(),
  };
  for (const { kind, tabId } of captured) byKind[kind].add(tabId);
  const jobs: Promise<unknown>[] = [];
  for (const tabId of [...byKind.autoSolve].sort((a, b) => a - b)) {
    jobs.push(send(tabId, { type: "STOP_AUTO_SOLVE_ALL" }).catch(() => undefined));
  }
  for (const tabId of [...byKind.fullPage].sort((a, b) => a - b)) {
    jobs.push(send(tabId, { type: "FULL_PAGE_DETECT_CANCELLED" }).catch(() => undefined));
  }
  await Promise.all(jobs);
  if (captured.length) await area.remove(captured.map(({ key }) => key));
}
