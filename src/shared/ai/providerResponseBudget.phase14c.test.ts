import { afterEach, describe, expect, it, vi } from "vitest";
import { callAnthropic, callGemini, callOpenAICompat } from "./providerClients";
import { requestContextFixture } from "./runtimeRequest.testFixture";
import type { QuestionBlock } from "../types";

const JSON_LIMIT = 512 * 1024;
const SSE_TEXT_LIMIT = 256 * 1024;
const credential = ["response", "budget", "fixture"].join("-");
const block: QuestionBlock = {
  id: "phase14c05-response-budget",
  bbox: { x: 0, y: 0, width: 140, height: 70 },
  previewText: "1+1=? A.1 B.2 C.3", hasImage: false,
  questionTypeGuess: "single_choice", confidence: 0.9, source: "manual_capture",
};
const answer = JSON.stringify({
  questionType: "single_choice", answer: "B", confidence: 0.99,
  briefExplanation: "2", detailedExplanation: "1+1=2", recognizedText: block.previewText,
});
type Provider = "openai" | "anthropic" | "gemini";
function wireJson(provider: Provider, padding: string): string {
  if (provider === "openai") return JSON.stringify({ choices: [{ message: { content: answer } }], padding });
  if (provider === "anthropic") return JSON.stringify({ content: [{ type: "text", text: answer }], padding });
  return JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }], padding });
}
function byteStream(payload: string, onCancel?: () => void, step = 16_384): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(payload);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset + step));
      offset += step;
    },
    cancel() { onCancel?.(); },
  });
}
function sseStream(events: string[]): ReadableStream<Uint8Array> {
  return byteStream(events.map(data => "data: " + data + "\n\n").join(""), undefined, 8192);
}
function openaiDelta(text: string): string {
  return JSON.stringify({ choices: [{ delta: { content: text } }] });
}
function anthropicDelta(text: string): string {
  return JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } });
}
function call(provider: Provider, stream?: (partial: string) => void) {
  const context = requestContextFixture(provider, credential);
  return provider === "openai" ? callOpenAICompat(block, "text", context, stream)
    : provider === "anthropic" ? callAnthropic(block, "text", context, stream)
      : callGemini(block, "text", context);
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("PHASE14C_05 bounded provider response consumption", () => {
  it.each(["openai", "anthropic", "gemini"] as const)(
    "%s rejects oversized chunked success JSON before parsing and cancels the body",
    async provider => {
      let cancelled = false;
      // Leave at least four unread chunks when crossing the limit so the
      // stream has not naturally closed before reader.cancel() is observed.
      const oversized = wireJson(provider, "x".repeat(JSON_LIMIT + 64 * 1024));
      vi.stubGlobal("fetch", vi.fn(async () => new Response(byteStream(oversized, () => { cancelled = true; }), {
        status: 200, headers: { "Content-Type": "application/json" },
      })));
      await expect(call(provider)).rejects.toThrow("AI_PROVIDER_RESPONSE_TOO_LARGE");
      expect(cancelled).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("accepts an exactly 512KiB success JSON and preserves the structured answer", async () => {
    const empty = wireJson("openai", "");
    const payload = wireJson("openai", "x".repeat(JSON_LIMIT - new TextEncoder().encode(empty).byteLength));
    expect(new TextEncoder().encode(payload).byteLength).toBe(JSON_LIMIT);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(byteStream(payload, undefined, 8191), { status: 200 })));
    const result = await call("openai");
    expect(result.answer).toBe("B");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns a fixed safe code for malformed but bounded JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(byteStream('{"secret":"not completed"'), { status: 200 })));
    await expect(call("openai")).rejects.toThrow("AI_PROVIDER_RESPONSE_INVALID");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["openai", "anthropic"] as const)(
    "%s aborts an over-budget SSE aggregate without dispatching the excess callback",
    async provider => {
      let cancelled = false;
      const delta = "😀".repeat(14_000); // 56,000 UTF-8 bytes; much larger than UTF-16 length.
      const frame = provider === "openai" ? openaiDelta(delta) : anthropicDelta(delta);
      const events = Array.from({ length: 6 }, () => frame);
      const partials: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async () => new Response(byteStream(
        events.map(data => "data: " + data + "\n\n").join(""),
        () => { cancelled = true; }, 8_192,
      ), { status: 200 })));
      await expect(call(provider, text => partials.push(text))).rejects.toThrow("AI_PROVIDER_RESPONSE_TOO_LARGE");
      expect(partials).toHaveLength(4); // 4 x 56,000B < 256KiB; fifth cannot emit.
      expect(new TextEncoder().encode(partials[partials.length - 1]).byteLength).toBe(224_000);
      expect(cancelled).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps a normal completed SSE result authoritative below the aggregate budget", async () => {
    const part1 = answer.slice(0, 10);
    const part2 = answer.slice(10);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      sseStream([openaiDelta(part1), openaiDelta(part2), "[DONE]"]), { status: 200 },
    )));
    const partials: string[] = [];
    const result = await call("openai", text => partials.push(text));
    expect(partials).toEqual([part1, answer]);
    expect(new TextEncoder().encode(partials[1]).byteLength).toBeLessThan(SSE_TEXT_LIMIT);
    expect(result.answer).toBe("B");
  });
});
