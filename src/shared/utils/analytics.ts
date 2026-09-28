/**
 * Analytics / Event Logger (M6)
 * Tracks user interactions and parse performance.
 */

import { logError } from "./errorLogger";
import type { AppSettings } from "../types";
import { buildAnalyticsUploadPayload, isAnalyticsUploadEvent } from "./analyticsBackend";
import { getOrCreateDeviceId, loadSettings } from "./storage";
import {
  __resetAnalyticsStateForTests,
  enqueueAnalyticsWork,
  flushAnalyticsWork,
  getAnalyticsConsentGeneration,
  SESSION_LOG,
} from "./analyticsState";
import { CURRENT_ANALYTICS_CONSENT_VERSION } from "./storage";

export type AnalyticsEvent =
  | "extension_installed"
  | "session_start"
  | "popup_opened"
  | "manual_capture_started"
  | "manual_capture_completed"
  | "manual_capture_cancelled"
  | "manual_capture_submitted"
  | "auto_detect_started"
  | "auto_detect_candidates_found"
  | "auto_detect_candidate_selected"
  | "auto_detect_batch_submitted"
  | "floating_window_opened"
  | "floating_window_minimized"
  | "floating_window_closed"
  | "floating_window_resized"
  | "floating_window_moved"
  | "answer_copied"
  | "parse_success"
  | "parse_error"
  | "parse_low_confidence"
  | "manual_auto_vision_retry_started"
  | "manual_auto_vision_retry_applied"
  | "manual_auto_vision_retry_skipped"
  | "manual_second_vision_review_started"
  | "manual_second_vision_review_applied"
  | "manual_second_vision_review_skipped"
  | "parse_stream_timeout_fallback"
  | "manual_parse_attempt_started"
  | "manual_parse_attempt_succeeded"
  | "manual_parse_attempt_failed"
  | "provider_result_discarded_stale"
  | "route_used_text"
  | "route_used_vision"
  | "route_used_hybrid"
  | "settings_saved"
  | "api_key_set"
  | "auth_registered"
  | "auth_logged_in"
  | "auth_logged_out"
  | "vision_upgrade_triggered"
  | "keyboard_shortcut_used"
  | "history_exported"
  | "history_cleared";

export interface EventEntry {
  event: AnalyticsEvent;
  data?: Record<string, string | number | boolean>;
  ts: number;
  duration?: number;
}

const MAX_STORED = 300;

function isExtensionContextInvalidatedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return /Extension context invalidated/i.test(message);
}

// Fire session_start once per content script load
let sessionStarted = false;
export function initAnalytics() {
  if (sessionStarted) return;
  sessionStarted = true;
  logEvent("session_start");
}

export function logEvent(
  event: AnalyticsEvent,
  data?: Record<string, unknown>,
): void {
  const consentGeneration = getAnalyticsConsentGeneration();
  void enqueueAnalyticsWork(async () => {
    try {
      if (getAnalyticsConsentGeneration() !== consentGeneration) return;
      const settings = await loadSettings();
      if (!settings.enableAnalytics || settings.analyticsConsentVersion !== CURRENT_ANALYTICS_CONSENT_VERSION) return;
      if (getAnalyticsConsentGeneration() !== consentGeneration) return;
      const safeData = normalizeLocalAnalyticsData(data);
      const duration = normalizeDuration(safeData?.duration);
      const entry: EventEntry = {
        event,
        ...(safeData ? { data: safeData } : {}),
        ts: Date.now(),
        ...(duration === undefined ? {} : { duration }),
      };
      SESSION_LOG.push(entry);
      await persistEvent(entry, consentGeneration);
      if (getAnalyticsConsentGeneration() !== consentGeneration) return;
      if (isAnalyticsUploadEvent(event)) await uploadEvent(entry, consentGeneration);
    } catch (err) {
      if (!isExtensionContextInvalidatedError(err)) logError("Failed to record analytics event", err, "logEvent", { event });
    }
  });
}

async function persistEvent(entry: EventEntry, consentGeneration: number): Promise<void> {
  if (getAnalyticsConsentGeneration() !== consentGeneration) return;
  const settings = await loadSettings();
  if (!settings.enableAnalytics || settings.analyticsConsentVersion !== CURRENT_ANALYTICS_CONSENT_VERSION) return;
  try {
    const r = await chrome.storage.local.get("analyticsLog");
    if (getAnalyticsConsentGeneration() !== consentGeneration) return;
    const log: EventEntry[] = (r["analyticsLog"] as EventEntry[]) ?? [];
    const updated = [...log, entry].slice(-MAX_STORED);
    await chrome.storage.local.set({ analyticsLog: updated });
    if (getAnalyticsConsentGeneration() !== consentGeneration) {
      const latest = await chrome.storage.local.get("appSettings");
      const currentSettings = latest.appSettings as Partial<AppSettings> | undefined;
      if (currentSettings?.enableAnalytics !== true || currentSettings.analyticsConsentVersion !== CURRENT_ANALYTICS_CONSENT_VERSION) {
        await chrome.storage.local.remove("analyticsLog");
      }
    }
  } catch (err) {
    if (isExtensionContextInvalidatedError(err)) return;
    logError("Failed to persist analytics event", err, "persistEvent", { event: entry.event });
  }
}

