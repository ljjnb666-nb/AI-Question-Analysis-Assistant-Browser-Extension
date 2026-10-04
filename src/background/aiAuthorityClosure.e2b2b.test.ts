import type * as AppSettingsAuthority from "./appSettingsAuthority";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage, dumpStoreJson } from "../test/memoryStorage";
import type { AppSettings } from "../shared/types/settings";
import { DEFAULT_SETTINGS } from "../shared/types/settings";
import { __resetStorageCacheForTests, loadSettings, saveSettings } from "../shared/utils/storage";
import type { AIConnectionResponse } from "../shared/types/aiConnectionMessages";

const legacyKeys = ["providerId", "apiKey", "apiModel", "customBaseUrl", "customProviderProtocol"];
const secret = ["closure", "test", "secret"].join("-");
const own = (path = "sidepanel/sidepanel.html") => ({ id: chrome.runtime.id, url: chrome.runtime.getURL(path) });
let memory: ReturnType<typeof installMemoryStorage>;
let handle: (message: unknown, sender: chrome.runtime.MessageSender) => Promise<AIConnectionResponse>;
let cleanup: () => Promise<void>;
let ordinary: typeof AppSettingsAuthority.handleAppSettingsCommand;
const ensure = () => handle({ type: "AI_CONNECTION_ENSURE_INITIALIZED" }, own());
const view = () => handle({ type: "AI_CONNECTION_GET_EDITOR_VIEW" }, own());
const update = (patch: unknown, sender: chrome.runtime.MessageSender = own()) => handle({ type: "AI_CONNECTION_UPDATE_ACTIVE", patch }, sender);
const raw = () => memory.store.get("appSettings") as Record<string, unknown>;
const state = () => memory.store.get("aiConnectionState");
function legacy() {
  return { ...DEFAULT_SETTINGS, language: "zh", deviceId: "stable-device", analyticsConsentVersion: 1,
    enableAnalytics: true, authToken: "opaque-account", userId: "user", userEmail: "mail@example.test",
    providerId: "custom", apiKey: secret, apiModel: "fixture-model", customBaseUrl: "https://custom.example", customProviderProtocol: "anthropic", unknownRecovery: { retained: true } };
}
function absent() { for (const key of legacyKeys) expect(raw()).not.toHaveProperty(key); }
beforeEach(async () => {
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); __resetStorageCacheForTests();
  memory = installMemoryStorage(); memory.store.set("appSettings", legacy());
  handle = (await import("./aiConnectionAuthority")).handleAIConnectionCommand;
  ({ cleanupLegacyAISettingsAfterAuthority: cleanup, handleAppSettingsCommand: ordinary } = await import("./appSettingsAuthority"));
});

describe("E2B2B domain and editor", () => {
  it("static ordinary type/defaults contain none of the five AI fields", () => {
    const ordinaryKeysExcludeAI: Extract<keyof AppSettings, "providerId" | "apiKey" | "apiModel" | "customBaseUrl" | "customProviderProtocol"> extends never ? true : false = true;
    expect(ordinaryKeysExcludeAI).toBe(true);
    const text = readFileSync(resolve("src/shared/types/settings.ts"), "utf8");
    for (const key of legacyKeys) { expect(text).not.toMatch(new RegExp(`\\b${key}\\b`)); expect(DEFAULT_SETTINGS).not.toHaveProperty(key); }
  });
  it("ordinary load explicitly excludes all raw AI properties without reading AI state", async () => {
    memory.store.set("aiConnectionState", { malformed: true });
    const loaded = await loadSettings();
    expect(loaded.language).toBe("zh");
    for (const key of legacyKeys) expect(loaded).not.toHaveProperty(key);
    expect(memory.get.mock.calls.flatMap(([key]) => [key])).not.toContain("aiConnectionState");
  });
  it("saveSettings filters runtime injection and sends only ordinary update", async () => {
    expect((await ensure()).ok).toBe(true);
    const before = JSON.stringify(state());
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(message => ordinary(message, own()));
    const injected = { language: "en" as const, providerId: "openai", apiKey: "attacker", apiModel: "wrong" };
    await saveSettings(injected);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "APP_SETTINGS_UPDATE", patch: { language: "en" } });
    expect(JSON.stringify(state())).toBe(before); absent();
  });
  it("editor exposes current connection and presence only", async () => {
    const response = await view();
    expect(response).toMatchObject({ ok: true, editorView: { presetId: "custom", selectedModelId: "fixture-model", endpointOverride: "https://custom.example", protocol: "anthropic_messages", hasCredential: true } });
    if (!response.ok) throw new Error();
    expect(Object.keys(response.editorView!).sort()).toEqual(["endpointOverride", "hasCredential", "presetId", "protocol", "selectedModelId"]);
    for (const forbidden of [secret, "encryptedValue", "credentialRef", "qse:"]) expect(JSON.stringify(response)).not.toContain(forbidden);
  });
  it.each(["authScheme", "providerId", "apiModel", "customBaseUrl", "customProviderProtocol"])("modern command rejects %s", async key => {
    expect(await update({ [key]: "injected", credential: { action: "KEEP" } })).toEqual({ ok: false, code: "AI_CONNECTION_PAYLOAD_INVALID" });
    expect(state()).toBeUndefined();
  });
  it("rejects an unknown old command with no state work", async () => {
    const retired = ["AI_CONNECTION", "APPLY", "LEGACY_SETTINGS"].join("_");
    expect(await handle({ type: retired }, own())).toEqual({ ok: false, code: "AI_CONNECTION_COMMAND_UNKNOWN" });
    expect(state()).toBeUndefined();
  });
});

