import { DEFAULT_SETTINGS } from "../types/settings";

export const CURRENT_ANALYTICS_CONSENT_VERSION = 1;

export function normalizeAnalyticsBaseUrl(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  return raw ? raw.replace(/\/+$/, "") : DEFAULT_SETTINGS.analyticsBaseUrl;
}
