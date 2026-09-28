import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../types";
import { __resetStorageCacheForTests, loadSettings, saveSettings, CURRENT_ANALYTICS_CONSENT_VERSION } from "./storage";
import { __resetAnalyticsForTests, flushAnalytics, getSessionLog, getStoredLog, logEvent } from "./analytics";
import { loginWithEmail } from "./auth";
import { parseQuestion } from "./parseRouter";
import type { QuestionBlock } from "../types";

let stored: Record<string, unknown>;

function installStorage() {
  vi.mocked(chrome.storage.local.get).mockImplementation(async (keys) => {
    const names = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(stored);
    return Object.fromEntries(names.filter((key) => key in stored).map((key) => [key, stored[key]])) as never;
  });
  vi.mocked(chrome.storage.local.set).mockImplementation(async (values) => {
    Object.assign(stored, values);
  });
  vi.mocked(chrome.storage.local.remove).mockImplementation(async (keys) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
  });
}

function consentedSettings() {
  return {
    ...DEFAULT_SETTINGS,
    deviceId: "device-analytics-01",
    enableAnalytics: true,
    analyticsConsentVersion: CURRENT_ANALYTICS_CONSENT_VERSION,
  };
}

describe("optional analytics privacy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetStorageCacheForTests();
    __resetAnalyticsForTests();
    stored = {};
    installStorage();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("defaults analytics off and persists the consent version", async () => {
    const settings = await loadSettings();
    expect(DEFAULT_SETTINGS.enableAnalytics).toBe(false);
    expect(settings.enableAnalytics).toBe(false);
    expect(settings.analyticsConsentVersion).toBe(CURRENT_ANALYTICS_CONSENT_VERSION);
    expect((stored.appSettings as Record<string, unknown>).enableAnalytics).toBe(false);
  });

  it("migrates a legacy implicit true to off and removes the old local analytics log", async () => {
    stored.appSettings = { ...DEFAULT_SETTINGS, enableAnalytics: true, analyticsConsentVersion: undefined, deviceId: "legacy-device" };
    stored.analyticsLog = [{ event: "legacy", ts: 1 }];

    const settings = await loadSettings();
    await flushAnalytics();

    expect(settings.enableAnalytics).toBe(false);
    expect(settings.analyticsConsentVersion).toBe(CURRENT_ANALYTICS_CONSENT_VERSION);
    expect(stored.analyticsLog).toBeUndefined();
    expect((stored.appSettings as Record<string, unknown>).enableAnalytics).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("collects nothing and does not persist or upload while disabled", async () => {
    stored.appSettings = { ...DEFAULT_SETTINGS, deviceId: "device-analytics-01", analyticsConsentVersion: CURRENT_ANALYTICS_CONSENT_VERSION, enableAnalytics: false };
    logEvent("parse_success", { provider: "openai", route: "text" });
    await flushAnalytics();

    expect(getSessionLog()).toEqual([]);
    expect(await getStoredLog()).toEqual([]);
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({ analyticsLog: expect.anything() }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clears only telemetry when a saved preference opts out", async () => {
    stored.appSettings = consentedSettings();
    stored.parseHistory = [{ id: "history-entry" }];
    logEvent("popup_opened");
    await flushAnalytics();
    expect(getSessionLog()).toHaveLength(1);
    expect(stored.analyticsLog).toHaveLength(1);

    await saveSettings({ enableAnalytics: false });

    expect(getSessionLog()).toEqual([]);
    expect(stored.analyticsLog).toBeUndefined();
    expect(stored.parseHistory).toEqual([{ id: "history-entry" }]);
    expect((stored.appSettings as Record<string, unknown>).enableAnalytics).toBe(false);
  });

  it("P_REL_PRIV_14_CROSS_CONTEXT_OPT_OUT fences pending and future analytics work", async () => {
    stored.appSettings = consentedSettings();
    await loadSettings(); // registers the same storage listener used by every extension context
    const writes: Record<string, unknown>[] = [];
    let releaseAnalyticsWrite!: () => void;
    const analyticsWritePending = new Promise<void>((resolve) => { releaseAnalyticsWrite = resolve; });
    vi.mocked(chrome.storage.local.set).mockImplementation(async (values) => {
      writes.push(values as Record<string, unknown>);
      if ("analyticsLog" in values) await analyticsWritePending;
      Object.assign(stored, values);
    });

    logEvent("popup_opened");
    await vi.waitFor(() => expect(writes.some((write) => "analyticsLog" in write)).toBe(true));
    expect(getSessionLog()).toHaveLength(1);

    const listenerCalls = vi.mocked(chrome.storage.onChanged.addListener).mock.calls;
    const listener = listenerCalls[listenerCalls.length - 1]?.[0] as
      ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void) | undefined;
    expect(listener).toBeTypeOf("function");
    stored.appSettings = { ...consentedSettings(), enableAnalytics: false };
    listener!({ appSettings: { newValue: stored.appSettings } }, "local");
    expect(getSessionLog()).toEqual([]);

    releaseAnalyticsWrite();
    await flushAnalytics();
    expect(stored.analyticsLog).toBeUndefined(); // stale in-flight write is removed after the consent generation changes

    const analyticsWriteCount = writes.filter((write) => "analyticsLog" in write).length;
    logEvent("popup_opened");
    await flushAnalytics();
    expect(getSessionLog()).toEqual([]);
    expect(writes.filter((write) => "analyticsLog" in write)).toHaveLength(analyticsWriteCount);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uploads allowlisted fields only, without page host, account identity, or bearer token", async () => {
    stored.appSettings = { ...consentedSettings(), authToken: "account-secret-token", userId: "account-user" };
    const source = "sidepanel_commit";
    logEvent("parse_success", {
      provider: "openai", route: "text", duration: 42, attempt: 2, source,
      blockId: "block-secret", questionId: "question-secret", questionText: "question-secret-text",
      answer: "answer-secret", recognizedText: "recognized-secret", host: "sensitive-course.example.edu",
      email: "user@example.com", apiKey: "api-secret", authToken: "account-secret-token",
      password: "password-secret", verificationCode: "123456", error: "provider-secret-error",
    });
    await flushAnalytics();

    const [, request] = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/analytics/events"))!;
    const serialized = String(request?.body);
    const payload = JSON.parse(serialized);
    expect(payload).toEqual({
      deviceId: "device-analytics-01", event: "parse_success", ts: expect.any(Number),
      duration: 42, extensionVersion: "0.2.0", data: { provider: "openai", route: "text", duration: 42, attempt: 2, source },
    });
    expect(request?.headers).toEqual({ "Content-Type": "application/json" });
    for (const secret of ["block-secret", "question-secret", "question-secret-text", "answer-secret", "recognized-secret", "sensitive-course.example.edu", "user@example.com", "api-secret", "account-secret-token", "password-secret", "123456", "provider-secret-error", "account-user"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(JSON.stringify(getSessionLog())).not.toContain("sensitive-course.example.edu");
  });

  it("drops raw error text from parse_error telemetry", async () => {
    stored.appSettings = consentedSettings();
    logEvent("parse_error", { error: "question-secret-123 api-response-secret-456", category: "unknown" });
    await flushAnalytics();
    const serialized = String(vi.mocked(fetch).mock.calls[0]?.[1]?.body);
    expect(serialized).not.toContain("question-secret-123");
    expect(serialized).not.toContain("api-response-secret-456");
    expect(serialized).toContain('"category":"unknown"');
  });

  it("keeps account login requests working while analytics is off", async () => {
    stored.appSettings = { ...DEFAULT_SETTINGS, analyticsConsentVersion: CURRENT_ANALYTICS_CONSENT_VERSION, enableAnalytics: false, deviceId: "device-analytics-01" };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true, user: { userId: "account-user", email: "user@example.com" }, authToken: "account-secret",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await loginWithEmail("user@example.com", "password123");
    await flushAnalytics();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/auth/login");
    expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).toContain("user@example.com");
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/analytics/events"), expect.anything());
  });

  it("keeps provider parsing requests working while analytics is off", async () => {
    stored.appSettings = { ...DEFAULT_SETTINGS, analyticsConsentVersion: CURRENT_ANALYTICS_CONSENT_VERSION, enableAnalytics: false, deviceId: "device-analytics-01" };
    const block: QuestionBlock = {
      id: "question-id", bbox: { x: 0, y: 0, width: 20, height: 20 }, previewText: "1+1=? A.1 B.2",
      hasImage: false, questionTypeGuess: "single_choice", confidence: 1, source: "manual_capture",
    };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      questionType: "single_choice", answer: "B", confidence: 0.9, briefExplanation: "Two", detailedExplanation: "1+1=2",
    }) } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await parseQuestion(block, { ...DEFAULT_SETTINGS, providerId: "openai", apiKey: "provider-key" });
    await flushAnalytics();

    expect(result.answer).toBe("B");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/chat/completions");
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/analytics/events"), expect.anything());
  });
});
