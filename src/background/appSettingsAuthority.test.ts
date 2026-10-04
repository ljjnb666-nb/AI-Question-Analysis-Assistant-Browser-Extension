import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { installMemoryStorage, type MemoryStorageHandle } from "../test/memoryStorage";
import { handleAppSettingsCommand, getOrCreateAppSettingsDeviceId } from "./appSettingsAuthority";
import { __resetStorageCacheForTests, loadSettings, saveSettings, getOrCreateDeviceId } from "../shared/utils/storage";
import { decryptValue } from "../shared/utils/encryption";
import * as encryption from "../shared/utils/encryption";
import { getErrorLogs } from "../shared/utils/errorLogger";
import { getSessionLog } from "../shared/utils/analytics";
import type { AppSettingsUpdatePatch } from "../shared/types/appSettingsMessages";

const ui = () => ({ id: chrome.runtime.id, url: chrome.runtime.getURL("sidepanel/sidepanel.html") });
const content = () => ({ id: chrome.runtime.id, url: "https://course.example/question", tab: { id: 1 } as chrome.tabs.Tab });
const normalized = { language: "zh", preferredRoute: "auto", enableAnalytics: false, analyticsConsentVersion: 1, deviceId: "device-existing", analyticsBaseUrl: "https://analytics.example" };
let memory: MemoryStorageHandle;
beforeEach(() => {
  vi.clearAllMocks(); __resetStorageCacheForTests(); memory = installMemoryStorage();
  memory.store.set("appSettings", { ...normalized });
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(message => handleAppSettingsCommand(message, ui()) as never);
});
afterEach(() => vi.restoreAllMocks());
const update = (patch: AppSettingsUpdatePatch) => handleAppSettingsCommand({ type: "APP_SETTINGS_UPDATE", patch }, ui());

it("SW-01 acknowledged mutation persists only its patch and preserves legacy recovery fields and AI state", async () => {
  const legacy = { providerId: "openai", apiKey: ["legacy", "recovery"].join("-"), apiModel: "old", customBaseUrl: "https://legacy.example", customProviderProtocol: "openai" };
  memory.store.set("appSettings", { ...normalized, ...legacy });
  memory.store.set("aiConnectionState", { sentinel: "unchanged" });
  expect(await update({ language: "en" })).toMatchObject({ ok: true });
  expect(memory.store.get("appSettings")).toMatchObject({ ...legacy, language: "en", preferredRoute: "auto" });
  expect(memory.store.get("aiConnectionState")).toEqual({ sentinel: "unchanged" });
});

it("SW-02 real queue preserves concurrent updates of different fields across client module instances", async () => {
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const original = memory.set.getMockImplementation() as (items: Record<string, unknown>) => Promise<void>;
  memory.set.mockImplementationOnce(async items => { entered(); await gate; await original(items); });
  const a = saveSettings({ language: "en" }); await started;
  vi.resetModules(); const contextB = await import("../shared/utils/storage");
  const b = contextB.saveSettings({ preferredRoute: "vision" });
  await Promise.resolve(); expect(memory.get.mock.calls.filter(([key]) => key === "appSettings")).toHaveLength(1);
  release(); await Promise.all([a, b]);
  expect(memory.store.get("appSettings")).toMatchObject({ language: "en", preferredRoute: "vision" });
});

it("SW-03 many interleaved real owner patches apply serially without unrelated-field loss", async () => {
  const writes: Record<string, unknown>[] = [];
  const original = memory.set.getMockImplementation() as (items: Record<string, unknown>) => Promise<void>;
  memory.set.mockImplementation(async items => { writes.push(items.appSettings); await original(items); });
  const patches: AppSettingsUpdatePatch[] = Array.from({ length: 30 }, (_, n) => ({ userId: `user-${n}` }));
  patches.splice(10, 0, { language: "en" }); patches.splice(20, 0, { preferredRoute: "vision" });
  const responses = await Promise.all(patches.map(update));
  expect(responses.every(r => r.ok)).toBe(true);
  expect(writes.map(s => s.userId).filter((_, n, all) => n === 0 || all[n] !== all[n - 1])).toEqual(Array.from({ length: 30 }, (_, n) => `user-${n}`));
  expect(memory.store.get("appSettings")).toMatchObject({ userId: "user-29", language: "en", preferredRoute: "vision", analyticsConsentVersion: 1 });
});

