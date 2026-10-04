import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIConnectionState, Connection } from "../types/connection";
import {
  AI_CONNECTION_STATE_STORAGE_KEY,
  AIConnectionStateNotInitializedError,
  MalformedAIConnectionStateError,
  createEmptyAIConnectionState,
  getActiveConnectionMetadata,
  getConnectionMetadata,
  invalidateConnectionValidation,
  loadAIConnectionState,
  persistAIConnectionState,
  updateAIConnectionState,
  validateAIConnectionState,
  withAIConnectionStateWriteLock,
} from "./aiConnectionState";
import { dumpStoreJson, installMemoryStorage, type MemoryStorageHandle } from "../../test/memoryStorage";

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn_test",
    name: "Test Connection",
    presetId: "anthropic",
    authScheme: { kind: "header", headerName: "x-api-key" },
    selectedModelId: "claude-opus-4.8",
    connectionRevision: 1,
    validation: { status: "never_tested", generation: 0 },
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function makeState(overrides: Partial<AIConnectionState> = {}): AIConnectionState {
  const connection = overrides.connections
    ? Object.values(overrides.connections)[0]
    : makeConnection();
  return {
    schemaVersion: 1,
    revision: 1,
    activeConnectionId: connection ? connection.id : null,
    connections: connection ? { [connection.id]: connection } : {},
    credentials: {},
    ...overrides,
  };
}

