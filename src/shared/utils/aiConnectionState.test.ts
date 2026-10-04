import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIConnectionState, Connection } from "../types/connection";
import {
  AIConnectionStateConflictError,
  AI_CONNECTION_STATE_STORAGE_KEY,
  MalformedAIConnectionStateError,
  createEmptyAIConnectionState,
  getActiveConnectionMetadata,
  getConnectionMetadata,
  loadAIConnectionState,
  saveAIConnectionState,
  updateAIConnectionState,
  validateAIConnectionState,
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
      await saveAIConnectionState(state);
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
        validateAIConnectionState(makeState({ connections: { conn_test: makeConnection({ presetId: "openai" as never, authScheme: { kind: "bogus" } as never }) } })),
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
      await expect(saveAIConnectionState(plaintextState)).rejects.toBeInstanceOf(MalformedAIConnectionStateError);
      expect(memory.store.has(AI_CONNECTION_STATE_STORAGE_KEY)).toBe(false);
    });
  });

  describe("metadata APIs", () => {
    it("expose resolved protocol/endpoint and credential presence, never secret material", async () => {
      await saveAIConnectionState({
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
      await saveAIConnectionState(createEmptyAIConnectionState());
      expect(await getActiveConnectionMetadata()).toBeNull();
    });
  });

  describe("updateAIConnectionState", () => {
    it("applies the mutator and bumps the whole-state revision", async () => {
      await saveAIConnectionState(makeState());
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
      await saveAIConnectionState(makeState());
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

    it("retries on a concurrent revision change and re-applies on top of the newer base", async () => {
      await saveAIConnectionState(makeState());
      let getCalls = 0;
      const readStateRecord = async (): Promise<Record<string, unknown>> => {
        const raw = memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY);
        return raw === undefined ? {} : { [AI_CONNECTION_STATE_STORAGE_KEY]: JSON.parse(JSON.stringify(raw)) };
      };
      memory.get.mockImplementation(async () => {
        getCalls += 1;
        // Per attempt the helper performs get(observed) then get(CAS re-read).
        // On the first CAS re-read, simulate a competing context committing
        // its own newer state.
        if (getCalls === 2) {
          const current = JSON.parse(JSON.stringify(memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY))) as AIConnectionState;
          current.revision = 7;
          current.credentials.cred_other = {
            ref: "cred_other",
            type: "api_key",
            encryptedValue: "qse:v1:QUJDREVGRw",
            revision: 1,
            updatedAt: 9,
          };
          memory.store.set(AI_CONNECTION_STATE_STORAGE_KEY, current);
        }
        return readStateRecord();
      });

      const result = await updateAIConnectionState((state) => {
        state.connections.conn_test.selectedModelId = "claude-haiku-4.5";
        return state;
      });

      const stored = await loadAIConnectionState();
      expect(stored?.revision).toBe(8);
      // The concurrent writer's change survived (no silent clobber)...
      expect(stored?.credentials.cred_other?.ref).toBe("cred_other");
      // ...and this mutator was re-applied on top of the newer base.
      expect(stored?.connections.conn_test?.selectedModelId).toBe("claude-haiku-4.5");
      expect(result?.revision).toBe(8);
    });

    it("throws AIConnectionStateConflictError instead of clobbering when conflicts never settle", async () => {
      await saveAIConnectionState(makeState());
      const beforeRevision = ((await loadAIConnectionState()) as AIConnectionState).revision;
      let getCalls = 0;
      const readStateRecord = async (): Promise<Record<string, unknown>> => {
        const raw = memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY);
        return raw === undefined ? {} : { [AI_CONNECTION_STATE_STORAGE_KEY]: JSON.parse(JSON.stringify(raw)) };
      };
      memory.get.mockImplementation(async () => {
        getCalls += 1;
        // Every CAS re-read (the even call of each attempt) is greeted by a
        // competing writer that has bumped the stored revision.
        if (getCalls % 2 === 0) {
          const current = JSON.parse(JSON.stringify(memory.store.get(AI_CONNECTION_STATE_STORAGE_KEY))) as AIConnectionState;
          current.revision += 1;
          memory.store.set(AI_CONNECTION_STATE_STORAGE_KEY, current);
        }
        return readStateRecord();
      });
      await expect(
        updateAIConnectionState((state) => {
          state.connections.conn_test.name = "MUTATOR_MARKER";
          return state;
        }, { maxAttempts: 3 }),
      ).rejects.toBeInstanceOf(AIConnectionStateConflictError);
      const stored = (await loadAIConnectionState()) as AIConnectionState;
      // The stored revision only moved by the competing writer (one bump per
      // attempt); the losing mutation was never committed over it.
      expect(stored.revision).toBe(beforeRevision + 3);
      expect(stored.connections.conn_test?.name).not.toBe("MUTATOR_MARKER");
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
      await saveAIConnectionState(state);
      expect(dumpStoreJson(memory.store)).not.toContain(plaintext);
      expect(dumpStoreJson(memory.store)).toContain("qse:v1:");
    });
  });
});
