import { describe, expect, it } from "vitest";
import { assessModelCapabilities } from "./modelCapabilityCatalog";
import {
  planWireMediaDelivery,
  resolveEffectiveMediaCapability,
} from "./effectiveMediaCapability";
import { resolveTransportMediaCapabilities } from "./transportMediaCapabilities";

const VISION_MODEL = assessModelCapabilities("anthropic", "claude-opus-4.8");
const TEXT_MODEL = assessModelCapabilities("deepseek", "deepseek-v4-flash");
const UNKNOWN_MODEL = assessModelCapabilities("custom", "my-arbitrary-model");
const ANTHROPIC_TRANSPORT = resolveTransportMediaCapabilities({
  presetId: "anthropic",
  protocol: "anthropic_messages",
  endpointProvenance: "canonical_builtin_endpoint",
});
const DEEPSEEK_TRANSPORT = resolveTransportMediaCapabilities({
  presetId: "deepseek",
  protocol: "openai_chat_completions",
  endpointProvenance: "canonical_builtin_endpoint",
});
const CUSTOM_ANTHROPIC_TRANSPORT = resolveTransportMediaCapabilities({
  presetId: "custom",
  protocol: "anthropic_messages",
  endpointProvenance: "custom_endpoint",
});
const GEMINI_TRANSPORT = resolveTransportMediaCapabilities({
  presetId: "gemini",
  protocol: "gemini_generate_content",
  endpointProvenance: "canonical_builtin_endpoint",
});

describe("planWireMediaDelivery (source vs wire separation)", () => {
  it("remote SOURCE media become inline WIRE media when the endpoint does not accept remote URLs", () => {
    // Production behavior: remote sources are acquired into data URLs unless
    // the endpoint is known to accept remote URLs — remote source never
    // requires remote wire support by itself.
    expect(planWireMediaDelivery({ inlineSourceCount: 1, remoteSourceCount: 2 }, ANTHROPIC_TRANSPORT)).toEqual({
      wireInlineImageCount: 3,
      wireRemoteImageCount: 0,
    });
    expect(planWireMediaDelivery({ inlineSourceCount: 0, remoteSourceCount: 1 }, GEMINI_TRANSPORT)).toEqual({
      wireInlineImageCount: 1,
      wireRemoteImageCount: 0,
    });
  });

  it("remote SOURCE media stay on the remote wire only when acceptance is known-true", () => {
    // Canonical OpenAI endpoint accepts remote URLs (legacy_declared).
    const openai = resolveTransportMediaCapabilities({
      presetId: "openai",
      protocol: "openai_chat_completions",
      endpointProvenance: "canonical_builtin_endpoint",
    });
    expect(planWireMediaDelivery({ inlineSourceCount: 0, remoteSourceCount: 2 }, openai)).toEqual({
      wireInlineImageCount: 0,
      wireRemoteImageCount: 2,
    });
    // Unknown remote acceptance never keeps media on the remote wire.
    expect(
      planWireMediaDelivery(
        { inlineSourceCount: 0, remoteSourceCount: 2 },
        resolveTransportMediaCapabilities({
          presetId: "custom",
          protocol: "openai_chat_completions",
          endpointProvenance: "custom_endpoint",
        }),
      ),
    ).toEqual({ wireInlineImageCount: 2, wireRemoteImageCount: 0 });
  });
});

