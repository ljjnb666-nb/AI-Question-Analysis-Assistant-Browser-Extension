import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../test/memoryStorage";
import type { Connection, ProviderPresetId } from "../types/connection";
import type { QuestionBlock } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { persistAIConnectionState, updateAIConnectionState } from "./aiConnectionState";
import { encryptValue } from "./encryption";
import { resolvePresetAuthScheme, resolvePresetDefaultModel } from "./aiConnectionPresets";
import * as credentials from "./credentialStore";
import { parseQuestion, parseQuestionPackage } from "./parseRouter";
import type { SolverQuestionPackage } from "../ai/questionPackage";
import * as runtimeResolver from "./aiRuntimeResolver";
import * as mediaPreparation from "../ai/providerMediaPreparation";
import { callOpenAICompat } from "../ai/providerClients";
import { getSessionLog } from "./analytics";
import { getErrorLogs } from "./errorLogger";

const key = "e2b2a-fixture-secret";
const block: QuestionBlock = {
  id: "q", bbox: { x: 0, y: 0, width: 10, height: 10 }, previewText: "What is 1 plus 1?",
  questionTypeGuess: "short_answer", hasImage: false, confidence: 1, source: "manual_capture",
};
const prefs = { preferredRoute: "text" as const, language: "en" as const };
const content = '{"questionType":"short_answer","answer":"2","confidence":1}';
const pkg: SolverQuestionPackage = {
  schemaVersion: 1, questionId: "q", contentFingerprint: "fp", questionType: "short_answer", text: block.previewText,
  media: [{ assetId: "stem", role: "stem", contentFingerprint: "fp", source: { kind: "data-url", dataUrl: "data:image/png;base64,aGVsbG8=" } }],
};
async function seed(presetId: ProviderPresetId, overrides: Partial<Connection> = {}) {
  const connection: Connection = {
    id: "active", name: "test", presetId, selectedModelId: resolvePresetDefaultModel(presetId),
    authScheme: resolvePresetAuthScheme(presetId), credentialRef: presetId === "ollama" ? undefined : "credential",
    connectionRevision: 1, validation: { status: "never_tested", generation: 0 }, createdAt: 1, updatedAt: 1,
    ...overrides,
  };
  await persistAIConnectionState({
    schemaVersion: 1, revision: 1, activeConnectionId: connection.id, connections: { [connection.id]: connection },
    credentials: connection.credentialRef ? { credential: { ref: "credential", type: "api_key", encryptedValue: await encryptValue(key), revision: 1, updatedAt: 1 } } : {},
  });
}
function response(protocol: "anthropic" | "gemini" | "openai") {
  return new Response(JSON.stringify(protocol === "anthropic" ? { content: [{ type: "text", text: content }] }
    : protocol === "gemini" ? { candidates: [{ content: { parts: [{ text: content }] } }] }
      : { choices: [{ message: { content } }] }), { status: 200 });
}
beforeEach(() => {
  installMemoryStorage();
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true } as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("E2B2A authoritative data plane", () => {
  it("FINAL-FENCE pauses request preparation after credential resolution and blocks an actual active switch", async () => {
    await seed("openai");
    const runtime = await runtimeResolver.resolveActiveAIConnectionRuntimeMetadata();
    const credential = await runtimeResolver.resolveRuntimeCredential(runtime);
    let release!: () => void; let entered!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const pause = new Promise<void>(resolve => { release = resolve; });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const assertion = expect(callOpenAICompat(block, "text", {
      runtime, credential, language: "en", beforeDispatch: async () => {
        entered(); await pause; await runtimeResolver.assertRuntimeConfigCurrent(runtime);
      },
    })).rejects.toMatchObject({ code: "AI_RUNTIME_CONFIG_STALE" });
    await entering;
    await updateAIConnectionState(state => {
      state.connections.second = { ...state.connections.active, id: "second" };
      state.activeConnectionId = "second";
      return state;
    });
    release(); await assertion; expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["anthropic", "openai", "gemini"] as const)("DISPATCH uses %s runtime protocol, not forged settings", async preset => {
    await seed(preset);
    const fetchMock = vi.fn(async () => response(preset)); vi.stubGlobal("fetch", fetchMock);
    const forged = { ...DEFAULT_SETTINGS, ...prefs, providerId: "custom", apiKey: "forged-secret", apiModel: "forged-model", customBaseUrl: "https://forged.example", customProviderProtocol: "anthropic" as const };
    expect((await parseQuestion(block, forged)).resultSource).toBe("provider");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("forged");
    expect(String(init.body)).not.toContain("forged");
    expect(JSON.stringify(init.headers)).not.toContain("forged-secret");
  });
  it("STALE after exact credential resolution pauses and rejects before actual fetch", async () => {
    await seed("openai");
    const original = credentials.resolveCredentialRecordForRuntime;
    let release!: () => void; let entered!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const pause = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(credentials, "resolveCredentialRecordForRuntime").mockImplementation(async record => {
      const value = await original(record); entered(); await pause; return value;
    });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const assertion = expect(parseQuestion(block, prefs)).rejects.toThrow("AI_RUNTIME_CONFIG_STALE");
    await entering;
    await updateAIConnectionState(state => { state.connections.active.connectionRevision += 1; return state; });
    release(); await assertion;
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("retry keeps the original snapshot and rejects changed authority during backoff", async () => {
    await seed("openai");
    const fetchMock = vi.fn(async () => {
      await updateAIConnectionState(state => { state.connections.active.connectionRevision += 1; return state; });
      return new Response("temporary upstream failure", { status: 503 });
    }); vi.stubGlobal("fetch", fetchMock);
    await expect(parseQuestion(block, prefs)).rejects.toMatchObject({ code: "AI_RUNTIME_CONFIG_STALE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("STALE-01 credential replacement before resolution rejects the original metadata", async () => {
    await seed("openai");
    const original = mediaPreparation.prepareQuestionPackageForProvider;
    vi.spyOn(mediaPreparation, "prepareQuestionPackageForProvider").mockImplementation(async (...args) => {
      const result = await original(...args);
      await credentials.replaceCredential("credential", "replacement-secret");
      return result;
    });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(parseQuestionPackage(pkg, block, { ...prefs, preferredRoute: "vision" })).rejects.toMatchObject({ code: "AI_RUNTIME_CONFIG_STALE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("STALE-02 connection change during remote acquisition dispatches no provider request", async () => {
    await seed("anthropic");
    let release!: (response: Response) => void; let entered!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const fetching = new Promise<Response>(resolve => { release = resolve; });
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.credentials).toBe("omit"); entered(); return fetching;
    }); vi.stubGlobal("fetch", fetchMock);
    const remote = { ...pkg, media: [{ ...pkg.media[0], source: { kind: "remote-url" as const, url: "https://media.example.test/image" } }] };
    const assertion = expect(parseQuestionPackage(remote, block, { ...prefs, preferredRoute: "vision" })).rejects.toMatchObject({ code: "AI_RUNTIME_CONFIG_STALE" });
    await entering;
    await updateAIConnectionState(state => { state.connections.active.connectionRevision += 1; return state; });
    release(new Response(new Blob(["image"], { type: "image/png" })));
    await assertion; expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("STALE-05 no-auth connection still fences immediately before fetch", async () => {
    await seed("ollama");
    const original = runtimeResolver.resolveRuntimeCredential;
    vi.spyOn(runtimeResolver, "resolveRuntimeCredential").mockImplementation(async runtime => {
      const result = await original(runtime);
      expect(result).toBeNull();
      await updateAIConnectionState(state => { state.connections.active.connectionRevision += 1; return state; });
      return result;
    });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(parseQuestion(block, prefs)).rejects.toMatchObject({ code: "AI_RUNTIME_CONFIG_STALE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["inlineBase64", "multipleImages"] as const)("transport %s is enforced independently of model vision", async dimension => {
    await seed("openai");
    const runtime = await runtimeResolver.resolveActiveAIConnectionRuntimeMetadata();
    runtime.transportCapabilities[dimension] = { value: false, confidence: "known_static" };
    vi.spyOn(runtimeResolver, "resolveActiveAIConnectionRuntimeMetadata").mockResolvedValue(runtime);
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const media = dimension === "multipleImages" ? [pkg.media[0], { ...pkg.media[0], assetId: "second" }] : pkg.media;
    await expect(parseQuestionPackage({ ...pkg, media }, block, { ...prefs, preferredRoute: "vision" })).rejects.toThrow("AI_TRANSPORT_MEDIA_UNSUPPORTED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("unknown required transport fails closed before acquisition", async () => {
    await seed("openai");
    const runtime = await runtimeResolver.resolveActiveAIConnectionRuntimeMetadata();
    runtime.transportCapabilities.inlineBase64 = { value: null, confidence: "unknown" };
    vi.spyOn(runtimeResolver, "resolveActiveAIConnectionRuntimeMetadata").mockResolvedValue(runtime);
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(parseQuestionPackage(pkg, block, { ...prefs, preferredRoute: "vision" })).rejects.toThrow("AI_TRANSPORT_CAPABILITY_UNKNOWN");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["deepseek", "custom"] as const)("required media for %s fails before credential and remote acquisition", async preset => {
    await seed(preset, preset === "custom" ? { endpointOverride: "https://custom.example", selectedModelId: "gpt-5.5" } : {});
    const secret = vi.spyOn(credentials, "resolveCredentialRecordForRuntime");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(parseQuestionPackage(pkg, block, { ...prefs, preferredRoute: "vision" })).rejects.toThrow(preset === "custom" ? "AI_MODEL_CAPABILITY_UNKNOWN" : "AI_MODEL_VISION_UNSUPPORTED");
    expect(secret).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("custom text remains executable with custom query authentication", async () => {
    await seed("custom", { endpointOverride: "https://custom.example/base", selectedModelId: "unverified-model", protocolOverride: "gemini_generate_content", authScheme: { kind: "query", parameterName: "token" } });
    const fetchMock = vi.fn(async () => response("gemini")); vi.stubGlobal("fetch", fetchMock);
    await parseQuestion(block, prefs);
    const url = new URL(String((fetchMock.mock.calls[0] as unknown as [string])[0]));
    expect(url.host).toBe("custom.example"); expect(url.searchParams.get("token")).toBe(key);
    expect(url.pathname).toContain("unverified-model:generateContent");
  });
  it("insecure endpoint is rejected before decrypting a credential", async () => {
    await seed("custom", { endpointOverride: "http://localhost.evil.test" });
    const secret = vi.spyOn(credentials, "resolveCredentialRecordForRuntime");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(parseQuestion(block, prefs)).rejects.toThrow("AI_ENDPOINT_INSECURE");
    expect(secret).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("canonical media auto route sends all evidence despite sufficient text", async () => {
    await seed("openai");
    const fetchMock = vi.fn(async () => response("openai")); vi.stubGlobal("fetch", fetchMock);
    const result = await parseQuestionPackage(pkg, { ...block, previewText: "A long sufficient question. ".repeat(20) }, { ...prefs, preferredRoute: "auto" });
    expect(result.routeUsed).toBe("vision");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body)).messages[1].content.some((part: { type: string }) => part.type === "image_url")).toBe(true);
  });
  it.each(["anthropic", "gemini"] as const)("MEDIA remote %s sources become inline wire media before credential resolution", async preset => {
    await seed(preset);
    const secret = vi.spyOn(credentials, "resolveCredentialRecordForRuntime");
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).startsWith("https://media.example.test")) {
        expect(init?.credentials).toBe("omit"); expect(secret).not.toHaveBeenCalled();
        return new Response(new Blob(["image"], { type: "image/png" }));
      }
      expect(String(init?.body)).not.toContain("https://media.example.test");
      const body = JSON.parse(String(init?.body));
      expect(preset === "anthropic" ? body.messages[0].content.some((part: { type: string }) => part.type === "image")
        : body.contents[0].parts.some((part: { inline_data?: unknown }) => part.inline_data)).toBe(true);
      return response(preset);
    }); vi.stubGlobal("fetch", fetchMock);
    const remote = { ...pkg, media: [{ ...pkg.media[0], source: { kind: "remote-url" as const, url: "https://media.example.test/image" } }] };
    await parseQuestionPackage(remote, block, { ...prefs, preferredRoute: "vision" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("manual image data URLs cannot bypass unknown model capabilities", async () => {
    await seed("custom", { endpointOverride: "https://custom.example", selectedModelId: "gpt-5.5" });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(parseQuestion({ ...block, hasImage: true, imageDataUrl: "data:image/png;base64,aGVsbG8=" }, { ...prefs, preferredRoute: "vision" })).rejects.toThrow("AI_MODEL_CAPABILITY_UNKNOWN");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("DISPATCH-04 an unhandled runtime protocol never defaults to a provider", async () => {
    await seed("custom", { endpointOverride: "https://custom.example" });
    const runtime = await runtimeResolver.resolveActiveAIConnectionRuntimeMetadata();
    Object.assign(runtime, { protocol: "future_protocol" });
    vi.spyOn(runtimeResolver, "resolveActiveAIConnectionRuntimeMetadata").mockResolvedValue(runtime);
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(parseQuestion(block, prefs)).rejects.toThrow("AI_PROTOCOL_UNSUPPORTED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("AUTH-04 no-auth transport sends no credential header or query", async () => {
    await seed("ollama");
    const fetchMock = vi.fn(async () => response("openai")); vi.stubGlobal("fetch", fetchMock);
    await parseQuestion(block, prefs);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).search).toBe("");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });
  it("ROUTE-01 Auto with sufficient text and no mandatory evidence can use an unknown custom model", async () => {
    await seed("custom", { endpointOverride: "https://custom.example", selectedModelId: "unknown-model" });
    const fetchMock = vi.fn(async () => response("openai")); vi.stubGlobal("fetch", fetchMock);
    const result = await parseQuestion({ ...block, previewText: "A sufficient complete textual question asks for a short answer. ".repeat(4) }, { ...prefs, preferredRoute: "auto" });
    expect(result.routeUsed).toBe("text"); expect(result.resultSource).toBe("provider");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("AUTH-06 invalid runtime header fails before secret resolution", async () => {
    await seed("custom", { endpointOverride: "https://custom.example", authScheme: { kind: "header", headerName: "invalid header" } });
    const secret = vi.spyOn(credentials, "resolveCredentialRecordForRuntime");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(parseQuestion(block, prefs)).rejects.toThrow("AI_AUTH_HEADER_INVALID");
    expect(secret).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("SECRET provider error echoes cannot reach normalized errors, logs, or analytics", async () => {
    await seed("gemini");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`key rejected: ${key} ${encodeURIComponent(key)}`, { status: 401 })));
    const error = await parseQuestion(block, prefs).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("[REDACTED]");
    for (const value of [(error as Error).message, JSON.stringify(getSessionLog()), JSON.stringify(getErrorLogs()), JSON.stringify(await chrome.storage.local.get(null))]) {
      expect(value).not.toContain(key);
    }
  });
});
