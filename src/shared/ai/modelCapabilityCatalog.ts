/**
 * UI05R-E2A — Static V1 model capability catalog.
 *
 * Explicit classification for every CURRENTLY shipped built-in model ID
 * (`PROVIDERS[].models` in `providers.ts`). This is the future model
 * capability authority; `ProviderConfig.supportsVision` and the
 * `isLikelyTextOnlyModel` regex remain the production authority until the E2B
 * cutover and are used here ONLY as a clearly labeled `legacy_declared`
 * evidence source for shipped models on their canonical provider.
 *
 * Rules encoded here:
 * - Capabilities are keyed by (presetId, modelId). An arbitrary manually
 *   entered model is `unknown` — no vision inference from names like
 *   "vision"/"vl"/"gpt"/"claude"/"gemini" happens in this authority.
 * - Custom preset model IDs are ALWAYS unknown: the default model string of
 *   the custom preset does not prove an arbitrary endpoint is actually
 *   serving that official model. Custom model capability stays unknown until
 *   an explicit verified capability source exists.
 * - Unknown vision must fail closed (see `effectiveMediaCapability.ts`).
 * - `reasoning`/`structuredOutput` have insufficient repository evidence for
 *   every model and are therefore `unknown` — not invented.
 * - The drift gate (`auditBuiltinModelClassification` + `E2A-CAP-07`) forces
 *   every built-in model to be explicitly classified (known or explicitly
 *   unknown) and flags stale catalog entries with no current built-in model
 *   unless they are marked `deprecated`.
 */

import { PROVIDERS } from "./providers";
import type {
  CapabilityAssessment,
  CapabilityConfidence,
  ModelCapabilityAssessment,
  ModelClassification,
  ProviderPresetId,
  EndpointProvenance,
} from "../types/connection";

const TEXT_KNOWN: CapabilityAssessment = { value: true, confidence: "known_static" };
const UNKNOWN_CAPABILITY: CapabilityAssessment = { value: null, confidence: "unknown" };

interface CatalogEntry {
  /** Current registry vision declaration for this shipped model. */
  vision: boolean;
  /**
   * Stale-entry escape hatch: deprecated entries are kept out of the stale
   * audit but never resolve as known capability for new decisions.
   */
  deprecated?: true;
}

/**
 * Explicit per-model vision classification, mirroring the CURRENT runtime
 * decision (provider `supportsVision` declaration downgraded by the
 * `isLikelyTextOnlyModel` heuristic in parseRouter). Source:
 * `legacy_declared`. Custom preset models are deliberately absent — they are
 * explicitly unknown (see EXPLICITLY_UNKNOWN_BUILTIN_MODELS).
 */
const BUILTIN_MODEL_CATALOG: Record<string, CatalogEntry> = {
  "anthropic::claude-opus-4.8": { vision: true },
  "anthropic::claude-sonnet-4.6": { vision: true },
  "anthropic::claude-haiku-4.5": { vision: true },

  "openai::gpt-5.5": { vision: true },
  "openai::gpt-5.4": { vision: true },
  "openai::gpt-5.4-mini": { vision: true },
  "openai::gpt-5.4-nano": { vision: true },

  "deepseek::deepseek-v4-flash": { vision: false },
  "deepseek::deepseek-v4-pro": { vision: false },

  "gemini::gemini-2.5-flash": { vision: true },
  "gemini::gemini-2.5-pro": { vision: true },
  "gemini::gemini-2.5-flash-lite": { vision: true },

  "qwen::qwen3-vl-plus": { vision: true },
  "qwen::qwen3-vl-flash": { vision: true },
  "qwen::qwen3.7-max": { vision: true },
  "qwen::qwen-plus": { vision: false },
  "qwen::qwen-flash": { vision: false },

  "moonshot::kimi-k2.6": { vision: true },
  "moonshot::kimi-k2.7-code": { vision: true },
  "moonshot::kimi-k2.7-code-highspeed": { vision: true },
  "moonshot::kimi-k2.5": { vision: true },

  "zhipu::glm-5v-turbo": { vision: true },
  "zhipu::glm-5.2": { vision: false },
  "zhipu::glm-5.1": { vision: false },
  "zhipu::glm-5-turbo": { vision: false },

  "minimax::MiniMax-M3": { vision: true },
  "minimax::MiniMax-M2.7": { vision: true },
  "minimax::MiniMax-M2.7-highspeed": { vision: true },

  "ollama::qwen3-vl": { vision: true },
  "ollama::qwen3.5": { vision: true },
  "ollama::gemma4": { vision: true },
  "ollama::llama3.2-vision": { vision: true },
  "ollama::llava": { vision: true },
};

