import { beforeEach, describe, expect, it, vi } from "vitest";
import { ENCRYPTED_VALUE_PREFIX, decryptValue } from "./encryption";
import {
  CredentialNotFoundError,
  clearCredential,
  getCredentialPresence,
  replaceCredential,
  resolveCredentialForRuntime,
  resolveCredentialRecordForRuntime,
} from "./credentialStore";
import {
  AI_CONNECTION_STATE_STORAGE_KEY,
  AIConnectionStateNotInitializedError,
  MalformedAIConnectionStateError,
  loadAIConnectionState,
  persistAIConnectionState,
} from "./aiConnectionState";
import { migrateLegacyAIConnectionState } from "./aiConnectionMigration";
import type { AIConnectionState, ValidationRecord } from "../types/connection";
import { dumpStoreJson, installMemoryStorage, type MemoryStorageHandle } from "../../test/memoryStorage";

const PLAINTEXT_CREDENTIAL = "sk-fake-runtime-key-12345";
const ENVELOPE_FIXTURE = "qse:v1:U0VFRF9FTlZFTE9QRQ";

interface SeedOverrides {
  validation?: ValidationRecord;
}

async function seedState(overrides: SeedOverrides = {}): Promise<void> {
  const validation: ValidationRecord = overrides.validation ?? {
    status: "validated",
    generation: 1,
    validatedConnectionRevision: 1,
    validatedCredentialRevision: 1,
    validatedAt: 1,
  };
  const state: AIConnectionState = {
    schemaVersion: 1,
    revision: 1,
    activeConnectionId: "conn_main",
    connections: {
      conn_main: {
        id: "conn_main",
        name: "Main",
        presetId: "openai",
        authScheme: { kind: "bearer" },
        credentialRef: "cred_main",
        selectedModelId: "gpt-5.5",
        connectionRevision: 1,
        validation,
        createdAt: 1,
        updatedAt: 1,
      },
    },
    credentials: {
      cred_main: {
        ref: "cred_main",
        type: "api_key",
        encryptedValue: ENVELOPE_FIXTURE,
        revision: 1,
        updatedAt: 1,
      },
    },
  };
  await persistAIConnectionState(state);
}

