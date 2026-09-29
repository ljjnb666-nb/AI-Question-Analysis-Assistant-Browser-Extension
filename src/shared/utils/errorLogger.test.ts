import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callGemini } from "../ai/providerClients";
import { DEFAULT_SETTINGS, type QuestionBlock } from "../types";
import {
  clearErrorLogs,
  exportErrorLogs,
  getErrorLogs,
  loadErrorLogs,
  logError,
  logInfo,
  logWarn,
  redactUrlForLog,
} from "./errorLogger";

// Assembled at runtime so security scanners do not mistake the fixture
// for a committed credential.
const GEMINI_SECRET = ["release", "secret", "12345"].join("-");
const AUTH_SECRET = ["auth", "secret"].join("-");
const PASSWORD_SECRET = ["password", "secret"].join("-");

const QUESTION_BLOCK: QuestionBlock = {
  id: "question-for-log-redaction-test",
  bbox: { x: 0, y: 0, width: 100, height: 40 },
  previewText: "What is 2 + 2?",
  hasImage: false,
  questionTypeGuess: "unknown",
  confidence: 1,
  source: "manual_capture",
};

let localStorageData: Record<string, unknown>;

beforeEach(() => {
  clearErrorLogs();
  localStorageData = {};

  vi.mocked(chrome.storage.local.get).mockImplementation(async (keys) => {
    const requestedKeys = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : [];
    return Object.fromEntries(requestedKeys.map((key) => [key, localStorageData[key]])) as never;
  });
  vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
    localStorageData = { ...localStorageData, ...items };
  });
  vi.mocked(chrome.storage.local.remove).mockImplementation(async (keys) => {
    const removedKeys = typeof keys === "string" ? [keys] : keys;
    for (const key of removedKeys) delete localStorageData[key];
  });

  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("error log secret redaction", () => {
  it("P_REL_SEC_01_GEMINI_TIMEOUT keeps the request key but redacts every error-log boundary", async () => {
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callGemini(QUESTION_BLOCK, "text", {
      ...DEFAULT_SETTINGS,
      providerId: "gemini",
      apiKey: GEMINI_SECRET,
      apiModel: "gemini-2.5-flash",
    })).rejects.toThrow("Request timed out");

    const requestUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestUrl).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_SECRET}`,
    );

    const inMemoryLogs = getErrorLogs();
    expect(JSON.stringify(inMemoryLogs)).not.toContain(GEMINI_SECRET);
    const loggedUrl = inMemoryLogs[0].data?.url as string;
    expect(new URL(loggedUrl).searchParams.get("key")).toBe("[REDACTED]");

    const exported = await exportErrorLogs();
    expect(JSON.stringify(localStorageData.errorLog)).not.toContain(GEMINI_SECRET);
    expect(exported).not.toContain(GEMINI_SECRET);
    expect(JSON.stringify(await loadErrorLogs())).not.toContain(GEMINI_SECRET);
  });

  it("P_REL_SEC_02_CUSTOM_URL_REDACTION removes URL userinfo and token while retaining diagnostics", async () => {
    const customUrl = "https://user:password@example.test/v1/chat/completions?token=secret&mode=test";

    logError("Custom provider request failed", new Error("Fetch failed"), "provider", { url: customUrl });
    const loggedUrl = getErrorLogs()[0].data?.url as string;
    const parsed = new URL(loggedUrl);

    expect(loggedUrl).not.toContain("user");
    expect(loggedUrl).not.toContain("password");
    expect(loggedUrl).not.toContain("secret");
    expect(parsed.protocol).toBe("https:");
    expect(parsed.host).toBe("example.test");
    expect(parsed.pathname).toBe("/v1/chat/completions");
    expect(parsed.searchParams.get("token")).toBe("[REDACTED]");
    expect(parsed.searchParams.get("mode")).toBe("test");
    expect(await exportErrorLogs()).not.toMatch(/user|password|secret/);
  });

  it("P_REL_SEC_03_NORMAL_URL preserves ordinary URL diagnostics", () => {
    const ordinaryUrl = "https://api.example.test/v1/chat/completions?mode=test";
    expect(redactUrlForLog(ordinaryUrl)).toBe(ordinaryUrl);

    logError("Ordinary request failed", undefined, "provider", { url: ordinaryUrl });
    expect(getErrorLogs()[0].data?.url).toBe(ordinaryUrl);
  });

  it("P_REL_SEC_04_SIGNED_URL_REDACTION masks AWS and Google signature credentials", () => {
    const signedUrl = [
      "https://media.example.test/object.png",
      "?X-Amz-Signature=aws-secret",
      "&X-Amz-Credential=aws-credential",
      "&X-Amz-Security-Token=session-secret",
      "&X-Goog-Signature=google-signature",
      "&X-Goog-Credential=google-credential",
      "&mode=test",
    ].join("");

    logError("Signed media request failed", undefined, "provider", { url: signedUrl });
    const loggedUrl = getErrorLogs()[0].data?.url as string;
    const parsed = new URL(loggedUrl);

    expect(loggedUrl).not.toMatch(/aws-secret|aws-credential|session-secret|google-signature|google-credential/);
    expect(parsed.protocol).toBe("https:");
    expect(parsed.host).toBe("media.example.test");
    expect(parsed.pathname).toBe("/object.png");
    expect(parsed.searchParams.get("X-Amz-Signature")).toBe("[REDACTED]");
    expect(parsed.searchParams.get("X-Amz-Credential")).toBe("[REDACTED]");
    expect(parsed.searchParams.get("X-Amz-Security-Token")).toBe("[REDACTED]");
    expect(parsed.searchParams.get("X-Goog-Signature")).toBe("[REDACTED]");
    expect(parsed.searchParams.get("X-Goog-Credential")).toBe("[REDACTED]");
    expect(parsed.searchParams.get("mode")).toBe("test");
  });

  it("scrubs sensitive structured fields without redacting an ordinary field named key", () => {
    const warningUrl = "https://api.example.test/run?access_token=secret&mode=test";
    logWarn("Provider warning", "provider", { url: warningUrl });
    logInfo("Credential diagnostic", "provider", {
      apiKey: GEMINI_SECRET,
      authToken: AUTH_SECRET,
      password: PASSWORD_SECRET,
      verificationCode: ["123", "456"].join(""),
      key: "semantic-key-name",
    });

    const logs = JSON.stringify(getErrorLogs());
    expect(logs).not.toMatch(/secret|123456/);
    expect(logs).toContain("semantic-key-name");
    expect(new URL(getErrorLogs()[0].data?.url as string).searchParams.get("access_token")).toBe("[REDACTED]");
  });

  it("scrubs legacy persisted entries before returning or exporting them", async () => {
    localStorageData.errorLog = [{
      level: "error",
      message: "Old failure",
      timestamp: 1,
      data: { url: `https://example.test/run?key=${GEMINI_SECRET}` },
    }];

    const loaded = await loadErrorLogs();
    expect(JSON.stringify(loaded)).not.toContain(GEMINI_SECRET);
    expect(JSON.stringify(localStorageData.errorLog)).not.toContain(GEMINI_SECRET);
    expect(await exportErrorLogs()).not.toContain(GEMINI_SECRET);
  });

  it("fails closed for malformed URL-shaped values", () => {
    expect(redactUrlForLog("https://[malformed?key=secret")).toBe("[REDACTED_URL]");
  });
});
