/** Background-owned single writer. Never import this module from UI/content. */
import {
  loadAIConnectionState,
  withAIConnectionStateWriteLock,
  updateAIConnectionState,
  toConnectionMetadata,
  invalidateConnectionValidation,
} from "../shared/utils/aiConnectionState";
import { migrateLegacyAIConnectionState } from "../shared/utils/aiConnectionMigration";
import {
  isProviderPresetId,
  resolvePresetAuthScheme,
  resolvePresetDefaultModel,
} from "../shared/utils/aiConnectionPresets";
import { encryptValue } from "../shared/utils/encryption";
import type {
  AIConnectionResponse,
  LegacyAISettingsPatch,
} from "../shared/types/aiConnectionMessages";

class AuthorityError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
let initialization: Promise<{ migrated: boolean; revision: number }> | null =
  null;
export function ensureAIConnectionAuthorityInitialized() {
  if (!initialization) {
    initialization = withAIConnectionStateWriteLock(async () => {
      const result = await migrateLegacyAIConnectionState();
      if (result.status === "failed") throw new AuthorityError(result.code);
      return {
        migrated: result.status === "migrated",
        revision: result.state.revision,
      };
    }).catch((error: unknown) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

function validatePatch(value: unknown): asserts value is LegacyAISettingsPatch {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
  const patch = value as Record<string, unknown>;
  if (
    Object.keys(patch).some(
      (key) =>
        ![
          "providerId",
          "apiModel",
          "customBaseUrl",
          "customProviderProtocol",
          "credential",
        ].includes(key),
    )
  )
    throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
  if ("providerId" in patch && !isProviderPresetId(patch.providerId))
    throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
  if (
    "apiModel" in patch &&
    (typeof patch.apiModel !== "string" ||
      !patch.apiModel.trim() ||
      patch.apiModel.length > 200)
  )
    throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
  if (
    "customProviderProtocol" in patch &&
    patch.customProviderProtocol !== "openai" &&
    patch.customProviderProtocol !== "anthropic"
  )
    throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
  if ("customBaseUrl" in patch) {
    if (
      typeof patch.customBaseUrl !== "string" ||
      patch.customBaseUrl.length > 2048
    )
      throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
    if (patch.customBaseUrl) {
      try {
        const url = new URL(patch.customBaseUrl);
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new Error();
      } catch {
        throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
      }
    }
  }
  const credential = patch.credential as Record<string, unknown> | undefined;
  if (
    !credential ||
    typeof credential !== "object" ||
    Array.isArray(credential)
  )
    throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
  if (credential.action === "REPLACE") {
    if (
      Object.keys(credential).some(
        (key) => !["action", "value"].includes(key),
      ) ||
      typeof credential.value !== "string" ||
      !credential.value.trim() ||
      credential.value.length > 16384
    )
      throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
  } else if (
    !["KEEP", "CLEAR"].includes(String(credential.action)) ||
    Object.keys(credential).some((key) => key !== "action")
  )
    throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
}

async function applyLegacySettings(
  patch: LegacyAISettingsPatch,
): Promise<void> {
  // Encryption and the coherent commit share the existing owner lock.
  await updateAIConnectionState(async (state) => {
    const connection = state.activeConnectionId
      ? state.connections[state.activeConnectionId]
      : undefined;
    if (!connection) throw new AuthorityError("AI_ACTIVE_CONNECTION_MISSING");
    const providerId = patch.providerId ?? connection.presetId;
    const switched = providerId !== connection.presetId;
    if (!switched && providerId === "gemini" && patch.customBaseUrl) {
      throw new AuthorityError("AI_RUNTIME_COMPATIBILITY_UNSUPPORTED");
    }
    const envelope = patch.credential.action === "REPLACE"
      ? await encryptValue(patch.credential.value) : undefined;
    const previous = JSON.stringify({
      presetId: connection.presetId,
      selectedModelId: connection.selectedModelId,
      endpointOverride: connection.endpointOverride,
      protocolOverride: connection.protocolOverride,
      authScheme: connection.authScheme,
    });
    connection.presetId = providerId;
    connection.selectedModelId =
      patch.apiModel ??
      (switched
        ? resolvePresetDefaultModel(providerId)
        : connection.selectedModelId);
    if (switched)
      connection.endpointOverride =
        providerId === "custom" ? patch.customBaseUrl || undefined : undefined;
    else if ("customBaseUrl" in patch)
      connection.endpointOverride = patch.customBaseUrl || undefined;
    if (providerId === "custom") {
      if (switched || "customProviderProtocol" in patch)
        connection.protocolOverride =
          patch.customProviderProtocol === "anthropic"
            ? "anthropic_messages"
            : "openai_chat_completions";
    } else connection.protocolOverride = undefined;
    connection.authScheme = resolvePresetAuthScheme(
      providerId,
      connection.protocolOverride,
    );
    const current = JSON.stringify({
      presetId: connection.presetId,
      selectedModelId: connection.selectedModelId,
      endpointOverride: connection.endpointOverride,
      protocolOverride: connection.protocolOverride,
      authScheme: connection.authScheme,
    });
    let credentialChanged = false;
    const oldRef = connection.credentialRef;
    if (
      patch.credential.action === "CLEAR" ||
      (switched && patch.credential.action !== "REPLACE")
    ) {
      if (oldRef) {
        delete connection.credentialRef;
        credentialChanged = true;
      }
    } else if (envelope) {
      const ref = switched
        ? `cred_${connection.id}_${connection.connectionRevision + 1}`
        : (oldRef ?? `cred_${connection.id}`);
      const old = state.credentials[ref];
      state.credentials[ref] = {
        ref,
        type: "api_key",
        encryptedValue: envelope,
        revision: (old?.revision ?? 0) + 1,
        updatedAt: Date.now(),
      };
      connection.credentialRef = ref;
      credentialChanged = true;
    }
    // Remove only unreferenced old material, preserving other connections.
    if (
      oldRef &&
      oldRef !== connection.credentialRef &&
      !Object.values(state.connections).some(
        (item) => item.credentialRef === oldRef,
      )
    )
      delete state.credentials[oldRef];
    const configChanged =
      previous !== current || oldRef !== connection.credentialRef;
    if (!configChanged && !credentialChanged) return null;
    if (configChanged) connection.connectionRevision += 1;
    connection.updatedAt = Math.max(Date.now(), connection.updatedAt + 1);
    if (credentialChanged && connection.credentialRef) {
      for (const other of Object.values(state.connections)) {
        if (
          other.id !== connection.id &&
          other.credentialRef === connection.credentialRef
        )
          invalidateConnectionValidation(other);
      }
    }
    invalidateConnectionValidation(connection);
    return state;
  });
}

/** Unknown/malformed messages and every failure get a non-secret response. */
export async function handleAIConnectionCommand(
  message: unknown,
): Promise<AIConnectionResponse> {
  try {
    const input = message as { type?: unknown; settings?: unknown } | null;
    if (
      !input ||
      ![
        "AI_CONNECTION_ENSURE_INITIALIZED",
        "AI_CONNECTION_GET_ACTIVE_METADATA",
        "AI_CONNECTION_APPLY_LEGACY_SETTINGS",
      ].includes(String(input.type))
    )
      throw new AuthorityError("AI_CONNECTION_COMMAND_UNKNOWN");
    if (
      Object.keys(input).some(
        (key) =>
          key !== "type" &&
          !(
            input.type === "AI_CONNECTION_APPLY_LEGACY_SETTINGS" &&
            key === "settings"
          ),
      )
    )
      throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
    if (input.type === "AI_CONNECTION_APPLY_LEGACY_SETTINGS")
      validatePatch(input.settings);
    const initialized = await ensureAIConnectionAuthorityInitialized();
    if (input.type === "AI_CONNECTION_APPLY_LEGACY_SETTINGS")
      await applyLegacySettings(input.settings as LegacyAISettingsPatch);
    const state = await loadAIConnectionState();
    if (!state) throw new AuthorityError("AI_CONNECTION_NOT_INITIALIZED");
    const connection = state.activeConnectionId
      ? state.connections[state.activeConnectionId]
      : undefined;
    return {
      ok: true,
      initialized: true,
      migrated: initialized.migrated,
      revision: state.revision,
      metadata: connection ? toConnectionMetadata(connection, state) : null,
    };
  } catch (error) {
    return {
      ok: false,
      code:
        error instanceof AuthorityError
          ? error.code
          : "AI_CONNECTION_AUTHORITY_FAILED",
    };
  }
}
