import { describe, expect, it } from "vitest";
import { assessModelCapabilities } from "./modelCapabilityCatalog";
import { resolveTransportMediaCapabilities } from "./transportMediaCapabilities";
import { resolveEffectiveMediaCapability } from "./effectiveMediaCapability";

const VISION_MODEL = assessModelCapabilities("anthropic", "claude-opus-4.8");
const TEXT_MODEL = assessModelCapabilities("deepseek", "deepseek-v4-flash");
const UNKNOWN_MODEL = assessModelCapabilities("custom", "my-arbitrary-model");
const ANTHROPIC_TRANSPORT = resolveTransportMediaCapabilities("anthropic", "anthropic_messages");
const DEEPSEEK_TRANSPORT = resolveTransportMediaCapabilities("deepseek", "openai_chat_completions");
const CUSTOM_OPENAI_TRANSPORT = resolveTransportMediaCapabilities("custom", "openai_chat_completions");

describe("resolveEffectiveMediaCapability", () => {
  it("text-only questions never require the vision path", () => {
    const result = resolveEffectiveMediaCapability({
      model: TEXT_MODEL,
      transport: DEEPSEEK_TRANSPORT,
      inlineImageCount: 0,
      remoteImageCount: 0,
    });
    expect(result).toEqual({ mediaRequired: false, canProcess: true });
  });

  it("E2A-CAP-01/04: known vision model over a supportive transport can process media", () => {
    const result = resolveEffectiveMediaCapability({
      model: VISION_MODEL,
      transport: ANTHROPIC_TRANSPORT,
      inlineImageCount: 1,
      remoteImageCount: 0,
    });
    expect(result).toEqual({ mediaRequired: true, canProcess: true });
  });

  it("E2A-CAP-04: model vision true + transport unsupported => effective false", () => {
    const result = resolveEffectiveMediaCapability({
      model: VISION_MODEL,
      transport: { ...DEEPSEEK_TRANSPORT },
      inlineImageCount: 1,
      remoteImageCount: 0,
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
      inlineImageCount: 2,
      remoteImageCount: 0,
    });
    expect(result.canProcess).toBe(false);
    expect(result.failCode).toBe("AI_TRANSPORT_MEDIA_UNSUPPORTED");
    expect(result.detail).toContain("multiple images");
  });

  it("E2A-CAP-06: unknown transport dimension => fail closed with unknown code", () => {
    const result = resolveEffectiveMediaCapability({
      model: VISION_MODEL,
      transport: CUSTOM_OPENAI_TRANSPORT,
      inlineImageCount: 1,
      remoteImageCount: 0,
    });
    expect(result.canProcess).toBe(false);
    expect(result.failCode).toBe("AI_TRANSPORT_CAPABILITY_UNKNOWN");
  });

  it("unknown model vision fails closed even over a supportive transport", () => {
    const result = resolveEffectiveMediaCapability({
      model: UNKNOWN_MODEL,
      transport: ANTHROPIC_TRANSPORT,
      inlineImageCount: 1,
      remoteImageCount: 0,
    });
    expect(result.canProcess).toBe(false);
    expect(result.failCode).toBe("AI_MODEL_CAPABILITY_UNKNOWN");
  });

  it("known text-only model fails with the vision-unsupported code", () => {
    const result = resolveEffectiveMediaCapability({
      model: TEXT_MODEL,
      transport: ANTHROPIC_TRANSPORT,
      inlineImageCount: 1,
      remoteImageCount: 0,
    });
    expect(result.canProcess).toBe(false);
    expect(result.failCode).toBe("AI_MODEL_VISION_UNSUPPORTED");
  });

  it("remote-image media require remote URL transport", () => {
    const result = resolveEffectiveMediaCapability({
      model: VISION_MODEL,
      transport: ANTHROPIC_TRANSPORT, // remoteImageUrl known-false
      inlineImageCount: 0,
      remoteImageCount: 1,
    });
    expect(result.canProcess).toBe(false);
    expect(result.failCode).toBe("AI_TRANSPORT_MEDIA_UNSUPPORTED");
  });
});