/**
 * Built-in shipped models that are EXPLICITLY classified as unknown — a
 * decision, not an omission. A custom endpoint's default model string does
 * not prove the endpoint serves the official model, so its capability stays
 * unknown until an explicit verified capability source exists.
 */
const EXPLICITLY_UNKNOWN_BUILTIN_MODELS: ReadonlySet<string> = new Set([
  "custom::gpt-5.4-mini",
]);

function catalogKey(presetId: ProviderPresetId, modelId: string): string {
  return `${presetId}::${modelId}`;
}

/**
 * Assess one model. Exact (presetId, modelId) matches on non-deprecated
 * catalog entries on canonical built-in endpoints are `known` with `legacy_declared` vision; anything else —
 * including every custom-preset model — is `unknown` and fails closed on
 * vision downstream.
 */
export function assessModelCapabilities({ presetId, modelId, endpointProvenance }: {
  presetId: ProviderPresetId;
  modelId: string;
  endpointProvenance: EndpointProvenance;
}): ModelCapabilityAssessment {
  const key = catalogKey(presetId, modelId);
  const entry = BUILTIN_MODEL_CATALOG[key];
  if (endpointProvenance !== "canonical_builtin_endpoint" || presetId === "custom" || !entry || entry.deprecated) {
    return {
      classification: "unknown" satisfies ModelClassification,
      text: UNKNOWN_CAPABILITY,
      vision: UNKNOWN_CAPABILITY,
      reasoning: UNKNOWN_CAPABILITY,
      structuredOutput: UNKNOWN_CAPABILITY,
    };
  }
  return {
    classification: "known" satisfies ModelClassification,
    text: TEXT_KNOWN,
    vision: { value: entry.vision, confidence: "legacy_declared" satisfies CapabilityConfidence },
    reasoning: UNKNOWN_CAPABILITY,
    structuredOutput: UNKNOWN_CAPABILITY,
  };
}

/** Every known-catalog (presetId, modelId) pair, for drift-gate tests. */
export function listCatalogedModelKeys(): string[] {
  return Object.keys(BUILTIN_MODEL_CATALOG);
}

/**
 * Exact drift audit. Every current built-in model must appear in exactly one
 * classification (known catalog or explicit-unknown); every catalog entry
 * must correspond to a current built-in model unless marked `deprecated`.
 */
export function auditBuiltinModelClassification(): {
  unclassified: Array<{ presetId: ProviderPresetId; modelId: string }>;
  stale: string[];
} {
  const unclassified: Array<{ presetId: ProviderPresetId; modelId: string }> = [];
  const currentKeys = new Set<string>();
  for (const provider of PROVIDERS) {
    for (const modelId of provider.models) {
      const key = catalogKey(provider.id, modelId);
      currentKeys.add(key);
      if (!(key in BUILTIN_MODEL_CATALOG) && !EXPLICITLY_UNKNOWN_BUILTIN_MODELS.has(key)) {
        unclassified.push({ presetId: provider.id, modelId });
      }
    }
  }
  const stale = [...Object.keys(BUILTIN_MODEL_CATALOG), ...EXPLICITLY_UNKNOWN_BUILTIN_MODELS]
    .filter((key) => !currentKeys.has(key) && !BUILTIN_MODEL_CATALOG[key]?.deprecated);
  return { unclassified, stale };
}