it("SW-04 failed write returns a safe code and the next queued mutation succeeds", async () => {
  memory.set.mockRejectedValueOnce(new Error("synthetic storage failure"));
  const [a, b] = await Promise.all([update({ language: "en" }), update({ preferredRoute: "vision" })]);
  expect(a).toEqual({ ok: false, code: "APP_SETTINGS_WRITE_FAILED" }); expect(b.ok).toBe(true);
  expect(memory.store.get("appSettings")).toMatchObject({ language: "zh", preferredRoute: "vision" });
});

it("SW-05 ten concurrent device callers and a restarted owner receive one persisted ID", async () => {
  memory.store.delete("appSettings");
  const ids = await Promise.all(Array.from({ length: 10 }, () => getOrCreateDeviceId()));
  expect(new Set(ids).size).toBe(1); expect(ids[0]).toBeTruthy();
  expect(memory.set.mock.calls.filter(([items]) => items.appSettings)).toHaveLength(1);
  vi.resetModules(); const restarted = await import("./appSettingsAuthority");
  expect(await restarted.getOrCreateAppSettingsDeviceId()).toBe(ids[0]);
  expect(memory.store.get("appSettings")).toHaveProperty("deviceId", ids[0]);
});

it("SW-06/08 normalization executes in owner and preserves a queued language update", async () => {
  memory.store.set("appSettings", { language: "zh", enableAnalytics: true });
  memory.store.set("analyticsLog", [{ event: "old" }]);
  const [ack] = await Promise.all([
    handleAppSettingsCommand({ type: "APP_SETTINGS_ENSURE_NORMALIZED" }, content()), update({ language: "en" }),
  ]);
  expect(ack.ok).toBe(true); expect(await loadSettings()).toMatchObject({ language: "en", enableAnalytics: false, analyticsConsentVersion: 1 });
  expect(memory.store.get("analyticsLog")).toBeUndefined();
});

it("SW-07/08 client update, normalization and device paths issue RPC and cannot directly write", async () => {
  const sender = vi.mocked(chrome.runtime.sendMessage);
  sender.mockResolvedValue({ ok: true, deviceId: "ack-device", analyticsDisabled: false });
  memory.store.set("appSettings", { ...normalized, deviceId: "" });
  await loadSettings(); await saveSettings({ language: "en" }); await getOrCreateDeviceId();
  expect(memory.set).not.toHaveBeenCalled();
  expect(sender.mock.calls.map(([message]) => (message as unknown as { type: string }).type)).toEqual([
    "APP_SETTINGS_ENSURE_NORMALIZED", "APP_SETTINGS_UPDATE", "APP_SETTINGS_GET_OR_CREATE_DEVICE_ID",
  ]);
});

it.each([
  ["sidepanel/sidepanel.html", false], ["popup/popup.html", false],
  ["sidepanel/sidepanel.html", true], ["popup/popup.html", true],
] as const)("SETTINGS-WRITER-SENDER allowed %s update (tab=%s)", async (path, inTab) => {
  const result = await handleAppSettingsCommand({ type: "APP_SETTINGS_UPDATE", patch: { language: "en" } }, { id: chrome.runtime.id, url: chrome.runtime.getURL(path), ...(inTab ? { tab: { id: 7 } as chrome.tabs.Tab } : {}) });
  expect(result.ok).toBe(true); expect(memory.store.get("appSettings")).toHaveProperty("language", "en");
});

it.each([
  () => content(),
  () => ({ ...ui(), id: "different-extension" }),
  () => ({ ...ui(), url: undefined }),
  () => ({ ...ui(), url: "not a URL" }),
  () => ({ ...ui(), url: chrome.runtime.getURL("background/background.html") }),
  () => ({ ...ui(), url: `https://example.com/chrome-extension://${chrome.runtime.id}/sidepanel/sidepanel.html` }),
  () => ({ ...ui(), url: `chrome-extension://${chrome.runtime.id}.evil/sidepanel/sidepanel.html` }),
])("SW-09 sender rejection precedes storage and credential encryption", async sender => {
  const encrypt = vi.spyOn(encryption, "encryptValue");
  expect(await handleAppSettingsCommand({ type: "APP_SETTINGS_UPDATE", patch: { authToken: "synthetic-token" } }, sender())).toEqual({ ok: false, code: "APP_SETTINGS_SENDER_FORBIDDEN" });
  expect(memory.get).not.toHaveBeenCalled(); expect(memory.set).not.toHaveBeenCalled(); expect(encrypt).not.toHaveBeenCalled();
  expect(memory.store.get("appSettings")).toEqual(normalized);
});

