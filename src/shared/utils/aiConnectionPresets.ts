/** Connection-domain preset defaults and canonical protocol/auth resolution.
 * Preserves the established providers/adapters; the UI catalog is display-only.
 */

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
 * - Anthropic Messages: `x-api-key` only, according to AuthScheme authority;
 *   no bearer fallback or silent auth relocation.
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
  return PRESET_DEFAULTS[presetId].endpoint;
}

/** Preset default model from the existing runtime registry. */
export function resolvePresetDefaultModel(presetId: ProviderPresetId): string {
  return PRESET_DEFAULTS[presetId].model;
}

export function resolveConnectionProtocol(connection: Connection): ProtocolId {
  return resolvePresetProtocol(connection.presetId, connection.protocolOverride);
}

export function resolveConnectionEndpoint(connection: Connection): string {
  return connection.endpointOverride ?? resolvePresetEndpoint(connection.presetId);
}

/** Connection-domain defaults; UI catalog is display-only. */
const PRESET_DEFAULTS: Record<ProviderPresetId, { endpoint: string; model: string }> = {
  anthropic: { endpoint: "https://api.anthropic.com", model: "claude-opus-4.8" },
  openai: { endpoint: "https://api.openai.com", model: "gpt-5.5" },
  deepseek: { endpoint: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  gemini: { endpoint: "https://generativelanguage.googleapis.com", model: "gemini-2.5-flash" },
  qwen: { endpoint: "https://dashscope.aliyuncs.com/compatible-mode", model: "qwen3-vl-plus" },
  moonshot: { endpoint: "https://api.moonshot.cn", model: "kimi-k2.6" },
  zhipu: { endpoint: "https://open.bigmodel.cn/api/paas", model: "glm-5v-turbo" },
  minimax: { endpoint: "https://api.minimaxi.com", model: "MiniMax-M3" },
  ollama: { endpoint: "http://localhost:11434", model: "qwen3-vl" },
  custom: { endpoint: "http://localhost:11434", model: "gpt-5.4-mini" },
};
