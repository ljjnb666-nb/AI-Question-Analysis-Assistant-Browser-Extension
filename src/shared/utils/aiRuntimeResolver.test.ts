import { beforeEach, describe, expect, it } from "vitest";
import { ENCRYPTED_VALUE_PREFIX, encryptValue } from "./encryption";
import {
  AIRuntimeResolutionError,
  resolveActiveAIConnectionRuntimeMetadata,
  resolveRuntimeCredential,
} from "./aiRuntimeResolver";
import {
  AI_CONNECTION_STATE_STORAGE_KEY,
  loadAIConnectionState,
  persistAIConnectionState,
  updateAIConnectionState,
} from "./aiConnectionState";
import { replaceCredential } from "./credentialStore";
import type { AIConnectionState, Connection } from "../types/connection";
import { installMemoryStorage } from "../../test/memoryStorage";

const PLAINTEXT_CREDENTIAL = "sk-e2a-runtime-test-material";

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn_main",
    name: "Main",
    presetId: "anthropic",
    authScheme: { kind: "header", headerName: "x-api-key" },
    credentialRef: "cred_main",
    selectedModelId: "claude-opus-4.8",
    connectionRevision: 4,
    validation: { status: "stale", generation: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function seedState(
  connection: Connection = makeConnection(),
  options: { withCredential?: boolean } = {},
): Promise<void> {
  const withCredential = options.withCredential ?? Boolean(connection.credentialRef);
  const state: AIConnectionState = {
    schemaVersion: 1,
    revision: 10,
    activeConnectionId: connection.id,
    connections: { [connection.id]: connection },
    credentials: withCredential
      ? {
          [connection.credentialRef ?? "cred_main"]: {
            ref: connection.credentialRef ?? "cred_main",
            type: "api_key",
            encryptedValue: "qse:v1:RUNTIMEFIXTURE",
            revision: 6,
            updatedAt: 2,
          },
        }
      : {},
  };
  await persistAIConnectionState(state);
}

async function expectErrorCode(promise: Promise<unknown>, code: string): Promise<AIRuntimeResolutionError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AIRuntimeResolutionError);
  expect((error as AIRuntimeResolutionError).code).toBe(code);
  return error as AIRuntimeResolutionError;
}

