/**
 * UI05R-E2A — Active connection runtime metadata resolver (READ SIDE).
 *
 * Answers, for an already initialized AIConnectionState: what exact runtime
 * configuration should a solve operation use, and can the selected model +
 * transport safely handle this question's media?
 *
 * Boundaries:
 * - Read-only. This module never mutates state and never runs migration.
 * - Fail closed: malformed state, missing active connection, missing model,
 *   and missing required credentials surface stable machine-readable error
 *   codes. There is NO silent fallback to Anthropic or any legacy default,
 *   and no legacy fallback inside this resolver.
 * - Secret boundary: this resolver returns NON-SECRET metadata only.
 *   Credential material is resolved separately, only when a real provider
 *   request is about to execute, via `resolveRuntimeCredential`. That path is
 *   REVISION-FENCED: the current state is re-read and the runtime snapshot is
 *   verified still-current (active connection id, connection revision,
 *   credential ref, credential revision) before any plaintext is produced —
 *   a stale snapshot must never be silently rebound to a new secret. Plaintext
 *   is never cached, never persisted, and never appears in errors, logs, or
 *   serialized metadata.
 * - Low-level contract errors (raw decrypt errors,
 *   MalformedAIConnectionStateError) never escape this boundary: they are
 *   translated to stable codes (AI_CREDENTIAL_UNAVAILABLE,
 *   AI_CONNECTION_MALFORMED).
 * - NOT yet consumed by `parseQuestion` — no authority cutover in E2A.
 */

import type { AIConnectionRuntimeConfig, AIConnectionState } from "../types/connection";
import { assessModelCapabilities } from "../ai/modelCapabilityCatalog";
import {
  resolveEndpointProvenance,
  resolveTransportMediaCapabilities,
} from "../ai/transportMediaCapabilities";
import { resolveConnectionEndpoint, resolveConnectionProtocol } from "./aiConnectionPresets";
import { resolveCredentialRecordForRuntime } from "./credentialStore";
import { MalformedAIConnectionStateError, loadAIConnectionState } from "./aiConnectionState";

export type AIRuntimeResolutionErrorCode =
  | "AI_CONNECTION_NOT_INITIALIZED"
  | "AI_CONNECTION_MALFORMED"
  | "AI_ACTIVE_CONNECTION_MISSING"
  | "AI_MODEL_MISSING"
  | "AI_CREDENTIAL_REQUIRED"
  | "AI_CREDENTIAL_UNAVAILABLE"
  | "AI_RUNTIME_CONFIG_STALE";

/** Stable, machine-readable resolution failure. Never carries secret material. */
export class AIRuntimeResolutionError extends Error {
  readonly code: AIRuntimeResolutionErrorCode;

  constructor(code: AIRuntimeResolutionErrorCode, message: string) {
    super(message);
    this.name = "AIRuntimeResolutionError";
    this.code = code;
  }
}

/**
 * Resolve the active connection's non-secret runtime configuration.
 *
 * - No state                 -> AI_CONNECTION_NOT_INITIALIZED
 * - Malformed state          -> AI_CONNECTION_MALFORMED
 * - No active connection set -> AI_ACTIVE_CONNECTION_MISSING
 * - Empty selected model     -> AI_MODEL_MISSING
 * - Required credential absent -> AI_CREDENTIAL_REQUIRED
 *
 * `authScheme.kind === "none"` connections (e.g. Ollama) are valid without a
 * credential and never trigger AI_CREDENTIAL_REQUIRED.
 */
export async function resolveActiveAIConnectionRuntimeMetadata(): Promise<AIConnectionRuntimeConfig> {
  const state = await loadAIConnectionState().catch((error: unknown) => {
    if (error instanceof MalformedAIConnectionStateError) {
      throw new AIRuntimeResolutionError(
        "AI_CONNECTION_MALFORMED",
        "Stored AI connection state failed schemaVersion-1 validation",
      );
    }
    throw error;
  });
  if (!state) {
    throw new AIRuntimeResolutionError(
      "AI_CONNECTION_NOT_INITIALIZED",
      "No AI connection state exists; run the initialization/migration path first",
    );
  }
  if (state.activeConnectionId === null) {
    throw new AIRuntimeResolutionError(
      "AI_ACTIVE_CONNECTION_MISSING",
      "AI connection state has no active connection",
    );
  }
  const connection = state.connections[state.activeConnectionId];
  if (!connection) {
    // Defensive: schema validation already enforces referential integrity.
    throw new AIRuntimeResolutionError(
      "AI_CONNECTION_MALFORMED",
      "Active connection reference does not resolve to a stored connection",
    );
  }
  if (!connection.selectedModelId) {
    throw new AIRuntimeResolutionError(
      "AI_MODEL_MISSING",
      `Active connection "${connection.id}" has no selected model`,
    );
  }

  const requiresCredential = connection.authScheme.kind !== "none";
  let credentialRevision: number | undefined;
  if (requiresCredential) {
    if (!connection.credentialRef || !(connection.credentialRef in state.credentials)) {
      throw new AIRuntimeResolutionError(
        "AI_CREDENTIAL_REQUIRED",
        `Active connection "${connection.id}" requires a credential for auth scheme "${connection.authScheme.kind}" but none is stored`,
      );
    }
    credentialRevision = state.credentials[connection.credentialRef].revision;
  } else if (connection.credentialRef && connection.credentialRef in state.credentials) {
    // Optional credential presence is reported but never required.
    credentialRevision = state.credentials[connection.credentialRef].revision;
  }

  const protocol = resolveConnectionProtocol(connection);
  const endpointProvenance = resolveEndpointProvenance(connection);

  return {
    connectionId: connection.id,
    connectionRevision: connection.connectionRevision,
    presetId: connection.presetId,
    protocol,
    endpoint: resolveConnectionEndpoint(connection),
    endpointProvenance,
    authScheme: connection.authScheme,
    requiresCredential,
    credentialRef: connection.credentialRef,
    credentialRevision,
    selectedModelId: connection.selectedModelId,
    modelCapabilityAssessment: assessModelCapabilities({ presetId: connection.presetId, modelId: connection.selectedModelId, endpointProvenance }),
    transportCapabilities: resolveTransportMediaCapabilities({
      presetId: connection.presetId,
      protocol,
      endpointProvenance,
    }),
  };
}

