import type { Page } from "@playwright/test";
import type { LegacyAISettingsPatch, AIConnectionResponse } from "../../src/shared/types/aiConnectionMessages";
declare const chrome: { runtime: { sendMessage: (message: unknown) => Promise<AIConnectionResponse> } };

/** Configure AI through the real background writer, after Popup initialization. */
export async function seedAIConnection(page: Page, settings: LegacyAISettingsPatch): Promise<void> {
  const response = await page.evaluate(async (patch) => {
    return await chrome.runtime.sendMessage({ type: "AI_CONNECTION_APPLY_LEGACY_SETTINGS", settings: patch }) as AIConnectionResponse;
  }, settings);
  if (!response?.ok) throw new Error(`AI fixture configuration failed: ${response?.code ?? "NO_RESPONSE"}`);
}
