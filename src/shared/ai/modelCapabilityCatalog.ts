/**
 * UI05R-E2A — Static V1 model capability catalog.
 *
 * Explicit classification for every CURRENTLY shipped built-in model ID
 * (`PROVIDERS[].models` in `providers.ts`). This is the future model
 * capability authority; `ProviderConfig.supportsVision` and the
 * `isLikelyTextOnlyModel` regex remain the production authority until the E2B
 * cutover and are used here ONLY as a clearly labeled `legacy_declared`
 * evidence source for the shipped IDs.
 *
 * Rules encoded here:
 * - Capabilities are keyed by (presetId, modelId). An arbitrary manually
 *   entered model (typically under `custom`) is `unknown` — no vision
 *   inference from names like "vision"/"vl"/"gpt"/"claude"/"gemini" happens in
 *   this authority.
 * - Unknown vision must fail closed (see `effectiveMediaCapability.ts`).
 * - `reasoning`/`structuredOutput` have insufficient repository evidence for
 *   every shipped model and are therefore `unknown` — not invented.
 * - The drift gate test (`E2A-CAP-07`) forces every new built-in model to
 *   receive an explicit catalog decision.
 */

import { PROVIDERS } from "./providers";
import type {
  CapabilityAssessment,
  CapabilityConfidence,
  ModelCapabilityAssessment,
  ModelClassification,
  ProviderPresetId,
} from "../types/connection";

const TEXT_KNOWN: CapabilityAssessment = { value: true, confidence: "known_static" };
const UNKNOWN_CAPABILITY: CapabilityAssessment = { value: null, confidence: "unknown" };

interface CatalogEntry {
  /** Current registry vision declaration for this shipped model. */
  vision: boolean;
}

/**
 * Explicit per-model vision classification, mirroring the CURRENT runtime
 * decision (provider `supportsVision` declaration downgraded by the
 * `isLikelyTextOnlyModel` heuristic in parseRouter). Source:
 * `legacy_declared`.
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

  "custom::gpt-5.4-mini": { vision: true },
};

function catalogKey(presetId: ProviderPresetId, modelId: string): string {
  return `${presetId}::${modelId}`;
}

/**
 * Assess one model. Exact (presetId, modelId) matches are `known` with
 * `legacy_declared` vision; anything else is `unknown` and fails closed on
 * vision downstream.
 */
export function assessModelCapabilities(
  presetId: ProviderPresetId,
  modelId: string,
): ModelCapabilityAssessment {
  const entry = BUILTIN_MODEL_CATALOG[catalogKey(presetId, modelId)];
  if (!entry) {
    return {
      classification: "unknown",
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

/** Every explicitly cataloged (presetId, modelId) pair, for drift-gate tests. */
export function listCatalogedModelKeys(): string[] {
  return Object.keys(BUILTIN_MODEL_CATALOG);
}

/**
 * Drift gate helper: every model currently shipped in PROVIDERS[].models must
 * have an explicit catalog entry. A missing entry means a developer added a
 * provider model without a capability decision — the drift test fails and
 * forces one.
 */
export function findUnclassifiedBuiltinModels(): Array<{ presetId: ProviderPresetId; modelId: string }> {
  const missing: Array<{ presetId: ProviderPresetId; modelId: string }> = [];
  for (const provider of PROVIDERS) {
    for (const modelId of provider.models) {
      if (!(catalogKey(provider.id, modelId) in BUILTIN_MODEL_CATALOG)) {
        missing.push({ presetId: provider.id, modelId });
      }
    }
  }
  return missing;
}
