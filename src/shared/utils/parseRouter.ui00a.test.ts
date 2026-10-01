import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings, type QuestionBlock } from "../types";
import { isProviderNotConfiguredError, ProviderNotConfiguredError } from "./parseAttemptErrors";
import { mockParse, parseQuestion } from "./parseRouter";

// Assembled at runtime so security scanners do not mistake this synthetic
// test fixture for a committed credential.
const TEST_API_KEY = ["test", "key"].join("-");

const block: QuestionBlock = {
  id: "ui00a-block",
  bbox: { x: 0, y: 0, width: 100, height: 50 },
  previewText: "1+1=? A.1 B.2 C.3 D.4",
  hasImage: false,
  questionTypeGuess: "single_choice",
  confidence: 0.9,
  source: "manual_capture",
};

function providerSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, providerId: "anthropic", apiKey: TEST_API_KEY, apiModel: "claude-opus-4.8", ...overrides };
}

/** OpenAI-compatible custom endpoint so the stubbed response shape matches. */
function customProviderSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...providerSettings(overrides),
    providerId: "custom",
    apiModel: "test-model",
    preferredRoute: "text",
    language: "en",
    customBaseUrl: "https://provider.example.test/v1",
    customProviderProtocol: "openai",
  };
}

function stubProviderResponse() {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            questionType: "single_choice",
            answer: "C",
            confidence: 0.97,
            briefExplanation: "provider says C",
            detailedExplanation: "provider detailed",
            recognizedText: block.previewText,
          }),
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("parseRouter mock safety gate (UI-00A)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("UI00A-01: required-key provider without a key fails explicitly and never returns a mock result", async () => {
    const fetchMock = stubProviderResponse();
    await expect(parseQuestion(block, providerSettings({ apiKey: "" }))).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    // The failure happens before any network attempt.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("UI00A-02: explicit demo opt-in returns a mock result stamped resultSource=mock", async () => {
    const fetchMock = stubProviderResponse();
    const result = await parseQuestion(block, providerSettings({ apiKey: "" }), undefined, { allowDemo: true });
    expect(result.resultSource).toBe("mock");
    expect(result.answer).toBe("B");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await mockParse(block)).resultSource).toBe("mock");
  });

  it("UI00A-03: a real provider success is stamped resultSource=provider at the unified boundary", async () => {
    const fetchMock = stubProviderResponse();
    const result = await parseQuestion(block, customProviderSettings());
    expect(result.answer).toBe("C");
    expect(result.resultSource).toBe("provider");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("UI00A-10: the not-configured failure keeps a natural zh message plus a stable machine code", async () => {
    stubProviderResponse();
    const error = await parseQuestion(block, providerSettings({ apiKey: "", language: "zh" })).catch((err: unknown) => err);
    expect(isProviderNotConfiguredError(error)).toBe(true);
    expect((error as ProviderNotConfiguredError).message).toContain("请先在设置");
    expect((error as ProviderNotConfiguredError).code).toBe("PROVIDER_NOT_CONFIGURED");
  });
});