it.each(["APP_SETTINGS_GET_OR_CREATE_DEVICE_ID", "APP_SETTINGS_ENSURE_NORMALIZED"])("internal content may call bounded %s but other extension cannot", async type => {
  expect((await handleAppSettingsCommand({ type }, content())).ok).toBe(true);
  expect(await handleAppSettingsCommand({ type }, { ...content(), id: "other" })).toEqual({ ok: false, code: "APP_SETTINGS_SENDER_FORBIDDEN" });
});

it("SW-11/12 authToken is encrypted at rest and absent from responses, logs and errors", async () => {
  const token = ["synthetic", "account", "secret"].join("-");
  const response = await update({ authToken: token });
  const raw = memory.store.get("appSettings") as { authToken: string };
  expect(raw.authToken).toMatch(/^qse:v1:/); expect(await decryptValue(raw.authToken)).toBe(token);
  expect(JSON.stringify(response)).not.toContain(token); expect(JSON.stringify([...getErrorLogs(), ...getSessionLog()])).not.toContain(token);
  vi.spyOn(encryption, "encryptValue").mockRejectedValueOnce(new Error(token));
  expect(await update({ authToken: token })).toEqual({ ok: false, code: "APP_SETTINGS_WRITE_FAILED" });
  expect(JSON.stringify([...getErrorLogs(), ...getSessionLog()])).not.toContain(token);
});

it("SW-13 storage.onChanged invalidates another client's cache after ACK", async () => {
  const cached = await loadSettings(); expect(cached.language).toBe("zh");
  await update({ language: "en" });
  const listeners = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.map(([listener]) => listener);
  for (const listener of listeners) listener({ appSettings: { newValue: memory.store.get("appSettings") } }, "local");
  expect((await loadSettings()).language).toBe("en");
});

it.each(["providerId", "apiKey", "apiModel", "customBaseUrl", "customProviderProtocol", "unknown", "__proto__"])("SW-14 ordinary command rejects forbidden key %s", async key => {
  const patch = JSON.parse(`{"${key}":"synthetic"}`);
  expect(await handleAppSettingsCommand({ type: "APP_SETTINGS_UPDATE", patch }, ui())).toEqual({ ok: false, code: "APP_SETTINGS_PAYLOAD_INVALID" });
  expect(memory.set).not.toHaveBeenCalled();
});

it.each([{ language: "xx" }, { preferredRoute: "other" }, { enableAnalytics: "true" }, { analyticsConsentVersion: -1 }, { authToken: 5 }, { authToken: "x".repeat(65_537) }])("rejects invalid patch values", async patch => {
  expect(await handleAppSettingsCommand({ type: "APP_SETTINGS_UPDATE", patch }, ui())).toEqual({ ok: false, code: "APP_SETTINGS_PAYLOAD_INVALID" });
});

it("lost ACK can retry an identical token patch without logical corruption", async () => {
  const token = ["retry", "account", "token"].join("-");
  vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(async message => {
    await handleAppSettingsCommand(message, ui()); throw new Error("lost response");
  });
  await expect(saveSettings({ language: "en", authToken: token })).rejects.toThrow("APP_SETTINGS_BACKGROUND_UNAVAILABLE");
  await saveSettings({ language: "en", authToken: token });
  expect(await decryptValue((memory.store.get("appSettings") as { authToken: string }).authToken)).toBe(token);
  expect(memory.store.get("appSettings")).toHaveProperty("language", "en");
});

it("background device initialization calls the owner without self messaging", async () => {
  memory.store.delete("appSettings"); const id = await getOrCreateAppSettingsDeviceId();
  expect(id).toBeTruthy(); expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
});
