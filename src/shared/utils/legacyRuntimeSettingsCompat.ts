/** Temporary E2B1 adapter. Never cache/persist its returned request-scoped plaintext. */
import { ensureAIConnectionAuthorityReady } from "./aiConnectionClient";
import {
  resolveActiveAIConnectionRuntimeMetadata,
  resolveRuntimeCredential,
  AIRuntimeResolutionError,
} from "./aiRuntimeResolver";
import { loadSettings } from "./storage";
import type { AppSettings } from "../types";
import type { AIConnectionRuntimeConfig } from "../types/connection";
import { resolvePresetAuthScheme } from "./aiConnectionPresets";

class RuntimeCompatibilityError extends Error {
  readonly code = "AI_RUNTIME_COMPATIBILITY_UNSUPPORTED";
  constructor() {
    super("AI_RUNTIME_COMPATIBILITY_UNSUPPORTED");
  }
}
function assertLegacyRepresentable(config: AIConnectionRuntimeConfig): void {
  // The unchanged Gemini client ignores customBaseUrl and uses its preset URL.
  if (config.presetId === "gemini" && config.endpointProvenance !== "canonical_builtin_endpoint") {
    throw new RuntimeCompatibilityError();
  }
  // V1 can express more custom auth/protocol combinations than the unchanged
  // legacy clients. Reject those rather than silently changing their meaning.
  const expected = resolvePresetAuthScheme("custom", config.protocol);
  const actual = config.authScheme;
  const authMatches = actual.kind === expected.kind
    && (expected.kind !== "header" || (actual.kind === "header" && actual.headerName === expected.headerName));
  if (
    config.presetId === "custom" &&
    (config.protocol === "gemini_generate_content" ||
      !authMatches)
  ) {
    throw new RuntimeCompatibilityError();
  }
}

export async function getAIConnectionReadiness(): Promise<
  { ready: true } | { ready: false; code: string }
> {
  try {
    await ensureAIConnectionAuthorityReady();
    assertLegacyRepresentable(await resolveActiveAIConnectionRuntimeMetadata());
    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      code:
        error instanceof AIRuntimeResolutionError ||
        error instanceof RuntimeCompatibilityError
          ? error.code
          : "AI_CONNECTION_AUTHORITY_UNAVAILABLE",
    };
  }
}
export async function loadLegacyRuntimeSettingsCompat(): Promise<AppSettings> {
  await ensureAIConnectionAuthorityReady();
  const settings = await loadSettings();
  const config = await resolveActiveAIConnectionRuntimeMetadata();
  assertLegacyRepresentable(config);
  const apiKey = await resolveRuntimeCredential(config);
  return {
    ...settings,
    providerId: config.presetId,
    apiModel: config.selectedModelId,
    apiKey: apiKey ?? "",
    customBaseUrl:
      config.endpointProvenance === "canonical_builtin_endpoint"
        ? undefined
        : config.endpoint,
    customProviderProtocol:
      config.presetId === "custom" && config.protocol === "anthropic_messages"
        ? ("anthropic" as const)
        : ("openai" as const),
  };
}
