import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types";
import { buildAnalyticsUploadPayload, isAnalyticsUploadEvent } from "./analyticsBackend";

describe("analyticsBackend", () => {
  it("flags only the exported analytics events for upload", () => {
    expect(isAnalyticsUploadEvent("extension_installed")).toBe(true);
    expect(isAnalyticsUploadEvent("parse_success")).toBe(true);
    expect(isAnalyticsUploadEvent("auth_logged_in")).toBe(false);
    expect(isAnalyticsUploadEvent("manual_capture_started")).toBe(false);
  });

  it("builds a pseudonymous payload with allowlisted fields only", () => {
    const payload = buildAnalyticsUploadPayload(
      {
        ...DEFAULT_SETTINGS,
        enableAnalytics: true,
        deviceId: "dev-1",
        userId: "usr-1",
        analyticsConsentVersion: 1,
      },
      "popup_opened",
      123,
      "0.2.0",
      undefined,
      { source: "sidepanel_commit", host: "example.com", userId: "usr-secret" },
    );

    expect(payload).toEqual({
      deviceId: "dev-1",
      analyticsConsentVersion: 1,
      event: "popup_opened",
      ts: 123,
      extensionVersion: "0.2.0",
    });
  });

  it("KEY_11_ANALYTICS_HAS_NO_API_KEY keeps only providerId for api_key_set", () => {
    const fakeApiKey = ["fake", "secret", "api", "key"].join("-");
    const fakeAuthToken = ["fake", "secret", "auth", "token"].join("-");
    const payload = buildAnalyticsUploadPayload(
      {
        ...DEFAULT_SETTINGS,
        enableAnalytics: true,
        deviceId: "dev-1",
        analyticsConsentVersion: 1,
        apiKey: fakeApiKey,
        authToken: fakeAuthToken,
      },
      "api_key_set",
      456,
      "0.2.0",
      undefined,
      { providerId: "anthropic", apiKey: fakeApiKey, authToken: fakeAuthToken },
    );

    expect(payload.data).toEqual({ providerId: "anthropic" });
    expect(JSON.stringify(payload)).not.toContain(fakeApiKey);
    expect(JSON.stringify(payload)).not.toContain(fakeAuthToken);
  });
});
