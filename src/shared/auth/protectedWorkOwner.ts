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

/** Shared wire-format check: malformed run IDs must never reach a start. */
export function isProtectedWorkGenerationId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

type StoredOwner = {
  key: string;
  kind: ProtectedWorkKind;
  tabId: number;
  /** Populated ONLY for an explicit token-aware START. */
  generationId?: string;
};

function legacyKeyFor(kind: ProtectedWorkKind, tabId: number): string {
  return `${KEY_PREFIX}${kind}:${tabId}`;
}

function parseOwnerKey(key: string): { kind: ProtectedWorkKind; tabId: number; generationId?: string } | null {
  // Optional UUID suffix supports previous extension versions whose session
  // records still use the single-key-per-tab layout.
  const match = /^protectedWorkOwner:(autoSolve|fullPage):(\d+)(?::([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))?$/.exec(key);
  if (!match) return null;
  const tabId = Number(match[2]);
  if (!Number.isSafeInteger(tabId) || tabId <= 0) return null;
  return { kind: match[1] as ProtectedWorkKind, tabId, ...(match[3] ? { generationId: match[3] } : {}) };
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
    const record = value as { active?: boolean; tabId?: unknown; completionProtocol?: unknown } | null;
    if (!record?.active) continue;
    // The persisted value must match the key's authoritative Tab identity.
    if (record.tabId !== undefined && record.tabId !== parsed.tabId) continue;
    records.push({
      key, kind: parsed.kind, tabId: parsed.tabId,
      ...(record.completionProtocol === "generation" && parsed.generationId
        ? { generationId: parsed.generationId }
        : {}),
    });
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
 * Run-generation authority for new START call sites. The UUID is generated
 * before persisting a NEW immutable key and is returned only after the write
 * commits. This token is not a bearer credential; it binds later DONE cleanup
 * to the exact owner generation, even if another context starts on the tab.
 *
 * Null means the session store was unavailable, not a successful owner mark.
 */
async function storeProtectedWorkOwner(
  kind: ProtectedWorkKind,
  tabId: number,
  completionProtocol: "legacy" | "generation",
): Promise<string | null> {
  const area = sessionArea();
  if (!area || !Number.isSafeInteger(tabId) || tabId <= 0) return null;
  const generationId = globalThis.crypto.randomUUID();
  // Only an explicit token-returning START opts in to generation-aware DONE.
  // Existing legacy STARTs cannot send this token and must remain distinct.
  await area.set({
    [`${legacyKeyFor(kind, tabId)}:${generationId}`]: {
      active: true, tabId, ...(completionProtocol === "generation" ? { completionProtocol } : {}),
    },
  });
  return generationId;
}

export async function markProtectedWorkOwnerWithGeneration(
  kind: ProtectedWorkKind,
  tabId: number,
): Promise<string | null> {
  return storeProtectedWorkOwner(kind, tabId, "generation");
}

/** Backward-compatible START: untagged DONE may clear only legacy owners. */
export async function markProtectedWorkOwner(
  kind: ProtectedWorkKind,
  tabId: number,
): Promise<void> {
  await storeProtectedWorkOwner(kind, tabId, "legacy");
}

/**
 * Completion of a KNOWN generation. Never scans or removes all same-tab
 * owners; an old DONE cannot erase a newer owner, even if remove is delayed.
 * Legacy callers without a generationId continue using the separate
 * clearProtectedWorkOwner API until their message contract is migrated.
 */
export async function clearProtectedWorkOwnerGeneration(
  kind: ProtectedWorkKind,
  tabId: number,
  generationId: string,
): Promise<boolean> {
  const area = sessionArea();
  if (!area || !Number.isSafeInteger(tabId) || tabId <= 0) return false;
  const key = `${legacyKeyFor(kind, tabId)}:${generationId}`;
  const parsed = parseOwnerKey(key);
  if (!parsed || parsed.kind !== kind || parsed.tabId !== tabId) return false;
  const entry = (await area.get(key))[key] as { active?: unknown; tabId?: unknown } | undefined;
  if (entry?.active !== true || entry.tabId !== tabId) return false;
  await area.remove(key);
  return true;
}

/**
 * DONE message cleanup while migrating the runtime wire protocol.
 *
 * Tagged DONE removes ONLY the specified generation; a malformed tag fails
 * closed. Untagged legacy DONE removes ONLY legacy/unbound generations, so
 * an old message can never erase a newly registered generation-aware owner.
 * Both paths snapshot immutable keys before remove (no storage CAS required).
 *
 * UI result delivery and STOP execution authority are separate concerns.
 */
export async function clearProtectedWorkOwnerFromRuntimeDone(
  kind: ProtectedWorkKind,
  tabId: number,
  generationId?: unknown,
): Promise<boolean> {
  if (generationId !== undefined) {
    if (typeof generationId !== "string") return false;
    return clearProtectedWorkOwnerGeneration(kind, tabId, generationId);
  }
  const area = sessionArea();
  if (!area || !Number.isSafeInteger(tabId) || tabId <= 0) return false;
  const snapshot = await area.get(null);
  const keys = ownerRecordsFor(snapshot, kind, tabId)
    .filter(({ key }) => {
      const value = snapshot[key] as { completionProtocol?: unknown } | undefined;
      return value?.completionProtocol !== "generation";
    })
    .map(({ key }) => key);
  if (!keys.length) return false;
  await area.remove(keys);
  return true;
}

/**
 * UI projection authority is independent of DONE owner cleanup. A tagged
 * runtime update must correspond to an active exact owner; when multiple
 * distinct tagged owners are live on the same tab, rendering is ambiguous and
 * must fail closed. Legacy untagged updates must not override a tagged run.
 *
 * For backward compatibility, untagged legacy PROGRESS without a prior owner
 * may still be projected and reconciled (older content-script protocol).
 */
export async function isProtectedWorkRuntimeUiMessageCurrent(
  kind: ProtectedWorkKind,
  tabId: number,
  generationId?: unknown,
): Promise<boolean> {
  if (!Number.isSafeInteger(tabId) || tabId <= 0) return false;
  if (generationId !== undefined && !isProtectedWorkGenerationId(generationId)) return false;
  const area = sessionArea();
  if (!area) return generationId === undefined;
  const captured = ownerRecordsFor(await area.get(null), kind, tabId);
  const tagged = captured.filter((o) => o.generationId !== undefined);
  if (generationId === undefined) return tagged.length === 0;
  return tagged.length === 1 && tagged[0]?.generationId === generationId;
}

/**
 * Completion feedback is rendered after the exact DONE owner was removed.
 * Revalidate after asynchronous localization: any newer/different tagged
 * owner suppresses stale success feedback, even if the DONE was initially
 * valid. The original DONE's own key may already have been removed.
 */
export async function hasConflictingProtectedWorkUiOwner(
  kind: ProtectedWorkKind,
  tabId: number,
  generationId?: unknown,
): Promise<boolean> {
  if (!Number.isSafeInteger(tabId) || tabId <= 0) return true;
  if (generationId !== undefined && !isProtectedWorkGenerationId(generationId)) return true;
  const area = sessionArea();
  if (!area) return generationId !== undefined;
  const current = ownerRecordsFor(await area.get(null), kind, tabId);
  return current.some((o) => generationId === undefined
    ? o.generationId !== undefined
    : o.generationId !== generationId);
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

/** A STOP wire message targets one immutable owner identity. */
type ProtectedStopMessage =
  | { type: "STOP_AUTO_SOLVE_ALL"; generationId?: string }
  | { type: "FULL_PAGE_DETECT_CANCELLED"; generationId?: string };

function stopTargets(
  captured: StoredOwner[],
  kind: ProtectedWorkKind,
  pendingTabId?: number,
): Array<{ tabId: number; generationId?: string }> {
  // Tagged generations get one targeted message EACH. Multiple legacy keys
  // on the same tab get one legacy STOP; keep historical dedup behavior.
  const byIdentity = new Map<string, { tabId: number; generationId?: string }>();
  for (const owner of captured) {
    if (owner.kind !== kind) continue;
    const identity = `${owner.tabId}:${owner.generationId ?? "legacy"}`;
    byIdentity.set(identity, { tabId: owner.tabId, ...(owner.generationId ? { generationId: owner.generationId } : {}) });
  }
  if (typeof pendingTabId === "number" && Number.isSafeInteger(pendingTabId) && pendingTabId > 0
    && ![...byIdentity.values()].some((owner) => owner.tabId === pendingTabId)) {
    // Only an uncommitted local intent may use a legacy pending-tab fallback.
    // Tagged runtimes reject this fallback, preventing a stale-tab kill.
    byIdentity.set(`${pendingTabId}:legacy`, { tabId: pendingTabId });
  }
  return [...byIdentity.values()].sort((a, b) => a.tabId - b.tabId
    || (a.generationId ?? "").localeCompare(b.generationId ?? ""));
}

function stopWireMessage(kind: ProtectedWorkKind, generationId?: string): ProtectedStopMessage {
  return kind === "autoSolve"
    ? { type: "STOP_AUTO_SOLVE_ALL", ...(generationId ? { generationId } : {}) }
    : { type: "FULL_PAGE_DETECT_CANCELLED", ...(generationId ? { generationId } : {}) };
}

/**
 * Manually terminate ONE protected kind. All target generations are frozen
 * before network I/O; STOP carries each captured generation and cleanup
 * removes only captured storage keys (never a later same-tab START).
 */
export async function terminateRecordedProtectedWorkKind(
  kind: ProtectedWorkKind,
  send: (tabId: number, message: ProtectedStopMessage) => Promise<unknown>,
  localPendingTabId?: number,
): Promise<number> {
  const area = sessionArea();
  const captured = area ? activeOwnerRecords(await area.get(null)).filter(record => record.kind === kind) : [];
  const targets = stopTargets(captured, kind, localPendingTabId);
  await Promise.all(targets.map(({ tabId, generationId }) =>
    send(tabId, stopWireMessage(kind, generationId)).catch(() => undefined),
  ));
  if (captured.length) await area?.remove(captured.map(({ key }) => key));
  // Return number of distinct tabs, not number of generation-specific sends.
  return new Set(targets.map(t => t.tabId)).size;
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
 * Auth-loss termination: take one immutable snapshot before transport, send
 * per-generation STOP/CANCEL (legacy one-per-tab remains), and clear only
 * snapshotted keys. A new same-tab generation survives both the STOP wire
 * and storage cleanup.
 */
export async function terminateRecordedProtectedWork(
  send: (tabId: number, message: ProtectedStopMessage) => Promise<unknown>,
  localPending?: Partial<Record<ProtectedWorkKind, number>>,
): Promise<void> {
  const area = sessionArea();
  const captured = area ? activeOwnerRecords(await area.get(null)) : [];
  const jobs: Promise<unknown>[] = [];
  for (const kind of ["autoSolve", "fullPage"] as const) {
    const targets = stopTargets(captured, kind, localPending?.[kind]);
    for (const { tabId, generationId } of targets) {
      jobs.push(send(tabId, stopWireMessage(kind, generationId)).catch(() => undefined));
    }
  }
  await Promise.all(jobs);
  if (captured.length) await area?.remove(captured.map(({ key }) => key));
}
