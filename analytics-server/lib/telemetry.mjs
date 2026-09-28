export const REMOTE_ANALYTICS_EVENTS = new Set([
  "extension_installed",
  "popup_opened",
  "settings_saved",
  "api_key_set",
  "parse_success",
  "parse_error",
]);
export const CURRENT_REMOTE_ANALYTICS_CONSENT_VERSION = 1;

const EVENT_FIELDS = {
  extension_installed: ["reason"],
  settings_saved: ["providerId", "route"],
  api_key_set: ["providerId"],
  parse_success: ["provider", "route", "duration", "attempt", "source"],
  parse_error: ["provider", "route", "attempt", "exhausted", "category"],
};
const PROVIDERS = new Set(["anthropic", "openai", "deepseek", "gemini", "qwen", "moonshot", "zhipu", "minimax", "ollama", "custom"]);
const ROUTES = new Set(["auto", "text", "vision", "hybrid"]);
const SOURCES = new Set(["sidepanel_commit", "auto_solve_commit"]);
const REASONS = new Set(["install", "update", "chrome_update", "shared_module_update"]);
const FAILURE_CATEGORIES = new Set(["timeout", "network", "http_4xx", "http_5xx", "media_unavailable", "unsupported", "unknown"]);

function boundedNumber(value, maximum) {
  return Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.floor(value))) : undefined;
}

function normalizeData(event, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const normalized = {};
  for (const key of EVENT_FIELDS[event] || []) {
    const value = data[key];
    if ((key === "provider" || key === "providerId") && PROVIDERS.has(value)) normalized[key] = value;
    else if (key === "route" && ROUTES.has(value)) normalized[key] = value;
    else if (key === "source" && SOURCES.has(value)) normalized[key] = value;
    else if (key === "reason" && REASONS.has(value)) normalized[key] = value;
    else if (key === "category" && typeof value === "string") normalized.category = FAILURE_CATEGORIES.has(value) ? value : "unknown";
    else if ((key === "duration" || key === "attempt") && typeof value === "number") {
      const number = boundedNumber(value, key === "duration" ? 3_600_000 : 100);
      if (number !== undefined) normalized[key] = number;
    } else if (key === "exhausted" && typeof value === "boolean") normalized[key] = value;
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

export function normalizeRemoteAnalyticsEvent(body, now = Date.now()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (body.analyticsConsentVersion !== CURRENT_REMOTE_ANALYTICS_CONSENT_VERSION) return null;
  if (typeof body.deviceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.deviceId)) return null;
  if (!REMOTE_ANALYTICS_EVENTS.has(body.event)) return null;
  const ts = typeof body.ts === "number" && Number.isFinite(body.ts) ? body.ts : now;
  const duration = body.event.startsWith("parse_") ? boundedNumber(body.duration, 3_600_000) : undefined;
  const extensionVersion = typeof body.extensionVersion === "string" && /^\d+(?:\.\d+){1,3}(?:[-+][\w.-]{1,16})?$/.test(body.extensionVersion)
    ? body.extensionVersion
    : undefined;
  const data = normalizeData(body.event, body.data);
  return {
    deviceId: body.deviceId,
    event: body.event,
    ts,
    ...(duration === undefined ? {} : { duration }),
    ...(extensionVersion ? { extensionVersion } : {}),
    ...(data ? { data } : {}),
  };
}
