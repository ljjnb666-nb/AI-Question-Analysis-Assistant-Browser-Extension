/**
 * UI05R-E1 — Idempotent legacy AppSettings -> AIConnectionState migration.
 *
 * Marker contract: the presence of a schemaVersion-1 `aiConnectionState` key is
 * the migration marker.
 * - No state        -> eligible; migrate the legacy AI fields.
 * - Valid v1 state  -> no-op (never rewritten, never regenerated).
 * - Malformed state -> fail closed: nothing is written, legacy data is left
 *   untouched, and a stable error code is surfaced. Retrying is safe.
 *
 * Credential handling: `loadSettings` returns a DECRYPTED apiKey, so migration
 * reads the RAW persisted `appSettings` instead and operates on a known
 * plaintext legacy domain value before (re-)encryption:
 * - `qse:v1:` envelope  -> decrypted first, then re-encrypted. A tampered or
 *   wrong-extension envelope fails closed (stable error, no state written).
 * - other `qse:*`       -> unsupported envelope version, fails closed.
 * - unversioned value   -> decoded via tryDecryptLegacyValue (legacy
 *   ciphertext or legacy plaintext), then encrypted.
 * An existing `qse:v1` envelope is never double-encrypted.
 *
 * Authority staging: E1 ships this migration as a CONTROLLED CUTOVER
 * PRIMITIVE ONLY — it is not executed anywhere in production during E1
 * (behavior-neutral). At the E2 authority-cutover boundary the background
 * service worker (the single writer authority) invokes it against the
 * then-current legacy authority, so no production legacy drift can occur
 * before that point. Legacy AppSettings AI fields stay the runtime authority
 * until that cutover; after it, AIConnectionState becomes authoritative and
 * the legacy AI fields degrade to a compatibility projection.
 *
 * Idempotence and fail-closed behavior are guaranteed for repeated
 * invocations from the owning (single-writer) context. There is no atomic
 * multi-context claim: chrome.storage.local has no compare-and-swap, so the
 * marker re-check before the final write is a best-effort guard, not a
 * transactional guarantee. Production safety comes from running migration
 * only in the single writer context.
 */

import type { AIConnectionState, Connection, ProtocolId, ProviderPresetId } from "../types/connection";
import {
  isProviderPresetId,
  resolvePresetAuthScheme,
  resolvePresetDefaultModel,
  resolvePresetProtocol,
} from "./aiConnectionPresets";
import {
  loadAIConnectionState,
  persistAIConnectionState,
} from "./aiConnectionState";
import { decryptValue, encryptValue, isCredentialEnvelope, tryDecryptLegacyValue } from "./encryption";

export const LEGACY_DEFAULT_CONNECTION_ID = "conn_legacy_default";
export const LEGACY_DEFAULT_CREDENTIAL_REF = "cred_legacy_default";

/** Raw legacy AI fields exactly as persisted in `appSettings` (not decrypted). */
export interface LegacyAISettingsSnapshot {
  providerId?: unknown;
  apiKey?: unknown;
  apiModel?: unknown;
  customBaseUrl?: unknown;
  customProviderProtocol?: unknown;
}

export type AIConnectionMigrationErrorCode =
  | "AI_CONNECTION_STATE_MALFORMED"
  | "LEGACY_CREDENTIAL_UNDECODABLE"
  | "LEGACY_CREDENTIAL_ENCRYPTION_FAILED";

export type AIConnectionMigrationResult =
  | { status: "migrated"; state: AIConnectionState }
  | { status: "already_migrated"; state: AIConnectionState }
  | { status: "failed"; code: AIConnectionMigrationErrorCode; message: string };

function failure(code: AIConnectionMigrationErrorCode, message: string): AIConnectionMigrationResult {
  return { status: "failed", code, message };
}

/** Decode the raw persisted legacy apiKey into known plaintext, fail closed. */
async function decodeLegacyCredentialMaterial(rawKey: unknown): Promise<
  { ok: true; plaintext: string } | { ok: false; code: AIConnectionMigrationErrorCode; message: string }
> {
  if (typeof rawKey !== "string" || rawKey.length === 0) return { ok: true, plaintext: "" };
  if (isCredentialEnvelope(rawKey)) {
    // Only the current envelope version can be decoded; anything else must
    // fail closed rather than be copied or guessed at.
    try {
      return { ok: true, plaintext: await decryptValue(rawKey) };
    } catch (err) {
      return {
        ok: false,
        code: "LEGACY_CREDENTIAL_UNDECODABLE",
        message: `Legacy credential could not be decoded (${err instanceof Error ? err.name : "unknown error"}); migration failed closed without writing state`,
      };
    }
  }
  // Unversioned legacy storage: decode leniently (legacy ciphertext or legacy
  // plaintext), never clear the value.
  const decoded = await tryDecryptLegacyValue(rawKey);
  return { ok: true, plaintext: decoded.plaintext };
}

/**
 * Pure mapping from the raw legacy AI fields to the migrated connection shape.
 * Runtime IDs, endpoints, and protocol/auth behavior mirror the current
 * runtime without renaming or inventing anything.
 */
