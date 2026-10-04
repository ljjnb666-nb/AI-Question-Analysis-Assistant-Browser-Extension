/**
 * UI05R-E1 — AIConnectionState storage SSOT.
 *
 * All AI provider configuration (connections + encrypted credentials) lives in
 * ONE `chrome.storage.local` key: `aiConnectionState`. There is no separately
 * writable connection store or credential store beside it.
 *
 * Ownership model (frozen contract):
 * - AIConnectionState WRITES = single writer authority. From E2 onward the
 *   background service worker is the only production mutation authority;
 *   Settings and other surfaces send mutation commands to it, and direct UI
 *   writes are forbidden. Other extension contexts are read-only for state
 *   metadata.
 * - `chrome.storage.local` has no atomic compare-and-swap. Cross-context
 *   lost-update safety therefore comes ONLY from the single-writer ownership
 *   rule — not from any read/write interleaving trick. Nothing here claims to
 *   close the gap between a read and a write across contexts.
 * - Inside the owning context, `withAIConnectionStateWriteLock` strictly
 *   serializes mutations (async interleaving across awaits is real even in
 *   one context). The lock is an owner-context convenience only and does NOT
 *   solve cross-context concurrency.
 *
 * Initialization rule: only the explicit migration/initialization path may
 * create the first AIConnectionState. Ordinary mutation on absent state fails
 * with `AIConnectionStateNotInitializedError` so the absent key keeps its
 * meaning as the migration eligibility marker.
 *
 * Current closure: background initializes AIConnectionState from migration-only raw
 * input, then physically deletes legacy AI keys through the appSettings owner.
 * AppSettings contains only ordinary preferences and account/session values.
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
import { ENCRYPTED_VALUE_PREFIX } from "./encryption";

export const AI_CONNECTION_STATE_STORAGE_KEY = "aiConnectionState";

const VALIDATION_STATUSES: readonly ValidationStatus[] = [
  "never_tested",
  "testing",
  "validated",
  "failed",
  "stale",
];

/** Thrown when stored state claims the key but fails schemaVersion-1 validation. */
export class MalformedAIConnectionStateError extends Error {
  constructor(reason: string) {
    super(`Stored ${AI_CONNECTION_STATE_STORAGE_KEY} is malformed: ${reason}`);
    this.name = "MalformedAIConnectionStateError";
  }
}

/**
 * Thrown when a mutation targets a context where no AIConnectionState exists
 * yet. Ordinary mutations must never auto-initialize the state: the absent
 * key is the migration eligibility marker, and only the explicit
 * migration/initialization path may create the first state.
 */
export class AIConnectionStateNotInitializedError extends Error {
  constructor() {
    super(
      `No ${AI_CONNECTION_STATE_STORAGE_KEY} exists yet; only the explicit migration/initialization path may create it`,
    );
    this.name = "AIConnectionStateNotInitializedError";
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
  // schemaVersion 1 accepts ONLY the currently supported `qse:v1:` envelope.
  // Unknown `qse:*` versions fail state validation instead of being treated as
  // valid credential state; plaintext values fail for the same reason.
  if (!isNonEmptyString(value.encryptedValue)) return false;
  if (!value.encryptedValue.startsWith(ENCRYPTED_VALUE_PREFIX)) return false;
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
 * - Absent key -> null (the migration eligibility marker).
 * - Malformed state -> throws MalformedAIConnectionStateError (fail closed);
 *   callers must never fall back to fabricating a default.
 */
export async function loadAIConnectionState(): Promise<AIConnectionState | null> {
  const raw = await readRawState();
  if (raw === undefined) return null;
  return cloneState(validateAIConnectionState(raw));
}

/**
 * Internal persistence primitive: validated, unconditional write of a
 * complete state. NOT a general-purpose writer. It is reserved for the
 * explicit initialization/migration path and for `updateAIConnectionState`
 * inside the owner-context write lock. Ordinary consumers must use
 * `updateAIConnectionState`, and production writes belong to the single
 * writer authority (the background service worker from E2 onward) — a bare
 * read-modify-write across contexts would silently clobber newer state.
 */
export async function persistAIConnectionState(state: AIConnectionState): Promise<void> {
  const validated = validateAIConnectionState(cloneState(state));
  await chrome.storage.local.set({ [AI_CONNECTION_STATE_STORAGE_KEY]: validated });
}

/**
 * Owner-context write lock. Tasks are strictly serialized in submission
 * order: a task starts only after the previous one settles. A rejected task
 * never poisons the queue — later mutations still execute. This serializes
 * the OWNING CONTEXT only; it does not claim to solve cross-context
 * concurrency (that is the single-writer ownership rule's job).
 */
let ownerWriteQueue: Promise<unknown> = Promise.resolve();

export function withAIConnectionStateWriteLock<T>(task: () => Promise<T>): Promise<T> {
  const run = ownerWriteQueue.catch(() => undefined).then(task);
  ownerWriteQueue = run;
  return run;
}

/**
 * Single-owner mutation helper. Must be called from the writer-authority
 * context. Reads the current state (fail closed when absent — mutations never
 * auto-initialize — and when malformed), applies `mutate`, bumps the
 * whole-state revision, validates, and persists — all inside the
 * owner-context write lock. Returning null from `mutate` aborts without
 * writing (idempotent no-op).
 */
export async function updateAIConnectionState(
  mutate: (state: AIConnectionState) => AIConnectionState | null | Promise<AIConnectionState | null>,
): Promise<AIConnectionState | null> {
  return withAIConnectionStateWriteLock(async () => {
    const raw = await readRawState();
    if (raw === undefined) throw new AIConnectionStateNotInitializedError();
    const base = validateAIConnectionState(raw);

    const draft = await mutate(cloneState(base));
    if (draft === null) return null;
    draft.revision = base.revision + 1;
    const validated = validateAIConnectionState(draft);
    await persistAIConnectionState(validated);
    return validated;
  });
}

/**
 * Invalidate the validation authority of a connection after a runtime-relevant
 * configuration or credential change: prior validation knowledge must not
 * remain current. `validated`/`failed`/`testing`/`stale` become `stale` with
 * all bound revisions, timestamps, and error codes cleared;
 * `never_tested` stays `never_tested`. The generation always increments so an
 * in-flight validation for the previous configuration can never later be
 * honored as current.
 */
export function invalidateConnectionValidation(connection: Connection): void {
  const hadAuthority = connection.validation.status !== "never_tested";
  connection.validation = {
    status: hadAuthority ? "stale" : "never_tested",
    generation: connection.validation.generation + 1,
  };
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
