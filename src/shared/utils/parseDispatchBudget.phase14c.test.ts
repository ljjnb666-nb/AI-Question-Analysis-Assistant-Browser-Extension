import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type QuestionBlock } from "../types";
import { installMemoryStorage } from "../../test/memoryStorage";
import { seedAIConnectionFixture } from "../../test/aiConnectionFixture";
import { parseQuestion } from "./parseRouter";
import { parseWithTieredRetries } from "../../content/parseRetryPipeline";

const providerFixtureCredential = ["retry", "fixture"].join("-");
const block: QuestionBlock = {
  id: "phase14c-retry-budget", bbox: { x: 0, y: 0, width: 120, height: 60 },
  previewText: "1+1=? A.1 B.2 C.3", hasImage: false,
  questionTypeGuess: "single_choice", confidence: 0.9, source: "manual_capture",
};
const settings = { preferredRoute: "text" as const, language: "en" as const };
const response = () => new Response("temporary provider failure", { status: 503 });

beforeEach(async () => {
  installMemoryStorage();
  await seedAIConnectionFixture({
    ...DEFAULT_SETTINGS, ...settings, providerId: "custom",
    customProviderProtocol: "openai", customBaseUrl: "https://retry-provider.example.test/v1",
    apiKey: providerFixtureCredential, apiModel: "fixture-model",
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PHASE14C_02A real retry dispatch budget", () => {
  it("prevents nested provider retries and tier retries from exceeding six real fetch dispatches", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    const pending = parseWithTieredRetries(block, settings, false, () => {}, [10_000, 10_000, 10_000], {
      parseQuestion, logEvent: vi.fn(), setStreamingText: vi.fn(),
      withTimeout: <T>(promise: Promise<T>) => promise,
    });
    const rejection = expect(pending).rejects.toThrow();
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("does not issue a seventh request when the provider keeps failing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    const logs = vi.fn();
    const pending = parseWithTieredRetries(block, settings, false, () => {}, [10_000, 10_000, 10_000], {
      parseQuestion, logEvent: logs, setStreamingText: vi.fn(),
      withTimeout: <T>(promise: Promise<T>) => promise,
    });
    const rejection = expect(pending).rejects.toThrow("AI_PROVIDER_DISPATCH_BUDGET_EXHAUSTED");
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(logs).not.toHaveBeenCalledWith("manual_parse_attempt_succeeded", expect.anything());
  });
});