describe("E2B2B migration closure", () => {
  it("MIGRATE-01 migrates then deletes only legacy keys and leaves encrypted secret only", async () => {
    const before = legacy();
    expect(await ensure()).toMatchObject({ ok: true, migrated: true }); absent();
    for (const [key, value] of Object.entries(before)) if (!legacyKeys.includes(key)) expect(raw()[key]).toEqual(value);
    const stored = state() as { credentials: Record<string, { encryptedValue: string }> };
    expect(Object.values(stored.credentials)).toHaveLength(1);
    expect(Object.values(stored.credentials)[0].encryptedValue).toMatch(/^qse:v1:/);
    expect(dumpStoreJson(memory.store)).not.toContain(secret);
  });
  it("MIGRATE-02 existing valid state wins and stale values are deleted", async () => {
    await ensure(); const before = JSON.stringify(state());
    memory.store.set("appSettings", { ...legacy(), providerId: "openai", apiKey: "qse:v9:stale" });
    vi.resetModules(); handle = (await import("./aiConnectionAuthority")).handleAIConnectionCommand;
    expect(await ensure()).toMatchObject({ ok: true, migrated: false }); absent(); expect(JSON.stringify(state())).toBe(before);
  });
  it("MIGRATE-03 undecodable credential keeps raw recovery material exactly", async () => {
    memory.store.set("appSettings", { ...legacy(), apiKey: "qse:v9:unknown" }); const before = JSON.stringify(raw());
    expect(await ensure()).toEqual({ ok: false, code: "LEGACY_CREDENTIAL_UNDECODABLE" });
    expect(state()).toBeUndefined(); expect(JSON.stringify(raw())).toBe(before);
  });
  it("MIGRATE-03 encryption failure keeps raw recovery material exactly", async () => {
    const encrypt = await import("../shared/utils/encryption");
    vi.spyOn(encrypt, "encryptValue").mockRejectedValueOnce(new Error("failure"));
    const before = JSON.stringify(raw());
    expect(await ensure()).toEqual({ ok: false, code: "LEGACY_CREDENTIAL_ENCRYPTION_FAILED" });
    expect(state()).toBeUndefined(); expect(JSON.stringify(raw())).toBe(before);
  });
  it("MIGRATE-04 malformed state prevents migration and cleanup", async () => {
    memory.store.set("aiConnectionState", { schemaVersion: 1 }); const before = dumpStoreJson(memory.store);
    expect(await ensure()).toEqual({ ok: false, code: "AI_CONNECTION_STATE_MALFORMED" });
    expect(dumpStoreJson(memory.store)).toBe(before); expect(memory.set).not.toHaveBeenCalled();
  });
  it("MIGRATE-05 cleanup write failure retries without duplicate import", async () => {
    const persist = memory.set.getMockImplementation() as (items: Record<string, unknown>) => Promise<void>; let fail = true;
    memory.set.mockImplementation(async items => { if (items.appSettings && fail) { fail = false; throw new Error(secret); } await persist(items); });
    const before = JSON.stringify(raw());
    expect(await ensure()).toEqual({ ok: false, code: "AI_LEGACY_SETTINGS_CLEANUP_FAILED" });
    expect(JSON.stringify(raw())).toBe(before); const committed = JSON.stringify(state());
    expect(await ensure()).toMatchObject({ ok: true, migrated: false }); absent(); expect(JSON.stringify(state())).toBe(committed);
    expect(memory.set.mock.calls.filter(([item]) => item.aiConnectionState)).toHaveLength(1);
  });
  it("MIGRATE-06 restart after closure performs no writes", async () => {
    await ensure(); const before = dumpStoreJson(memory.store); memory.set.mockClear();
    vi.resetModules(); handle = (await import("./aiConnectionAuthority")).handleAIConnectionCommand;
    expect(await ensure()).toMatchObject({ ok: true, migrated: false }); absent();
    expect(dumpStoreJson(memory.store)).toBe(before); expect(memory.set).not.toHaveBeenCalled();
  });
  it.each([true, false])("real single writer queue preserves ordinary language update (cleanup first=%s)", async first => {
    const tasks = [() => cleanup(), () => ordinary({ type: "APP_SETTINGS_UPDATE", patch: { language: "en" } }, own())];
    if (!first) tasks.reverse(); await Promise.all(tasks.map(run => run()));
    expect(raw().language).toBe("en"); absent();
  });
});

