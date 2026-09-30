import { beforeEach, describe, expect, it, vi } from "vitest";
import { callAnthropic, callGemini, callOpenAICompat } from "./providerClients";
import { getProvider } from "./providers";
import { DEFAULT_SETTINGS } from "../types";
import type { AppSettings, QuestionBlock } from "../types";

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

function settingsWith(apiKey: string): AppSettings {
  return { ...DEFAULT_SETTINGS, apiKey };
}

describe("KEY_12_PROVIDER_REQUEST_STILL_RECEIVES_CORRECT_PLAINTEXT_KEY", () => {
  it("x-api-key provider receives the plaintext credential in the header", async () => {
    await expect(
      callAnthropic(block, "text", settingsWith("fake-anthropic-key"))
    ).rejects.toThrow();

    expect(captured).toHaveLength(1);
    expect(captured[0].headers["x-api-key"]).toBe("fake-anthropic-key");
  });

  it("bearer provider receives the plaintext credential in the Authorization header", async () => {
    await expect(
      callOpenAICompat(block, "text", settingsWith("fake-openai-key"), getProvider("openai"))
    ).rejects.toThrow();

    expect(captured).toHaveLength(1);
    expect(captured[0].headers["Authorization"]).toBe("Bearer fake-openai-key");
  });

  it("Gemini receives the plaintext credential in the ?key= query", async () => {
    await expect(
      callGemini(block, "text", settingsWith("fake-gemini-key"))
    ).rejects.toThrow();

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toContain("?key=fake-gemini-key");
  });
});
