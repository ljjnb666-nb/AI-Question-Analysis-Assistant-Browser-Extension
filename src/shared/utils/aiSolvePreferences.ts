import { ensureAIConnectionAuthorityReady } from "./aiConnectionClient";
import { resolveActiveAIConnectionRuntimeMetadata } from "./aiRuntimeResolver";
import { validateRuntimeAuth, validateRuntimeEndpoint } from "../ai/runtimeRequest";
import type { ParsePreferences } from "../ai/runtimeRequest";
import { loadSettings } from "./storage";

export async function loadParsePreferences(): Promise<ParsePreferences> {
  await ensureAIConnectionAuthorityReady();
  const settings = await loadSettings();
  return { preferredRoute: settings.preferredRoute, language: settings.language };
}

/** Capture hint only; parseRouter independently enforces the final runtime authority. */
export async function getRuntimeCaptureInfo() {
  await ensureAIConnectionAuthorityReady();
  const runtime = await resolveActiveAIConnectionRuntimeMetadata();
  return {
    name: runtime.presetId, baseUrl: runtime.endpoint,
    supportsVision: runtime.modelCapabilityAssessment.vision.value === true && runtime.transportCapabilities.inlineBase64.value === true,
  };
}

export async function getAIConnectionReadiness(): Promise<{ ready: true } | { ready: false; code: string }> {
  try {
    await ensureAIConnectionAuthorityReady();
    const runtime = await resolveActiveAIConnectionRuntimeMetadata();
    validateRuntimeEndpoint(runtime.endpoint);
    validateRuntimeAuth(runtime);
    return { ready: true };
  } catch (error) {
    return { ready: false, code: error && typeof error === "object" && "code" in error ? String(error.code) : "AI_CONNECTION_AUTHORITY_UNAVAILABLE" };
  }
}
