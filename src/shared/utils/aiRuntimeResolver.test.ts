import { beforeEach, describe, expect, it } from "vitest";
import { encryptValue } from "./encryption";
import {
  AIRuntimeResolutionError,
  resolveActiveAIConnectionRuntimeMetadata,
  resolveRuntimeCredential,
} from "./aiRuntimeResolver";
import { AI_CONNECTION_STATE_STORAGE_KEY, persistAIConnectionState } from "./aiConnectionState";
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
      authScheme: { kind: "header", headerName: "x-api-key" },
      requiresCredential: true,
      credentialRef: "cred_main",
      credentialRevision: 6,
      selectedModelId: "claude-opus-4.8",
    });
    expect(config.modelCapabilityAssessment.vision).toEqual({ value: true, confidence: "legacy_declared" });
    expect(config.transportCapabilities.inlineBase64).toEqual({ value: true, confidence: "known_static" });
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

  it("E2A-RUN-05 resolves a Custom OpenAI override connection", async () => {
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
      authScheme: { kind: "bearer" },
      requiresCredential: true,
    });
    // Custom OpenAI-compatible transport stays unknown (fail closed).
    expect(config.transportCapabilities.inlineBase64).toEqual({ value: null, confidence: "unknown" });
  });

  it("E2A-RUN-06 resolves a Custom Anthropic override connection", async () => {
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
      authScheme: { kind: "header", headerName: "x-api-key" },
      requiresCredential: true,
    });
    expect(config.transportCapabilities.inlineBase64).toEqual({ value: true, confidence: "known_static" });
  });

  it("E2A-RUN-07 fails closed with a stable code when no state exists", async () => {
    const error = await resolveActiveAIConnectionRuntimeMetadata().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AIRuntimeResolutionError);
    expect((error as AIRuntimeResolutionError).code).toBe("AI_CONNECTION_NOT_INITIALIZED");
  });

  it("E2A-RUN-08 fails closed when no active connection is set", async () => {
    await persistAIConnectionState({
      schemaVersion: 1,
      revision: 1,
      activeConnectionId: null,
      connections: { conn_main: makeConnection({ credentialRef: undefined }) },
      credentials: {},
    });

    const error = await resolveActiveAIConnectionRuntimeMetadata().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AIRuntimeResolutionError);
    expect((error as AIRuntimeResolutionError).code).toBe("AI_ACTIVE_CONNECTION_MISSING");
  });

  it("E2A-RUN-09 fails closed when a required credential is missing", async () => {
    await seedState(makeConnection({ credentialRef: undefined }), { withCredential: false });

    const error = await resolveActiveAIConnectionRuntimeMetadata().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AIRuntimeResolutionError);
    expect((error as AIRuntimeResolutionError).code).toBe("AI_CREDENTIAL_REQUIRED");
  });

  it("E2A-RUN-11 fails closed on malformed state", async () => {
    memory.store.set(AI_CONNECTION_STATE_STORAGE_KEY, { schemaVersion: 1, revision: 1 });

    const error = await resolveActiveAIConnectionRuntimeMetadata().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AIRuntimeResolutionError);
    expect((error as AIRuntimeResolutionError).code).toBe("AI_CONNECTION_MALFORMED");
  });

  it("fails closed with AI_MODEL_MISSING when no model is selected", async () => {
    await seedState(makeConnection({ selectedModelId: "" }));

    const error = await resolveActiveAIConnectionRuntimeMetadata().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AIRuntimeResolutionError);
    expect((error as AIRuntimeResolutionError).code).toBe("AI_MODEL_MISSING");
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

  it("decrypts only at the explicit runtime boundary", async () => {
    const config = await resolveActiveAIConnectionRuntimeMetadata();
    expect(await resolveRuntimeCredential(config)).toBe(PLAINTEXT_CREDENTIAL);
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
    const error = await resolveRuntimeCredential(withoutCredential).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AIRuntimeResolutionError);
    expect((error as AIRuntimeResolutionError).code).toBe("AI_CREDENTIAL_REQUIRED");
  });
});
