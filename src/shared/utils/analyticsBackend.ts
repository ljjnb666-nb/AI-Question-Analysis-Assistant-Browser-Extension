import type { AppSettings } from "../types";
import type { AnalyticsEvent } from "./analytics";

export type AnalyticsUploadPayload = {
  deviceId: string;
  userId?: string;
  event: AnalyticsEvent;
  ts: number;
  host?: string;
  duration?: number;
  extensionVersion?: string;
  data?: Record<string, unknown>;
};

const UPLOAD_EVENTS = new Set<AnalyticsEvent>([
  "extension_installed",
  "popup_opened",
  "settings_saved",
  "api_key_set",
  "parse_success",
  "parse_error",
  "auth_registered",
  "auth_logged_in",
  "auth_logged_out",
]);

export function isAnalyticsUploadEvent(event: AnalyticsEvent): boolean {
  return UPLOAD_EVENTS.has(event);
}

export function buildAnalyticsUploadPayload(
  settings: AppSettings,
  event: AnalyticsEvent,
  ts: number,
  extensionVersion?: string,
  host?: string,
  duration?: number,
  data?: Record<string, unknown>,
): AnalyticsUploadPayload {
  return {
    deviceId: settings.deviceId,
    userId: settings.userId,
    event,
    ts,
    host,
    duration,
    extensionVersion,
    data,
  };
}
