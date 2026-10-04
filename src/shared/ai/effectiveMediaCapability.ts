/**
 * UI05R-E2A — Effective media capability calculation.
 *
 * effective vision = model understands images AND transport can encode the
 * question's media.
 *
 * Fail-closed policy: UNKNOWN in any REQUIRED dimension rejects the media
 * path — an unknown model capability or unknown transport encoding never
 * counts as support. This resolver is pure and is NOT yet wired into
 * `parseQuestion` (no authority cutover in E2A).
 */

import type {
  CapabilityAssessment,
  ModelCapabilityAssessment,
  TransportMediaCapabilityAssessment,
} from "../types/connection";

export type EffectiveMediaFailCode =
  | "AI_MODEL_CAPABILITY_UNKNOWN"
  | "AI_MODEL_VISION_UNSUPPORTED"
  | "AI_TRANSPORT_CAPABILITY_UNKNOWN"
  | "AI_TRANSPORT_MEDIA_UNSUPPORTED";

export interface EffectiveMediaCapabilityRequest {
  model: ModelCapabilityAssessment;
  transport: TransportMediaCapabilityAssessment;
  /** Images that would be sent as inline base64 (data URL) media. */
  inlineImageCount: number;
  /** Images that would be sent as remote URLs. */
  remoteImageCount: number;
}

export interface EffectiveMediaCapability {
  /** True when the question carries any media requiring a vision path. */
  mediaRequired: boolean;
  /** True only when every required capability dimension is known-supported. */
  canProcess: boolean;
  failCode?: EffectiveMediaFailCode;
  /** Stable, non-secret detail about the failing dimension. */
  detail?: string;
}

function requireKnownTrue(capability: CapabilityAssessment, unknownCode: EffectiveMediaFailCode, unsupportedCode: EffectiveMediaFailCode): EffectiveMediaFailCode | null {
  if (capability.confidence === "unknown" || capability.value === null) return unknownCode;
  if (capability.value !== true) return unsupportedCode;
  return null;
}

/**
 * Decide whether the model + transport combination can process the given
 * media. Unknown in any required dimension fails closed.
 */
export function resolveEffectiveMediaCapability(request: EffectiveMediaCapabilityRequest): EffectiveMediaCapability {
  const inlineImageCount = Math.max(0, Math.floor(request.inlineImageCount));
  const remoteImageCount = Math.max(0, Math.floor(request.remoteImageCount));
  const totalImages = inlineImageCount + remoteImageCount;

  if (totalImages === 0) {
    return { mediaRequired: false, canProcess: true };
  }

  // Model layer: must explicitly understand images.
  if (request.model.vision.confidence === "unknown" || request.model.vision.value === null) {
    return {
      mediaRequired: true,
      canProcess: false,
      failCode: "AI_MODEL_CAPABILITY_UNKNOWN",
      detail: "model vision capability is unknown; failing closed",
    };
  }
  if (request.model.vision.value !== true) {
    return {
      mediaRequired: true,
      canProcess: false,
      failCode: "AI_MODEL_VISION_UNSUPPORTED",
      detail: "model is classified as text-only",
    };
  }

  // Transport layer: every required encoding dimension must be known-supported.
  if (inlineImageCount > 0) {
    const fail = requireKnownTrue(
      request.transport.inlineBase64,
      "AI_TRANSPORT_CAPABILITY_UNKNOWN",
      "AI_TRANSPORT_MEDIA_UNSUPPORTED",
    );
    if (fail) {
      return { mediaRequired: true, canProcess: false, failCode: fail, detail: `transport cannot accept inline base64 media` };
    }
  }
  if (remoteImageCount > 0) {
    const fail = requireKnownTrue(
      request.transport.remoteImageUrl,
      "AI_TRANSPORT_CAPABILITY_UNKNOWN",
      "AI_TRANSPORT_MEDIA_UNSUPPORTED",
    );
    if (fail) {
      return { mediaRequired: true, canProcess: false, failCode: fail, detail: "transport cannot accept remote image URLs" };
    }
  }
  if (totalImages > 1) {
    const fail = requireKnownTrue(
      request.transport.multipleImages,
      "AI_TRANSPORT_CAPABILITY_UNKNOWN",
      "AI_TRANSPORT_MEDIA_UNSUPPORTED",
    );
    if (fail) {
      return { mediaRequired: true, canProcess: false, failCode: fail, detail: "transport cannot accept multiple images" };
    }
  }

  return { mediaRequired: true, canProcess: true };
}
