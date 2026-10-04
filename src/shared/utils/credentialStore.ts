/**
 * UI05R-E1 — Bounded credential store API over the AIConnectionState SSOT.
 *
 * Security contract:
 * - Only `resolveCredentialForRuntime` may decrypt persisted credential
 *   material, and only for normal runtime use.
 * - General connection readers (metadata APIs) never return plaintext.
 * - Credential values are always persisted as `qse:v1:` envelopes; plaintext
 *   is never stored and never logged. This is application-layer encryption in
 *   local extension storage — not an OS keychain.
 */

import { decryptValue, encryptValue } from "./encryption";
import type { EncryptedCredentialRecord } from "../types/connection";
import { loadAIConnectionState, updateAIConnectionState } from "./aiConnectionState";

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
 * revision; connections whose validation was bound to the previous revision
 * are marked stale so a bound validation can never be honored across a
 * credential change.
 */
export async function replaceCredential(ref: string, plaintext: string): Promise<EncryptedCredentialRecord> {
  if (!ref) throw new Error("Credential ref must be a non-empty string");
  if (!plaintext) throw new Error("Refusing to store an empty credential; use clearCredential instead");
  const encryptedValue = await encryptValue(plaintext);
  let storedRevision = 0;
  await updateAIConnectionState((state) => {
    const previous = state.credentials[ref];
    const record: EncryptedCredentialRecord = {
      ref,
      type: "api_key",
      encryptedValue,
      revision: previous ? previous.revision + 1 : 1,
      updatedAt: Date.now(),
    };
    state.credentials[ref] = record;
    storedRevision = record.revision;
    for (const connection of Object.values(state.connections)) {
      if (connection.credentialRef === ref && connection.validation.status === "validated") {
        connection.validation = { ...connection.validation, status: "stale" };
      }
    }
    return state;
  });
  return {
    ref,
    type: "api_key",
    encryptedValue,
    revision: storedRevision,
    updatedAt: Date.now(),
  };
}

/**
 * Remove a credential record and drop references to it. Idempotent: clearing
 * an unknown ref is a no-op that does not bump the state revision.
 */
export async function clearCredential(ref: string): Promise<void> {
  await updateAIConnectionState((state) => {
    if (!state.credentials[ref]) return null;
    delete state.credentials[ref];
    for (const connection of Object.values(state.connections)) {
      if (connection.credentialRef === ref) {
        delete connection.credentialRef;
        if (connection.validation.status === "validated") {
          connection.validation = { ...connection.validation, status: "stale" };
        }
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