describe("resolveEffectiveMediaCapability", () => {
  it("text-only questions never require the vision path", () => {
    const result = resolveEffectiveMediaCapability({
      model: TEXT_MODEL,
      transport: DEEPSEEK_TRANSPORT,
      wireInlineImageCount: 0,
      wireRemoteImageCount: 0,
    });
    expect(result).toEqual({ mediaRequired: false, canProcess: true });
  });

  it("E2A-CAP-01: known vision model over a supportive transport can process media", () => {
    const result = resolveEffectiveMediaCapability({
      model: VISION_MODEL,
      transport: ANTHROPIC_TRANSPORT,
      wireInlineImageCount: 1,
      wireRemoteImageCount: 0,
    });
    expect(result).toEqual({ mediaRequired: true, canProcess: true });
  });

  it("E2A-CAP-04: model vision true + transport unsupported => effective false", () => {
    const result = resolveEffectiveMediaCapability({
      model: VISION_MODEL,
      transport: DEEPSEEK_TRANSPORT,
      wireInlineImageCount: 1,
      wireRemoteImageCount: 0,
    });
    expect(result.mediaRequired).toBe(true);
    expect(result.canProcess).toBe(false);
    expect(result.failCode).toBe("AI_TRANSPORT_MEDIA_UNSUPPORTED");
  });

  it("E2A-CAP-05: multiple images + single-image transport => rejected", () => {
    const singleImageTransport = {
      ...ANTHROPIC_TRANSPORT,
      multipleImages: { value: false, confidence: "legacy_declared" as const },
    };
    const result = resolveEffectiveMediaCapability({
      model: VISION_MODEL,
      transport: singleImageTransport,
      wireInlineImageCount: 2,
      wireRemoteImageCount: 0,
    });
    expect(result.canProcess).toBe(false);
    expect(result.failCode).toBe("AI_TRANSPORT_MEDIA_UNSUPPORTED");
    expect(result.detail).toContain("multiple images");
  });

  it("E2A-CAP-06: unknown transport dimension => fail closed with unknown code", () => {
    const result = resolveEffectiveMediaCapability({
      model: VISION_MODEL,
      transport: CUSTOM_ANTHROPIC_TRANSPORT,
      wireInlineImageCount: 1,
      wireRemoteImageCount: 0,
    });
    expect(result.canProcess).toBe(false);
    expect(result.failCode).toBe("AI_TRANSPORT_CAPABILITY_UNKNOWN");
  });

  it("unknown model vision fails closed even over a supportive transport", () => {
    const result = resolveEffectiveMediaCapability({
      model: UNKNOWN_MODEL,
      transport: ANTHROPIC_TRANSPORT,
      wireInlineImageCount: 1,
      wireRemoteImageCount: 0,
    });
    expect(result.canProcess).toBe(false);
    expect(result.failCode).toBe("AI_MODEL_CAPABILITY_UNKNOWN");
  });

  it("known text-only model fails with the vision-unsupported code", () => {
    const result = resolveEffectiveMediaCapability({
      model: TEXT_MODEL,
      transport: ANTHROPIC_TRANSPORT,
      wireInlineImageCount: 1,
      wireRemoteImageCount: 0,
    });
    expect(result.canProcess).toBe(false);
    expect(result.failCode).toBe("AI_MODEL_VISION_UNSUPPORTED");
  });

  it("E2A-RF01-MEDIA-03: wire plan explicitly requiring remote URL + remote transport false => rejected", () => {
    const result = resolveEffectiveMediaCapability({
      model: VISION_MODEL,
      transport: ANTHROPIC_TRANSPORT, // remoteImageUrl known-false
      wireInlineImageCount: 0,
      wireRemoteImageCount: 1,
    });
    expect(result.canProcess).toBe(false);
    expect(result.failCode).toBe("AI_TRANSPORT_MEDIA_UNSUPPORTED");
  });

  it("E2A-RF01-MEDIA-04: wire plan requires inline + inline transport unknown => fail closed", () => {
    const result = resolveEffectiveMediaCapability({
      model: VISION_MODEL,
      transport: CUSTOM_ANTHROPIC_TRANSPORT,
      wireInlineImageCount: 2,
      wireRemoteImageCount: 0,
    });
    expect(result.canProcess).toBe(false);
    expect(result.failCode).toBe("AI_TRANSPORT_CAPABILITY_UNKNOWN");
  });

  it("E2A-RF01-MEDIA-01/02: remote source + delivery planning + anthropic/gemini => permitted", () => {
    for (const transport of [ANTHROPIC_TRANSPORT, GEMINI_TRANSPORT]) {
      // Remote page image sources are acquired into data URLs, so the wire
      // requirement is inline — which these transports support.
      const plan = planWireMediaDelivery({ inlineSourceCount: 0, remoteSourceCount: 1 }, transport);
      const result = resolveEffectiveMediaCapability({
        model: VISION_MODEL,
        transport,
        wireInlineImageCount: plan.wireInlineImageCount,
        wireRemoteImageCount: plan.wireRemoteImageCount,
      });
      expect(result).toEqual({ mediaRequired: true, canProcess: true });
    }
  });
});
