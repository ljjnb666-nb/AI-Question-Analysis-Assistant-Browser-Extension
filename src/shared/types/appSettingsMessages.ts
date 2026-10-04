/** Ordinary settings patches only. Null explicitly clears account/session values. */
export interface AppSettingsUpdatePatch {
  preferredRoute?: "auto" | "text" | "vision";
  language?: "zh" | "en";
  enableAnalytics?: boolean;
  analyticsConsentVersion?: number;
  deviceId?: string;
  analyticsBaseUrl?: string;
  userId?: string | null;
  userEmail?: string | null;
  authToken?: string | null;
}

export type AppSettingsCommand =
  | { type: "APP_SETTINGS_UPDATE"; patch: AppSettingsUpdatePatch }
  | { type: "APP_SETTINGS_ENSURE_NORMALIZED" }
  | { type: "APP_SETTINGS_GET_OR_CREATE_DEVICE_ID" };

export type AppSettingsResponse =
  | { ok: true; deviceId: string; analyticsDisabled: boolean }
  | { ok: false; code: "APP_SETTINGS_SENDER_FORBIDDEN" | "APP_SETTINGS_PAYLOAD_INVALID" | "APP_SETTINGS_WRITE_FAILED" };
