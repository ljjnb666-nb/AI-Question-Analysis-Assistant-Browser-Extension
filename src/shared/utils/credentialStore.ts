/**
 * UI05R-E1 — Bounded credential store API over the AIConnectionState SSOT.
 *
 * Security contract:
 * - Only `resolveCredentialForRuntime` may decrypt persisted credential
 *   material, and only for normal runtime use.
 * - General connection readers (metadata APIs) never return plaintext.
 * - Write results expose committed non-secret metadata only (ref, revision,
 *   committed updatedAt) — never the encrypted envelope.
 * - Credential values are always persisted as `qse:v1:` envelopes; plaintext
 *   is never stored and never logged. This is application-layer encryption in
 *   local extension storage — not an OS keychain.
 *
 * Mutations run inside the owner-context write lock via
 * `updateAIConnectionState`; production callers are the single writer
 * authority (background service worker from E2). Mutations never
 * auto-initialize absent state.
 */

import { decryptValue, encryptValue } from "./encryption";
import type { EncryptedCredentialRecord } from "../types/connection";
import {
  invalidateConnectionValidation,
  updateAIConnectionState,
  loadAIConnectionState,
} from "./aiConnectionState";

/** Thrown when a credential ref does not exist. Fails closed: no empty-string fallback. */
export class CredentialNotFoundError extends Error {
  constructor(ref: string) {
    super(`Credential "${ref}" does not exist`);
    this.name = "CredentialNotFoundError";
  }
}

export interface CredentialPresence {
  exists: boolean;
  /** Present only when the credential exists. Never secret material. */
  revision?: number;
  updatedAt?: number;
}

/** Committed, non-secret result of a credential write. */
export interface CredentialWriteMetadata {
  ref: string;
  revision: number;
  /** The exact committed updatedAt of the credential record. */
  updatedAt: number;
}

/**
 * Whether a credential record exists, plus non-secret metadata. Never returns
 * credential material.
 */
export async function getCredentialPresence(ref: string): Promise<CredentialPresence> {
  const state = await loadAIConnectionState();
  const record = state?.credentials[ref];
  if (!record) return { exists: false };
  return { exists: true, revision: record.revision, updatedAt: record.updatedAt };
}

/**
 * Encrypt `plaintext` into a fresh `qse:v1` envelope and replace (or create)
 * the credential record. Credential replacement increments the credential
 * revision and invalidates the validation authority of every connection
 * referencing the credential: prior validation knowledge (validated, failed,
 * testing, or stale) becomes stale with bound revisions cleared and the
 * generation incremented, so an in-flight validation for the previous
 * credential can never later be honored as current. Connection metadata
 * (connectionRevision, updatedAt) is untouched — only credential material
 * changed.
 */
export async function replaceCredential(ref: string, plaintext: string): Promise<CredentialWriteMetadata> {
  if (!ref) throw new Error("Credential ref must be a non-empty string");
  if (!plaintext) throw new Error("Refusing to store an empty credential; use clearCredential instead");
  const encryptedValue = await encryptValue(plaintext);
  const committed = await updateAIConnectionState((state) => {
    const previous = state.credentials[ref];
    const record: EncryptedCredentialRecord = {
      ref,
      type: "api_key",
      encryptedValue,
      revision: previous ? previous.revision + 1 : 1,
      updatedAt: Date.now(),
    };
    state.credentials[ref] = record;
    for (const connection of Object.values(state.connections)) {
      if (connection.credentialRef === ref) {
        invalidateConnectionValidation(connection);
      }
    }
    return state;
  });
  if (!committed) throw new Error("Credential replacement unexpectedly committed nothing");
  return { ref, revision: committed.credentials[ref].revision, updatedAt: committed.credentials[ref].updatedAt };
}

/**
 * Remove a credential record. Because credentialRef is runtime-relevant
 * Connection metadata, every connection referencing the cleared credential
 * gets its credentialRef removed, its connectionRevision incremented, its
 * updatedAt refreshed, and its validation authority invalidated (generation
 * incremented). Idempotent: clearing an unknown ref is a no-op that does not
 * bump the state revision.
 */
export async function clearCredential(ref: string): Promise<void> {
  await updateAIConnectionState((state) => {
    if (!state.credentials[ref]) return null;
    delete state.credentials[ref];
    const now = Date.now();
    for (const connection of Object.values(state.connections)) {
      if (connection.credentialRef === ref) {
        delete connection.credentialRef;
        connection.connectionRevision += 1;
        connection.updatedAt = now;
        invalidateConnectionValidation(connection);
      }
    }
    return state;
  });
}

/**
 * The only path that decrypts persisted credential material for normal
 * runtime use. Fails closed: unknown refs throw, tampered `qse:v1` envelopes
 * throw, unknown `qse:*` envelope versions throw. Never returns a fallback
 * value and never logs plaintext.
 */
export async function resolveCredentialForRuntime(ref: string): Promise<string> {
  const state = await loadAIConnectionState();
  const record = state?.credentials[ref];
  if (!record) throw new CredentialNotFoundError(ref);
  return decryptValue(record.encryptedValue);
}
