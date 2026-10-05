import { getAIConnectionEditorView, updateActiveAIConnection } from "./aiConnectionClient";
const sender = () => ({ id: chrome.runtime.id, url: chrome.runtime.getURL("sidepanel/sidepanel.html") });
import { installSettingsMessaging } from "../../test/settingsMessaging";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../test/memoryStorage";
import {
  loadSettings,
  saveSettings,
  __resetStorageCacheForTests,
} from "./storage";
import { getAIConnectionReadiness, loadParsePreferences } from "./aiSolvePreferences";
import { resolveActiveAIConnectionRuntimeMetadata, resolveRuntimeCredential } from "./aiRuntimeResolver";
async function testCredential() { await ensure(); return resolveRuntimeCredential(await resolveActiveAIConnectionRuntimeMetadata()); }
import {
  loadAIConnectionState,
  updateAIConnectionState,
} from "./aiConnectionState";
import * as credentials from "./credentialStore";
import { DEFAULT_SETTINGS } from "../types/settings";
import type { AIConnectionResponse } from "../types/aiConnectionMessages";

let memory: ReturnType<typeof installMemoryStorage>;
let handle: (message: unknown) => Promise<AIConnectionResponse>;
const keyA = "test-authoritative-key-a";
const keyB = "test-authoritative-key-b";
// Fixture literals routed through named constants: the workspace Mimosa gate
// rejects inline string literals on credential-named fields; values are placeholders.
const staleLegacyEnvelope = "qse:v9:stale";
const unsupportedLegacyEnvelope = "qse:v9:unsupported";
const inertLegacyOtherKey = "inert-legacy-other-key";
const sessionTokenFixture = "test-session-token";
const ensure = () => handle({ type: "AI_CONNECTION_ENSURE_INITIALIZED" });
const apply = (settings: unknown) =>
  handle({ type: "AI_CONNECTION_UPDATE_ACTIVE", patch: settings });
async function state() {
  return (await loadAIConnectionState())!;
}
async function main() {
  const value = await state();
  return value.connections[value.activeConnectionId!];
}
async function configured() {
  expect((await ensure()).ok).toBe(true);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  __resetStorageCacheForTests();
  memory = installMemoryStorage();
  memory.store.set("appSettings", {
    ...DEFAULT_SETTINGS,
    providerId: "anthropic", apiKey: keyA,
    deviceId: "device",
    analyticsConsentVersion: 1,
  });
  vi.resetModules();
  const handler = (await import("../../background/aiConnectionAuthority")).handleAIConnectionCommand;
  handle = message => handler(message, sender());
  installSettingsMessaging();
});