async function uploadEvent(entry: EventEntry, consentGeneration: number): Promise<void> {
  if (!isAnalyticsUploadEvent(entry.event)) return;
  try {
    if (getAnalyticsConsentGeneration() !== consentGeneration) return;
    const settings = await loadSettings();
    if (!settings.enableAnalytics || settings.analyticsConsentVersion !== CURRENT_ANALYTICS_CONSENT_VERSION) return;

    const deviceId = settings.deviceId || await getOrCreateDeviceId();
    if (getAnalyticsConsentGeneration() !== consentGeneration) return;
    const baseUrl = String(settings.analyticsBaseUrl || "").trim().replace(/\/+$/, "");
    if (!baseUrl) return;

    const payload = buildAnalyticsUploadPayload(
      { ...settings, deviceId },
      entry.event,
      entry.ts,
      chrome.runtime.getManifest?.().version,
      entry.duration,
      entry.data,
    );

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (getAnalyticsConsentGeneration() !== consentGeneration) return;
    await fetch(`${baseUrl}/analytics/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (isExtensionContextInvalidatedError(err)) return;
    console.warn("[Analytics] upload failed:", err);
  }
}

export function getSessionLog(): EventEntry[] {
  return SESSION_LOG.map((entry) => ({ ...entry, ...(entry.data ? { data: { ...entry.data } } : {}) }));
}

const LOCAL_SAFE_FIELDS = new Set([
  "provider", "providerId", "route", "source", "mode", "count", "selected", "duration", "attempt",
  "exhausted", "autoVisionRetry", "screenshotFallback", "timeoutMs", "confidence", "success", "key", "category",
]);
const SAFE_VALUES: Record<string, Set<string>> = {
  provider: new Set(["anthropic", "openai", "deepseek", "gemini", "qwen", "moonshot", "zhipu", "minimax", "ollama", "custom"]),
  providerId: new Set(["anthropic", "openai", "deepseek", "gemini", "qwen", "moonshot", "zhipu", "minimax", "ollama", "custom"]),
  route: new Set(["auto", "text", "vision", "hybrid"]),
  source: new Set(["sidepanel_commit", "auto_solve_commit", "mock"]),
  mode: new Set(["full_page"]),
  key: new Set(["Alt+Q", "Alt+W"]),
  category: new Set(["timeout", "network", "http_4xx", "http_5xx", "media_unavailable", "unsupported", "unknown"]),
};

function normalizeLocalAnalyticsData(data?: Record<string, unknown>): Record<string, string | number | boolean> | undefined {
  if (!data) return undefined;
  const normalized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!LOCAL_SAFE_FIELDS.has(key) || value === null || value === undefined) continue;
    if (typeof value === "boolean" && ["selected", "exhausted", "autoVisionRetry", "screenshotFallback", "success"].includes(key)) {
      normalized[key] = value;
    } else if (typeof value === "number" && ["count", "duration", "attempt", "timeoutMs", "confidence"].includes(key) && Number.isFinite(value)) {
      normalized[key] = Math.max(0, Math.min(key === "confidence" ? 1 : key === "duration" || key === "timeoutMs" ? 3_600_000 : 100_000, value));
    } else if (typeof value === "string" && SAFE_VALUES[key]?.has(value)) {
      normalized[key] = value;
    }
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeDuration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(3_600_000, Math.floor(value))) : undefined;
}

/** Deterministic drain for tests and explicit telemetry clearing. */
export async function flushAnalytics(): Promise<void> {
  await flushAnalyticsWork();
}

export function __resetAnalyticsForTests(): void {
  __resetAnalyticsStateForTests();
}

export function classifyAnalyticsFailure(error: unknown): "timeout" | "network" | "http_4xx" | "http_5xx" | "media_unavailable" | "unsupported" | "unknown" {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/timeout|timed out|abort/i.test(message)) return "timeout";
  if (/media|image|screenshot/i.test(message)) return "media_unavailable";
  if (/unsupported|not supported/i.test(message)) return "unsupported";
  const status = message.match(/\b(4\d\d|5\d\d)\b/)?.[1];
  if (status?.startsWith("4")) return "http_4xx";
  if (status?.startsWith("5")) return "http_5xx";
  if (/network|fetch|connection/i.test(message)) return "network";
  return "unknown";
}

export async function getStoredLog(): Promise<EventEntry[]> {
  try {
    const r = await chrome.storage.local.get("analyticsLog");
    return (r["analyticsLog"] as EventEntry[]) ?? [];
  } catch (err) {
    if (isExtensionContextInvalidatedError(err)) return [];
    logError("Failed to load stored analytics log", err, "getStoredLog");
    return [];
  }
}

/** Utility: wrap an async operation and log its duration */
export async function trackDuration<T>(
  event: AnalyticsEvent,
  fn: () => Promise<T>,
  extraData?: Record<string, unknown>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logEvent(event, { ...extraData, duration: Date.now() - start, success: true });
    return result;
  } catch (err) {
    logEvent(event, { ...extraData, duration: Date.now() - start, success: false, error: String(err) });
    throw err;
  }
}
