import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { callAnthropic, callGemini, callOpenAICompat } from "./providerClients";
import { requestContextFixture } from "./runtimeRequest.testFixture";
import type { QuestionBlock } from "../types";

const block: QuestionBlock = {
  id: "block-key12",
  bbox: { x: 0, y: 0, width: 100, height: 50 },
  previewText: "1+1=? A.1 B.2 C.3 D.4",
  hasImage: false,
  questionTypeGuess: "single_choice",
  confidence: 0.9,
  source: "manual_capture",
};

const captured: { url: string; headers: Record<string, string> }[] = [];

beforeEach(() => {
  captured.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      captured.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response("provider request rejected by test mock", { status: 500 });
    }),
  );
  return () => vi.unstubAllGlobals();
});

describe("KEY_12_PROVIDER_REQUEST_STILL_RECEIVES_CORRECT_PLAINTEXT_KEY", () => {
  it("x-api-key provider receives the plaintext credential in the header", async () => {
    await expect(
      callAnthropic(block, "text", requestContextFixture("anthropic", "fake-anthropic-key"))
    ).rejects.toThrow();

    expect(captured).toHaveLength(1);
    expect(captured[0].headers["x-api-key"]).toBe("fake-anthropic-key");
  });

  it("bearer provider receives the plaintext credential in the Authorization header", async () => {
    await expect(
      callOpenAICompat(block, "text", requestContextFixture("openai", "fake-openai-key"))
    ).rejects.toThrow();

    expect(captured).toHaveLength(1);
    expect(captured[0].headers["Authorization"]).toBe("Bearer fake-openai-key");
  });

  it("Gemini receives the plaintext credential in the ?key= query", async () => {
    await expect(
      callGemini(block, "text", requestContextFixture("gemini", "fake-gemini-key"))
    ).rejects.toThrow();

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toContain("?key=fake-gemini-key");
  });
});

describe("E2B2A bounded provider attempt", () => {
  it("ENDPOINT-13 a real cross-origin 302 is never followed with a credential", async () => {
    vi.unstubAllGlobals();
    let redirectedRequests = 0;
    let originCredential: string | string[] | undefined;
    const target = createServer((_request, response) => { redirectedRequests += 1; response.end("unexpected"); });
    const origin = createServer((request, response) => {
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "content-type,x-custom-key" });
        response.end(); return;
      }
      originCredential = request.headers["x-custom-key"];
      const targetAddress = target.address();
      if (!targetAddress || typeof targetAddress === "string") throw new Error("fixture server address missing");
      response.writeHead(302, { Location: `http://127.0.0.1:${targetAddress.port}/leak`, "Access-Control-Allow-Origin": "*" }); response.end();
    });
    const listen = (server: ReturnType<typeof createServer>) => new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const close = (server: ReturnType<typeof createServer>) => new Promise<void>((resolve, reject) => {
      server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
    });
    await listen(target); await listen(origin);
    try {
      const address = origin.address();
      if (!address || typeof address === "string") throw new Error("fixture server address missing");
      const context = requestContextFixture("openai", "redirect-fixture-secret");
      context.runtime.endpoint = `http://127.0.0.1:${address.port}`;
      context.runtime.authScheme = { kind: "header", headerName: "x-custom-key" };
      await expect(callOpenAICompat(block, "text", context)).rejects.toThrow();
      expect(originCredential).toBe("redirect-fixture-secret");
      expect(redirectedRequests).toBe(0);
    } finally { await close(origin); await close(target); }
  });
  it.each(["anthropic", "openai", "gemini"] as const)("%s fences after preparation and immediately before fetch", async preset => {
    const context = requestContextFixture(preset, "attempt-secret");
    let release!: () => void;
    let entered!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const paused = new Promise<void>(resolve => { release = resolve; });
    context.beforeDispatch = async () => { entered(); await paused; throw new Error("AI_RUNTIME_CONFIG_STALE"); };
    const pending = preset === "anthropic" ? callAnthropic(block, "text", context)
      : preset === "gemini" ? callGemini(block, "text", context) : callOpenAICompat(block, "text", context);
    const assertion = expect(pending).rejects.toThrow("AI_RUNTIME_CONFIG_STALE");
    await entering;
    expect(captured).toHaveLength(0);
    release();
    await assertion;
    expect(captured).toHaveLength(0);
  });
  it("custom Anthropic 401 never switches auth or retries bearer", async () => {
    const context = requestContextFixture("anthropic", "attempt-secret");
    context.runtime.presetId = "custom";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid x-api-key", { status: 401 })));
    await expect(callAnthropic(block, "text", context)).rejects.toThrow("401");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "attempt-secret" });
  });
  it("query credential echoes are redacted and redirects are disabled", async () => {
    const context = requestContextFixture("gemini", "attempt + secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`rejected ${context.credential}`, { status: 401 })));
    await expect(callGemini(block, "text", context)).rejects.toThrow("[REDACTED]");
    expect(vi.mocked(fetch).mock.calls[0][1]?.redirect).toBe("error");
  });
  it("model and endpoint come solely from the runtime request context", async () => {
    const context = requestContextFixture("openai", "attempt-secret");
    context.runtime.endpoint = "https://authoritative.example.test/base?mode=1";
    context.runtime.selectedModelId = "authoritative-model";
    await expect(callOpenAICompat(block, "text", context)).rejects.toThrow();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://authoritative.example.test/base/v1/chat/completions?mode=1");
    expect(JSON.parse(String(init?.body)).model).toBe("authoritative-model");
  });
});


it("RF01 preserves stable error code even when synthetic credential overlaps it", async () => {
  const context = requestContextFixture("openai", "AI");
  context.beforeDispatch = async () => { throw Object.assign(new Error("AI_RUNTIME_CONFIG_STALE"), { code: "AI_RUNTIME_CONFIG_STALE" }); };
  await expect(callOpenAICompat(block, "text", context)).rejects.toMatchObject({ code: "AI_RUNTIME_CONFIG_STALE" });
  expect(captured).toHaveLength(0);
});
