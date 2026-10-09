import { afterEach, describe, expect, it, vi } from "vitest";
import { callAnthropic, callGemini, callOpenAICompat } from "./providerClients";
import { requestContextFixture } from "./runtimeRequest.testFixture";
import type { QuestionBlock } from "../types";

const TIMEOUT_MS = 30_000;
const fixtureCredential = "phase14c-fixture-key";
const block: QuestionBlock = {
  id: "phase14c-body-stall",
  bbox: { x: 0, y: 0, width: 150, height: 70 },
  previewText: "1+1=? A.1 B.2 C.3",
  hasImage: false,
  questionTypeGuess: "single_choice",
  confidence: 0.9,
  source: "manual_capture",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function unresolvedBody(): ReadableStream<Uint8Array> {
  // Headers arrive, but the provider never finishes the response body.
  return new ReadableStream<Uint8Array>({ start() {} });
}

describe("PHASE14C_01 full provider attempt lifetime", () => {
  it.each(["openai", "anthropic", "gemini"] as const)(
    "%s times out a stalled JSON body after HTTP 200 headers",
    async (preset) => {
      vi.useFakeTimers();
      let dispatched!: () => void;
      const fetchStarted = new Promise<void>((resolve) => { dispatched = resolve; });
      vi.stubGlobal("fetch", vi.fn(async () => {
        dispatched();
        return new Response(unresolvedBody(), { status: 200 });
      }));
      const context = requestContextFixture(preset, fixtureCredential);
      const pending = preset === "openai"
        ? callOpenAICompat(block, "text", context)
        : preset === "anthropic"
          ? callAnthropic(block, "text", context)
          : callGemini(block, "text", context);
      const rejected = expect(pending).rejects.toThrow("Request timed out after 30s");
      await fetchStarted;
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
      await rejected;
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("times out a stalled HTTP error body instead of waiting forever for its diagnostic", async () => {
    vi.useFakeTimers();
    let dispatched!: () => void;
    const fetchStarted = new Promise<void>((resolve) => { dispatched = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      dispatched();
      return new Response(unresolvedBody(), { status: 503 });
    }));
    const pending = callOpenAICompat(block, "text", requestContextFixture("openai", fixtureCredential));
    const rejected = expect(pending).rejects.toThrow("Request timed out after 30s");
    await fetchStarted;
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled SSE body and fences late stream callbacks", async () => {
    vi.useFakeTimers();
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    let firstChunk!: () => void;
    const streamed = new Promise<void>((resolve) => { firstChunk = resolve; });
    const partials: string[] = [];
    const context = requestContextFixture("openai", fixtureCredential);
    const abort = new AbortController();
    context.signal = abort.signal;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"first"}}]}\n'));
      },
    }), { status: 200 })));
    const pending = callOpenAICompat(block, "text", context, (partial) => {
      partials.push(partial);
      firstChunk();
    });
    const rejected = expect(pending).rejects.toThrow("AI_REQUEST_ABORTED");
    await streamed;
    expect(partials).toEqual(["first"]);
    abort.abort();
    await rejected;
    bodyController.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"late"}}]}\n'));
    await Promise.resolve();
    await Promise.resolve();
    expect(partials).toEqual(["first"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