describe("aiConnectionState", () => {
  let memory: MemoryStorageHandle;

  beforeEach(() => {
    memory = installMemoryStorage();
  });

  describe("loadAIConnectionState", () => {
    it("returns null when the key is absent (migration eligibility marker)", async () => {
      expect(await loadAIConnectionState()).toBeNull();
    });

    it("round-trips a valid state", async () => {
      const state = makeState();
      await persistAIConnectionState(state);
      const loaded = await loadAIConnectionState();
      expect(loaded).toEqual(state);
    });

    it("throws MalformedAIConnectionStateError on a malformed state instead of repairing it", async () => {
      memory.store.set(AI_CONNECTION_STATE_STORAGE_KEY, { schemaVersion: 2, revision: 1 });
      await expect(loadAIConnectionState()).rejects.toBeInstanceOf(MalformedAIConnectionStateError);
    });
  });

  describe("validateAIConnectionState", () => {
    it("rejects wrong schemaVersion, non-object state, and bad revision", () => {
      expect(() => validateAIConnectionState(null)).toThrow(MalformedAIConnectionStateError);
      expect(() => validateAIConnectionState([1])).toThrow(MalformedAIConnectionStateError);
      expect(() => validateAIConnectionState({ ...makeState(), schemaVersion: 2 })).toThrow(MalformedAIConnectionStateError);
      expect(() => validateAIConnectionState({ ...makeState(), revision: 0 })).toThrow(MalformedAIConnectionStateError);
      expect(() => validateAIConnectionState({ ...makeState(), revision: 1.5 })).toThrow(MalformedAIConnectionStateError);
    });

    it("rejects an activeConnectionId that references no connection", () => {
      expect(() => validateAIConnectionState({ ...makeState(), activeConnectionId: "conn_missing" })).toThrow(
        MalformedAIConnectionStateError,
      );
    });

    it("rejects unknown preset ids, protocols, and auth schemes", () => {
      expect(() =>
        validateAIConnectionState(makeState({ connections: { conn_test: makeConnection({ authScheme: { kind: "bogus" } as never }) } })),
      ).toThrow(MalformedAIConnectionStateError);
      expect(() =>
        validateAIConnectionState(makeState({ connections: { conn_test: makeConnection({ protocolOverride: "gpt_wire" as never }) } })),
      ).toThrow(MalformedAIConnectionStateError);
      expect(() =>
        validateAIConnectionState(makeState({ connections: { conn_test: makeConnection({ authScheme: { kind: "header" } as never }) } })),
      ).toThrow(MalformedAIConnectionStateError);
    });

    it("rejects a credentialRef without a matching credential record", () => {
      expect(() =>
        validateAIConnectionState(makeState({ connections: { conn_test: makeConnection({ credentialRef: "cred_missing" }) } })),
      ).toThrow(MalformedAIConnectionStateError);
    });

    it("rejects plaintext credential material (defense in depth, save fails closed)", async () => {
      const plaintextState = makeState({
        credentials: {
          cred_test: {
            ref: "cred_test",
            type: "api_key",
            encryptedValue: "sk-plaintext-key-value",
            revision: 1,
            updatedAt: 1,
          },
        },
      });
      expect(() => validateAIConnectionState(plaintextState)).toThrow(MalformedAIConnectionStateError);
      await expect(persistAIConnectionState(plaintextState)).rejects.toBeInstanceOf(MalformedAIConnectionStateError);
      expect(memory.store.has(AI_CONNECTION_STATE_STORAGE_KEY)).toBe(false);
    });

    it("E1-RF01-ENV-01 rejects unknown qse envelope versions in schemaVersion-1 state", () => {
      const futureEnvelopeState = makeState({
        credentials: {
          cred_test: {
            ref: "cred_test",
            type: "api_key",
            encryptedValue: "qse:v9:QUJD",
            revision: 1,
            updatedAt: 1,
          },
        },
      });
      futureEnvelopeState.connections.conn_test.credentialRef = "cred_test";
      expect(() => validateAIConnectionState(futureEnvelopeState)).toThrow(MalformedAIConnectionStateError);
      // The exact current envelope remains valid.
      const currentEnvelopeState = makeState({
        credentials: {
          cred_test: {
            ref: "cred_test",
            type: "api_key",
            encryptedValue: "qse:v1:QUJDREVGRw",
            revision: 1,
            updatedAt: 1,
          },
        },
      });
      currentEnvelopeState.connections.conn_test.credentialRef = "cred_test";
      expect(() => validateAIConnectionState(currentEnvelopeState)).not.toThrow();
    });
  });

  describe("metadata APIs", () => {
    it("expose resolved protocol/endpoint and credential presence, never secret material", async () => {
      await persistAIConnectionState({
        schemaVersion: 1,
        revision: 1,
        activeConnectionId: "conn_custom",
        connections: {
          conn_custom: makeConnection({
            id: "conn_custom",
            presetId: "custom",
            protocolOverride: "anthropic_messages",
            endpointOverride: "https://gateway.example.internal",
            credentialRef: "cred_custom",
            authScheme: { kind: "header", headerName: "x-api-key" },
          }),
        },
        credentials: {
          cred_custom: {
            ref: "cred_custom",
            type: "api_key",
            encryptedValue: "qse:v1:QUJDREVGR0hJSktMTU5PUA",
            revision: 3,
            updatedAt: 5,
          },
        },
      });

      const metadata = await getActiveConnectionMetadata();
      expect(metadata).toMatchObject({
        id: "conn_custom",
        protocol: "anthropic_messages",
        endpoint: "https://gateway.example.internal",
        hasCredential: true,
        credentialRevision: 3,
      });
      const serialized = JSON.stringify(metadata);
      expect(serialized).not.toContain("qse:v1:");
      expect(serialized).not.toContain("encryptedValue");

      const byId = await getConnectionMetadata("conn_custom");
      expect(byId?.id).toBe("conn_custom");
      expect(await getConnectionMetadata("conn_absent")).toBeNull();
    });

    it("returns null when no state or no active connection exists", async () => {
      expect(await getActiveConnectionMetadata()).toBeNull();
      await persistAIConnectionState(createEmptyAIConnectionState());
      expect(await getActiveConnectionMetadata()).toBeNull();
    });
  });

  describe("updateAIConnectionState", () => {
    it("applies the mutator and bumps the whole-state revision", async () => {
      await persistAIConnectionState(makeState());
      const result = await updateAIConnectionState((state) => {
        const connection = state.connections.conn_test;
        connection.selectedModelId = "claude-sonnet-4.6";
        connection.connectionRevision += 1;
        return state;
      });
      expect(result?.revision).toBe(2);
      const stored = await loadAIConnectionState();
      expect(stored?.connections.conn_test?.selectedModelId).toBe("claude-sonnet-4.6");
      expect(stored?.revision).toBe(2);
    });

    it("writes nothing when the mutator returns null", async () => {
      await persistAIConnectionState(makeState());
      const writesBefore = vi.mocked(memory.set).mock.calls.length;
      expect(await updateAIConnectionState(() => null)).toBeNull();
      expect(vi.mocked(memory.set).mock.calls.length).toBe(writesBefore);
    });

    it("fails closed on a malformed base state", async () => {
      memory.store.set(AI_CONNECTION_STATE_STORAGE_KEY, { schemaVersion: 1 });
      await expect(updateAIConnectionState((state) => state)).rejects.toBeInstanceOf(
        MalformedAIConnectionStateError,
      );
      expect(memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY)).toEqual({ schemaVersion: 1 });
    });

    it("E1-RF01-INIT (state layer) refuses to mutate absent state instead of auto-initializing", async () => {
      await expect(updateAIConnectionState((state) => state)).rejects.toBeInstanceOf(
        AIConnectionStateNotInitializedError,
      );
      expect(memory.store.has(AI_CONNECTION_STATE_STORAGE_KEY)).toBe(false);
    });
  });

  describe("E1-RF01-CONC owner-context write lock", () => {
    it("E1-RF01-CONC-01 serializes concurrent same-owner mutations so no update is lost", async () => {
      await persistAIConnectionState(makeState());

      // Without serialization both mutations would read revision 1 and the
      // second write would clobber the first ("A" lost).
      const [, second] = await Promise.all([
        updateAIConnectionState((state) => {
          state.connections.conn_test.name = "A";
          return state;
        }),
        updateAIConnectionState((state) => {
          state.connections.conn_test.name = `${state.connections.conn_test.name}-B`;
          return state;
        }),
      ]);

      const stored = await loadAIConnectionState();
      // The second mutation observed the first one's committed result.
      expect(second?.connections.conn_test?.name).toBe("A-B");
      expect(stored?.connections.conn_test?.name).toBe("A-B");
      expect(stored?.revision).toBe(3);
    });

    it("E1-RF01-CONC-02 keeps the queue usable after a mutation rejects", async () => {
      await persistAIConnectionState(makeState());

      await expect(
        updateAIConnectionState(() => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      // The failed mutation wrote nothing...
      expect((await loadAIConnectionState())?.revision).toBe(1);

      // ...and the next mutation still executes.
      const result = await updateAIConnectionState((state) => {
        state.connections.conn_test.selectedModelId = "claude-haiku-4.5";
        return state;
      });
      expect(result?.revision).toBe(2);
      const stored = await loadAIConnectionState();
      expect(stored?.connections.conn_test?.selectedModelId).toBe("claude-haiku-4.5");
    });

    it("serializes lock users that do not go through updateAIConnectionState", async () => {
      const order: string[] = [];
      await Promise.all([
        withAIConnectionStateWriteLock(async () => {
          order.push("first-start");
          await new Promise((resolve) => setTimeout(resolve, 20));
          order.push("first-end");
        }),
        withAIConnectionStateWriteLock(async () => {
          order.push("second-start");
        }),
      ]);
      expect(order).toEqual(["first-start", "first-end", "second-start"]);
    });
  });

  describe("invalidateConnectionValidation", () => {
    it("demotes current authorities (validated/failed/testing/stale) to stale and clears bound data", () => {
      for (const status of ["validated", "failed", "testing", "stale"] as const) {
        const connection = makeConnection({
          validation: {
            status,
            generation: 4,
            validatedConnectionRevision: 2,
            validatedCredentialRevision: 3,
            validatedAt: 12345,
            errorCode: status === "validated" ? undefined : "SOME_CODE",
          },
        });
        invalidateConnectionValidation(connection);
        expect(connection.validation.status).toBe("stale");
        expect(connection.validation.generation).toBe(5);
        expect(connection.validation).not.toHaveProperty("validatedConnectionRevision");
        expect(connection.validation).not.toHaveProperty("validatedCredentialRevision");
        expect(connection.validation).not.toHaveProperty("validatedAt");
        expect(connection.validation).not.toHaveProperty("errorCode");
      }
    });

    it("keeps never_tested but still increments generation for consistent semantics", () => {
      const connection = makeConnection({ validation: { status: "never_tested", generation: 2 } });
      invalidateConnectionValidation(connection);
      expect(connection.validation.status).toBe("never_tested");
      expect(connection.validation.generation).toBe(3);
    });
  });

  describe("plaintext leak regression", () => {
    it("the stored dump of a state with credentials contains no plaintext domain key", async () => {
      const plaintext = "sk-ant-regression-probe";
      const state = makeState({
        credentials: {
          cred_test: {
            ref: "cred_test",
            type: "api_key",
            encryptedValue: "qse:v1:QUJDREVGR0hJSktMTU5PUA",
            revision: 1,
            updatedAt: 1,
          },
        },
      });
      state.connections.conn_test.credentialRef = "cred_test";
      await persistAIConnectionState(state);
      expect(dumpStoreJson(memory.store)).not.toContain(plaintext);
      expect(dumpStoreJson(memory.store)).toContain("qse:v1:");
    });
  });
});