describe("resolveActiveAIConnectionRuntimeMetadata", () => {
  let memory: ReturnType<typeof installMemoryStorage>;

  beforeEach(() => {
    memory = installMemoryStorage();
  });

  it("E2A-RUN-01 resolves an Anthropic active connection", async () => {
    await seedState();

    const config = await resolveActiveAIConnectionRuntimeMetadata();

    expect(config).toMatchObject({
      connectionId: "conn_main",
      connectionRevision: 4,
      presetId: "anthropic",
      protocol: "anthropic_messages",
      endpoint: "https://api.anthropic.com",
      endpointProvenance: "canonical_builtin_endpoint",
      authScheme: { kind: "header", headerName: "x-api-key" },
      requiresCredential: true,
      credentialRef: "cred_main",
      credentialRevision: 6,
      selectedModelId: "claude-opus-4.8",
    });
    expect(config.modelCapabilityAssessment.vision).toEqual({ value: true, confidence: "legacy_declared" });
    expect(config.transportCapabilities.inlineBase64).toEqual({ value: true, confidence: "legacy_declared" });
    expect(config.transportCapabilities.adapterEncoding.inlineBase64).toEqual({
      value: true,
      confidence: "known_static",
    });
  });

  it("E2A-RUN-02 resolves an OpenAI bearer connection", async () => {
    await seedState(
      makeConnection({
        presetId: "openai",
        authScheme: { kind: "bearer" },
        selectedModelId: "gpt-5.5",
      }),
    );

    const config = await resolveActiveAIConnectionRuntimeMetadata();

    expect(config).toMatchObject({
      presetId: "openai",
      protocol: "openai_chat_completions",
      endpoint: "https://api.openai.com",
      endpointProvenance: "canonical_builtin_endpoint",
      authScheme: { kind: "bearer" },
      requiresCredential: true,
    });
  });

  it("E2A-RUN-03 resolves a Gemini query-auth connection", async () => {
    await seedState(
      makeConnection({
        presetId: "gemini",
        authScheme: { kind: "query", parameterName: "key" },
        selectedModelId: "gemini-2.5-flash",
      }),
    );

    const config = await resolveActiveAIConnectionRuntimeMetadata();

    expect(config).toMatchObject({
      presetId: "gemini",
      protocol: "gemini_generate_content",
      endpoint: "https://generativelanguage.googleapis.com",
      authScheme: { kind: "query", parameterName: "key" },
      requiresCredential: true,
    });
  });

  it("E2A-RUN-04 + E2A-RUN-10 resolves Ollama without any credential", async () => {
    await seedState(
      makeConnection({
        id: "conn_local",
        presetId: "ollama",
        authScheme: { kind: "none" },
        credentialRef: undefined,
        selectedModelId: "qwen3-vl",
      }),
      { withCredential: false },
    );

    const config = await resolveActiveAIConnectionRuntimeMetadata();

    expect(config).toMatchObject({
      presetId: "ollama",
      endpoint: "http://localhost:11434",
      authScheme: { kind: "none" },
      requiresCredential: false,
    });
    expect(config.credentialRef).toBeUndefined();
    expect(config.credentialRevision).toBeUndefined();
    // Secret boundary: no credential is needed, so none is resolved.
    expect(await resolveRuntimeCredential(config)).toBeNull();
  });

  it("E2A-RUN-05 resolves a Custom OpenAI override connection with unknown transport", async () => {
    await seedState(
      makeConnection({
        id: "conn_custom",
        presetId: "custom",
        protocolOverride: "openai_chat_completions",
        endpointOverride: "https://gateway.example.internal/v1",
        authScheme: { kind: "bearer" },
        selectedModelId: "gpt-5.4-mini",
      }),
    );

    const config = await resolveActiveAIConnectionRuntimeMetadata();

    expect(config).toMatchObject({
      presetId: "custom",
      protocol: "openai_chat_completions",
      endpoint: "https://gateway.example.internal/v1",
      endpointProvenance: "custom_endpoint",
      authScheme: { kind: "bearer" },
      requiresCredential: true,
    });
    // Custom endpoint acceptance is unknown (fail closed)...
    expect(config.transportCapabilities.inlineBase64).toEqual({ value: null, confidence: "unknown" });
    // ...and the custom model identity is unknown too.
    expect(config.modelCapabilityAssessment.vision).toEqual({ value: null, confidence: "unknown" });
  });

  it("E2A-RUN-06 resolves a Custom Anthropic override connection with unknown acceptance", async () => {
    await seedState(
      makeConnection({
        id: "conn_relay",
        presetId: "custom",
        protocolOverride: "anthropic_messages",
        endpointOverride: "https://relay.example.internal",
        selectedModelId: "claude-sonnet-4.6",
      }),
    );

    const config = await resolveActiveAIConnectionRuntimeMetadata();

    expect(config).toMatchObject({
      presetId: "custom",
      protocol: "anthropic_messages",
      endpoint: "https://relay.example.internal",
      endpointProvenance: "custom_endpoint",
      authScheme: { kind: "header", headerName: "x-api-key" },
      requiresCredential: true,
    });
    // Adapter encoding stays known; endpoint acceptance is unknown.
    expect(config.transportCapabilities.adapterEncoding.inlineBase64).toEqual({
      value: true,
      confidence: "known_static",
    });
    expect(config.transportCapabilities.endpointAcceptance.inlineBase64).toEqual({
      value: null,
      confidence: "unknown",
    });
    expect(config.transportCapabilities.inlineBase64).toEqual({ value: null, confidence: "unknown" });
  });

  it("official preset + endpoint override reports overridden provenance with unknown acceptance", async () => {
    await seedState(
      makeConnection({
        presetId: "openai",
        authScheme: { kind: "bearer" },
        endpointOverride: "https://proxy.example.internal",
        selectedModelId: "gpt-5.5",
      }),
    );

    const config = await resolveActiveAIConnectionRuntimeMetadata();

    expect(config.endpointProvenance).toBe("overridden_endpoint");
    expect(config.transportCapabilities.endpointAcceptance).toEqual({
      inlineBase64: { value: null, confidence: "unknown" },
      remoteImageUrl: { value: null, confidence: "unknown" },
      multipleImages: { value: null, confidence: "unknown" },
    });
    expect(config.transportCapabilities.inlineBase64).toEqual({ value: null, confidence: "unknown" });
  });

  it("E2A-RUN-07 fails closed with a stable code when no state exists", async () => {
    await expectErrorCode(resolveActiveAIConnectionRuntimeMetadata(), "AI_CONNECTION_NOT_INITIALIZED");
  });

  it("E2A-RUN-08 fails closed when no active connection is set", async () => {
    await persistAIConnectionState({
      schemaVersion: 1,
      revision: 1,
      activeConnectionId: null,
      connections: { conn_main: makeConnection({ credentialRef: undefined }) },
      credentials: {},
    });

    await expectErrorCode(resolveActiveAIConnectionRuntimeMetadata(), "AI_ACTIVE_CONNECTION_MISSING");
  });

  it("E2A-RUN-09 fails closed when a required credential is missing", async () => {
    await seedState(makeConnection({ credentialRef: undefined }), { withCredential: false });

    await expectErrorCode(resolveActiveAIConnectionRuntimeMetadata(), "AI_CREDENTIAL_REQUIRED");
  });

  it("E2A-RUN-11 fails closed on malformed state", async () => {
    memory.store.set(AI_CONNECTION_STATE_STORAGE_KEY, { schemaVersion: 1, revision: 1 });

    await expectErrorCode(resolveActiveAIConnectionRuntimeMetadata(), "AI_CONNECTION_MALFORMED");
  });

  it("fails closed with AI_MODEL_MISSING when no model is selected", async () => {
    await seedState(makeConnection({ selectedModelId: "" }));

    await expectErrorCode(resolveActiveAIConnectionRuntimeMetadata(), "AI_MODEL_MISSING");
  });

  it("exposes no credential material through the runtime metadata", async () => {
    await seedState();

    const config = await resolveActiveAIConnectionRuntimeMetadata();
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain("qse:");
    expect(serialized).not.toContain("encryptedValue");
    expect(serialized).not.toContain(PLAINTEXT_CREDENTIAL);
  });
});

