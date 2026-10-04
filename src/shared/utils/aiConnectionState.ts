/**
 * UI05R-E1 — AIConnectionState storage SSOT.
 *
 * All AI provider configuration (connections + encrypted credentials) lives in
 * ONE `chrome.storage.local` key: `aiConnectionState`. There is no separately
 * writable connection store or credential store beside it.
 *
 * Concurrency model (documented contract, tested in aiConnectionState.test.ts):
 * - `chrome.storage.local` has no transactions or compare-and-swap.
 * - Within one extension context, JavaScript execution is event-loop
 *   serialized, so a load→save sequence cannot interleave.
 * - Across contexts (e.g. background service worker vs side panel), a plain
 *   read-modify-write could silently clobber newer state. `updateAIConnectionState`
 *   closes this: it re-reads the stored revision immediately before writing,
 *   retries the mutator on top of a newer base (bounded attempts), and throws
 *   `AIConnectionStateConflictError` instead of clobbering when attempts are
 *   exhausted.
 *
 * Authority staging: until the E2 parseRouter cutover, legacy `AppSettings`
 * AI fields remain the runtime authority; this state is a shadow created by
 * migration. After E2 this state becomes authoritative and the legacy fields
 * become a compatibility projection only.
 */

import type {
  AIConnectionState,
  AuthScheme,
  Connection,
  ConnectionMetadata,
  EncryptedCredentialRecord,
  ProtocolId,
  ProviderPresetId,
  ValidationRecord,
  ValidationStatus,
} from "../types/connection";
import {
  isProtocolId,
  isProviderPresetId,
  resolveConnectionEndpoint,
  resolveConnectionProtocol,
} from "./aiConnectionPresets";

export const AI_CONNECTION_STATE_STORAGE_KEY = "aiConnectionState";

const VALIDATION_STATUSES: readonly ValidationStatus[] = [
  "never_tested",
  "testing",
  "validated",
  "failed",
  "stale",
];

/** Namespace every credential envelope version shares (`qse:*`). */
const CREDENTIAL_ENVELOPE_NAMESPACE = "qse:";

/** Thrown when stored state claims the key but fails schemaVersion-1 validation. */
export class MalformedAIConnectionStateError extends Error {
  constructor(reason: string) {
    super(`Stored ${AI_CONNECTION_STATE_STORAGE_KEY} is malformed: ${reason}`);
    this.name = "MalformedAIConnectionStateError";
  }
}

/** Thrown when a bounded revision-conflict retry loop cannot commit a mutation. */
export class AIConnectionStateConflictError extends Error {
  constructor(attempts: number) {
    super(
      `AI connection state changed concurrently; mutation aborted after ${attempts} attempts to avoid clobbering newer state`,
    );
    this.name = "AIConnectionStateConflictError";
  }
}

