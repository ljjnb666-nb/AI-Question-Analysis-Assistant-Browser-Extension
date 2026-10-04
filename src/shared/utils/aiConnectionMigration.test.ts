import { beforeEach, describe, expect, it, vi } from "vitest";
import { ENCRYPTED_VALUE_PREFIX, decryptValue, encryptValue } from "./encryption";
import {
  LEGACY_DEFAULT_CONNECTION_ID,
  LEGACY_DEFAULT_CREDENTIAL_REF,
  migrateLegacyAIConnectionState,
} from "./aiConnectionMigration";
import { AI_CONNECTION_STATE_STORAGE_KEY, getActiveConnectionMetadata, loadAIConnectionState } from "./aiConnectionState";
import { dumpStoreJson, installMemoryStorage, type MemoryStorageHandle } from "../../test/memoryStorage";

const LEGACY_PLAINTEXT_KEY = "sk-mig-matrix-plaintext-key";
const LEGACY_RAW_VALUE_FIXTURE = "raw-plaintext-credential-42";
const LEGACY_UNKNOWN_ENVELOPE_FIXTURE = "qse:v9:QUJD";

type LegacySettings = Record<string, unknown>;

function legacySettings(overrides: LegacySettings = {}): LegacySettings {
  return {
    providerId: "anthropic",
    apiKey: "",
    apiModel: "claude-opus-4.8",
    preferredRoute: "auto",
    language: "zh",
    enableAnalytics: false,
    analyticsConsentVersion: 1,
    deviceId: "device-1",
    analyticsBaseUrl: "https://analytics.example",
    ...overrides,
  };
}

/** Tamper one payload byte inside a qse:v1 envelope, keeping the prefix. */
function tamperEnvelope(envelope: string): string {
  const payload = envelope.slice(ENCRYPTED_VALUE_PREFIX.length);
  const middle = Math.floor(payload.length / 2);
  const swapped = payload[middle] === "A" ? "B" : "A";
  return envelope.slice(0, ENCRYPTED_VALUE_PREFIX.length) + payload.slice(0, middle) + swapped + payload.slice(middle + 1);
}

async function expectNoStateWritten(): Promise<void> {
  expect(memory.store.has(AI_CONNECTION_STATE_STORAGE_KEY)).toBe(false);
}

function legacySnapshotJson(): string {
  return JSON.stringify(memory.store.get("appSettings"));
}

let memory: MemoryStorageHandle;

