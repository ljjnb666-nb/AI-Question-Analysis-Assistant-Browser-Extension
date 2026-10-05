/**
 * UI05R-E2A — Effective media capability + wire media delivery planning.
 *
 * SOURCE vs WIRE separation (frozen contract): where a question's image
 * ORIGINATED (remote page URL vs captured data URL) is a SOURCE property; the
 * capability contract only reasons about the WIRE representation that would
 * actually be sent. Production already acquires remote source media into
 * data URLs when the endpoint does not accept remote URLs
 * (`prepareQuestionPackageForProvider`), so a remote SOURCE never by itself
 * requires remote-URL WIRE support. `planWireMediaDelivery` encodes that
 * planning; `resolveEffectiveMediaCapability` operates ONLY on the wire plan
 * (frozen E2B order):
 *
 *   source media
 *     -> media acquisition / delivery planning   (planWireMediaDelivery)
 *     -> wire representation requirements
 *     -> model capability check                  \
 *     -> transport capability check              / resolveEffectiveMediaCapability
 *     -> provider adapter
 *
 * Fail-closed policy: UNKNOWN in any REQUIRED dimension rejects the media
 * path. This pure module is enforced by `parseQuestion` after E2B2A.
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

/** SOURCE media counts (origin of the images), before delivery planning. */
export interface MediaSourceCounts {
  /** Images captured as data URLs (or equivalent inline material). */
  inlineSourceCount: number;
  /** Images whose source is a remote page URL. */
  remoteSourceCount: number;
}

/**
 * WIRE representation requirement after delivery planning. This — not the
 * source counts — is the input of the effective capability decision.
 */
export interface WireMediaPlan {
  wireInlineImageCount: number;
  wireRemoteImageCount: number;
}

/**
 * Delivery planning: a remote SOURCE stays a remote WIRE URL only when the
 * endpoint is known to accept remote URLs; otherwise production acquires it
 * into a data URL and sends it inline (current adapter behavior). Unknown
 * remote acceptance never keeps media on the remote wire (fail closed) —
 * acquisition at request time remains a runtime concern for E2B.
 */
export function planWireMediaDelivery(
  source: MediaSourceCounts,
  transport: TransportMediaCapabilityAssessment,
): WireMediaPlan {
  const inlineSourceCount = Math.max(0, Math.floor(source.inlineSourceCount));
  const remoteSourceCount = Math.max(0, Math.floor(source.remoteSourceCount));
  const remoteAcceptance = transport.remoteImageUrl;
  const remoteKnownAccepted = remoteAcceptance.confidence !== "unknown" && remoteAcceptance.value === true;
  return remoteKnownAccepted
    ? { wireInlineImageCount: inlineSourceCount, wireRemoteImageCount: remoteSourceCount }
    : { wireInlineImageCount: inlineSourceCount + remoteSourceCount, wireRemoteImageCount: 0 };
}

export interface EffectiveMediaCapabilityRequest {
  model: ModelCapabilityAssessment;
  transport: TransportMediaCapabilityAssessment;
  /** Wire plan: images that would be sent as inline base64 media. */
  wireInlineImageCount: number;
  /** Wire plan: images that would be sent as remote URLs. */
  wireRemoteImageCount: number;
}

export interface EffectiveMediaCapability {
  /** True when the wire plan carries any media requiring a vision path. */
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
 * Decide whether the model + transport combination can process the planned
 * WIRE media. Unknown in any required dimension fails closed.
 */
export function resolveEffectiveMediaCapability(request: EffectiveMediaCapabilityRequest): EffectiveMediaCapability {
  const wireInlineImageCount = Math.max(0, Math.floor(request.wireInlineImageCount));
  const wireRemoteImageCount = Math.max(0, Math.floor(request.wireRemoteImageCount));
  const totalImages = wireInlineImageCount + wireRemoteImageCount;

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

  // Transport layer: every required wire encoding dimension must be known-supported.
  if (wireInlineImageCount > 0) {
    const fail = requireKnownTrue(
      request.transport.inlineBase64,
      "AI_TRANSPORT_CAPABILITY_UNKNOWN",
      "AI_TRANSPORT_MEDIA_UNSUPPORTED",
    );
    if (fail) {
      return { mediaRequired: true, canProcess: false, failCode: fail, detail: "transport cannot accept inline base64 media" };
    }
  }
  if (wireRemoteImageCount > 0) {
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
