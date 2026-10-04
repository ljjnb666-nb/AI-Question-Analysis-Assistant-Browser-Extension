import { describe, expect, it } from "vitest";
import { PROVIDERS } from "./providers";
import {
  assessModelCapabilities,
  auditBuiltinModelClassification,
} from "./modelCapabilityCatalog";

describe("modelCapabilityCatalog", () => {
  it.each(["overridden_endpoint", "custom_endpoint", "unknown"] as const)("fails closed on known IDs with %s provenance", (endpointProvenance) => {
    const assessment = assessModelCapabilities({ presetId: "openai", modelId: "gpt-5.5", endpointProvenance });
    expect(assessment.classification).toBe("unknown");
    for (const dimension of [assessment.text, assessment.vision, assessment.reasoning, assessment.structuredOutput]) {
      expect(dimension).toEqual({ value: null, confidence: "unknown" });
    }
  });
  it("E2A-CAP-01 classifies known multimodal built-in models as vision known-true", () => {
    const assessment = assessModelCapabilities({ presetId: "anthropic", modelId: "claude-opus-4.8", endpointProvenance: "canonical_builtin_endpoint" });
    expect(assessment.classification).toBe("known");
    expect(assessment.text).toEqual({ value: true, confidence: "known_static" });
    expect(assessment.vision).toEqual({ value: true, confidence: "legacy_declared" });
  });

  it("E2A-CAP-02 classifies known text-only built-in models as vision known-false", () => {
    for (const [presetId, modelId] of [
      ["deepseek", "deepseek-v4-flash"],
      ["qwen", "qwen-plus"],
      ["qwen", "qwen-flash"],
      ["zhipu", "glm-5.2"],
      ["zhipu", "glm-5-turbo"],
    ] as const) {
      const assessment = assessModelCapabilities({ presetId: presetId, modelId: modelId, endpointProvenance: "canonical_builtin_endpoint" });
      expect(assessment.classification).toBe("known");
      expect(assessment.vision).toEqual({ value: false, confidence: "legacy_declared" });
    }
  });

  it("E2A-CAP-03 leaves unknown/custom models unknown (fail closed, no name inference)", () => {
    for (const modelId of [
      "my-vision-model",
      "claude-something-unreleased",
      "gpt-99-turbo-vl-vision",
      "gemini-secret-preview",
    ]) {
      const assessment = assessModelCapabilities({ presetId: "custom", modelId: modelId, endpointProvenance: "canonical_builtin_endpoint" });
      expect(assessment.classification).toBe("unknown");
      expect(assessment.vision).toEqual({ value: null, confidence: "unknown" });
      expect(assessment.text).toEqual({ value: null, confidence: "unknown" });
    }
    // Even a known preset cannot be combined with another preset's model id.
    expect(assessModelCapabilities({ presetId: "custom", modelId: "claude-opus-4.8", endpointProvenance: "canonical_builtin_endpoint" }).classification).toBe("unknown");
  });

  it("custom model identity is never trusted by its string, including the preset default", () => {
    // The custom preset's default model string does not prove an arbitrary
    // endpoint is serving the official OpenAI model.
    const assessment = assessModelCapabilities({ presetId: "custom", modelId: "gpt-5.4-mini", endpointProvenance: "canonical_builtin_endpoint" });
    expect(assessment.classification).toBe("unknown");
    expect(assessment.vision).toEqual({ value: null, confidence: "unknown" });
  });

  it("leaves reasoning/structuredOutput unknown for every model (no invented capabilities)", () => {
    for (const provider of PROVIDERS) {
      for (const modelId of provider.models) {
        const assessment = assessModelCapabilities({ presetId: provider.id, modelId: modelId, endpointProvenance: "canonical_builtin_endpoint" });
        expect(assessment.reasoning).toEqual({ value: null, confidence: "unknown" });
        expect(assessment.structuredOutput).toEqual({ value: null, confidence: "unknown" });
      }
    }
  });

  it("E2A-CAP-07 exact drift gate: every built-in model classified, no stale entries", () => {
    const audit = auditBuiltinModelClassification();
    expect(audit.unclassified).toEqual([]);
    expect(audit.stale).toEqual([]);
    for (const provider of PROVIDERS) {
      for (const modelId of provider.models) {
        const assessment = assessModelCapabilities({ presetId: provider.id, modelId: modelId, endpointProvenance: "canonical_builtin_endpoint" });
        expect(
          assessment.classification === "known" || assessment.classification === "unknown",
          `${provider.id}::${modelId} must be explicitly classified`,
        ).toBe(true);
        if (assessment.classification === "known") {
          expect(assessment.vision.value, `${provider.id}::${modelId} vision must be decided`).not.toBeNull();
          expect(assessment.vision.confidence).not.toBe("unknown");
        }
      }
    }
  });
});