describe("E2B2B sender authorization", () => {
  it("AI-SENDER-01 sidepanel in a tab is allowed", async () => {
    expect(await update({ credential: { action: "KEEP" } }, { ...own(), tab: { id: 1 } as chrome.tabs.Tab })).toMatchObject({ ok: true });
  });
  it.each([
    ["content", { id: chrome.runtime.id, url: "https://example.test", tab: { id: 1 } as chrome.tabs.Tab }],
    ["popup", own("popup/popup.html")],
    ["different extension", { id: "other", url: chrome.runtime.getURL("sidepanel/sidepanel.html") }],
    ["missing URL", { id: chrome.runtime.id }],
    ["spoof URL", { id: chrome.runtime.id, url: "https://example.test/sidepanel/sidepanel.html" }],
    ["wrong extension URL", { id: chrome.runtime.id, url: "chrome-extension://other/sidepanel/sidepanel.html" }],
    ["path suffix", own("sidepanel/sidepanel.html/evil")],
  ])("AI-SENDER forbidden %s performs no encryption/read/write", async (_label, sender) => {
    const encrypt = await import("../shared/utils/encryption"); const spy = vi.spyOn(encrypt, "encryptValue");
    expect(await update({ credential: { action: "REPLACE", value: secret } }, sender)).toEqual({ ok: false, code: "AI_CONNECTION_SENDER_FORBIDDEN" });
    expect(spy).not.toHaveBeenCalled(); expect(memory.get).not.toHaveBeenCalled(); expect(memory.set).not.toHaveBeenCalled();
  });
  it.each(["AI_CONNECTION_ENSURE_INITIALIZED", "AI_CONNECTION_GET_ACTIVE_METADATA"])("internal content %s remains allowed", async type => {
    expect(await handle({ type }, { id: chrome.runtime.id, url: "https://content.example", tab: { id: 1 } as chrome.tabs.Tab })).toMatchObject({ ok: true });
  });
  it.each(["AI_CONNECTION_ENSURE_INITIALIZED", "AI_CONNECTION_GET_ACTIVE_METADATA", "AI_CONNECTION_GET_EDITOR_VIEW"])("external extension %s rejected", async type => {
    expect(await handle({ type }, { id: "other" })).toEqual({ ok: false, code: "AI_CONNECTION_SENDER_FORBIDDEN" });
    expect(memory.get).not.toHaveBeenCalled();
  });
});

it("production UI/content cannot import low-level AI writers or parser configuration facade", () => {
  for (const area of ["sidepanel", "popup", "content"]) {
    for (const name of readdirSync(resolve("src", area), { recursive: true }).map(String).filter(name => /\.tsx?$/.test(name) && !name.includes(".test"))) {
      const source = readFileSync(resolve("src", area, name), "utf8");
      expect(source).not.toMatch(/import[^;]*\b(persistAIConnectionState|updateAIConnectionState|replaceCredential|clearCredential|loadAIConnectionState)\b[^;]*from/s);
      expect(source).not.toMatch(/import[^;]*\b(getProvider|PROVIDERS|ProviderConfig|ProviderId|getProviderNotConfiguredMessage)\b[^;]*from ["'][^"']*parseRouter/s);
    }
  }
  const parser = readFileSync(resolve("src/shared/utils/parseRouter.ts"), "utf8");
  expect(parser).not.toMatch(/isLikelyTextOnlyModel|isProviderRuntimeConfigured|\bPROVIDERS\b|\bProviderConfig\b|\bProviderId\b/);
  expect(readFileSync(resolve("src/shared/utils/storage.ts"), "utf8")).not.toMatch(/AI_SETTINGS_KEYS|withoutAISettings|aiConnectionState|aiConnectionClient/);
});
