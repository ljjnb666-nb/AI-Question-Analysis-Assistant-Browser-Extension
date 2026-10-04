import { DEFAULT_ANALYTICS_BASE_URL } from "../constants/analytics";

export interface AppSettings {
  preferredRoute: "auto" | "text" | "vision";
  language: "zh" | "en";
  enableAnalytics: boolean;
  analyticsConsentVersion: number;
  deviceId: string;
  analyticsBaseUrl: string;
  userId?: string;
  userEmail?: string;
  authToken?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  preferredRoute: "auto",
  language: "zh",
  enableAnalytics: false,
  analyticsConsentVersion: 0,
  deviceId: "",
  analyticsBaseUrl: DEFAULT_ANALYTICS_BASE_URL,
};
