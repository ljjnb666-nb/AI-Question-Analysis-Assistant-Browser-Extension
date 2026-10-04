import type { AppSettings } from "../types/settings";
import { DEFAULT_SETTINGS } from "../types/settings";

export const CURRENT_ANALYTICS_CONSENT_VERSION = 1;

export function normalizeAnalyticsBaseUrl(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  return raw ? raw.replace(/\/+$/, "") : DEFAULT_SETTINGS.analyticsBaseUrl;
}

export const APP_SETTINGS_FIELDS = ["preferredRoute", "language", "enableAnalytics", "analyticsConsentVersion", "deviceId", "analyticsBaseUrl", "userId", "userEmail", "authToken"] as const;

/** Explicit current-domain projection; raw migration/unknown keys never escape. */
export function projectAppSettings(raw: Partial<AppSettings>): AppSettings {
  const result = { ...DEFAULT_SETTINGS };
  if (raw.preferredRoute === "auto" || raw.preferredRoute === "text" || raw.preferredRoute === "vision") result.preferredRoute = raw.preferredRoute;
  if (raw.language === "zh" || raw.language === "en") result.language = raw.language;
  if (typeof raw.enableAnalytics === "boolean") result.enableAnalytics = raw.enableAnalytics;
  if (Number.isSafeInteger(raw.analyticsConsentVersion) && Number(raw.analyticsConsentVersion) >= 0) result.analyticsConsentVersion = raw.analyticsConsentVersion!;
  for (const key of ["deviceId", "analyticsBaseUrl", "userId", "userEmail", "authToken"] as const) {
    if (typeof raw[key] === "string") result[key] = raw[key];
  }
  return result;
}
