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
 *   request is about to execute, via `resolveRuntimeCredential` (which
 *   delegates to `resolveCredentialForRuntime`). Plaintext is never cached,
 *   never persisted, and never appears in errors, logs, or serialized
 *   metadata.
 * - NOT yet consumed by `parseQuestion` — no authority cutover in E2A.
 */

import type { AIConnectionRuntimeConfig } from "../types/connection";
import { assessModelCapabilities } from "../ai/modelCapabilityCatalog";
import { resolveTransportMediaCapabilities } from "../ai/transportMediaCapabilities";
import { resolveConnectionEndpoint, resolveConnectionProtocol } from "./aiConnectionPresets";
import {
  MalformedAIConnectionStateError,
  loadAIConnectionState,
} from "./aiConnectionState";
import { resolveCredentialForRuntime } from "./credentialStore";

export type AIRuntimeResolutionErrorCode =
  | "AI_CONNECTION_NOT_INITIALIZED"
  | "AI_CONNECTION_MALFORMED"
  | "AI_ACTIVE_CONNECTION_MISSING"
  | "AI_MODEL_MISSING"
  | "AI_CREDENTIAL_REQUIRED";

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

  return {
    connectionId: connection.id,
    connectionRevision: connection.connectionRevision,
    presetId: connection.presetId,
    protocol: resolveConnectionProtocol(connection),
    endpoint: resolveConnectionEndpoint(connection),
    authScheme: connection.authScheme,
    requiresCredential,
    credentialRef: connection.credentialRef,
    credentialRevision,
    selectedModelId: connection.selectedModelId,
    modelCapabilityAssessment: assessModelCapabilities(connection.presetId, connection.selectedModelId),
    transportCapabilities: resolveTransportMediaCapabilities(
      connection.presetId,
      resolveConnectionProtocol(connection),
    ),
  };
}

/**
 * Secret resolution boundary. Call only when a real provider request is about
 * to execute. Returns null for connections that require no credential
 * (`authScheme.kind === "none"`); throws AI_CREDENTIAL_REQUIRED when a
 * required credential reference is absent; otherwise delegates to the E1
 * `resolveCredentialForRuntime` decrypt path (fail closed on tampering).
 * Plaintext is never cached or persisted here.
 */
export async function resolveRuntimeCredential(config: AIConnectionRuntimeConfig): Promise<string | null> {
  if (!config.requiresCredential) return null;
  if (!config.credentialRef) {
    throw new AIRuntimeResolutionError(
      "AI_CREDENTIAL_REQUIRED",
      `Connection "${config.connectionId}" requires a credential but has no credential reference`,
    );
  }
  return resolveCredentialForRuntime(config.credentialRef);
}