/**
 * General currentness fence, including no-auth configurations. E2B must call
 * this at the last responsible moment immediately before request dispatch.
 *
 * The current AIConnectionState is re-read and the runtime snapshot verified
 * against it before any plaintext is produced:
 * - state still exists and is valid;
 * - `activeConnectionId` still points at `config.connectionId`;
 * - that connection still exists with the same `connectionRevision`;
 * - if a credential is required, its ref and revision still match.
 *
 * Any mismatch fails with `AI_RUNTIME_CONFIG_STALE` — a stale snapshot is
 * never silently rebound to a new secret. Errors are translated to stable
 * codes: `AI_CREDENTIAL_REQUIRED` (missing required reference) and
 * `AI_CONNECTION_MALFORMED` (invalid state). The returned snapshot is internal
 * to the secret boundary; callers must never serialize or log it.
 */
export async function assertRuntimeConfigCurrent(config: AIConnectionRuntimeConfig): Promise<AIConnectionState> {
  if (config.requiresCredential && !config.credentialRef) {
    throw new AIRuntimeResolutionError(
      "AI_CREDENTIAL_REQUIRED",
      `Connection "${config.connectionId}" requires a credential but has no credential reference`,
    );
  }

  const state = await loadAIConnectionState().catch((error: unknown) => {
    if (error instanceof MalformedAIConnectionStateError) {
      throw new AIRuntimeResolutionError(
        "AI_CONNECTION_MALFORMED",
        "Stored AI connection state failed schemaVersion-1 validation",
      );
    }
    throw error;
  });
  if (!state) {
    throw new AIRuntimeResolutionError(
      "AI_RUNTIME_CONFIG_STALE",
      "AI connection state no longer exists; the runtime snapshot is stale",
    );
  }

  const stale = (detail: string) =>
    new AIRuntimeResolutionError("AI_RUNTIME_CONFIG_STALE", `Runtime snapshot is stale: ${detail}`);

  if (state.activeConnectionId !== config.connectionId) {
    throw stale("active connection changed");
  }
  const connection = state.connections[config.connectionId];
  if (!connection) {
    throw stale("resolved connection no longer exists");
  }
  if (connection.connectionRevision !== config.connectionRevision) {
    throw stale("connection revision changed");
  }
  if (config.requiresCredential) {
    if (connection.credentialRef !== config.credentialRef) {
      throw stale("credential reference changed");
    }
    const credential = state.credentials[config.credentialRef!];
    if (!credential || credential.revision !== config.credentialRevision) {
      throw stale("credential revision changed");
    }
  }
  return state;
}

/**
 * Validate currentness, then decrypt the exact fenced credential snapshot.
 * No second state read by ref. No-auth configurations are also fenced.
 * E2B must fence again immediately before dispatch, even after this succeeds.
 */
export async function resolveRuntimeCredential(config: AIConnectionRuntimeConfig): Promise<string | null> {
  const state = await assertRuntimeConfigCurrent(config);
  if (!config.requiresCredential) return null;

  try {
    return await resolveCredentialRecordForRuntime(state.credentials[config.credentialRef!]);
  } catch (error) {
    if (error instanceof AIRuntimeResolutionError) throw error;
    // Decrypt failures (tampered envelopes, unsupported versions, wrong
    // extension context) fail closed under a stable code; no raw low-level
    // error and no material escapes this boundary.
    throw new AIRuntimeResolutionError(
      "AI_CREDENTIAL_UNAVAILABLE",
      `Credential for connection "${config.connectionId}" could not be decrypted`,
    );
  }
}