describe("UI05R-E1 legacy migration matrix", () => {
  beforeEach(() => {
    memory = installMemoryStorage();
  });

  describe("E1-MIG-01 fresh install / default settings", () => {
    it("creates exactly one legacy connection with anthropic defaults and no credential", async () => {
      memory.store.set("appSettings", legacySettings());

      const result = await migrateLegacyAIConnectionState();

      expect(result.status).toBe("migrated");
      if (result.status === "failed") return;
      expect(result.state.revision).toBe(1);
      expect(result.state.activeConnectionId).toBe(LEGACY_DEFAULT_CONNECTION_ID);
      expect(Object.keys(result.state.connections)).toEqual([LEGACY_DEFAULT_CONNECTION_ID]);
      expect(Object.keys(result.state.credentials)).toEqual([]);

      const connection = result.state.connections[LEGACY_DEFAULT_CONNECTION_ID];
      expect(connection.presetId).toBe("anthropic");
      expect(connection.protocolOverride).toBeUndefined();
      expect(connection.endpointOverride).toBeUndefined();
      expect(connection.authScheme).toEqual({ kind: "header", headerName: "x-api-key" });
      expect(connection.credentialRef).toBeUndefined();
      expect(connection.selectedModelId).toBe("claude-opus-4.8");
      expect(connection.validation.status).toBe("never_tested");
      expect(connection.validation.generation).toBe(0);
    });
  });

  describe("E1-MIG-02 Anthropic existing key", () => {
    it("maps protocol/auth and encrypts the key into a credential record", async () => {
      memory.store.set("appSettings", legacySettings({ apiKey: LEGACY_PLAINTEXT_KEY }));

      const result = await migrateLegacyAIConnectionState();
      expect(result.status).toBe("migrated");

      const state = await loadAIConnectionState();
      const connection = state?.connections[LEGACY_DEFAULT_CONNECTION_ID];
      expect(connection?.presetId).toBe("anthropic");
      expect(connection?.credentialRef).toBe(LEGACY_DEFAULT_CREDENTIAL_REF);
      expect(connection?.authScheme).toEqual({ kind: "header", headerName: "x-api-key" });
      expect(connection?.validation.status).toBe("stale");
      const record = state?.credentials[LEGACY_DEFAULT_CREDENTIAL_REF];
      expect(record?.encryptedValue.startsWith(ENCRYPTED_VALUE_PREFIX)).toBe(true);
      expect(await decryptValue(record?.encryptedValue ?? "")).toBe(LEGACY_PLAINTEXT_KEY);
      // The plaintext key is absent from the stored AIConnectionState.
      // (Legacy appSettings intentionally keeps it until the E2 cutover.)
      expect(dumpStoreJson(memory.store, AI_CONNECTION_STATE_STORAGE_KEY)).not.toContain(LEGACY_PLAINTEXT_KEY);
    });
  });

  describe("E1-MIG-03 OpenAI existing key", () => {
    it("maps openai_chat_completions with bearer auth", async () => {
      memory.store.set("appSettings", legacySettings({ providerId: "openai", apiKey: LEGACY_PLAINTEXT_KEY, apiModel: "gpt-5.5" }));

      const result = await migrateLegacyAIConnectionState();
      expect(result.status).toBe("migrated");

      const state = await loadAIConnectionState();
      const connection = state?.connections[LEGACY_DEFAULT_CONNECTION_ID];
      expect(connection?.presetId).toBe("openai");
      expect(connection?.protocolOverride).toBeUndefined();
      expect(connection?.authScheme).toEqual({ kind: "bearer" });
      expect(connection?.selectedModelId).toBe("gpt-5.5");
    });
  });

  describe("E1-MIG-04 Gemini query-key auth mapping", () => {
    it("maps gemini_generate_content with query parameter key auth", async () => {
      memory.store.set("appSettings",
        legacySettings({
          providerId: "gemini",
          apiKey: LEGACY_PLAINTEXT_KEY,
          apiModel: "gemini-2.5-flash",
          customBaseUrl: "https://proxy.example.internal",
        }),
      );

      const result = await migrateLegacyAIConnectionState();
      expect(result.status).toBe("migrated");

      const state = await loadAIConnectionState();
      const connection = state?.connections[LEGACY_DEFAULT_CONNECTION_ID];
      expect(connection?.presetId).toBe("gemini");
      expect(connection?.protocolOverride).toBeUndefined();
      expect(connection?.authScheme).toEqual({ kind: "query", parameterName: "key" });
      // Runtime parity: callGemini never uses customBaseUrl, so no endpoint
      // override is recorded for the gemini protocol.
      expect(connection?.endpointOverride).toBeUndefined();
    });
  });

  describe("E1-MIG-05 Ollama no-key config", () => {
    it("maps none auth with the local preset endpoint", async () => {
      memory.store.set("appSettings", legacySettings({ providerId: "ollama", apiModel: "qwen3-vl" }));

      const result = await migrateLegacyAIConnectionState();
      expect(result.status).toBe("migrated");

      const state = await loadAIConnectionState();
      const connection = state?.connections[LEGACY_DEFAULT_CONNECTION_ID];
      expect(connection?.presetId).toBe("ollama");
      expect(connection?.authScheme).toEqual({ kind: "none" });
      expect(connection?.credentialRef).toBeUndefined();
      expect(connection?.validation.status).toBe("never_tested");
      const metadata = await getActiveConnectionMetadata();
      expect(metadata?.endpoint).toBe("http://localhost:11434");
      expect(metadata?.hasCredential).toBe(false);
    });
  });

  describe("E1-MIG-06 Custom OpenAI-compatible", () => {
    it("records the protocol and endpoint overrides with bearer auth", async () => {
      memory.store.set("appSettings",
        legacySettings({
          providerId: "custom",
          apiKey: LEGACY_PLAINTEXT_KEY,
          customBaseUrl: "https://gateway.example.internal/v1",
          customProviderProtocol: "openai",
        }),
      );

      const result = await migrateLegacyAIConnectionState();
      expect(result.status).toBe("migrated");

      const state = await loadAIConnectionState();
      const connection = state?.connections[LEGACY_DEFAULT_CONNECTION_ID];
      expect(connection?.presetId).toBe("custom");
      expect(connection?.protocolOverride).toBe("openai_chat_completions");
      expect(connection?.endpointOverride).toBe("https://gateway.example.internal/v1");
      expect(connection?.authScheme).toEqual({ kind: "bearer" });
    });
  });

  describe("E1-MIG-07 Custom Anthropic-compatible", () => {
    it("records the anthropic protocol override with x-api-key auth", async () => {
      memory.store.set("appSettings",
        legacySettings({
          providerId: "custom",
          apiKey: LEGACY_PLAINTEXT_KEY,
          customBaseUrl: "https://relay.example.internal",
          customProviderProtocol: "anthropic",
        }),
      );

      const result = await migrateLegacyAIConnectionState();
      expect(result.status).toBe("migrated");

      const state = await loadAIConnectionState();
      const connection = state?.connections[LEGACY_DEFAULT_CONNECTION_ID];
      expect(connection?.protocolOverride).toBe("anthropic_messages");
      expect(connection?.endpointOverride).toBe("https://relay.example.internal");
      expect(connection?.authScheme).toEqual({ kind: "header", headerName: "x-api-key" });
    });
  });

  describe("E1-MIG-08 legacy plaintext credential", () => {
    it("re-encrypts an unversioned plaintext value exactly once", async () => {
      memory.store.set("appSettings", legacySettings({ apiKey: LEGACY_RAW_VALUE_FIXTURE }));

      const result = await migrateLegacyAIConnectionState();
      expect(result.status).toBe("migrated");

      const state = await loadAIConnectionState();
      const record = state?.credentials[LEGACY_DEFAULT_CREDENTIAL_REF];
      expect(record?.encryptedValue.startsWith(ENCRYPTED_VALUE_PREFIX)).toBe(true);
      expect(await decryptValue(record?.encryptedValue ?? "")).toBe(LEGACY_RAW_VALUE_FIXTURE);
    });
  });

  describe("E1-MIG-09 legacy unversioned encrypted credential", () => {
    it("decodes the legacy ciphertext and re-encrypts into the versioned envelope", async () => {
      const legacyEnvelope = await encryptValue("legacy-ciphertext-secret");
      const legacyCiphertext = legacyEnvelope.slice(ENCRYPTED_VALUE_PREFIX.length);
      memory.store.set("appSettings", legacySettings({ apiKey: legacyCiphertext }));

      const result = await migrateLegacyAIConnectionState();
      expect(result.status).toBe("migrated");

      const state = await loadAIConnectionState();
      const record = state?.credentials[LEGACY_DEFAULT_CREDENTIAL_REF];
      expect(record?.encryptedValue.startsWith(ENCRYPTED_VALUE_PREFIX)).toBe(true);
      expect(await decryptValue(record?.encryptedValue ?? "")).toBe("legacy-ciphertext-secret");
    });
  });

  describe("E1-MIG-10 current qse:v1 credential", () => {
    it("moves the material without double-encrypting the envelope", async () => {
      const envelope = await encryptValue("qse-v1-persisted-secret");
      memory.store.set("appSettings", legacySettings({ apiKey: envelope }));

      const result = await migrateLegacyAIConnectionState();
      expect(result.status).toBe("migrated");

      const state = await loadAIConnectionState();
      const record = state?.credentials[LEGACY_DEFAULT_CREDENTIAL_REF];
      // A single decrypt yields the domain plaintext: the envelope was not
      // wrapped a second time.
      expect(await decryptValue(record?.encryptedValue ?? "")).toBe("qse-v1-persisted-secret");
      expect(record?.encryptedValue.startsWith(ENCRYPTED_VALUE_PREFIX)).toBe(true);
    });
  });

  describe("E1-MIG-11 tampered qse:v1 fails closed", () => {
    it("fails with a stable error, writes no state, and preserves legacy data", async () => {
      const envelope = tamperEnvelope(await encryptValue("tamper-target-secret"));
      memory.store.set("appSettings", legacySettings({ apiKey: envelope }));
      const legacyBefore = legacySnapshotJson();

      const result = await migrateLegacyAIConnectionState();

      expect(result.status).toBe("failed");
      if (result.status !== "failed") return;
      expect(result.code).toBe("LEGACY_CREDENTIAL_UNDECODABLE");
      await expectNoStateWritten();
      expect(legacySnapshotJson()).toBe(legacyBefore);
    });
  });

  describe("E1-MIG-12 existing valid AIConnectionState => no-op", () => {
    it("never rewrites or regenerates an already-migrated state", async () => {
      memory.store.set("appSettings", legacySettings({ apiKey: LEGACY_PLAINTEXT_KEY }));
      const first = await migrateLegacyAIConnectionState();
      expect(first.status).toBe("migrated");
      const storedBefore = JSON.stringify(memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY));

      const second = await migrateLegacyAIConnectionState();

      expect(second.status).toBe("already_migrated");
      expect(JSON.stringify(memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY))).toBe(storedBefore);
      const state = await loadAIConnectionState();
      expect(Object.keys(state?.connections ?? {})).toEqual([LEGACY_DEFAULT_CONNECTION_ID]);
    });
  });

  describe("E1-MIG-13 partial/malformed state => no destructive overwrite", () => {
    it("fails closed with a stable error and leaves both keys untouched", async () => {
      memory.store.set("appSettings", legacySettings({ apiKey: LEGACY_PLAINTEXT_KEY }));
      const malformed = { schemaVersion: 1, revision: 1, activeConnectionId: "conn_ghost", connections: {}, credentials: {} };
      memory.store.set(AI_CONNECTION_STATE_STORAGE_KEY, malformed);
      const legacyBefore = legacySnapshotJson();

      const result = await migrateLegacyAIConnectionState();

      expect(result.status).toBe("failed");
      if (result.status !== "failed") return;
      expect(result.code).toBe("AI_CONNECTION_STATE_MALFORMED");
      // The malformed state itself was not replaced or repaired.
      expect(memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY)).toEqual(malformed);
      expect(legacySnapshotJson()).toBe(legacyBefore);
    });
  });

  describe("E1-MIG-14 repeat migration => deterministic/idempotent", () => {
    it("produces the same stored state on every retry", async () => {
      memory.store.set("appSettings", legacySettings({ apiKey: LEGACY_PLAINTEXT_KEY }));

      const first = await migrateLegacyAIConnectionState();
      const storedAfterFirst = JSON.stringify(memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY));
      const second = await migrateLegacyAIConnectionState();
      const third = await migrateLegacyAIConnectionState();

      expect(second.status).toBe("already_migrated");
      expect(third.status).toBe("already_migrated");
      expect(JSON.stringify(memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY))).toBe(storedAfterFirst);
      expect((second.status === "already_migrated" ? second.state.revision : -1)).toBe(
        (first.status === "migrated" ? first.state.revision : -2),
      );
    });
  });

  describe("E1-MIG-15/16 revision initialization", () => {
    it("initializes credential, connection, and state revisions to 1", async () => {
      memory.store.set("appSettings", legacySettings({ apiKey: LEGACY_PLAINTEXT_KEY }));

      const result = await migrateLegacyAIConnectionState();
      expect(result.status).toBe("migrated");

      const state = await loadAIConnectionState();
      expect(state?.revision).toBe(1);
      expect(state?.connections[LEGACY_DEFAULT_CONNECTION_ID]?.connectionRevision).toBe(1);
      expect(state?.credentials[LEGACY_DEFAULT_CREDENTIAL_REF]?.revision).toBe(1);
    });
  });

  describe("unknown qse envelope version fails closed", () => {
    it("refuses to migrate a future envelope instead of copying it", async () => {
      memory.store.set("appSettings", legacySettings({ apiKey: LEGACY_UNKNOWN_ENVELOPE_FIXTURE }));
      const legacyBefore = legacySnapshotJson();

      const result = await migrateLegacyAIConnectionState();

      expect(result.status).toBe("failed");
      if (result.status !== "failed") return;
      expect(result.code).toBe("LEGACY_CREDENTIAL_UNDECODABLE");
      await expectNoStateWritten();
      expect(legacySnapshotJson()).toBe(legacyBefore);
    });
  });

  describe("security regressions", () => {
    it("metadata APIs expose no plaintext or envelope material after migration", async () => {
      memory.store.set("appSettings", legacySettings({ providerId: "openai", apiKey: LEGACY_PLAINTEXT_KEY }));

      await migrateLegacyAIConnectionState();
      const metadata = await getActiveConnectionMetadata();

      const serialized = JSON.stringify(metadata);
      expect(serialized).not.toContain(LEGACY_PLAINTEXT_KEY);
      expect(serialized).not.toContain("qse:v1:");
      expect(metadata?.hasCredential).toBe(true);
    });

    it("never logs plaintext credential material and never rewrites appSettings", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        memory.store.set("appSettings", legacySettings({ apiKey: LEGACY_PLAINTEXT_KEY }));
        await migrateLegacyAIConnectionState();

        memory.store.set("appSettings", legacySettings({ apiKey: tamperEnvelope(await encryptValue("second-run-secret")) }));
        await migrateLegacyAIConnectionState();

        const logged = consoleSpy.mock.calls
          .map((call) =>
            call
              .map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : JSON.stringify(arg) ?? String(arg)))
              .join(" "),
          )
          .join("\n");
        expect(logged).not.toContain(LEGACY_PLAINTEXT_KEY);
        expect(logged).not.toContain("second-run-secret");
      } finally {
        consoleSpy.mockRestore();
      }

      const appSettingsWrites = vi.mocked(memory.set).mock.calls.filter(([payload]) =>
        Object.keys(payload as Record<string, unknown>).includes("appSettings"),
      );
      expect(appSettingsWrites).toHaveLength(0);
    });
  });
});
