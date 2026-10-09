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
const fixtureCredential = ["sse", "fixture"].join("-");
const answer = JSON.stringify({
  questionType: "single_choice",
  answer: "B", confidence: 0.99, briefExplanation: "2 ✅",
  detailedExplanation: "1+1=2", recognizedText: block.previewText,
});

function streamInSmallChunks(body: string, step = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(body);
  return new ReadableStream({
    start(controller) {
      for (let start = 0; start < bytes.length; start += step)
        controller.enqueue(bytes.slice(start, start + step));
      controller.close();
    },
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("PHASE14C_02B streaming SSE framing via production adapters", () => {
  it("OpenAI reconstructs split UTF-8 and JSON data frames and returns authoritative content", async () => {
    const event = JSON.stringify({ choices: [{ delta: { content: answer } }] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      streamInSmallChunks("data: " + event + "\r\n\r\ndata: [DONE]\r\n\r\n", 5),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    )));
    const partials: string[] = [];
    const result = await callOpenAICompat(block, "text", requestContextFixture("openai", fixtureCredential), text => partials.push(text));
    expect(partials).toEqual([answer]);
    expect(result.answer).toBe("B");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("Anthropic reconstructs split data prefixes, JSON, and EOF-terminated last frame", async () => {
    const event = JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: answer } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      streamInSmallChunks("event: content_block_delta\n" + "data: " + event, 3),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    )));
    const partials: string[] = [];
    const result = await callAnthropic(block, "text", requestContextFixture("anthropic", fixtureCredential), text => partials.push(text));
    expect(partials).toEqual([answer]);
    expect(result.answer).toBe("B");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("OpenAI ignores all events after a terminal DONE frame", async () => {
    const first = JSON.stringify({ choices: [{ delta: { content: answer } }] });
    const late = JSON.stringify({ choices: [{ delta: { content: "SHOULD_NOT_APPEAR" } }] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      streamInSmallChunks("data: " + first + "\n\ndata: [DONE]\n\ndata: " + late + "\n\n", 11),
      { status: 200 },
    )));
    const partials: string[] = [];
    const result = await callOpenAICompat(block, "text", requestContextFixture("openai", fixtureCredential), p => partials.push(p));
    expect(partials).toEqual([answer]);
    expect(result.answer).toBe("B");
  });
});