export function createEmptyAIConnectionState(): AIConnectionState {
  return {
    schemaVersion: 1,
    revision: 1,
    activeConnectionId: null,
    connections: {},
    credentials: {},
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isAuthScheme(value: unknown): value is AuthScheme {
  if (!isPlainObject(value)) return false;
  switch (value.kind) {
    case "bearer":
    case "none":
      return true;
    case "header":
      return isNonEmptyString(value.headerName);
    case "query":
      return isNonEmptyString(value.parameterName);
    default:
      return false;
  }
}

function isValidationRecord(value: unknown): value is ValidationRecord {
  if (!isPlainObject(value)) return false;
  if (!(VALIDATION_STATUSES as readonly string[]).includes(value.status as ValidationStatus)) return false;
  if (!isInteger(value.generation, 0)) return false;
  if (value.validatedConnectionRevision !== undefined && !isInteger(value.validatedConnectionRevision, 1)) return false;
  if (value.validatedCredentialRevision !== undefined && !isInteger(value.validatedCredentialRevision, 1)) return false;
  if (value.validatedAt !== undefined && !isFiniteNumber(value.validatedAt)) return false;
  if (value.errorCode !== undefined && !isNonEmptyString(value.errorCode)) return false;
  return true;
}

function isConnection(value: unknown, expectedId: string, credentials: Record<string, EncryptedCredentialRecord>): value is Connection {
  if (!isPlainObject(value)) return false;
  if (value.id !== expectedId) return false;
  if (typeof value.name !== "string") return false;
  if (!isProviderPresetId(value.presetId)) return false;
  if (value.endpointOverride !== undefined && !isNonEmptyString(value.endpointOverride)) return false;
  if (value.protocolOverride !== undefined && !isProtocolId(value.protocolOverride)) return false;
  if (!isAuthScheme(value.authScheme)) return false;
  if (value.credentialRef !== undefined) {
    if (!isNonEmptyString(value.credentialRef)) return false;
    // Referential integrity: a connection may only reference a credential that
    // exists in the same state snapshot.
    if (!isPlainObject(credentials) || !(value.credentialRef in credentials)) return false;
  }
  if (typeof value.selectedModelId !== "string") return false;
  if (!isInteger(value.connectionRevision, 1)) return false;
  if (!isValidationRecord(value.validation)) return false;
  if (!isFiniteNumber(value.createdAt) || !isFiniteNumber(value.updatedAt)) return false;
  return true;
}

function isEncryptedCredentialRecord(value: unknown, expectedRef: string): value is EncryptedCredentialRecord {
  if (!isPlainObject(value)) return false;
  if (value.ref !== expectedRef) return false;
  if (value.type !== "api_key") return false;
  // Defense in depth: persisted credential material must always claim the
  // `qse:*` envelope namespace. A plaintext value fails validation, so a save
  // of plaintext credential material fails closed instead of being stored.
  if (!isNonEmptyString(value.encryptedValue)) return false;
  if (!value.encryptedValue.startsWith(CREDENTIAL_ENVELOPE_NAMESPACE)) return false;
  if (!isInteger(value.revision, 1)) return false;
  if (!isFiniteNumber(value.updatedAt)) return false;
  return true;
}

/**
 * Structural validation for schemaVersion 1. Throws
 * `MalformedAIConnectionStateError` (fail closed) instead of repairing or
 * partially accepting damaged state.
 */
export function validateAIConnectionState(raw: unknown): AIConnectionState {
  if (!isPlainObject(raw)) throw new MalformedAIConnectionStateError("state is not an object");
  if (raw.schemaVersion !== 1) {
    throw new MalformedAIConnectionStateError(`unsupported schemaVersion ${String(raw.schemaVersion)}`);
  }
  if (!isInteger(raw.revision, 1)) throw new MalformedAIConnectionStateError("revision must be an integer >= 1");
  if (raw.activeConnectionId !== null && !isNonEmptyString(raw.activeConnectionId)) {
    throw new MalformedAIConnectionStateError("activeConnectionId must be null or a non-empty string");
  }
  if (!isPlainObject(raw.connections)) throw new MalformedAIConnectionStateError("connections must be an object");
  if (!isPlainObject(raw.credentials)) throw new MalformedAIConnectionStateError("credentials must be an object");

  for (const [ref, record] of Object.entries(raw.credentials)) {
    if (!isEncryptedCredentialRecord(record, ref)) {
      throw new MalformedAIConnectionStateError(`credential record "${ref}" is invalid`);
    }
  }
  for (const [id, connection] of Object.entries(raw.connections)) {
    if (!isConnection(connection, id, raw.credentials as Record<string, EncryptedCredentialRecord>)) {
      throw new MalformedAIConnectionStateError(`connection "${id}" is invalid`);
    }
  }
  if (
    raw.activeConnectionId !== null &&
    !(raw.activeConnectionId in raw.connections)
  ) {
    throw new MalformedAIConnectionStateError("activeConnectionId does not reference an existing connection");
  }

  return raw as unknown as AIConnectionState;
}

async function readRawState(): Promise<unknown> {
  const result = await chrome.storage.local.get(AI_CONNECTION_STATE_STORAGE_KEY);
  return result[AI_CONNECTION_STATE_STORAGE_KEY];
}

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Load the AI connection state.
 * - Absent key -> null (the E1 migration eligibility marker).
 * - Malformed state -> throws MalformedAIConnectionStateError (fail closed);
 *   callers must never fall back to fabricating a default.
 */
export async function loadAIConnectionState(): Promise<AIConnectionState | null> {
  const raw = await readRawState();
  if (raw === undefined) return null;
  return cloneState(validateAIConnectionState(raw));
}

/**
 * Persist a complete state. The caller must have observed this state in the
 * same context turn; cross-context mutations should use
 * `updateAIConnectionState`, which is revision-aware. Validation runs before
 * the write: malformed or plaintext-bearing state fails closed.
 */
export async function saveAIConnectionState(state: AIConnectionState): Promise<void> {
  const validated = validateAIConnectionState(cloneState(state));
  await chrome.storage.local.set({ [AI_CONNECTION_STATE_STORAGE_KEY]: validated });
}

/**
 * Revision-aware mutation. Reads the current state (fail closed on malformed),
 * applies `mutate`, bumps the whole-state revision, re-reads immediately
 * before writing, and retries the whole sequence on a revision conflict.
 * Returning null from `mutate` aborts without writing (idempotent no-op).
 *
 * Throws MalformedAIConnectionStateError when the stored state is invalid, and
 * AIConnectionStateConflictError after exhausting attempts instead of
 * silently clobbering newer state.
 */
export async function updateAIConnectionState(
  mutate: (state: AIConnectionState) => AIConnectionState | null,
  options?: { maxAttempts?: number },
): Promise<AIConnectionState | null> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const observedRaw = await readRawState();
    const observedAbsent = observedRaw === undefined;
    const base = observedAbsent ? createEmptyAIConnectionState() : validateAIConnectionState(observedRaw);

    const draft = mutate(cloneState(base));
    if (draft === null) return null;
    draft.revision = base.revision + 1;
    const validated = validateAIConnectionState(draft);

    // Narrow CAS window: re-read right before the write. Chrome storage has no
    // atomic compare-and-swap, so the remaining race window is one event-loop
    // turn wide; the retry loop keeps it recoverable, and exhaustion throws
    // rather than clobbering.
    const latestRaw = await readRawState();
    const latestAbsent = latestRaw === undefined;
    const conflicts =
      latestAbsent !== observedAbsent ||
      (!latestAbsent && validateAIConnectionState(latestRaw).revision !== base.revision);
    if (conflicts) {
      if (attempt === maxAttempts) throw new AIConnectionStateConflictError(maxAttempts);
      continue;
    }

    await chrome.storage.local.set({ [AI_CONNECTION_STATE_STORAGE_KEY]: validated });
    return validated;
  }
  throw new AIConnectionStateConflictError(maxAttempts);
}

