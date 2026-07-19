import { DEFAULT_ANALYTICS_BASE_URL } from "../constants/analytics";

export interface AppSettings {
  providerId: string;
  apiKey: string;
  apiModel: string;
  preferredRoute: "auto" | "text" | "vision";
  language: "zh" | "en";
  enableAnalytics: boolean;
  deviceId: string;
  analyticsBaseUrl: string;
  userId?: string;
  userEmail?: string;
  authToken?: string;
  customBaseUrl?: string;
  customProviderProtocol?: "openai" | "anthropic";
}

export const DEFAULT_SETTINGS: AppSettings = {
  providerId: "anthropic",
  apiKey: "",
  apiModel: "claude-opus-4.8",
  preferredRoute: "auto",
  language: "zh",
  enableAnalytics: true,
  deviceId: "",
  analyticsBaseUrl: DEFAULT_ANALYTICS_BASE_URL,
  customProviderProtocol: "openai",
};
