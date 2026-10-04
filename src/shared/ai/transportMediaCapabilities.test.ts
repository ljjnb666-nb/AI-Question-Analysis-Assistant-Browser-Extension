import { describe, expect, it } from "vitest";
import { PROVIDER_PRESET_IDS, resolvePresetProtocol } from "../utils/aiConnectionPresets";
import {
  listProtocolCoverage,
  resolveTransportMediaCapabilities,
} from "./transportMediaCapabilities";

describe("transportMediaCapabilities", () => {
  it("classifies anthropic_messages transport as inline-only with multiple images", () => {
    const transport = resolveTransportMediaCapabilities("anthropic", "anthropic_messages");
    expect(transport.inlineBase64).toEqual({ value: true, confidence: "known_static" });
    expect(transport.remoteImageUrl).toEqual({ value: false, confidence: "known_static" });
    expect(transport.multipleImages).toEqual({ value: true, confidence: "known_static" });
    // Custom Anthropic-compatible endpoints share the adapter semantics.
    expect(resolveTransportMediaCapabilities("custom", "anthropic_messages")).toEqual(transport);
  });

  it("classifies gemini_generate_content transport as inline-only for the gemini preset", () => {
    const transport = resolveTransportMediaCapabilities("gemini", "gemini_generate_content");
    expect(transport.inlineBase64).toEqual({ value: true, confidence: "known_static" });
    expect(transport.remoteImageUrl).toEqual({ value: false, confidence: "known_static" });
    expect(transport.multipleImages).toEqual({ value: true, confidence: "known_static" });
    // Gemini wire format under another preset has no runtime evidence.
    expect(resolveTransportMediaCapabilities("custom", "gemini_generate_content").inlineBase64).toEqual({
      value: null,
      confidence: "unknown",
    });
  });

  it("E2A-CAP-08 drift gate: every current protocol resolves to an explicit per-dimension outcome", () => {
    const coverage = listProtocolCoverage();
    const protocols = new Set(coverage.map((entry) => entry.protocol));
    expect(protocols).toEqual(new Set(["anthropic_messages", "openai_chat_completions", "gemini_generate_content"]));

    for (const presetId of PROVIDER_PRESET_IDS) {
      const transport = resolveTransportMediaCapabilities(presetId, resolvePresetProtocol(presetId));
      for (const dimension of [transport.inlineBase64, transport.remoteImageUrl, transport.multipleImages]) {
        // Explicit outcome: either a known decision or an explicit unknown —
        // never an implicit "everything supported" default.
        expect(dimension.confidence === "unknown" || typeof dimension.value === "boolean").toBe(true);
      }
    }
  });

  it("mirrors current openai-compat endpoint declarations and fails closed on custom", () => {
    // Custom OpenAI-compatible endpoints: unknown transport, no overclaiming.
    const custom = resolveTransportMediaCapabilities("custom", "openai_chat_completions");
    expect(custom.inlineBase64).toEqual({ value: null, confidence: "unknown" });
    expect(custom.remoteImageUrl).toEqual({ value: null, confidence: "unknown" });
    expect(custom.multipleImages).toEqual({ value: null, confidence: "unknown" });

    // deepseek preset currently rejects media entirely.
    const deepseek = resolveTransportMediaCapabilities("deepseek", "openai_chat_completions");
    expect(deepseek.inlineBase64).toEqual({ value: false, confidence: "legacy_declared" });
    expect(deepseek.remoteImageUrl).toEqual({ value: false, confidence: "legacy_declared" });
    expect(deepseek.multipleImages).toEqual({ value: false, confidence: "legacy_declared" });

    // Endpoints declared to accept remote images keep that behavior.
    const openai = resolveTransportMediaCapabilities("openai", "openai_chat_completions");
    expect(openai.inlineBase64).toEqual({ value: true, confidence: "known_static" });
    expect(openai.remoteImageUrl).toEqual({ value: true, confidence: "legacy_declared" });
    expect(openai.multipleImages).toEqual({ value: true, confidence: "legacy_declared" });
  });
});