describe("resolveRuntimeCredential secret boundary", () => {
  let memory: ReturnType<typeof installMemoryStorage>;

  beforeEach(async () => {
    memory = installMemoryStorage();
    const envelope = await encryptValue(PLAINTEXT_CREDENTIAL);
    const connection = makeConnection();
    await persistAIConnectionState({
      schemaVersion: 1,
      revision: 1,
      activeConnectionId: connection.id,
      connections: { [connection.id]: connection },
      credentials: {
        cred_main: { ref: "cred_main", type: "api_key", encryptedValue: envelope, revision: 1, updatedAt: 1 },
      },
    });
  });

  it("E2A-RF01-RACE-04 resolves plaintext when the snapshot is still current", async () => {
    const config = await resolveActiveAIConnectionRuntimeMetadata();
    expect(await resolveRuntimeCredential(config)).toBe(PLAINTEXT_CREDENTIAL);
  });

  it("E2A-RF01-RACE-01 fails stale when the credential was replaced after resolution", async () => {
    const config = await resolveActiveAIConnectionRuntimeMetadata();
    await replaceCredential("cred_main", "sk-e2a-rotated-test-material");

    const error = await expectErrorCode(resolveRuntimeCredential(config), "AI_RUNTIME_CONFIG_STALE");
    // The stale snapshot is never rebound to the new secret.
    expect(error.message).not.toContain("sk-e2a-rotated-test-material");
    expect(await resolveRuntimeCredential(await resolveActiveAIConnectionRuntimeMetadata())).toBe(
      "sk-e2a-rotated-test-material",
    );
  });

  it("E2A-RF01-RACE-02 fails stale when the connection revision changed", async () => {
    const config = await resolveActiveAIConnectionRuntimeMetadata();
    await updateAIConnectionState((state) => {
      state.connections.conn_main.connectionRevision += 1;
      return state;
    });

    await expectErrorCode(resolveRuntimeCredential(config), "AI_RUNTIME_CONFIG_STALE");
  });

  it("E2A-RF01-RACE-03 fails stale when the active connection switched", async () => {
    // Add a second connection, then switch the active pointer.
    await updateAIConnectionState((state) => {
      const current = state.connections.conn_main;
      state.connections.conn_second = {
        ...current,
        id: "conn_second",
        name: "Second",
        presetId: "ollama",
        authScheme: { kind: "none" },
        credentialRef: undefined,
      };
      state.activeConnectionId = "conn_second";
      return state;
    });

    const config = await resolveActiveAIConnectionRuntimeMetadata();
    // Build a stale snapshot of the ORIGINAL connection and resolve against it.
    const staleSnapshot = {
      ...config,
      connectionId: "conn_main",
      presetId: "anthropic" as const,
      protocol: "anthropic_messages" as const,
      requiresCredential: true,
      credentialRef: "cred_main",
      credentialRevision: 1,
    };
    await expectErrorCode(resolveRuntimeCredential(staleSnapshot), "AI_RUNTIME_CONFIG_STALE");
  });

  it("translates low-level errors: unavailable credential and malformed state", async () => {
    const config = await resolveActiveAIConnectionRuntimeMetadata();

    // Tampered envelope with unchanged revisions -> stable unavailable code.
    const state = (await loadAIConnectionState()) as AIConnectionState;
    const payload = state.credentials.cred_main.encryptedValue.slice(ENCRYPTED_VALUE_PREFIX.length);
    const middle = Math.floor(payload.length / 2);
    const tampered =
      state.credentials.cred_main.encryptedValue.slice(0, ENCRYPTED_VALUE_PREFIX.length) +
      payload.slice(0, middle) +
      (payload[middle] === "A" ? "B" : "A") +
      payload.slice(middle + 1);
    state.credentials.cred_main.encryptedValue = tampered;
    await persistAIConnectionState(state);
    const unavailable = await expectErrorCode(resolveRuntimeCredential(config), "AI_CREDENTIAL_UNAVAILABLE");
    expect(unavailable.message).not.toContain(PLAINTEXT_CREDENTIAL);

    // Malformed state during secret resolution -> stable malformed code.
    memory.store.set(AI_CONNECTION_STATE_STORAGE_KEY, { schemaVersion: 1, revision: 1 });
    await expectErrorCode(resolveRuntimeCredential(config), "AI_CONNECTION_MALFORMED");
  });

  it("fails stale when the state disappears entirely", async () => {
    const config = await resolveActiveAIConnectionRuntimeMetadata();
    memory.store.delete(AI_CONNECTION_STATE_STORAGE_KEY);
    await expectErrorCode(resolveRuntimeCredential(config), "AI_RUNTIME_CONFIG_STALE");
  });

  it("never caches plaintext across calls", async () => {
    const config = await resolveActiveAIConnectionRuntimeMetadata();
    await resolveRuntimeCredential(config);
    // Storage still holds only the envelope.
    const dump = JSON.stringify(Object.fromEntries(memory.store.entries()));
    expect(dump).not.toContain(PLAINTEXT_CREDENTIAL);
  });

  it("throws the stable required-credential code when the reference is absent", async () => {
    const config = await resolveActiveAIConnectionRuntimeMetadata();
    const withoutCredential = { ...config, credentialRef: undefined };
    await expectErrorCode(resolveRuntimeCredential(withoutCredential), "AI_CREDENTIAL_REQUIRED");
  });
});
