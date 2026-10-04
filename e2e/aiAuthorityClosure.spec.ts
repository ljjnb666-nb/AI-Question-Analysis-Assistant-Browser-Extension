import { expect, test } from "@playwright/test";
import { closeExtensionContext, launchExtensionContext, resolveExtensionId } from "./helpers/extensionHarness";
import type { AIConnectionResponse } from "../src/shared/types/aiConnectionMessages";
declare const chrome: {
  runtime: { sendMessage: (message: unknown) => Promise<AIConnectionResponse> };
  storage: { local: { get: (keys: string[] | null) => Promise<Record<string, unknown>>; set: (values: Record<string, unknown>) => Promise<void> } };
};

test("E2B2B real extension cleans migration input and restricts AI mutation to sidepanel", async () => {
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const worker = context.serviceWorkers()[0];
    // Await the onInstalled owner commit before injecting pre-migration raw storage.
    await expect.poll(async () => {
      const raw = await worker.evaluate(() => chrome.storage.local.get(["appSettings"]));
      return (raw.appSettings as { deviceId?: string } | undefined)?.deviceId;
    }).toBeTruthy();
    const secret = ["closure", "browser", "fixture"].join("-");
    await worker.evaluate(async secret => chrome.storage.local.set({ appSettings: {
      language: "en", deviceId: "closure-device", enableAnalytics: false, analyticsConsentVersion: 1,
      providerId: "openai", apiKey: secret, apiModel: "gpt-5.5", customBaseUrl: "", customProviderProtocol: "openai",
    } }), secret);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    const initialized = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "AI_CONNECTION_ENSURE_INITIALIZED" }));
    expect(initialized.ok).toBe(true);
    const snapshot = await popup.evaluate(() => chrome.storage.local.get(["appSettings", "aiConnectionState"]));
    for (const key of ["providerId", "apiKey", "apiModel", "customBaseUrl", "customProviderProtocol"]) expect(snapshot.appSettings).not.toHaveProperty(key);
    expect(snapshot.appSettings).toMatchObject({ language: "en", deviceId: "closure-device" });
    expect(JSON.stringify(snapshot)).not.toContain(secret);
    expect(JSON.stringify(snapshot.aiConnectionState)).toContain("qse:v1:");
    const before = JSON.stringify(snapshot.aiConnectionState);
    const forbidden = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "AI_CONNECTION_UPDATE_ACTIVE", patch: { credential: { action: "REPLACE", value: "forbidden-fixture" } } }));
    expect(forbidden).toEqual({ ok: false, code: "AI_CONNECTION_SENDER_FORBIDDEN" });
    expect(JSON.stringify((await popup.evaluate(() => chrome.storage.local.get(["aiConnectionState"]))).aiConnectionState)).toBe(before);
    const editor = await context.newPage();
    await editor.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
    const projection = await editor.evaluate(() => chrome.runtime.sendMessage({ type: "AI_CONNECTION_GET_EDITOR_VIEW" }));
    expect(projection).toMatchObject({ ok: true, editorView: { presetId: "openai", selectedModelId: "gpt-5.5", hasCredential: true } });
    if (!projection.ok) throw new Error("editor unavailable");
    for (const key of ["credentialRef", "encryptedValue", "apiKey"]) expect(projection.editorView).not.toHaveProperty(key);
    expect(await editor.evaluate(() => chrome.runtime.sendMessage({ type: "AI_CONNECTION_UPDATE_ACTIVE", patch: { selectedModelId: "gpt-5.4", credential: { action: "KEEP" } } }))).toMatchObject({ ok: true });
    expect(await editor.evaluate(() => chrome.runtime.sendMessage({ type: "AI_CONNECTION_GET_EDITOR_VIEW" }))).toMatchObject({ ok: true, editorView: { selectedModelId: "gpt-5.4", hasCredential: true } });
  } finally { await closeExtensionContext(context); }
});