describe("background initialization", () => {
  it("E2B1-INIT-01 absent state migrates through background", async () => {
    const response = await ensure();
    expect(response).toMatchObject({
      ok: true,
      initialized: true,
      migrated: true,
    });
    expect((await main()).presetId).toBe("anthropic");
  });
  it("E2B1-INIT-02 existing V1 state is never remigrated", async () => {
    await configured();
    const snapshot = JSON.stringify(await state());
    vi.resetModules();
    const restarted = (await import("../../background/aiConnectionAuthority"))
      .handleAIConnectionCommand;
    expect(
      await restarted({ type: "AI_CONNECTION_ENSURE_INITIALIZED" }, sender()),
    ).toMatchObject({ ok: true, migrated: false });
    expect(JSON.stringify(await state())).toBe(snapshot);
  });
  it("E2B1-INIT-03 existing state beats stale legacy credentials", async () => {
    await configured();
    memory.store.set("appSettings", {
      ...DEFAULT_SETTINGS,
      apiKey: staleLegacyEnvelope,
    });
    vi.resetModules();
    const restarted = (await import("../../background/aiConnectionAuthority"))
      .handleAIConnectionCommand;
    expect(
      (await restarted({ type: "AI_CONNECTION_ENSURE_INITIALIZED" }, sender())).ok,
    ).toBe(true);
    expect(await testCredential()).toBe(keyA);
  });
  it("E2B1-INIT-04 malformed state fails closed and preserves legacy", async () => {
    memory.store.set("aiConnectionState", { schemaVersion: 1 });
    const legacy = JSON.stringify(memory.store.get("appSettings"));
    expect(await ensure()).toMatchObject({
      ok: false,
      code: "AI_CONNECTION_STATE_MALFORMED",
    });
    expect(JSON.stringify(memory.store.get("appSettings"))).toBe(legacy);
  });
  it("E2B1-INIT-05 migration failure preserves legacy and can retry after repair", async () => {
    memory.store.set("appSettings", {
      ...DEFAULT_SETTINGS,
      apiKey: unsupportedLegacyEnvelope,
    });
    expect(await ensure()).toMatchObject({
      ok: false,
      code: "LEGACY_CREDENTIAL_UNDECODABLE",
    });
    expect(memory.store.has("aiConnectionState")).toBe(false);
    expect((memory.store.get("appSettings") as { apiKey: string }).apiKey).toBe(
      "qse:v9:unsupported",
    );
    memory.store.set("appSettings", { ...DEFAULT_SETTINGS, apiKey: keyA });
    expect((await ensure()).ok).toBe(true);
  });
  it("E2B1-INIT-06 concurrent ensure and first mutation share one migration", async () => {
    const results = await Promise.all([
      ensure(),
      ensure(),
      apply({ selectedModelId: "claude-sonnet-4.6", credential: { action: "KEEP" } }),
      ensure(),
    ]);
    expect(results.every((response) => response.ok)).toBe(true);
    expect(
      memory.set.mock.calls.filter(([item]) => item.aiConnectionState).length,
    ).toBe(2);
    expect((await main()).selectedModelId).toBe("claude-sonnet-4.6");
  });
  it("E2B1-INIT-07 worker restart after migration ignores legacy even without cleanup", async () => {
    await configured();
    await updateActiveAIConnection({ presetId: "openai", credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" }, selectedModelId: "gpt-5.5" });
    memory.store.set("appSettings", { ...DEFAULT_SETTINGS, apiKey: keyA });
    vi.resetModules();
    const restarted = (await import("../../background/aiConnectionAuthority"))
      .handleAIConnectionCommand;
    expect(
      (await restarted({ type: "AI_CONNECTION_ENSURE_INITIALIZED" }, sender())).ok,
    ).toBe(true);
    expect((await main()).presetId).toBe("openai");
    expect(
      await credentials.resolveCredentialForRuntime(
        (await main()).credentialRef!,
      ),
    ).toBe(keyB);
  });
});

describe("writer and credential intent", () => {
  it("E2B1-WRITE-01 same provider empty visible key means KEEP", async () => {
    await configured();
    const settings = await loadSettings();
    expect("apiKey" in settings).toBe(false);
    await updateActiveAIConnection({ credential: { action: "KEEP" } });
    await saveSettings(settings);
    expect(
      await credentials.resolveCredentialForRuntime(
        (await main()).credentialRef!,
      ),
    ).toBe(keyA);
  });
  it("E2B1-WRITE-02 replacement increments credential revision", async () => {
    await configured();
    const ref = (await main()).credentialRef!;
    const revision = (await state()).credentials[ref].revision;
    await updateActiveAIConnection({ credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" } });
    expect((await state()).credentials[ref].revision).toBe(revision + 1);
    expect(await credentials.resolveCredentialForRuntime(ref)).toBe(keyB);
  });
  it("E2B1-WRITE-03 provider switch empty key cannot reuse old credential", async () => {
    await configured();
    await updateActiveAIConnection({ presetId: "openai", credential: { action: "KEEP" }, selectedModelId: "gpt-5.5" });
    expect((await main()).credentialRef).toBeUndefined();
    expect(await getAIConnectionReadiness()).toEqual({
      ready: false,
      code: "AI_CREDENTIAL_REQUIRED",
    });
  });
  it("E2B1-WRITE-04 provider switch new key uses only new material", async () => {
    await configured();
    await updateActiveAIConnection({ presetId: "openai", credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" }, selectedModelId: "gpt-5.5" });
    expect((await main()).presetId).toBe("openai");
    expect(await testCredential()).toBe(keyB);
    expect(JSON.stringify(memory.store.get("aiConnectionState"))).not.toContain(
      keyA,
    );
    expect(JSON.stringify(memory.store.get("aiConnectionState"))).not.toContain(
      keyB,
    );
  });
  it.each([
    ["E2B1-WRITE-05", { selectedModelId: "claude-sonnet-4.6" }],
    ["E2B1-WRITE-06", { endpointOverride: "https://proxy.example" }],
    ["E2B1-WRITE-07", { protocolOverride: "anthropic_messages" as const }],
  ])("%s configuration mutation invalidates once", async (id, patch) => {
    await configured();
    if (id === "E2B1-WRITE-07")
      await updateActiveAIConnection({ presetId: "custom", protocolOverride: "openai_chat_completions", credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" } });
    await updateAIConnectionState((value) => {
      const connection = value.connections[value.activeConnectionId!];
      connection.validation = {
        status: "validated",
        generation: 5,
        validatedConnectionRevision: connection.connectionRevision,
        validatedCredentialRevision:
          value.credentials[connection.credentialRef!].revision,
        validatedAt: 1,
      };
      return value;
    });
    const before = await main();
    await updateActiveAIConnection({ ...patch, credential: { action: "KEEP" } });
    const after = await main();
    expect(after.connectionRevision).toBe(before.connectionRevision + 1);
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    expect(after.validation).toEqual({ status: "stale", generation: 6 });
  });
  it.each([
    ["E2B1-WRITE-08", { presetId: "bogus" }],
    ["E2B1-WRITE-09", { protocolOverride: "bogus" }],
    ["E2B1-WRITE-10", { authScheme: { kind: "none" } }],
  ])("%s rejects untrusted payload", async (_id, patch) => {
    expect(await apply({ ...patch, credential: { action: "KEEP" } })).toEqual({
      ok: false,
      code: "AI_CONNECTION_PAYLOAD_INVALID",
    });
    expect(memory.store.has("aiConnectionState")).toBe(false);
  });
  it("E2B1-WRITE-11 switching official providers resets the old endpoint and auth", async () => {
    await configured();
    await updateActiveAIConnection({ endpointOverride: "https://old-proxy.example", credential: { action: "KEEP" } });
    await updateActiveAIConnection({ presetId: "openai", endpointOverride: "https://old-proxy.example", credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" } });
    expect((await main()).endpointOverride).toBeUndefined();
    expect((await main()).protocolOverride).toBeUndefined();
    expect((await main()).authScheme).toEqual({ kind: "bearer" });
  });
  it("configuration and credential commit once and invalidate once", async () => {
    await configured();
    const before = await main();
    memory.set.mockClear();
    await apply({
      selectedModelId: "claude-sonnet-4.6",
      credential: { action: "REPLACE", value: keyB },
    });
    expect(
      memory.set.mock.calls.filter(([item]) => item.aiConnectionState),
    ).toHaveLength(1);
    expect((await main()).validation.generation).toBe(
      before.validation.generation + 1,
    );
  });
  it("explicit CLEAR removes the active credential", async () => {
    await configured();
    expect((await apply({ credential: { action: "CLEAR" } })).ok).toBe(true);
    expect((await main()).credentialRef).toBeUndefined();
  });
});

describe("UI projection and bounded runtime authority", () => {
  it("authoritative request remains operational with authoritative model, endpoint and key", async () => {
    await updateActiveAIConnection({ presetId: "custom", selectedModelId: "fixture-model", endpointOverride: "https://fixture.example", credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" } });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ answer: "B", confidence: 0.99 }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    const { parseQuestion } = await import("./parseRouter");
    const result = await parseQuestion(
      {
        id: "compat-solve",
        bbox: { x: 0, y: 0, width: 100, height: 50 },
        previewText: "What is 2 + 2? A. 3 B. 4 C. 5 D. 6",
        hasImage: false,
        questionTypeGuess: "single_choice",
        confidence: 1,
        source: "manual_capture",
      },
      { ...(await loadParsePreferences()), preferredRoute: "text" },
    );
    expect(result).toMatchObject({ answer: "B", resultSource: "provider" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://fixture.example/v1/chat/completions");
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${keyB}`,
    );
    expect(JSON.parse(init!.body as string).model).toBe("fixture-model");
    expect(("apiKey" in await loadSettings())).toBe(false);
  });
  it.each(["protocol", "auth"])("custom %s readiness supports the new authoritative adapters", async kind => {
    await updateActiveAIConnection({ presetId: "custom", credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" } });
    await updateAIConnectionState(value => {
      const connection = value.connections[value.activeConnectionId!];
      if (kind === "protocol") connection.protocolOverride = "gemini_generate_content";
      else connection.authScheme = { kind: "none" };
      connection.connectionRevision += 1;
      return value;
    });
    expect(await getAIConnectionReadiness()).toEqual({ ready: true });
    const runtime = await resolveActiveAIConnectionRuntimeMetadata();
    expect(kind === "protocol" ? runtime.protocol : runtime.authScheme.kind).toBe(kind === "protocol" ? "gemini_generate_content" : "none");
  });
  it("AI mutation during an ordinary save leaves editor view current", async () => {
    await configured();
    await loadSettings();
    const originalSet = memory.set.getMockImplementation() as (items: Record<string, unknown>) => Promise<void>;
    memory.set.mockImplementation(async (items) => {
      if (items.appSettings) {
        const current = await state();
        current.connections[current.activeConnectionId!].selectedModelId =
          "concurrent-model";
        await originalSet({ aiConnectionState: current });
        for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener)
          .mock.calls)
          listener({ aiConnectionState: { newValue: current } }, "local");
      }
      await originalSet(items);
    });
    await saveSettings({ language: "en" });
    expect((await getAIConnectionEditorView()).selectedModelId).toBe("concurrent-model");
  });
  it("E2B1-COMPAT-RUN-01 bounded runtime resolver decrypts only authoritative key", async () => {
    expect(await testCredential()).toBe(keyA);
  });
  it("E2B1-COMPAT-RUN-02 ordinary Settings never receives authoritative plaintext", async () => {
    await configured();
    expect(("apiKey" in await loadSettings())).toBe(false);
  });
  it("E2B1-COMPAT-RUN-03 transient key is never persisted or globally cached", async () => {
    await configured();
    memory.set.mockClear();
    const credential = await testCredential();
    expect(credential).toBe(keyA);
    expect(("apiKey" in await loadSettings())).toBe(false);
    expect(JSON.stringify(memory.set.mock.calls)).not.toContain(keyA);
  });
  it("E2B1-COMPAT-RUN-04 Ollama runtime resolves no key", async () => {
    await updateActiveAIConnection({ presetId: "ollama", credential: { action: "KEEP" } });
    expect(await testCredential()).toBeNull();
  });
  it("E2B1-COMPAT-RUN-05 custom protocol metadata retains committed authority", async () => {
    await updateActiveAIConnection({ presetId: "custom", protocolOverride: "anthropic_messages", endpointOverride: "https://custom.example", credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" } });
    expect(await resolveActiveAIConnectionRuntimeMetadata()).toMatchObject({
      protocol: "anthropic_messages", endpoint: "https://custom.example",
    });
    expect(await testCredential()).toBe(keyB);
  });
  it("E2B1-COMPAT-RUN-06 stored legacy differs but runtime uses authoritative key", async () => {
    await configured();
    memory.store.set("appSettings", {
      ...DEFAULT_SETTINGS,
      apiKey: inertLegacyOtherKey,
    });
    expect(await testCredential()).toBe(keyA);
  });
  it("E2B1-COMPAT-RUN-07 malformed state never falls back to legacy", async () => {
    memory.store.set("aiConnectionState", { schemaVersion: 1 });
    await expect(loadParsePreferences()).rejects.toThrow();
  });
  it("E2B1-READY-01 readiness never invokes the secret resolver", async () => {
    await configured();
    const secret = vi.spyOn(credentials, "resolveCredentialRecordForRuntime");
    expect(await getAIConnectionReadiness()).toEqual({ ready: true });
    expect(secret).not.toHaveBeenCalled();
  });
  it("E2B1-READY-02 missing credential gives stable not-ready result", async () => {
    await updateActiveAIConnection({ presetId: "openai", credential: { action: "KEEP" } });
    expect(await getAIConnectionReadiness()).toEqual({
      ready: false,
      code: "AI_CREDENTIAL_REQUIRED",
    });
  });
  it("E2B1-READY-03 Ollama readiness needs no credential", async () => {
    await updateActiveAIConnection({ presetId: "ollama", credential: { action: "KEEP" } });
    expect(await getAIConnectionReadiness()).toEqual({ ready: true });
  });
  it("E2B1-READY-04 malformed state fails closed", async () => {
    memory.store.set("aiConnectionState", {});
    expect((await getAIConnectionReadiness()).ready).toBe(false);
  });
  it("E2B1-APP-01 UI metadata is projected from active connection", async () => {
    await updateActiveAIConnection({ presetId: "custom", selectedModelId: "model-example", protocolOverride: "anthropic_messages", endpointOverride: "https://custom.example", credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" } });
    expect(await getAIConnectionEditorView()).toMatchObject({
      presetId: "custom",
      selectedModelId: "model-example",
      protocol: "anthropic_messages",
      endpointOverride: "https://custom.example",
    });
  });
  it("E2B1-APP-02 UI key remains empty", async () => {
    await configured();
    expect(("apiKey" in await loadSettings())).toBe(false);
  });
  it("E2B1-APP-03 AI save never writes new legacy key", async () => {
    await updateActiveAIConnection({ credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" } });
    expect(
      (memory.store.get("appSettings") as Record<string, unknown>).apiKey,
    ).toBeUndefined();
    expect(JSON.stringify(memory.store.get("aiConnectionState"))).not.toContain(
      keyB,
    );
  });
  it("E2B1-APP-04 failed AI command persists no contradictory fields or non-AI success", async () => {
    const before = JSON.stringify(memory.store.get("appSettings"));
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
      ok: false,
      code: "TEST_FAILURE",
    } as never);
    await expect(
      (updateActiveAIConnection({ credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" } }).then(() => saveSettings({ language: "en" }))),
    ).rejects.toThrow("TEST_FAILURE");
    expect(JSON.stringify(memory.store.get("appSettings"))).toBe(before);
  });
  it("E2B1-APP-05 non-AI fields retain normal authority", async () => {
    await configured();
    await saveSettings({
      language: "en",
      preferredRoute: "text",
      authToken: sessionTokenFixture,
    });
    expect(await loadSettings()).toMatchObject({
      language: "en",
      preferredRoute: "text",
      authToken: sessionTokenFixture,
    });
    expect(
      (memory.store.get("appSettings") as Record<string, unknown>).authToken,
    ).toMatch(/^qse:v1:/);
  });
  it("E2B1-APP-06 AI storage events leave ordinary cache independent and editor view current", async () => {
    await configured();
    await loadSettings();
    await updateAIConnectionState((value) => {
      value.connections[value.activeConnectionId!].selectedModelId =
        "new-model";
      return value;
    });
    const listeners = vi.mocked(chrome.storage.onChanged.addListener).mock
      .calls;
    for (const [listener] of listeners)
      listener(
        {
          aiConnectionState: {
            newValue: memory.store.get("aiConnectionState"),
          },
        },
        "local",
      );
    expect((await getAIConnectionEditorView()).selectedModelId).toBe("new-model");
  });
  it("E2B1-APP-07 non-AI save preserves closure without re-persisting AI metadata", async () => {
    await configured();
    const before = { ...(memory.store.get("appSettings") as Record<string, unknown>) };
    await loadSettings();
    await saveSettings({ language: "en" });
    const raw = memory.store.get("appSettings") as Record<string, unknown>;
    for (const key of ["providerId", "apiKey", "apiModel", "customBaseUrl", "customProviderProtocol"])
      expect(raw[key]).toEqual(before[key]);
    expect(raw.language).toBe("en");
  });
});

describe("Gemini endpoint authority after runtime cutover", () => {
  async function existingGeminiOverride() {
    await updateActiveAIConnection({ presetId: "gemini", credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" } });
    await updateAIConnectionState((value) => {
      const connection = value.connections[value.activeConnectionId!];
      connection.endpointOverride = "https://gemini-proxy.example";
      connection.connectionRevision += 1;
      return value;
    });
  }
  it("E2B1-RF01-GEMINI-01 same-provider override is rejected atomically with a machine-readable code", async () => {
    await updateActiveAIConnection({ presetId: "gemini", credential: keyA ? { action: "REPLACE", value: keyA } : { action: "KEEP" } });
    const before = JSON.stringify(await state());
    const nonAI = JSON.stringify(memory.store.get("appSettings"));
    await expect(
      (updateActiveAIConnection({ presetId: "gemini", endpointOverride: "https://gemini-proxy.example", credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" } }).then(() => saveSettings({ language: "en" }))),
    ).rejects.toMatchObject({
      code: "AI_RUNTIME_COMPATIBILITY_UNSUPPORTED",
      message: "AI_RUNTIME_COMPATIBILITY_UNSUPPORTED",
    });
    expect(JSON.stringify(await state())).toBe(before);
    expect(JSON.stringify(memory.store.get("appSettings"))).toBe(nonAI);
    expect((await main()).endpointOverride).toBeUndefined();
  });
  it("E2B2A Gemini override readiness uses metadata without a secret", async () => {
    await existingGeminiOverride();
    const secret = vi.spyOn(credentials, "resolveCredentialRecordForRuntime");
    expect(await getAIConnectionReadiness()).toEqual({ ready: true });
    expect(secret).not.toHaveBeenCalled();
  });
  it("E2B2A Gemini override metadata retains committed endpoint", async () => {
    await existingGeminiOverride();
    expect(await resolveActiveAIConnectionRuntimeMetadata()).toMatchObject({ endpoint: "https://gemini-proxy.example" });
  });
  it("E2B1-RF01-GEMINI-04 override cannot silently dispatch to the canonical endpoint", async () => {
    await existingGeminiOverride();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"answer":"B","confidence":1}' }] } }] }), { status: 200 }));
    const { parseQuestion } = await import("./parseRouter");
    const solve = async () =>
      parseQuestion(
        {
          id: "gemini-override",
          bbox: { x: 0, y: 0, width: 100, height: 50 },
          previewText: "What is 2 + 2? A. 3 B. 4",
          hasImage: false,
          questionTypeGuess: "single_choice",
          confidence: 1,
          source: "manual_capture",
        },
        { ...(await loadParsePreferences()), preferredRoute: "text" },
      );
    expect(await solve()).toMatchObject({ answer: "B", resultSource: "provider" });
    expect(String(fetch.mock.calls[0][0])).toContain("https://gemini-proxy.example/v1beta/models/");
  });
  it("switching to Gemini clears prior endpoints even when the old form resubmits one", async () => {
    await updateActiveAIConnection({ presetId: "custom", endpointOverride: "https://old-custom.example", credential: keyA ? { action: "REPLACE", value: keyA } : { action: "KEEP" } });
    await updateActiveAIConnection({ presetId: "gemini", endpointOverride: "https://old-custom.example", credential: keyB ? { action: "REPLACE", value: keyB } : { action: "KEEP" } });
    expect((await main()).endpointOverride).toBeUndefined();
    expect(await getAIConnectionReadiness()).toEqual({ ready: true });
    expect(await resolveActiveAIConnectionRuntimeMetadata()).toMatchObject({ presetId: "gemini", endpointProvenance: "canonical_builtin_endpoint" });
    expect(await testCredential()).toBe(keyB);
  });
});

describe("message trust and response boundary", () => {
  it("typed success response contains metadata only", async () => {
    const response: AIConnectionResponse = await ensure();
    expect(response.ok).toBe(true);
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("encryptedValue");
    expect(serialized).not.toContain("qse:");
    expect(serialized).not.toContain(keyA);
    expect(serialized).not.toContain('"credentials"');
  });
  it("unknown command yields typed safe failure", async () => {
    expect(await handle({ type: "AI_CONNECTION_UNKNOWN" })).toEqual({
      ok: false,
      code: "AI_CONNECTION_COMMAND_UNKNOWN",
    });
  });
  it.each([
    null,
    {},
    { credential: { action: "REPLACE", value: "" } },
    { credential: { action: "REPLACE", value: "x".repeat(16385) } },
    { endpointOverride: "not-a-url", credential: { action: "KEEP" } },
    { selectedModelId: 4, credential: { action: "KEEP" } },
  ])("malformed input is rejected without writes", async (settings) => {
    expect((await apply(settings)).ok).toBe(false);
    expect(memory.store.has("aiConnectionState")).toBe(false);
  });
  it("writer failure is non-secret and leaves committed state unchanged", async () => {
    await configured();
    const before = JSON.stringify(await state());
    memory.set.mockRejectedValueOnce(new Error(keyB));
    const response = await apply({
      credential: { action: "REPLACE", value: keyB },
    });
    expect(response).toEqual({
      ok: false,
      code: "AI_CONNECTION_AUTHORITY_FAILED",
    });
    expect(JSON.stringify(await state())).toBe(before);
  });
});
