import { describe, expect, it } from "vitest";
import { PROTOCOL_IDS } from "../utils/aiConnectionPresets";
import {
  resolveAdapterEncodingCapability,
  resolveEndpointAcceptanceCapability,
  resolveEndpointProvenance,
  resolveTransportMediaCapabilities,
} from "./transportMediaCapabilities";

const canonical = (presetId: Parameters<typeof resolveTransportMediaCapabilities>[0]["presetId"], protocol: Parameters<typeof resolveTransportMediaCapabilities>[0]["protocol"]) =>
  resolveTransportMediaCapabilities({ presetId, protocol, endpointProvenance: "canonical_builtin_endpoint" });

describe("transportMediaCapabilities", () => {
  it.each(["anthropic_messages", "gemini_generate_content"] as const)("false AND unknown is false for %s", (protocol) => {
    const result = resolveTransportMediaCapabilities({ presetId: "custom", protocol, endpointProvenance: "custom_endpoint" });
    expect(result.endpointAcceptance.remoteImageUrl).toEqual({ value: null, confidence: "unknown" });
    expect(result.remoteImageUrl).toEqual({ value: false, confidence: "known_static" });
    expect(result.inlineBase64).toEqual({ value: null, confidence: "unknown" });
  });
  it("exposes both capability layers for canonical anthropic_messages", () => {
    const transport = canonical("anthropic", "anthropic_messages");
    // Adapter layer: protocol ground truth (inline base64, never remote URLs).
    expect(transport.adapterEncoding).toEqual({
      inlineBase64: { value: true, confidence: "known_static" },
      remoteImageUrl: { value: false, confidence: "known_static" },
      multipleImages: { value: true, confidence: "known_static" },
    });
    // Acceptance layer: canonical Anthropic service registry knowledge.
    expect(transport.endpointAcceptance.inlineBase64).toEqual({ value: true, confidence: "legacy_declared" });
    // Effective dimensions combine both layers.
    expect(transport.inlineBase64).toEqual({ value: true, confidence: "legacy_declared" });
    // Effective confidence is the weakest layer (adapter known_static ∧
    // acceptance legacy_declared => legacy_declared).
    expect(transport.remoteImageUrl).toEqual({ value: false, confidence: "legacy_declared" });
    expect(transport.endpointProvenance).toBe("canonical_builtin_endpoint");
  });

  it("custom Anthropic-compatible endpoints fail closed on acceptance, not on encoding", () => {
    const transport = resolveTransportMediaCapabilities({
      presetId: "custom",
      protocol: "anthropic_messages",
      endpointProvenance: "custom_endpoint",
    });
    // Adapter encoding shape stays known (the adapter can inline base64)...
    expect(transport.adapterEncoding.inlineBase64).toEqual({ value: true, confidence: "known_static" });
    // ...but an arbitrary remote server is not conformance-verified.
    expect(transport.endpointAcceptance.inlineBase64).toEqual({ value: null, confidence: "unknown" });
    expect(transport.inlineBase64).toEqual({ value: null, confidence: "unknown" });
    expect(transport.remoteImageUrl).toEqual({ value: false, confidence: "known_static" });
    expect(transport.multipleImages).toEqual({ value: null, confidence: "unknown" });
  });

  it("custom OpenAI-compatible endpoints fail closed on acceptance", () => {
    const transport = resolveTransportMediaCapabilities({
      presetId: "custom",
      protocol: "openai_chat_completions",
      endpointProvenance: "custom_endpoint",
    });
    expect(transport.adapterEncoding.inlineBase64).toEqual({ value: true, confidence: "known_static" });
    expect(transport.endpointAcceptance).toEqual({
      inlineBase64: { value: null, confidence: "unknown" },
      remoteImageUrl: { value: null, confidence: "unknown" },
      multipleImages: { value: null, confidence: "unknown" },
    });
    expect(transport.inlineBase64).toEqual({ value: null, confidence: "unknown" });
    expect(transport.remoteImageUrl).toEqual({ value: null, confidence: "unknown" });
    expect(transport.multipleImages).toEqual({ value: null, confidence: "unknown" });
  });

  it("official preset + endpoint override degrades endpoint-dependent capability to unknown", () => {
    const transport = resolveTransportMediaCapabilities({
      presetId: "openai",
      protocol: "openai_chat_completions",
      endpointProvenance: "overridden_endpoint",
    });
    // Adapter encoding knowledge persists...
    expect(transport.adapterEncoding.inlineBase64).toEqual({ value: true, confidence: "known_static" });
    // ...but the overridden endpoint is not the canonical provider service.
    expect(transport.endpointAcceptance).toEqual({
      inlineBase64: { value: null, confidence: "unknown" },
      remoteImageUrl: { value: null, confidence: "unknown" },
      multipleImages: { value: null, confidence: "unknown" },
    });
    expect(transport.inlineBase64).toEqual({ value: null, confidence: "unknown" });
    expect(transport.remoteImageUrl).toEqual({ value: null, confidence: "unknown" });
    // The canonical preset on its canonical endpoint keeps its declaration.
    expect(canonical("openai", "openai_chat_completions").remoteImageUrl).toEqual({
      value: true,
      confidence: "legacy_declared",
    });
  });

  it("mirrors canonical openai-compat endpoint declarations", () => {
    // deepseek preset currently rejects media entirely.
    const deepseek = canonical("deepseek", "openai_chat_completions");
    expect(deepseek.inlineBase64).toEqual({ value: false, confidence: "legacy_declared" });
    expect(deepseek.remoteImageUrl).toEqual({ value: false, confidence: "legacy_declared" });
    expect(deepseek.multipleImages).toEqual({ value: false, confidence: "legacy_declared" });

    const gemini = canonical("gemini", "gemini_generate_content");
    expect(gemini.inlineBase64).toEqual({ value: true, confidence: "legacy_declared" });
    expect(gemini.remoteImageUrl).toEqual({ value: false, confidence: "legacy_declared" });
    // Gemini wire format under another preset has no canonical evidence.
    const foreignGemini = resolveEndpointAcceptanceCapability("custom", "gemini_generate_content", "canonical_builtin_endpoint");
    expect(foreignGemini.inlineBase64).toEqual({ value: null, confidence: "unknown" });
  });

  it("resolves endpoint provenance from the persisted connection shape", () => {
    expect(resolveEndpointProvenance({ presetId: "openai" })).toBe("canonical_builtin_endpoint");
    expect(resolveEndpointProvenance({ presetId: "openai", endpointOverride: "https://proxy.example.internal" })).toBe(
      "overridden_endpoint",
    );
    expect(resolveEndpointProvenance({ presetId: "custom", endpointOverride: "https://relay.example.internal" })).toBe(
      "custom_endpoint",
    );
    expect(resolveEndpointProvenance({ presetId: "custom" })).toBe("custom_endpoint");
  });

  it("E2A-CAP-08 drift gate: every authoritative ProtocolId has explicit handling", () => {
    // PROTOCOL_IDS is the authoritative protocol list; a newly added protocol
    // without a transport branch fails here (and fails to compile via
    // assertNever inside the resolver).
    expect(PROTOCOL_IDS).toEqual(["anthropic_messages", "openai_chat_completions", "gemini_generate_content"]);
    for (const protocol of PROTOCOL_IDS) {
      const encoding = resolveAdapterEncodingCapability(protocol);
      for (const dimension of [encoding.inlineBase64, encoding.remoteImageUrl, encoding.multipleImages]) {
        expect(dimension.confidence === "unknown" || typeof dimension.value === "boolean").toBe(true);
      }
      const transport = resolveTransportMediaCapabilities({
        presetId: "openai",
        protocol,
        endpointProvenance: "canonical_builtin_endpoint",
      });
      for (const dimension of [transport.inlineBase64, transport.remoteImageUrl, transport.multipleImages]) {
        expect(dimension.confidence === "unknown" || typeof dimension.value === "boolean").toBe(true);
      }
    }
  });
});
