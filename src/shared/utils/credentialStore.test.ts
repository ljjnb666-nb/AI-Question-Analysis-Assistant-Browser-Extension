import { beforeEach, describe, expect, it, vi } from "vitest";
import { ENCRYPTED_VALUE_PREFIX, UnsupportedCredentialFormatError } from "./encryption";
import {
  CredentialNotFoundError,
  clearCredential,
  getCredentialPresence,
  replaceCredential,
  resolveCredentialForRuntime,
} from "./credentialStore";
import { AI_CONNECTION_STATE_STORAGE_KEY, loadAIConnectionState, saveAIConnectionState } from "./aiConnectionState";
import type { AIConnectionState } from "../types/connection";
import { dumpStoreJson, installMemoryStorage, type MemoryStorageHandle } from "../../test/memoryStorage";

const PLAINTEXT_CREDENTIAL = "sk-fake-runtime-key-12345";

async function seedState(): Promise<void> {
  await saveAIConnectionState({
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
        validation: { status: "validated", generation: 1, validatedConnectionRevision: 1, validatedCredentialRevision: 1 },
        createdAt: 1,
        updatedAt: 1,
      },
    },
    credentials: {
      cred_main: {
        ref: "cred_main",
        type: "api_key",
        encryptedValue: "qse:v1:U0VFRF9FTlZFTE9QRQ",
        revision: 1,
        updatedAt: 1,
      },
    },
  });
}

describe("credentialStore", () => {
  let memory: MemoryStorageHandle;

  beforeEach(async () => {
    memory = installMemoryStorage();
    await seedState();
  });

  describe("replaceCredential", () => {
    it("encrypts into a qse:v1 envelope and never persists plaintext", async () => {
      const record = await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);
      expect(record.revision).toBe(2); // seeded record was revision 1
      expect(record.encryptedValue.startsWith(ENCRYPTED_VALUE_PREFIX)).toBe(true);
      expect(dumpStoreJson(memory.store)).not.toContain(PLAINTEXT_CREDENTIAL);
      expect(dumpStoreJson(memory.store, AI_CONNECTION_STATE_STORAGE_KEY)).toContain("qse:v1:");
    });

    it("round-trips through resolveCredentialForRuntime", async () => {
      await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);
      expect(await resolveCredentialForRuntime("cred_main")).toBe(PLAINTEXT_CREDENTIAL);
    });

    it("increments the credential revision on replacement and marks bound validations stale", async () => {
      await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);
      const second = await replaceCredential("cred_main", "sk-fake-rotated-key-67890");
      expect(second.revision).toBe(3);

      const state = await loadAIConnectionState();
      expect(state?.credentials.cred_main?.revision).toBe(3);
      // A validation bound to credential revision 1 can no longer be honored.
      expect(state?.connections.conn_main?.validation.status).toBe("stale");
      expect(dumpStoreJson(memory.store)).not.toContain("sk-fake-rotated-key-67890");
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
      await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);
      await clearCredential("cred_main");

      let state = await loadAIConnectionState();
      expect(state?.credentials.cred_main).toBeUndefined();
      expect(state?.connections.conn_main?.credentialRef).toBeUndefined();

      const revisionBefore = state?.revision;
      await clearCredential("cred_main");
      state = await loadAIConnectionState();
      expect(state?.revision).toBe(revisionBefore);
    });
  });

  describe("resolveCredentialForRuntime fails closed", () => {
    it("throws on an unknown ref instead of returning empty material", async () => {
      await expect(resolveCredentialForRuntime("cred_missing")).rejects.toBeInstanceOf(CredentialNotFoundError);
    });

    it("rejects a tampered qse:v1 envelope", async () => {
      const record = await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);
      const payload = record.encryptedValue.slice(ENCRYPTED_VALUE_PREFIX.length);
      const middle = Math.floor(payload.length / 2);
      const tampered =
        record.encryptedValue.slice(0, ENCRYPTED_VALUE_PREFIX.length) +
        payload.slice(0, middle) +
        (payload[middle] === "A" ? "B" : "A") +
        payload.slice(middle + 1);

      const state = (await loadAIConnectionState()) as AIConnectionState;
      state.credentials.cred_main.encryptedValue = tampered;
      await saveAIConnectionState(state);

      await expect(resolveCredentialForRuntime("cred_main")).rejects.toThrow();
      // The stored tampered material never yields the plaintext.
      expect(await resolveCredentialForRuntime("cred_main").catch(() => "FAILED_CLOSED")).toBe("FAILED_CLOSED");
    });

    it("rejects an unknown qse envelope version", async () => {
      await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);
      const state = (await loadAIConnectionState()) as AIConnectionState;
      state.credentials.cred_main.encryptedValue = "qse:v9:QUJD";
      await saveAIConnectionState(state);

      const err = await resolveCredentialForRuntime("cred_main").catch((caught: unknown) => caught);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error & { cause?: unknown }).cause).toBeInstanceOf(UnsupportedCredentialFormatError);
    });
  });

  it("does not log plaintext material on failures", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await replaceCredential("cred_main", PLAINTEXT_CREDENTIAL);
      const state = (await loadAIConnectionState()) as AIConnectionState;
      state.credentials.cred_main.encryptedValue = "qse:v9:QUJD";
      await saveAIConnectionState(state);
      await resolveCredentialForRuntime("cred_main").catch(() => undefined);

      const logged = consoleSpy.mock.calls.map((call) => call.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg))).join(" ")).join("\n");
      expect(logged).not.toContain(PLAINTEXT_CREDENTIAL);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
