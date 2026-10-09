import { afterEach, describe, expect, it, vi } from "vitest";
import { callAnthropic, callOpenAICompat } from "./providerClients";
import { requestContextFixture } from "./runtimeRequest.testFixture";
import type { QuestionBlock } from "../types";

const block: QuestionBlock = {
  id: "phase14c-sse-fragments",
  bbox: { x: 0, y: 0, width: 140, height: 70 },
  previewText: "1+1=? A.1 B.2 C.3",
  hasImage: false, questionTypeGuess: "single_choice", confidence: 0.9,
  source: "manual_capture",
};
const credential = ["sse", "fixture"].join("-");
const answer = JSON.stringify({
  questionType: "single_choice", answer: "B", confidence: 0.99,
  briefExplanation: "2 ✅", detailedExplanation: "1+1=2", recognizedText: block.previewText,
});
function chunks(body: string, step = 5): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(body);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += step) controller.enqueue(bytes.slice(i, i + step));
      controller.close();
    },
  });
}
function stubSse(body: string, step = 5): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(chunks(body, step), {
    status: 200, headers: { "Content-Type": "text/event-stream" },
  })));
}
function openAIEvent(text: string): string {
  return JSON.stringify({ choices: [{ delta: { content: text } }] });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("PHASE14C_02B_R1 SSE framing through production adapters", () => {
  it("reconstructs split UTF-8, data prefix and JSON in OpenAI streams", async () => {
    stubSse("data: " + openAIEvent(answer) + "\r\n\r\ndata: [DONE]\r\n\r\n", 3);
    const partials: string[] = [];
    const result = await callOpenAICompat(block, "text", requestContextFixture("openai", credential), p => partials.push(p));
    expect(partials).toEqual([answer]);
    expect(result.answer).toBe("B");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reconstructs Anthropic JSON with a split data prefix and EOF final line", async () => {
    const event = JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: answer } });
    stubSse("event: content_block_delta\n" + "data: " + event, 2);
    const partials: string[] = [];
    const result = await callAnthropic(block, "text", requestContextFixture("anthropic", credential), p => partials.push(p));
    expect(partials).toEqual([answer]);
    expect(result.answer).toBe("B");
  });

  it("reconstructs multiline data belonging to one event, with comments and CRLF boundaries", async () => {
    const event = openAIEvent(answer);
    const at = event.indexOf(',"');
    expect(at).toBeGreaterThan(0);
    stubSse(":keepalive\r\nevent: message\r\ndata: " + event.slice(0, at + 1) +
      "\r\ndata: " + event.slice(at + 1) + "\r\n\r\ndata: [DONE]\r\n\r\n", 4);
    const partials: string[] = [];
    const result = await callOpenAICompat(block, "text", requestContextFixture("openai", credential), p => partials.push(p));
    expect(partials).toEqual([answer]);
    expect(result.answer).toBe("B");
  });

  it("terminates at DONE and never dispatches data from a subsequent frame", async () => {
    const late = openAIEvent("SHOULD_NOT_APPEAR");
    stubSse("data: " + openAIEvent(answer) + "\n\ndata: [DONE]\n\ndata: " + late + "\n\n", 11);
    const partials: string[] = [];
    const result = await callOpenAICompat(block, "text", requestContextFixture("openai", credential), p => partials.push(p));
    expect(partials).toEqual([answer]);
    expect(result.answer).toBe("B");
  });

  it("rejects a complete oversized SSE data frame without dispatching any answer", async () => {
    stubSse("data: " + "x".repeat(65536) + "\n\n", 2048);
    const partials: string[] = [];
    await expect(callOpenAICompat(block, "text", requestContextFixture("openai", credential), p => partials.push(p)))
      .rejects.toThrow("AI_SSE_FRAME_TOO_LARGE");
    expect(partials).toEqual([]);
  });

  it("skips malformed events but preserves subsequent valid events", async () => {
    stubSse("data: {broken}\n\ndata: " + openAIEvent(answer) + "\n\ndata: [DONE]\n\n", 7);
    const partials: string[] = [];
    const result = await callOpenAICompat(block, "text", requestContextFixture("openai", credential), p => partials.push(p));
    expect(partials).toEqual([answer]);
    expect(result.answer).toBe("B");
  });
});