describe("credentialStore", () => {
  let memory: MemoryStorageHandle;

  beforeEach(async () => {
    memory = installMemoryStorage();
    await seedState();
  });

  describe("replaceCredential", () => {
    it("encrypts into a qse:v1 envelope, never persists plaintext, and returns only non-secret metadata", async () => {
      const result = await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);
      expect(result.ref).toBe("cred_main");
      expect(result.revision).toBe(2); // seeded record was revision 1
      // The committed updatedAt equals the stored record's updatedAt exactly.
      const stored = await loadAIConnectionState();
      expect(result.updatedAt).toBe(stored?.credentials.cred_main?.updatedAt);
      // The write result never exposes the envelope.
      expect(JSON.stringify(result)).not.toContain("qse:");
      expect(dumpStoreJson(memory.store)).not.toContain(PLAINTEXT_CREDENTIAL);
      expect(dumpStoreJson(memory.store, AI_CONNECTION_STATE_STORAGE_KEY)).toContain("qse:v1:");
    });

    it("round-trips through resolveCredentialForRuntime", async () => {
      await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);
      expect(await resolveCredentialForRuntime("cred_main")).toBe(PLAINTEXT_CREDENTIAL);
    });

    it("E1-RF01-CRED-01 invalidates a prior failed validation authority", async () => {
      await seedState({
        validation: {
          status: "failed",
          generation: 7,
          validatedConnectionRevision: 1,
          validatedCredentialRevision: 1,
          validatedAt: 42,
          errorCode: "HTTP_401",
        },
      });

      await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);

      const connection = (await loadAIConnectionState())?.connections.conn_main;
      expect(connection?.validation.status).toBe("stale");
      expect(connection?.validation.generation).toBe(8);
      expect(connection?.validation).not.toHaveProperty("errorCode");
      expect(connection?.validation).not.toHaveProperty("validatedAt");
      expect(connection?.validation).not.toHaveProperty("validatedCredentialRevision");
      // Connection metadata itself did not change.
      expect(connection?.connectionRevision).toBe(1);
    });

    it("E1-RF01-CRED-02 invalidates a testing validation and bumps its generation", async () => {
      await seedState({ validation: { status: "testing", generation: 3 } });

      await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);

      const connection = (await loadAIConnectionState())?.connections.conn_main;
      expect(connection?.validation.status).toBe("stale");
      expect(connection?.validation.generation).toBe(4);
      expect(connection?.validation).not.toHaveProperty("validatedCredentialRevision");
    });

    it("invalidates a validated connection (stale + bound revisions cleared + generation bump)", async () => {
      await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);

      const connection = (await loadAIConnectionState())?.connections.conn_main;
      expect(connection?.validation.status).toBe("stale");
      expect(connection?.validation.generation).toBe(2);
      expect(connection?.validation).not.toHaveProperty("validatedConnectionRevision");
      expect(connection?.validation).not.toHaveProperty("validatedCredentialRevision");
      expect(connection?.validation).not.toHaveProperty("validatedAt");
    });

    it("refuses empty plaintext without writing", async () => {
      const before = JSON.stringify(memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY));
      await expect(replaceCredential("cred_main", "")).rejects.toThrow();
      expect(JSON.stringify(memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY))).toBe(before);
    });
  });

  describe("getCredentialPresence", () => {
    it("reports presence and non-secret metadata only", async () => {
      expect(await getCredentialPresence("cred_absent")).toEqual({ exists: false });
      await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);
      const presence = await getCredentialPresence("cred_main");
      expect(presence.exists).toBe(true);
      expect(presence.revision).toBe(2); // seeded record was revision 1
      expect(JSON.stringify(presence)).not.toContain(PLAINTEXT_CREDENTIAL);
      expect(JSON.stringify(presence)).not.toContain("qse:v1:");
    });
  });

  describe("clearCredential", () => {
    it("removes the record, drops the connection reference, and is idempotent", async () => {
      await clearCredential("cred_main");

      let state = await loadAIConnectionState();
      expect(state?.credentials.cred_main).toBeUndefined();
      expect(state?.connections.conn_main?.credentialRef).toBeUndefined();

      const revisionBefore = state?.revision;
      await clearCredential("cred_main");
      state = await loadAIConnectionState();
      expect(state?.revision).toBe(revisionBefore);
    });

    it("E1-RF01-CRED-03 increments connectionRevision of referencing connections", async () => {
      await clearCredential("cred_main");
      const connection = (await loadAIConnectionState())?.connections.conn_main;
      expect(connection?.connectionRevision).toBe(2);
    });

    it("E1-RF01-CRED-04 refreshes the connection updatedAt", async () => {
      const before = (await loadAIConnectionState())?.connections.conn_main?.updatedAt;
      await clearCredential("cred_main");
      const after = (await loadAIConnectionState())?.connections.conn_main?.updatedAt;
      // The seed sets updatedAt to 1; clearing runtime-relevant metadata must
      // actually move the timestamp forward.
      expect(after).toBeDefined();
      expect((after ?? 0)).toBeGreaterThan(before ?? 0);
    });

    it("E1-RF01-CRED-05 invalidates the validation authority of referencing connections", async () => {
      await clearCredential("cred_main");
      const connection = (await loadAIConnectionState())?.connections.conn_main;
      expect(connection?.validation.status).toBe("stale");
      expect(connection?.validation.generation).toBe(2);
      expect(connection?.validation).not.toHaveProperty("validatedConnectionRevision");
      expect(connection?.validation).not.toHaveProperty("validatedCredentialRevision");
      expect(connection?.validation).not.toHaveProperty("validatedAt");
    });
  });

  describe("resolveCredentialForRuntime fails closed", () => {
    it("decrypts an exact snapshot without reading connection storage after rotation", async () => {
      await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);
      const record = (await loadAIConnectionState())!.credentials.cred_main;
      await replaceCredential("cred_main", "sk-new-snapshot-secret");
      memory.get.mockClear();
      expect(await resolveCredentialRecordForRuntime(record)).toBe(PLAINTEXT_CREDENTIAL);
      expect(memory.get.mock.calls.some(([key]) => key === AI_CONNECTION_STATE_STORAGE_KEY)).toBe(false);
    });

    it.each(["", "plaintext-secret", "qse:v9:QUJD"])("rejects unsupported snapshot material safely: %s", async (encryptedValue) => {
      const record = { ref: "cred_main", type: "api_key" as const, encryptedValue, revision: 1, updatedAt: 1 };
      await expect(resolveCredentialRecordForRuntime(record)).rejects.toThrow("Credential snapshot could not be decrypted");
    });
    it("throws on an unknown ref instead of returning empty material", async () => {
      await expect(resolveCredentialForRuntime("cred_missing")).rejects.toBeInstanceOf(CredentialNotFoundError);
    });

    it("rejects a tampered qse:v1 envelope", async () => {
      await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);
      const state = (await loadAIConnectionState()) as AIConnectionState;
      const record = state.credentials.cred_main;
      const payload = record.encryptedValue.slice(ENCRYPTED_VALUE_PREFIX.length);
      const middle = Math.floor(payload.length / 2);
      const tampered =
        record.encryptedValue.slice(0, ENCRYPTED_VALUE_PREFIX.length) +
        payload.slice(0, middle) +
        (payload[middle] === "A" ? "B" : "A") +
        payload.slice(middle + 1);
      state.credentials.cred_main.encryptedValue = tampered;
      await persistAIConnectionState(state);

      const result = await resolveCredentialForRuntime("cred_main").catch(() => "FAILED_CLOSED");
      expect(result).toBe("FAILED_CLOSED");
    });

    it("rejects an unknown qse envelope version (state validation gates before decrypt)", async () => {
      // Corrupt storage directly (bypassing the validating write path) to
      // simulate a future envelope version landing on disk.
      const raw = JSON.parse(JSON.stringify(memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY))) as AIConnectionState;
      raw.credentials.cred_main.encryptedValue = "qse:v9:QUJD";
      memory.store.set(AI_CONNECTION_STATE_STORAGE_KEY, raw);

      // Since Review Fix 01 the state validator only accepts the current
      // qse:v1 envelope, so an unknown version fails closed at load time.
      await expect(resolveCredentialForRuntime("cred_main")).rejects.toBeInstanceOf(
        MalformedAIConnectionStateError,
      );
      // The raw decrypt path independently fails closed on unknown versions.
      await expect(decryptValue("qse:v9:QUJD")).rejects.toThrow();
    });
  });

  describe("E1-RF01-INIT-01 absent-state mutation cannot consume the migration marker", () => {
    it("replaceCredential fails with a stable error, writes no state, and migration still works", async () => {
      memory = installMemoryStorage();
      memory.store.set("appSettings", {
        providerId: "anthropic",
        apiKey: PLAINTEXT_CREDENTIAL,
        apiModel: "claude-opus-4.8",
      });

      await expect(replaceCredential("cred_new", PLAINTEXT_CREDENTIAL)).rejects.toBeInstanceOf(
        AIConnectionStateNotInitializedError,
      );
      await expect(clearCredential("cred_new")).rejects.toBeInstanceOf(AIConnectionStateNotInitializedError);
      // The absent key stays absent: the migration eligibility marker was not consumed.
      expect(memory.store.has(AI_CONNECTION_STATE_STORAGE_KEY)).toBe(false);

      // After the failed mutation, migration still runs normally from legacy AppSettings.
      const result = await migrateLegacyAIConnectionState();
      expect(result.status).toBe("migrated");
      const state = await loadAIConnectionState();
      expect(state?.activeConnectionId).toBe("conn_legacy_default");
      expect(await resolveCredentialForRuntime("cred_legacy_default")).toBe(PLAINTEXT_CREDENTIAL);
    });
  });

  it("does not log plaintext material on failures", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);
      const raw = JSON.parse(JSON.stringify(memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY))) as AIConnectionState;
      raw.credentials.cred_main.encryptedValue = "qse:v9:QUJD";
      memory.store.set(AI_CONNECTION_STATE_STORAGE_KEY, raw);
      await resolveCredentialForRuntime("cred_main").catch(() => undefined);

      const logged = consoleSpy.mock.calls
        .map((call) =>
          call.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : JSON.stringify(arg) ?? String(arg))).join(" "),
        )
        .join("\n");
      expect(logged).not.toContain(PLAINTEXT_CREDENTIAL);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
