import type { AppSettings } from "../types";
import type { AnalyticsEvent } from "./analytics";

export type AnalyticsUploadPayload = {
  deviceId: string;
  event: AnalyticsEvent;
  ts: number;
  duration?: number;
  extensionVersion?: string;
  data?: Record<string, unknown>;
};

const PROVIDERS = new Set(["anthropic", "openai", "deepseek", "gemini", "qwen", "moonshot", "zhipu", "minimax", "ollama", "custom"]);
const ROUTES = new Set(["auto", "text", "vision", "hybrid"]);
const SOURCES = new Set(["sidepanel_commit", "auto_solve_commit"]);
const FAILURE_CATEGORIES = new Set(["timeout", "network", "http_4xx", "http_5xx", "media_unavailable", "unsupported", "unknown"]);
const DATA_FIELDS: Partial<Record<AnalyticsEvent, readonly string[]>> = {
  extension_installed: ["reason"],
  settings_saved: ["providerId", "route"],
  api_key_set: ["providerId"],
  parse_success: ["provider", "route", "duration", "attempt", "source"],
  parse_error: ["provider", "route", "attempt", "exhausted", "category"],
};

const UPLOAD_EVENTS = new Set<AnalyticsEvent>([
  "extension_installed",
  "popup_opened",
  "settings_saved",
  "api_key_set",
  "parse_success",
  "parse_error",
]);

export function isAnalyticsUploadEvent(event: AnalyticsEvent): boolean {
  return UPLOAD_EVENTS.has(event);
}

export function buildAnalyticsUploadPayload(
  settings: AppSettings,
  event: AnalyticsEvent,
  ts: number,
  extensionVersion?: string,
  duration?: number,
  data?: Record<string, unknown>,
): AnalyticsUploadPayload {
  const safeData = normalizeAnalyticsData(event, data);
  const safeDuration = normalizeDuration(duration ?? safeData?.duration);
  return {
    deviceId: settings.deviceId,
    event,
    ts,
    ...(safeDuration === undefined ? {} : { duration: safeDuration }),
    extensionVersion,
    ...(safeData && Object.keys(safeData).length > 0 ? { data: safeData } : {}),
  };
}

export function normalizeAnalyticsData(
  event: AnalyticsEvent,
  data?: Record<string, unknown>,
): Record<string, string | number | boolean> | undefined {
  if (!data) return undefined;
  const fields = DATA_FIELDS[event] ?? [];
  const result: Record<string, string | number | boolean> = {};
  for (const key of fields) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    if ((key === "provider" || key === "providerId") && typeof value === "string" && PROVIDERS.has(value)) result[key] = value;
    else if (key === "route" && typeof value === "string" && ROUTES.has(value)) result[key] = value;
    else if (key === "source" && typeof value === "string" && SOURCES.has(value)) result[key] = value;
    else if (key === "reason" && typeof value === "string" && ["install", "update", "chrome_update", "shared_module_update"].includes(value)) result[key] = value;
    else if (key === "category" && typeof value === "string") result[key] = FAILURE_CATEGORIES.has(value) ? value : "unknown";
    else if ((key === "duration" || key === "attempt") && typeof value === "number" && Number.isFinite(value)) result[key] = Math.max(0, Math.min(key === "duration" ? 3_600_000 : 100, Math.floor(value)));
    else if (key === "exhausted" && typeof value === "boolean") result[key] = value;
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeDuration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(3_600_000, Math.floor(value)))
    : undefined;
}
