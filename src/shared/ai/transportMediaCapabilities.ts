/**
 * UI05R-E2A — Transport/media capability authority (two layers).
 *
 * ADAPTER ENCODING is protocol ground truth — what the wire adapter can
 * encode, audited from the current implementations (`providerClients.ts`):
 * - `anthropic_messages` (callAnthropic): images are always sent as inline
 *   base64 content blocks; the adapter never emits a remote image URL.
 * - `gemini_generate_content` (callGemini): images are always sent as
 *   `inline_data` base64 parts; the adapter never emits a remote image URL.
 * - `openai_chat_completions` (callOpenAICompat): images travel as
 *   `image_url` parts — the adapter CAN emit a remote URL and otherwise sends
 *   a data URL; multiple parts are structurally supported.
 *
 * ENDPOINT ACCEPTANCE is what the concrete endpoint actually accepts. It is
 * only trusted (legacy_declared) for built-in presets on their CANONICAL
 * endpoint. An endpoint override stops the endpoint from being the canonical
 * provider service, and a custom endpoint is never conformance-verified —
 * selecting "Anthropic-compatible" does NOT prove an arbitrary remote server
 * accepts Anthropic encodings. Acceptance is therefore UNKNOWN for overridden
 * and custom endpoints, and effective transport support requires BOTH layers,
 * so positive support degrades to unknown (fail closed downstream). No overconfident
 * boolean collapse.
 *
 * Remote SOURCE media are NOT remote WIRE media: production acquires remote
 * sources into data URLs unless the endpoint is known to accept remote URLs
 * (see `planWireMediaDelivery`).
 *
 * Protocol handling is exhaustive (`switch` + `assertNever`): every
 * `ProtocolId` has an explicit branch and a newly added protocol fails to
 * compile until handled.
 */

import type {
  AdapterEncodingCapability,
  CapabilityAssessment,
  EndpointAcceptanceCapability,
  EndpointProvenance,
  ProtocolId,
  ProviderPresetId,
  TransportMediaCapabilityAssessment,
} from "../types/connection";

const KNOWN_TRUE: CapabilityAssessment = { value: true, confidence: "known_static" };
const KNOWN_FALSE: CapabilityAssessment = { value: false, confidence: "known_static" };
const UNKNOWN: CapabilityAssessment = { value: null, confidence: "unknown" };

function assertNeverProtocol(value: never): never {
  throw new Error(`Unhandled ProtocolId in transport resolver: ${String(value)}`);
}

/**
 * Layer 1 — adapter encoding, per protocol. Exhaustive over `ProtocolId`.
 */
export function resolveAdapterEncodingCapability(protocol: ProtocolId): AdapterEncodingCapability {
  switch (protocol) {
    case "anthropic_messages":
      // Adapter always inlines base64 blocks and never emits remote URLs.
      return { inlineBase64: KNOWN_TRUE, remoteImageUrl: KNOWN_FALSE, multipleImages: KNOWN_TRUE };
    case "gemini_generate_content":
      // Adapter always inlines base64 `inline_data` parts, never remote URLs.
      return { inlineBase64: KNOWN_TRUE, remoteImageUrl: KNOWN_FALSE, multipleImages: KNOWN_TRUE };
    case "openai_chat_completions":
      // Adapter sends remote URLs when declared+available, else data URLs.
      return { inlineBase64: KNOWN_TRUE, remoteImageUrl: KNOWN_TRUE, multipleImages: KNOWN_TRUE };
    default:
      return assertNeverProtocol(protocol);
  }
}

/** Current canonical-endpoint registry declarations per openai-compat provider. */
interface CanonicalEndpointDeclaration {
  remoteImageUrl: boolean;
  multipleImages: boolean;
  /** false = the provider preset currently rejects media entirely. */
  acceptsMedia: boolean;
}

const CANONICAL_OPENAI_COMPAT_ACCEPTANCE: Partial<Record<ProviderPresetId, CanonicalEndpointDeclaration>> = {
  openai: { remoteImageUrl: true, multipleImages: true, acceptsMedia: true },
  deepseek: { remoteImageUrl: false, multipleImages: false, acceptsMedia: false },
  qwen: { remoteImageUrl: true, multipleImages: true, acceptsMedia: true },
  moonshot: { remoteImageUrl: true, multipleImages: true, acceptsMedia: true },
  zhipu: { remoteImageUrl: true, multipleImages: true, acceptsMedia: true },
  minimax: { remoteImageUrl: true, multipleImages: true, acceptsMedia: true },
  ollama: { remoteImageUrl: true, multipleImages: true, acceptsMedia: true },
};

