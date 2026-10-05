import type { ProviderPresetId } from "../types/connection";
import { resolvePresetAuthScheme, resolvePresetDefaultModel, resolvePresetEndpoint, resolvePresetProtocol } from "../utils/aiConnectionPresets";
import { assessModelCapabilities } from "./modelCapabilityCatalog";
import { resolveTransportMediaCapabilities } from "./transportMediaCapabilities";
import type { ProviderRequestContext } from "./runtimeRequest";

export function requestContextFixture(presetId: ProviderPresetId, credential: string | null): ProviderRequestContext {
  const protocol = resolvePresetProtocol(presetId);
  const endpointProvenance = presetId === "custom" ? "custom_endpoint" : "canonical_builtin_endpoint";
  const selectedModelId = resolvePresetDefaultModel(presetId);
  return {
    runtime: {
      connectionId: "fixture-connection", connectionRevision: 1, presetId, protocol,
      endpoint: resolvePresetEndpoint(presetId), endpointProvenance,
      authScheme: resolvePresetAuthScheme(presetId), requiresCredential: presetId !== "ollama",
      selectedModelId,
      modelCapabilityAssessment: assessModelCapabilities({ presetId, modelId: selectedModelId, endpointProvenance }),
      transportCapabilities: resolveTransportMediaCapabilities({ presetId, protocol, endpointProvenance }),
    },
    credential, language: "en", beforeDispatch: async () => {},
  };
}