/** Non-secret projection of a connection. Never contains credential material. */
export function toConnectionMetadata(
  connection: Connection,
  state: Pick<AIConnectionState, "credentials">,
): ConnectionMetadata {
  const credential = connection.credentialRef ? state.credentials[connection.credentialRef] : undefined;
  return {
    id: connection.id,
    name: connection.name,
    presetId: connection.presetId,
    protocol: resolveConnectionProtocol(connection),
    endpoint: resolveConnectionEndpoint(connection),
    authScheme: connection.authScheme,
    credentialRef: connection.credentialRef,
    hasCredential: credential !== undefined,
    credentialRevision: credential?.revision,
    selectedModelId: connection.selectedModelId,
    connectionRevision: connection.connectionRevision,
    validation: cloneState(connection.validation),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

/**
 * Metadata for the active connection, or null when absent/unset. Malformed
 * state fails closed (throws); metadata never exposes credential material.
 */
export async function getActiveConnectionMetadata(): Promise<ConnectionMetadata | null> {
  const state = await loadAIConnectionState();
  if (!state || state.activeConnectionId === null) return null;
  const connection = state.connections[state.activeConnectionId];
  if (!connection) return null;
  return toConnectionMetadata(connection, state);
}

/** Metadata for one connection by id, or null when not found. */
export async function getConnectionMetadata(id: string): Promise<ConnectionMetadata | null> {
  const state = await loadAIConnectionState();
  if (!state) return null;
  const connection = state.connections[id];
  if (!connection) return null;
  return toConnectionMetadata(connection, state);
}

// Type-level re-exports keep storage consumers on the connection domain types.
export type {
  AIConnectionState,
  Connection,
  ConnectionMetadata,
  EncryptedCredentialRecord,
  ProtocolId,
  ProviderPresetId,
  ValidationRecord,
};
