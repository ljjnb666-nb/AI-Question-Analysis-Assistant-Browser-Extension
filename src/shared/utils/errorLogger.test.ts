import { requestContextFixture } from "../ai/runtimeRequest.testFixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callGemini } from "../ai/providerClients";
import { type QuestionBlock } from "../types";
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
  it("P_REL_SEC_01_GEMINI_FETCH_ABORT keeps the request key but redacts every error-log boundary", async () => {
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callGemini(QUESTION_BLOCK, "text", requestContextFixture("gemini", GEMINI_SECRET))).rejects.toThrow("aborted");

    const requestUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestUrl).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_SECRET}`,
    );

    const inMemoryLogs = getErrorLogs();
    expect(JSON.stringify(inMemoryLogs)).not.toContain(GEMINI_SECRET);
    const loggedUrl = inMemoryLogs[0].data?.url as string;
    expect(new URL(loggedUrl).search).toBe("");

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


describe("PHASE14D_02 explicit HTTP credential redaction", () => {
  it("redacts credentials in structured headers, URL query parameters, and Error stack at all log boundaries", async () => {
    const bearer = ["private", "bearer", "value"].join("-");
    const proxy = ["proxy", "credential", "value"].join("-");
    const cookie = ["session", "cookie", "value"].join("-");
    const apiKey = ["service", "key", "value"].join("-");
    const csrf = ["csrf", "token", "value"].join("-");
    const assertion = ["client", "assertion", "value"].join("-");
    const session = ["session", "identifier", "value"].join("-");
    const url = "https://service.example.test/endpoint?session_id=" + session
      + "&csrf_token=" + csrf + "&mode=test";
    const error = new Error("Authorization: Bearer " + bearer + "\nserver rejected request");
    error.stack = "Error: Authorization: Bearer " + bearer
      + "\nProxy-Authorization: Basic " + proxy + "\n at test-helper";
    Object.assign(error, { extraHeaders: { "Set-Cookie": "id=" + cookie } });

    logError("Failed with Cookie: id=" + cookie + "; Secure\nrequest stayed in diagnostic mode", error, "security", {
      url,
      headers: { Cookie: "id=" + cookie, "X-Api-Key": apiKey },
      nested: { clientAssertion: assertion, privateKey: assertion, context: "safe-context" },
    });
    const memory = getErrorLogs();
    const serializedMemory = JSON.stringify(memory, (_key, value) =>
      value instanceof Error ? { message: value.message, stack: value.stack, extraHeaders: (value as Error & { extraHeaders?: unknown }).extraHeaders } : value,
    );
    const exported = await exportErrorLogs();
    const storage = JSON.stringify(localStorageData.errorLog);
    const devConsole = JSON.stringify(vi.mocked(console.error).mock.calls);
    for (const secret of [bearer, proxy, cookie, apiKey, csrf, assertion, session]) {
      for (const output of [serializedMemory, exported, storage, devConsole]) {
        expect(output).not.toContain(secret);
      }
    }
    expect(memory[0].message).toContain("Cookie: [REDACTED]");
    expect(memory[0].error?.message).toContain("Authorization: [REDACTED]");
    expect(memory[0].data?.headers).toEqual({ Cookie: "[REDACTED]", "X-Api-Key": "[REDACTED]" });
    expect((memory[0].data?.nested as Record<string, unknown>).context).toBe("safe-context");
    const parsed = new URL(memory[0].data?.url as string);
    expect(parsed.searchParams.get("session_id")).toBe("[REDACTED]");
    expect(parsed.searchParams.get("csrf_token")).toBe("[REDACTED]");
    expect(parsed.searchParams.get("mode")).toBe("test");
  });

  it("scrubs legacy stored Cookie/Proxy-Authorization and URL auth-code fields before export", async () => {
    const cookie = ["legacy", "cookie", "value"].join("-");
    const authCode = ["legacy", "auth", "code"].join("-");
    const proxy = ["legacy", "proxy", "value"].join("-");
    localStorageData.errorLog = [{
      level: "error", timestamp: 42,
      message: "Proxy-Authorization: Bearer " + proxy,
      data: {
        httpHeaders: { "Set-Cookie": "session=" + cookie },
        url: "https://id.example.test/return?auth_code=" + authCode + "&mode=test",
      },
    }];
    const logs = await loadErrorLogs();
    const exported = await exportErrorLogs();
    const stored = JSON.stringify(localStorageData.errorLog);
    for (const secret of [cookie, authCode, proxy]) {
      expect(JSON.stringify(logs)).not.toContain(secret);
      expect(exported).not.toContain(secret);
      expect(stored).not.toContain(secret);
    }
    expect(logs[0].message).toBe("Proxy-Authorization: [REDACTED]");
    expect((logs[0].data?.httpHeaders as Record<string, unknown>)["Set-Cookie"]).toBe("[REDACTED]");
    expect(new URL(logs[0].data?.url as string).searchParams.get("auth_code")).toBe("[REDACTED]");
  });
});

describe("PHASE14D_01 error-log deletion consistency", () => {
  it("serializes clear behind a parked older persistence write", async () => {
    // Drain any previous tests' queued storage work before installing the gate.
    await loadErrorLogs();
    let persistedWriteStarted!: () => void;
    let releasePersistedWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => { persistedWriteStarted = resolve; });
    const writeGate = new Promise<void>((resolve) => { releasePersistedWrite = resolve; });
    let parkNextSet = true;
    vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
      if (parkNextSet && Array.isArray(items.errorLog)) {
        parkNextSet = false;
        persistedWriteStarted();
        await writeGate;
      }
      localStorageData = { ...localStorageData, ...items };
    });

    logError("old queued error", new Error("old entry"));
    await writeStarted;
    clearErrorLogs();
    releasePersistedWrite();

    // loadErrorLogs is serialized through the exact same queue and provides
    // a deterministic completion fence. The cleared entry must not resurrect.
    expect(await loadErrorLogs()).toEqual([]);
    expect(localStorageData.errorLog).toBeUndefined();
    expect(getErrorLogs()).toEqual([]);
  });

  it("retains only logs committed after a clear, even with queued pre-clear writes", async () => {
    await loadErrorLogs();
    logError("before clear");
    clearErrorLogs();
    logError("after clear");
    const logs = await loadErrorLogs();
    expect(logs.map((entry) => entry.message)).toEqual(["after clear"]);
    expect(getErrorLogs().map((entry) => entry.message)).toEqual(["after clear"]);
    expect(JSON.stringify(localStorageData.errorLog)).not.toContain("before clear");
  });
});


describe("PHASE14D_03 legacy persisted error-log retention", () => {
  it("caps an oversized legacy array on load, storage rewrite, and export while scrubbing retained secrets", async () => {
    // Drain the beforeEach clear operation before seeding legacy storage.
    await loadErrorLogs();
    const secret = ["legacy", "retained", "credential"].join("-");
    localStorageData.errorLog = Array.from({ length: 137 }, (_unused, index) => ({
      level: "error",
      message: "legacy-" + index,
      timestamp: index,
      data: { url: "https://provider.example.test/fail?token=" + secret + "&mode=test" },
    }));

    const loaded = await loadErrorLogs();
    expect(loaded).toHaveLength(100);
    expect(loaded[0].message).toBe("legacy-37");
    expect(loaded[99].message).toBe("legacy-136");
    const stored = localStorageData.errorLog as Array<{ message: string; data: { url: string } }>;
    expect(stored).toHaveLength(100);
    expect(stored.map((entry) => entry.message)).toEqual(loaded.map((entry) => entry.message));
    const exported = JSON.parse(await exportErrorLogs()) as Array<{ message: string }>;
    expect(exported).toHaveLength(100);
    expect(exported[0].message).toBe("legacy-37");
    expect(exported[99].message).toBe("legacy-136");
    expect(JSON.stringify(loaded)).not.toContain(secret);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(exported)).not.toContain(secret);
    expect(new URL(stored[0].data.url).searchParams.get("token")).toBe("[REDACTED]");
  });

  it("caps oversized historical data before appending a newly committed error", async () => {
    await loadErrorLogs();
    localStorageData.errorLog = Array.from({ length: 140 }, (_unused, index) => ({
      level: "error",
      message: "legacy-" + index,
      timestamp: index,
    }));

    logError("latest-new-error", undefined, "retention");
    // Wait behind the write on the same serialized persistence queue.
    const stored = await loadErrorLogs();
    expect(stored).toHaveLength(100);
    expect(stored[0].message).toBe("legacy-41");
    expect(stored[98].message).toBe("legacy-139");
    expect(stored[99].message).toBe("latest-new-error");
    expect(localStorageData.errorLog as unknown[]).toHaveLength(100);
    expect(JSON.parse(await exportErrorLogs())).toHaveLength(100);
  });
});


describe("PHASE14D_04 per-entry error-log resource budgets", () => {
  it("fails closed for oversized messages, stacks, URL fields and legacy data at every boundary", async () => {
    await loadErrorLogs();
    const secret = ["very", "private", "token"].join("-");
    const oversized = "Authorization: Bearer " + secret + " ".repeat(9000);
    const hugeUrl = "https://api.example.test/run?token=" + secret + "&memo=" + "x".repeat(9000);
    const thrown = new Error(oversized);
    thrown.stack = oversized;
    logError(oversized, thrown, "limits", { url: hugeUrl, oversized });
    const entries = getErrorLogs();
    const exported = await exportErrorLogs();
    const stored = JSON.stringify(localStorageData.errorLog);
    const consoleOutput = JSON.stringify(vi.mocked(console.error).mock.calls);
    for (const output of [JSON.stringify(entries), exported, stored, consoleOutput]) {
      expect(output).not.toContain(secret);
      expect(output.length).toBeLessThan(32 * 1024);
    }
    expect(entries[0].message).toBe("[REDACTED_OVERSIZED_LOG_VALUE]");
    expect(entries[0].stack).toBe("[REDACTED_OVERSIZED_LOG_VALUE]");
    expect(entries[0].error?.message).toBe("[REDACTED_OVERSIZED_LOG_VALUE]");
    expect(entries[0].data?.url).toBe("[REDACTED_OVERSIZED_LOG_VALUE]");
    expect(redactUrlForLog(hugeUrl)).toBe("[REDACTED_OVERSIZED_LOG_VALUE]");

    localStorageData.errorLog = [{
      level: "error", message: oversized, timestamp: 1, stack: oversized,
      data: { url: hugeUrl, payload: oversized },
    }];
    const legacy = await loadErrorLogs();
    expect(legacy[0].message).toBe("[REDACTED_OVERSIZED_LOG_VALUE]");
    expect(JSON.stringify(legacy)).not.toContain(secret);
    expect(await exportErrorLogs()).not.toContain(secret);
    expect(JSON.stringify(localStorageData.errorLog)).not.toContain(secret);
  });

  it("terminates deep, wide and cyclic structured logs without traversing oversized data", async () => {
    await loadErrorLogs();
    const secret = ["nested", "credential", "value"].join("-");
    let deep: Record<string, unknown> = { token: secret };
    for (let depth = 0; depth < 80; depth++) deep = { child: deep };
    const wide = Array.from({ length: 500 }, () => ({ apiKey: secret }));
    const cyclic: Record<string, unknown> = { context: "diagnostic" };
    cyclic.self = cyclic;
    logError("resource-limits", undefined, "test", { deep, wide, cyclic });
    const [entry] = getErrorLogs();
    const data = entry.data as Record<string, unknown>;
    expect(data.wide).toBe("[REDACTED_COMPLEX_LOG_VALUE]");
    expect(JSON.stringify(data.deep)).toContain("[REDACTED_COMPLEX_LOG_VALUE]");
    expect(JSON.stringify(data.cyclic)).toContain("[REDACTED_CIRCULAR_DATA]");
    expect(JSON.stringify(entry)).not.toContain(secret);
    const exported = await exportErrorLogs();
    expect(exported).not.toContain(secret);
    expect(new TextEncoder().encode(JSON.stringify(entry)).byteLength).toBeLessThanOrEqual(32 * 1024);
  });

  it("replaces aggregate over-budget entries without retaining raw content", async () => {
    await loadErrorLogs();
    const payload = Array.from({ length: 60 }, (_unused, i) => "record-" + i + "-" + "x".repeat(790));
    logError("large structured entry", undefined, "budget", { payload });
    const entry = getErrorLogs()[0];
    expect(entry.message).toBe("Log entry redacted after exceeding resource or sanitization limit");
    expect(new TextEncoder().encode(JSON.stringify(entry)).byteLength).toBeLessThanOrEqual(32 * 1024);
    // Persistence is serialized and asynchronous: wait on the same queue
    // before inspecting durable storage, not just the synchronous memory log.
    const committed = await loadErrorLogs();
    expect(committed[0].message).toBe(entry.message);
    expect(JSON.stringify(localStorageData.errorLog)).not.toContain("record-59-");
    expect(await exportErrorLogs()).not.toContain("record-59-");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("record-59-");
    expect((await loadErrorLogs())[0].message).toBe(entry.message);
  });

  it("preserves bounded diagnostics, semantic keys and token masking", () => {
    const credential = ["header", "secret", "value"].join("-");
    logError("ordinary request failure", undefined, "provider", {
      url: "https://api.example.test/call?mode=test&token=" + credential,
      key: "semantic-name",
    });
    const [entry] = getErrorLogs();
    expect(entry.message).toBe("ordinary request failure");
    expect(entry.data?.key).toBe("semantic-name");
    expect(new URL(entry.data?.url as string).searchParams.get("token")).toBe("[REDACTED]");
    expect(JSON.stringify(entry)).not.toContain(credential);
  });
});
