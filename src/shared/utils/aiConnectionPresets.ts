/**
 * UI05R-E1 — V1 provider preset resolution for the connection domain.
 *
 * This mirrors the ground truth of `src/shared/ai/providers.ts` and the
 * current wire clients (`providerClients.ts`) WITHOUT changing them:
 * - endpoints and default models come from the existing PROVIDERS registry;
 * - protocol mapping follows the current parseRouter dispatch;
 * - auth mapping follows the current credential presentation per provider.
 *
 * E1 does not add providers, rename IDs, or implement protocol adapters.
 * Display labels remain frontend-owned (deferred).
 */

import { getProvider } from "../ai/providers";
import type { AuthScheme, Connection, ProtocolId, ProviderPresetId } from "../types/connection";

export const PROVIDER_PRESET_IDS: readonly ProviderPresetId[] = [
  "anthropic",
  "openai",
  "deepseek",
  "gemini",
  "qwen",
  "moonshot",
  "zhipu",
  "minimax",
  "ollama",
  "custom",
];

export function isProviderPresetId(value: unknown): value is ProviderPresetId {
  return typeof value === "string" && (PROVIDER_PRESET_IDS as readonly string[]).includes(value);
}

export const PROTOCOL_IDS: readonly ProtocolId[] = [
  "anthropic_messages",
  "openai_chat_completions",
  "gemini_generate_content",
];

export function isProtocolId(value: unknown): value is ProtocolId {
  return typeof value === "string" && (PROTOCOL_IDS as readonly string[]).includes(value);
}

/** `ProviderPresetId` values are exactly the persisted runtime `ProviderId` values. */
export function asProviderPresetId(value: string): ProviderPresetId {
  return (isProviderPresetId(value) ? value : "anthropic") as ProviderPresetId;
}

/**
 * Preset default protocol, mirroring the current parseRouter dispatch:
 * - anthropic -> callAnthropic (anthropic_messages)
 * - custom + anthropic protocol override -> callAnthropic (anthropic_messages)
 * - gemini -> callGemini (gemini_generate_content)
 * - everything routed through callOpenAICompat -> openai_chat_completions
 */
export function resolvePresetProtocol(
  presetId: ProviderPresetId,
  protocolOverride?: ProtocolId,
): ProtocolId {
  if (protocolOverride) return protocolOverride;
  if (presetId === "anthropic") return "anthropic_messages";
  if (presetId === "gemini") return "gemini_generate_content";
  return "openai_chat_completions";
}

/**
 * Preset default auth scheme, mirroring current runtime credential
 * presentation:
 * - Anthropic: `x-api-key` header (the bearer retry on specific rejections is
 *   wire-adapter behavior, not the scheme identity).
 * - Custom + anthropic_messages: same `x-api-key` presentation.
 * - Gemini: `key` query parameter.
 * - Ollama: no auth.
 * - All other openai_chat_completions providers: bearer.
 */
export function resolvePresetAuthScheme(
  presetId: ProviderPresetId,
  protocolOverride?: ProtocolId,
): AuthScheme {
  const protocol = resolvePresetProtocol(presetId, protocolOverride);
  if (protocol === "anthropic_messages") return { kind: "header", headerName: "x-api-key" };
  if (presetId === "gemini") return { kind: "query", parameterName: "key" };
  if (presetId === "ollama") return { kind: "none" };
  return { kind: "bearer" };
}

/** Preset default endpoint from the existing runtime registry (no renaming). */
export function resolvePresetEndpoint(presetId: ProviderPresetId): string {
  return getProvider(presetId).baseUrl;
}

/** Preset default model from the existing runtime registry. */
export function resolvePresetDefaultModel(presetId: ProviderPresetId): string {
  return getProvider(presetId).defaultModel;
}

export function resolveConnectionProtocol(connection: Connection): ProtocolId {
  return resolvePresetProtocol(connection.presetId, connection.protocolOverride);
}

export function resolveConnectionEndpoint(connection: Connection): string {
  return connection.endpointOverride ?? resolvePresetEndpoint(connection.presetId);
}
