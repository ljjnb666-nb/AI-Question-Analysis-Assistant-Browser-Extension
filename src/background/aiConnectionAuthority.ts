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
import { cleanupLegacyAISettingsAfterAuthority } from "./appSettingsAuthority";
import { resolveConnectionProtocol } from "../shared/utils/aiConnectionPresets";
import { encryptValue } from "../shared/utils/encryption";
import type {
  AIConnectionResponse,
  AIConnectionUpdatePatch,
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
      try { await cleanupLegacyAISettingsAfterAuthority(); }
      catch { throw new AuthorityError("AI_LEGACY_SETTINGS_CLEANUP_FAILED"); }
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

function validatePatch(value: unknown): asserts value is AIConnectionUpdatePatch {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
  const patch = value as Record<string, unknown>;
  if (
    Object.keys(patch).some(
      (key) =>
        ![
          "presetId",
          "selectedModelId",
          "endpointOverride",
          "protocolOverride",
          "credential",
        ].includes(key),
    )
  )
    throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
  if ("presetId" in patch && !isProviderPresetId(patch.presetId))
    throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
  if (
    "selectedModelId" in patch &&
    (typeof patch.selectedModelId !== "string" ||
      !patch.selectedModelId.trim() ||
      patch.selectedModelId.length > 200)
  )
    throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
  if (
    "protocolOverride" in patch &&
    patch.protocolOverride !== null &&
    patch.protocolOverride !== "openai_chat_completions" &&
    patch.protocolOverride !== "anthropic_messages"
  )
    throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
  if ("endpointOverride" in patch) {
    if (
      (patch.endpointOverride !== null && typeof patch.endpointOverride !== "string") ||
      (typeof patch.endpointOverride === "string" && patch.endpointOverride.length > 2048)
    )
      throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
    if (patch.endpointOverride) {
      try {
        const url = new URL(patch.endpointOverride);
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

async function updateActiveConnection(
  patch: AIConnectionUpdatePatch,
): Promise<void> {
  // Encryption and the coherent commit share the existing owner lock.
  await updateAIConnectionState(async (state) => {
    const connection = state.activeConnectionId
      ? state.connections[state.activeConnectionId]
      : undefined;
    if (!connection) throw new AuthorityError("AI_ACTIVE_CONNECTION_MISSING");
    const presetId = patch.presetId ?? connection.presetId;
    const switched = presetId !== connection.presetId;
    if (!switched && presetId === "gemini" && patch.endpointOverride) {
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
    connection.presetId = presetId;
    connection.selectedModelId =
      patch.selectedModelId ??
      (switched
        ? resolvePresetDefaultModel(presetId)
        : connection.selectedModelId);
    if (switched)
      connection.endpointOverride =
        presetId === "custom" ? patch.endpointOverride || undefined : undefined;
    else if ("endpointOverride" in patch)
      connection.endpointOverride = patch.endpointOverride || undefined;
    if (presetId === "custom") {
      if (switched || "protocolOverride" in patch)
        connection.protocolOverride =
          patch.protocolOverride === "anthropic_messages"
            ? "anthropic_messages"
            : "openai_chat_completions";
    } else connection.protocolOverride = undefined;
    connection.authScheme = resolvePresetAuthScheme(
      presetId,
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
  sender: chrome.runtime.MessageSender,
): Promise<AIConnectionResponse> {
  try {
    const input = message as { type?: unknown; patch?: unknown } | null;
    if (
      !input ||
      ![
        "AI_CONNECTION_ENSURE_INITIALIZED",
        "AI_CONNECTION_GET_ACTIVE_METADATA",
        "AI_CONNECTION_GET_EDITOR_VIEW",
        "AI_CONNECTION_UPDATE_ACTIVE",
      ].includes(String(input.type))
    )
      throw new AuthorityError("AI_CONNECTION_COMMAND_UNKNOWN");
    authorizeAICommand(input.type, sender);
    if (
      Object.keys(input).some(
        (key) =>
          key !== "type" &&
          !(
            input.type === "AI_CONNECTION_UPDATE_ACTIVE" &&
            key === "patch"
          ),
      )
    )
      throw new AuthorityError("AI_CONNECTION_PAYLOAD_INVALID");
    if (input.type === "AI_CONNECTION_UPDATE_ACTIVE")
      validatePatch(input.patch);
    const initialized = await ensureAIConnectionAuthorityInitialized();
    if (input.type === "AI_CONNECTION_UPDATE_ACTIVE")
      await updateActiveConnection(input.patch as AIConnectionUpdatePatch);
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
      metadata: input.type !== "AI_CONNECTION_GET_EDITOR_VIEW" && connection ? toConnectionMetadata(connection, state) : null,
      ...(input.type === "AI_CONNECTION_GET_EDITOR_VIEW" && connection ? { editorView: {
        presetId: connection.presetId, selectedModelId: connection.selectedModelId,
        endpointOverride: connection.endpointOverride ?? null, protocol: resolveConnectionProtocol(connection),
        hasCredential: Boolean(connection.credentialRef && state.credentials[connection.credentialRef]),
      } } : {}),
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

function authorizeAICommand(type: unknown, sender: chrome.runtime.MessageSender): void {
  if (!sender || typeof sender.id !== "string" || sender.id !== chrome.runtime.id) throw new AuthorityError("AI_CONNECTION_SENDER_FORBIDDEN");
  if (type !== "AI_CONNECTION_UPDATE_ACTIVE") return;
  try {
    const page = new URL(sender.url ?? "");
    const own = new URL(chrome.runtime.getURL("/"));
    if (page.protocol === own.protocol && page.host === own.host && !page.username && !page.password && page.pathname === "/sidepanel/sidepanel.html") return;
  } catch { /* fail closed */ }
  throw new AuthorityError("AI_CONNECTION_SENDER_FORBIDDEN");
}
