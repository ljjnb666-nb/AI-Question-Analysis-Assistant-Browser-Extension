/**
 * UI05R-E2A — Transport/media encoding capability authority.
 *
 * Transport capability is a property of the PROTOCOL adapter plus the known
 * provider endpoint behavior — not of the model. Ground truth audited from
 * the current wire adapters:
 *
 * - `anthropic_messages` (callAnthropic): images are always sent as inline
 *   base64 content blocks; the adapter never consumes remote image URLs
 *   directly (remote media are downloaded into data URLs by
 *   prepareQuestionPackageForProvider beforehand). Multiple image blocks are
 *   structurally supported.
 * - `gemini_generate_content` (callGemini): images are always sent as
 *   `inline_data` base64 parts; remote URLs are never sent. Multiple parts
 *   supported.
 * - `openai_chat_completions` (callOpenAICompat): images travel as
 *   `image_url` content parts — a remote URL when the provider is declared to
 *   accept them, otherwise a data URL. Per-provider acceptance therefore
 *   differs and is taken from the current registry as `legacy_declared`.
 *   Arbitrary custom OpenAI-compatible endpoints have UNKNOWN transport
 *   support and fail closed — no overclaiming.
 *
 * No "everything supported" fallback exists: every protocol receives an
 * explicit outcome (drift gate `E2A-CAP-08`).
 */

import type {
  CapabilityAssessment,
  ProtocolId,
  ProviderPresetId,
  TransportMediaCapabilityAssessment,
} from "../types/connection";
import { PROVIDERS } from "./providers";

const KNOWN_TRUE: CapabilityAssessment = { value: true, confidence: "known_static" };
const KNOWN_FALSE: CapabilityAssessment = { value: false, confidence: "known_static" };
const UNKNOWN: CapabilityAssessment = { value: null, confidence: "unknown" };

interface ProviderTransportDeclaration {
  remoteImageUrl: boolean;
  multipleImages: boolean;
  /** false = the provider preset currently rejects media entirely. */
  acceptsMedia: boolean;
}

/** Current registry declarations per openai-compat provider (`legacy_declared`). */
const OPENAI_COMPAT_TRANSPORT: Partial<Record<ProviderPresetId, ProviderTransportDeclaration>> = {
  openai: { remoteImageUrl: true, multipleImages: true, acceptsMedia: true },
  deepseek: { remoteImageUrl: false, multipleImages: false, acceptsMedia: false },
  qwen: { remoteImageUrl: true, multipleImages: true, acceptsMedia: true },
  moonshot: { remoteImageUrl: true, multipleImages: true, acceptsMedia: true },
  zhipu: { remoteImageUrl: true, multipleImages: true, acceptsMedia: true },
  minimax: { remoteImageUrl: true, multipleImages: true, acceptsMedia: true },
  ollama: { remoteImageUrl: true, multipleImages: true, acceptsMedia: true },
};

/**
 * Explicit transport outcome per protocol (+ provider endpoint behavior).
 * `presetId` refines `openai_chat_completions`; an unknown combination yields
 * explicit `unknown` dimensions, which fail closed downstream.
 */
export function resolveTransportMediaCapabilities(
  presetId: ProviderPresetId,
  protocol: ProtocolId,
): TransportMediaCapabilityAssessment {
  if (protocol === "anthropic_messages") {
    // Adapter always inlines base64 and never consumes remote URLs.
    return { protocol, inlineBase64: KNOWN_TRUE, remoteImageUrl: KNOWN_FALSE, multipleImages: KNOWN_TRUE };
  }
  if (protocol === "gemini_generate_content") {
    // Adapter always inlines base64 as inline_data parts.
    if (presetId === "gemini") {
      return { protocol, inlineBase64: KNOWN_TRUE, remoteImageUrl: KNOWN_FALSE, multipleImages: KNOWN_TRUE };
    }
    // No current runtime evidence for other presets on the Gemini wire format.
    return { protocol, inlineBase64: UNKNOWN, remoteImageUrl: UNKNOWN, multipleImages: UNKNOWN };
  }

  // openai_chat_completions: per-provider endpoint behavior.
  const declaration = OPENAI_COMPAT_TRANSPORT[presetId];
  if (!declaration) {
    // Custom (and any unknown) OpenAI-compatible endpoint: transport support
    // is unknown and must fail closed instead of being overclaimed.
    return { protocol, inlineBase64: UNKNOWN, remoteImageUrl: UNKNOWN, multipleImages: UNKNOWN };
  }
  if (!declaration.acceptsMedia) {
    // The preset's current registry declaration rejects media entirely
    // (legacy_declared evidence, not adapter-structural knowledge).
    const declaredFalse: CapabilityAssessment = { value: false, confidence: "legacy_declared" };
    return { protocol, inlineBase64: declaredFalse, remoteImageUrl: declaredFalse, multipleImages: declaredFalse };
  }
  // Data-URL image parts are what the adapter sends whenever it does not send
  // a remote URL, so inline transport is adapter behavior (known_static);
  // remote acceptance is per-endpoint registry knowledge (legacy_declared).
  return {
    protocol,
    inlineBase64: KNOWN_TRUE,
    remoteImageUrl: { value: declaration.remoteImageUrl, confidence: "legacy_declared" },
    multipleImages: { value: declaration.multipleImages, confidence: "legacy_declared" },
  };
}

/**
 * Drift gate helper: every protocol currently reachable from the provider
 * registry must resolve to an explicit outcome (never an implicit fallback).
 */
export function listProtocolCoverage(): Array<{ presetId: ProviderPresetId; protocol: ProtocolId }> {
  const covered = new Map<string, { presetId: ProviderPresetId; protocol: ProtocolId }>();
  for (const provider of PROVIDERS) {
    const protocol =
      provider.id === "anthropic"
        ? "anthropic_messages"
        : provider.id === "gemini"
          ? "gemini_generate_content"
          : "openai_chat_completions";
    covered.set(protocol, { presetId: provider.id, protocol });
  }
  return [...covered.values()];
}
