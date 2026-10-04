import { vi } from "vitest";
import type { AppSettings, QuestionBlock } from "../shared/types";
import type { ProviderPresetId } from "../shared/types/connection";
import { resolvePresetAuthScheme, resolvePresetDefaultModel } from "../shared/utils/aiConnectionPresets";
import { persistAIConnectionState } from "../shared/utils/aiConnectionState";
import { encryptValue } from "../shared/utils/encryption";
import { parseQuestion, parseQuestionPackage } from "../shared/utils/parseRouter";

export type AIConnectionScenarioFixture = AppSettings & { providerId?: ProviderPresetId; apiKey?: string; apiModel?: string; customBaseUrl?: string; customProviderProtocol?: "openai" | "anthropic" };

/** Old scenario inputs now configure actual connection authority before solving. */
export async function seedAIConnectionFixture(settings: AIConnectionScenarioFixture) {
  const presetId = settings.providerId ?? "anthropic";
  const protocolOverride = presetId === "custom" ? settings.customProviderProtocol === "anthropic" ? "anthropic_messages" : "openai_chat_completions" : undefined;
  await persistAIConnectionState({
    schemaVersion: 1, revision: 1, activeConnectionId: "test", connections: {
      test: {
        id: "test", name: "fixture", presetId, protocolOverride, endpointOverride: settings.customBaseUrl,
        selectedModelId: settings.apiModel || resolvePresetDefaultModel(presetId), authScheme: resolvePresetAuthScheme(presetId, protocolOverride),
        credentialRef: settings.apiKey ? "credential" : undefined, connectionRevision: 1,
        validation: { status: "never_tested", generation: 0 }, createdAt: 1, updatedAt: 1,
      },
    }, credentials: settings.apiKey ? {
      credential: { ref: "credential", type: "api_key", encryptedValue: await encryptValue(settings.apiKey), revision: 1, updatedAt: 1 },
    } : {},
  });
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true } as never);
}

export async function parseConfiguredQuestion(block: QuestionBlock, settings: AIConnectionScenarioFixture, ...rest: Parameters<typeof parseQuestion> extends [unknown, unknown, ...infer R] ? R : never) {
  await seedAIConnectionFixture(settings);
  return parseQuestion(block, { preferredRoute: settings.preferredRoute, language: settings.language }, ...rest);
}
export async function parseConfiguredQuestionPackage(pkg: Parameters<typeof parseQuestionPackage>[0], block: QuestionBlock, settings: AIConnectionScenarioFixture, ...rest: Parameters<typeof parseQuestionPackage> extends [unknown, unknown, unknown, ...infer R] ? R : never) {
  await seedAIConnectionFixture(settings);
  return parseQuestionPackage(pkg, block, { preferredRoute: settings.preferredRoute, language: settings.language }, ...rest);
}