export function buildLegacyConnectionParts(snapshot: LegacyAISettingsSnapshot): {
  presetId: ProviderPresetId;
  protocol: ProtocolId;
  protocolOverride: ProtocolId | undefined;
  endpointOverride: string | undefined;
  authScheme: ReturnType<typeof resolvePresetAuthScheme>;
  selectedModelId: string;
} {
  // Unknown/absent legacy providerId falls back to the runtime default
  // (anthropic), mirroring getProvider's fallback; persisted IDs are mapped
  // 1:1 and never renamed.
  const presetId: ProviderPresetId = isProviderPresetId(snapshot.providerId)
    ? snapshot.providerId
    : "anthropic";
  // Only the custom preset may override its protocol; official presets inherit.
  const protocolOverride: ProtocolId | undefined =
    presetId === "custom"
      ? snapshot.customProviderProtocol === "anthropic"
        ? "anthropic_messages"
        : "openai_chat_completions"
      : undefined;
  const protocol = resolvePresetProtocol(presetId, protocolOverride);
  // callGemini ignores customBaseUrl at runtime, so the endpoint override must
  // not claim otherwise; every other client uses customBaseUrl when present.
  const customBaseUrl = typeof snapshot.customBaseUrl === "string" ? snapshot.customBaseUrl : "";
  const endpointOverride =
    customBaseUrl && protocol !== "gemini_generate_content" ? customBaseUrl : undefined;
  return {
    presetId,
    protocol,
    protocolOverride,
    endpointOverride,
    authScheme: resolvePresetAuthScheme(presetId, protocolOverride),
    selectedModelId:
      typeof snapshot.apiModel === "string" && snapshot.apiModel
        ? snapshot.apiModel
        : resolvePresetDefaultModel(presetId),
  };
}

/**
 * Run the idempotent legacy migration. Safe to call repeatedly: the state-key
 * marker makes every outcome deterministic (at most one legacy connection is
 * ever created, and a valid existing state is never rewritten). Production
 * invocation is reserved for the E2 cutover in the single-writer background
 * context; no atomic multi-context behavior is claimed.
 */
export async function migrateLegacyAIConnectionState(): Promise<AIConnectionMigrationResult> {
  // Marker check. A valid state is authoritative: no-op, no rewrite.
  const existing = await loadAIConnectionState().catch((err: unknown): AIConnectionState | null | Error =>
    err instanceof Error ? err : new Error(String(err)),
  );
  if (existing instanceof Error) {
    return failure(
      "AI_CONNECTION_STATE_MALFORMED",
      "Existing aiConnectionState failed schemaVersion-1 validation; refusing to overwrite",
    );
  }
  if (existing) return { status: "already_migrated", state: existing };

  const stored = await chrome.storage.local.get("appSettings");
  const snapshot = (stored?.appSettings ?? {}) as LegacyAISettingsSnapshot;

  const parts = buildLegacyConnectionParts(snapshot);
  const decoded = await decodeLegacyCredentialMaterial(snapshot.apiKey);
  if (!decoded.ok) return failure(decoded.code, decoded.message);

  let encryptedValue = "";
  if (decoded.plaintext) {
    try {
      encryptedValue = await encryptValue(decoded.plaintext);
    } catch (err) {
      return failure(
        "LEGACY_CREDENTIAL_ENCRYPTION_FAILED",
        `Failed to encrypt legacy credential (${err instanceof Error ? err.name : "unknown error"}); legacy data left untouched`,
      );
    }
  }

  const now = Date.now();
  const connection: Connection = {
    id: LEGACY_DEFAULT_CONNECTION_ID,
    name: "Default Connection",
    presetId: parts.presetId,
    endpointOverride: parts.endpointOverride,
    protocolOverride: parts.protocolOverride,
    authScheme: parts.authScheme,
    ...(decoded.plaintext ? { credentialRef: LEGACY_DEFAULT_CREDENTIAL_REF } : {}),
    selectedModelId: parts.selectedModelId,
    connectionRevision: 1,
    validation: {
      status: decoded.plaintext ? "stale" : "never_tested",
      generation: 0,
    },
    createdAt: now,
    updatedAt: now,
  };

  const state: AIConnectionState = {
    schemaVersion: 1,
    revision: 1,
    activeConnectionId: connection.id,
    connections: { [connection.id]: connection },
    credentials: decoded.plaintext
      ? {
          [LEGACY_DEFAULT_CREDENTIAL_REF]: {
            ref: LEGACY_DEFAULT_CREDENTIAL_REF,
            type: "api_key",
            encryptedValue,
            revision: 1,
            updatedAt: now,
          },
        }
      : {},
  };

  // Idempotence guard, not a transactional guarantee: if state appeared
  // meanwhile, keep it and never overwrite. Production runs this only in the
  // single-writer context, so the guard is expected to be decisive there.
  const latest = await loadAIConnectionState().catch((err: unknown): AIConnectionState | null | Error =>
    err instanceof Error ? err : new Error(String(err)),
  );
  if (latest instanceof Error) {
    return failure(
      "AI_CONNECTION_STATE_MALFORMED",
      "Concurrent aiConnectionState failed schemaVersion-1 validation; refusing to overwrite",
    );
  }
  if (latest) return { status: "already_migrated", state: latest };

  try {
    await persistAIConnectionState(state);
  } catch (err) {
    return failure(
      "AI_CONNECTION_STATE_MALFORMED",
      `Migration write was rejected (${err instanceof Error ? err.name : "unknown error"}); legacy data left untouched`,
    );
  }
  return { status: "migrated", state };
}