/**
 * Layer 2 — endpoint acceptance. Only canonical built-in endpoints carry
 * legacy-declared knowledge; overridden and custom endpoints are unknown in
 * every endpoint-dependent dimension.
 */
export function resolveEndpointAcceptanceCapability(
  presetId: ProviderPresetId,
  protocol: ProtocolId,
  endpointProvenance: EndpointProvenance,
): EndpointAcceptanceCapability {
  if (endpointProvenance !== "canonical_builtin_endpoint") {
    // Overridden and custom endpoints have no conformance evidence: adapter
    // encoding shape may be known, endpoint acceptance is not.
    return { inlineBase64: UNKNOWN, remoteImageUrl: UNKNOWN, multipleImages: UNKNOWN };
  }

  switch (protocol) {
    case "anthropic_messages":
      // Canonical Anthropic service (legacy_declared registry knowledge).
      return { inlineBase64: { value: true, confidence: "legacy_declared" }, remoteImageUrl: { value: false, confidence: "legacy_declared" }, multipleImages: { value: true, confidence: "legacy_declared" } };
    case "gemini_generate_content":
      if (presetId !== "gemini") {
        // No canonical evidence for the Gemini wire format under another preset.
        return { inlineBase64: UNKNOWN, remoteImageUrl: UNKNOWN, multipleImages: UNKNOWN };
      }
      return { inlineBase64: { value: true, confidence: "legacy_declared" }, remoteImageUrl: { value: false, confidence: "legacy_declared" }, multipleImages: { value: true, confidence: "legacy_declared" } };
    case "openai_chat_completions": {
      const declaration = CANONICAL_OPENAI_COMPAT_ACCEPTANCE[presetId];
      if (!declaration) {
        return { inlineBase64: UNKNOWN, remoteImageUrl: UNKNOWN, multipleImages: UNKNOWN };
      }
      if (!declaration.acceptsMedia) {
        const declaredFalse: CapabilityAssessment = { value: false, confidence: "legacy_declared" };
        return { inlineBase64: declaredFalse, remoteImageUrl: declaredFalse, multipleImages: declaredFalse };
      }
      return {
        inlineBase64: { value: true, confidence: "legacy_declared" },
        remoteImageUrl: { value: declaration.remoteImageUrl, confidence: "legacy_declared" },
        multipleImages: { value: declaration.multipleImages, confidence: "legacy_declared" },
      };
    }
    default:
      return assertNeverProtocol(protocol);
  }
}

/** Three-valued AND: false is decisive; otherwise confidence follows the weakest layer. */
function combineCapability(adapter: CapabilityAssessment, acceptance: CapabilityAssessment): CapabilityAssessment {
  if (adapter.value === false && acceptance.value === null) return adapter;
  if (acceptance.value === false && adapter.value === null) return acceptance;
  if (adapter.confidence === "unknown" || acceptance.confidence === "unknown") return UNKNOWN;
  return {
    value: adapter.value && acceptance.value,
    confidence: adapter.confidence === "known_static" && acceptance.confidence === "known_static" ? "known_static" : "legacy_declared",
  };
}

export interface TransportResolutionInput {
  presetId: ProviderPresetId;
  protocol: ProtocolId;
  endpointProvenance: EndpointProvenance;
}

/**
 * Resolve the layered transport assessment. Effective dimensions require BOTH
 * adapter encoding and endpoint acceptance to be known-supported; unknown in
 * either layer degrades support to unknown unless the other layer is known-false.
 */
export function resolveTransportMediaCapabilities(input: TransportResolutionInput): TransportMediaCapabilityAssessment {
  const adapterEncoding = resolveAdapterEncodingCapability(input.protocol);
  const endpointAcceptance = resolveEndpointAcceptanceCapability(input.presetId, input.protocol, input.endpointProvenance);
  return {
    protocol: input.protocol,
    endpointProvenance: input.endpointProvenance,
    adapterEncoding,
    endpointAcceptance,
    inlineBase64: combineCapability(adapterEncoding.inlineBase64, endpointAcceptance.inlineBase64),
    remoteImageUrl: combineCapability(adapterEncoding.remoteImageUrl, endpointAcceptance.remoteImageUrl),
    multipleImages: combineCapability(adapterEncoding.multipleImages, endpointAcceptance.multipleImages),
  };
}

/** Provenance of a connection's endpoint from its persisted shape. */
export function resolveEndpointProvenance(connection: {
  presetId: ProviderPresetId;
  endpointOverride?: string;
}): EndpointProvenance {
  if (connection.presetId === "custom") return "custom_endpoint";
  if (connection.endpointOverride) return "overridden_endpoint";
  return "canonical_builtin_endpoint";
}
