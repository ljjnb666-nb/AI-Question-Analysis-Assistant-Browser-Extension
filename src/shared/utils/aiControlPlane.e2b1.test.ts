import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../test/memoryStorage";
import {
  loadSettings,
  saveSettings,
  __resetStorageCacheForTests,
} from "./storage";
import {
  loadLegacyRuntimeSettingsCompat,
  getAIConnectionReadiness,
} from "./legacyRuntimeSettingsCompat";
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
const ensure = () => handle({ type: "AI_CONNECTION_ENSURE_INITIALIZED" });
const apply = (settings: unknown) =>
  handle({ type: "AI_CONNECTION_APPLY_LEGACY_SETTINGS", settings });
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
    apiKey: keyA,
    deviceId: "device",
    analyticsConsentVersion: 1,
  });
  vi.resetModules();
  handle = (await import("../../background/aiConnectionAuthority"))
    .handleAIConnectionCommand;
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(
    (message) => handle(message) as never,
  );
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
      await restarted({ type: "AI_CONNECTION_ENSURE_INITIALIZED" }),
    ).toMatchObject({ ok: true, migrated: false });
    expect(JSON.stringify(await state())).toBe(snapshot);
  });
  it("E2B1-INIT-03 existing state beats stale legacy credentials", async () => {
    await configured();
    memory.store.set("appSettings", {
      ...DEFAULT_SETTINGS,
      apiKey: "qse:v9:stale",
    });
    vi.resetModules();
    const restarted = (await import("../../background/aiConnectionAuthority"))
      .handleAIConnectionCommand;
    expect(
      (await restarted({ type: "AI_CONNECTION_ENSURE_INITIALIZED" })).ok,
    ).toBe(true);
    expect((await loadLegacyRuntimeSettingsCompat()).apiKey).toBe(keyA);
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
      apiKey: "qse:v9:unsupported",
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
      apply({ apiModel: "claude-sonnet-4.6", credential: { action: "KEEP" } }),
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
    await saveSettings({
      providerId: "openai",
      apiKey: keyB,
      apiModel: "gpt-5.5",
    });
    memory.store.set("appSettings", { ...DEFAULT_SETTINGS, apiKey: keyA });
    vi.resetModules();
    const restarted = (await import("../../background/aiConnectionAuthority"))
      .handleAIConnectionCommand;
    expect(
      (await restarted({ type: "AI_CONNECTION_ENSURE_INITIALIZED" })).ok,
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
    expect(settings.apiKey).toBe("");
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
    await saveSettings({ apiKey: keyB });
    expect((await state()).credentials[ref].revision).toBe(revision + 1);
    expect(await credentials.resolveCredentialForRuntime(ref)).toBe(keyB);
  });
  it("E2B1-WRITE-03 provider switch empty key cannot reuse old credential", async () => {
    await configured();
    await saveSettings({
      ...(await loadSettings()),
      providerId: "openai",
      apiKey: "",
      apiModel: "gpt-5.5",
    });
    expect((await main()).credentialRef).toBeUndefined();
    expect(await getAIConnectionReadiness()).toEqual({
      ready: false,
      code: "AI_CREDENTIAL_REQUIRED",
    });
  });
  it("E2B1-WRITE-04 provider switch new key uses only new material", async () => {
    await configured();
    await saveSettings({
      providerId: "openai",
      apiKey: keyB,
      apiModel: "gpt-5.5",
    });
    expect((await main()).presetId).toBe("openai");
    expect((await loadLegacyRuntimeSettingsCompat()).apiKey).toBe(keyB);
    expect(JSON.stringify(memory.store.get("aiConnectionState"))).not.toContain(
      keyA,
    );
    expect(JSON.stringify(memory.store.get("aiConnectionState"))).not.toContain(
      keyB,
    );
  });
  it.each([
    ["E2B1-WRITE-05", { apiModel: "claude-sonnet-4.6" }],
    ["E2B1-WRITE-06", { customBaseUrl: "https://proxy.example" }],
    ["E2B1-WRITE-07", { customProviderProtocol: "anthropic" as const }],
  ])("%s configuration mutation invalidates once", async (id, patch) => {
    await configured();
    if (id === "E2B1-WRITE-07")
      await saveSettings({
        providerId: "custom",
        customProviderProtocol: "openai",
        apiKey: keyB,
      });
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
    await saveSettings(patch);
    const after = await main();
    expect(after.connectionRevision).toBe(before.connectionRevision + 1);
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    expect(after.validation).toEqual({ status: "stale", generation: 6 });
  });
  it.each([
    ["E2B1-WRITE-08", { providerId: "bogus" }],
    ["E2B1-WRITE-09", { customProviderProtocol: "bogus" }],
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
    await saveSettings({ customBaseUrl: "https://old-proxy.example" });
    await saveSettings({
      providerId: "openai",
      customBaseUrl: "https://old-proxy.example",
      apiKey: keyB,
    });
    expect((await main()).endpointOverride).toBeUndefined();
    expect((await main()).protocolOverride).toBeUndefined();
    expect((await main()).authScheme).toEqual({ kind: "bearer" });
  });
  it("configuration and credential commit once and invalidate once", async () => {
    await configured();
    const before = await main();
    memory.set.mockClear();
    await apply({
      apiModel: "claude-sonnet-4.6",
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

describe("UI projection and runtime compatibility", () => {
  it("legacy request remains operational with authoritative model, endpoint and key", async () => {
    await saveSettings({
      providerId: "custom",
      apiModel: "fixture-model",
      customBaseUrl: "https://fixture.example",
      apiKey: keyB,
    });
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
      { ...(await loadLegacyRuntimeSettingsCompat()), preferredRoute: "text" },
    );
    expect(result).toMatchObject({ answer: "B", resultSource: "provider" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://fixture.example/v1/chat/completions");
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${keyB}`,
    );
    expect(JSON.parse(init!.body as string).model).toBe("fixture-model");
    expect((await loadSettings()).apiKey).toBe("");
  });
  it.each(["protocol", "auth"])(
    "unsupported custom %s cannot be silently reinterpreted",
    async (kind) => {
      await saveSettings({ providerId: "custom", apiKey: keyB });
      await updateAIConnectionState((value) => {
        const connection = value.connections[value.activeConnectionId!];
        if (kind === "protocol")
          connection.protocolOverride = "gemini_generate_content";
        else connection.authScheme = { kind: "none" };
        connection.connectionRevision += 1;
        return value;
      });
      expect(await getAIConnectionReadiness()).toEqual({
        ready: false,
        code: "AI_RUNTIME_COMPATIBILITY_UNSUPPORTED",
      });
      await expect(loadLegacyRuntimeSettingsCompat()).rejects.toThrow(
        "AI_RUNTIME_COMPATIBILITY_UNSUPPORTED",
      );
    },
  );
  it("AI mutation during a non-AI save cannot republish the old projection cache", async () => {
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
    expect((await loadSettings()).apiModel).toBe("concurrent-model");
  });
  it("E2B1-COMPAT-RUN-01 runtime projection materializes only authoritative key", async () => {
    expect((await loadLegacyRuntimeSettingsCompat()).apiKey).toBe(keyA);
  });
  it("E2B1-COMPAT-RUN-02 ordinary Settings never receives authoritative plaintext", async () => {
    await configured();
    expect((await loadSettings()).apiKey).toBe("");
  });
  it("E2B1-COMPAT-RUN-03 transient key is never persisted or globally cached", async () => {
    await configured();
    memory.set.mockClear();
    const runtime = await loadLegacyRuntimeSettingsCompat();
    expect(runtime.apiKey).toBe(keyA);
    expect((await loadSettings()).apiKey).toBe("");
    expect(JSON.stringify(memory.set.mock.calls)).not.toContain(keyA);
  });
  it("E2B1-COMPAT-RUN-04 Ollama runtime uses no key", async () => {
    await saveSettings({ providerId: "ollama", apiKey: "" });
    expect((await loadLegacyRuntimeSettingsCompat()).apiKey).toBe("");
  });
  it("E2B1-COMPAT-RUN-05 custom protocol retains legacy representation", async () => {
    await saveSettings({
      providerId: "custom",
      customProviderProtocol: "anthropic",
      customBaseUrl: "https://custom.example",
      apiKey: keyB,
    });
    expect(await loadLegacyRuntimeSettingsCompat()).toMatchObject({
      customProviderProtocol: "anthropic",
      customBaseUrl: "https://custom.example",
      apiKey: keyB,
    });
  });
  it("E2B1-COMPAT-RUN-06 stored legacy differs but runtime uses authoritative key", async () => {
    await configured();
    memory.store.set("appSettings", {
      ...DEFAULT_SETTINGS,
      apiKey: "inert-legacy-other-key",
    });
    expect((await loadLegacyRuntimeSettingsCompat()).apiKey).toBe(keyA);
  });
  it("E2B1-COMPAT-RUN-07 malformed state never falls back to legacy", async () => {
    memory.store.set("aiConnectionState", { schemaVersion: 1 });
    await expect(loadLegacyRuntimeSettingsCompat()).rejects.toThrow();
  });
  it("E2B1-READY-01 readiness never invokes the secret resolver", async () => {
    await configured();
    const secret = vi.spyOn(credentials, "resolveCredentialRecordForRuntime");
    expect(await getAIConnectionReadiness()).toEqual({ ready: true });
    expect(secret).not.toHaveBeenCalled();
  });
  it("E2B1-READY-02 missing credential gives stable not-ready result", async () => {
    await saveSettings({ providerId: "openai", apiKey: "" });
    expect(await getAIConnectionReadiness()).toEqual({
      ready: false,
      code: "AI_CREDENTIAL_REQUIRED",
    });
  });
  it("E2B1-READY-03 Ollama readiness needs no credential", async () => {
    await saveSettings({ providerId: "ollama", apiKey: "" });
    expect(await getAIConnectionReadiness()).toEqual({ ready: true });
  });
  it("E2B1-READY-04 malformed state fails closed", async () => {
    memory.store.set("aiConnectionState", {});
    expect((await getAIConnectionReadiness()).ready).toBe(false);
  });
  it("E2B1-APP-01 UI metadata is projected from active connection", async () => {
    await saveSettings({
      providerId: "custom",
      apiModel: "model-example",
      customProviderProtocol: "anthropic",
      customBaseUrl: "https://custom.example",
      apiKey: keyB,
    });
    expect(await loadSettings()).toMatchObject({
      providerId: "custom",
      apiModel: "model-example",
      customProviderProtocol: "anthropic",
      customBaseUrl: "https://custom.example",
    });
  });
  it("E2B1-APP-02 UI key remains empty", async () => {
    await configured();
    expect((await loadSettings()).apiKey).toBe("");
  });
  it("E2B1-APP-03 AI save never writes new legacy key", async () => {
    await saveSettings({ apiKey: keyB });
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
      saveSettings({ apiKey: keyB, language: "en" }),
    ).rejects.toThrow("TEST_FAILURE");
    expect(JSON.stringify(memory.store.get("appSettings"))).toBe(before);
  });
  it("E2B1-APP-05 non-AI fields retain normal authority", async () => {
    await configured();
    await saveSettings({
      language: "en",
      preferredRoute: "text",
      authToken: "test-session-token",
    });
    expect(await loadSettings()).toMatchObject({
      language: "en",
      preferredRoute: "text",
      authToken: "test-session-token",
      apiKey: "",
    });
    expect(
      (memory.store.get("appSettings") as Record<string, unknown>).authToken,
    ).toMatch(/^qse:v1:/);
  });
  it("E2B1-APP-06 AI storage events invalidate projected cache", async () => {
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
    expect((await loadSettings()).apiModel).toBe("new-model");
  });
  it("E2B1-APP-07 merged non-AI save cannot re-persist projected AI fields", async () => {
    await configured();
    await loadSettings();
    await saveSettings({ language: "en" });
    const raw = memory.store.get("appSettings") as Record<string, unknown>;
    for (const key of [
      "providerId",
      "apiKey",
      "apiModel",
      "customBaseUrl",
      "customProviderProtocol",
    ])
      expect(raw).not.toHaveProperty(key);
  });
});

describe("RF01 Gemini legacy compatibility representability", () => {
  async function existingGeminiOverride() {
    await saveSettings({ providerId: "gemini", apiKey: keyB });
    await updateAIConnectionState((value) => {
      const connection = value.connections[value.activeConnectionId!];
      connection.endpointOverride = "https://gemini-proxy.example";
      connection.connectionRevision += 1;
      return value;
    });
  }
  it("E2B1-RF01-GEMINI-01 same-provider override is rejected atomically with a machine-readable code", async () => {
    await saveSettings({ providerId: "gemini", apiKey: keyA });
    const before = JSON.stringify(await state());
    const nonAI = JSON.stringify(memory.store.get("appSettings"));
    await expect(
      saveSettings({
        providerId: "gemini",
        customBaseUrl: "https://gemini-proxy.example",
        apiKey: keyB,
        language: "en",
      }),
    ).rejects.toMatchObject({
      code: "AI_RUNTIME_COMPATIBILITY_UNSUPPORTED",
      message: "AI_RUNTIME_COMPATIBILITY_UNSUPPORTED",
    });
    expect(JSON.stringify(await state())).toBe(before);
    expect(JSON.stringify(memory.store.get("appSettings"))).toBe(nonAI);
    expect((await main()).endpointOverride).toBeUndefined();
  });
  it("E2B1-RF01-GEMINI-02 existing override readiness fails closed without resolving a secret", async () => {
    await existingGeminiOverride();
    const secret = vi.spyOn(credentials, "resolveCredentialRecordForRuntime");
    expect(await getAIConnectionReadiness()).toEqual({
      ready: false,
      code: "AI_RUNTIME_COMPATIBILITY_UNSUPPORTED",
    });
    expect(secret).not.toHaveBeenCalled();
  });
  it("E2B1-RF01-GEMINI-03 existing override cannot enter runtime compatibility settings", async () => {
    await existingGeminiOverride();
    await expect(loadLegacyRuntimeSettingsCompat()).rejects.toMatchObject({
      code: "AI_RUNTIME_COMPATIBILITY_UNSUPPORTED",
    });
  });
  it("E2B1-RF01-GEMINI-04 override cannot silently dispatch to the canonical endpoint", async () => {
    await existingGeminiOverride();
    const fetch = vi.spyOn(globalThis, "fetch");
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
        await loadLegacyRuntimeSettingsCompat(),
      );
    await expect(solve()).rejects.toMatchObject({
      code: "AI_RUNTIME_COMPATIBILITY_UNSUPPORTED",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("switching to Gemini clears prior endpoints even when the old form resubmits one", async () => {
    await saveSettings({
      providerId: "custom",
      customBaseUrl: "https://old-custom.example",
      apiKey: keyA,
    });
    await saveSettings({
      providerId: "gemini",
      customBaseUrl: "https://old-custom.example",
      apiKey: keyB,
    });
    expect((await main()).endpointOverride).toBeUndefined();
    expect(await getAIConnectionReadiness()).toEqual({ ready: true });
    expect(await loadLegacyRuntimeSettingsCompat()).toMatchObject({
      providerId: "gemini",
      apiKey: keyB,
      customBaseUrl: undefined,
    });
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
    { customBaseUrl: "not-a-url", credential: { action: "KEEP" } },
    { apiModel: 4, credential: { action: "KEEP" } },
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
