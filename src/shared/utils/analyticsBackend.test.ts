import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types";
import { buildAnalyticsUploadPayload, isAnalyticsUploadEvent } from "./analyticsBackend";

describe("analyticsBackend", () => {
  it("flags only the exported analytics events for upload", () => {
    expect(isAnalyticsUploadEvent("extension_installed")).toBe(true);
    expect(isAnalyticsUploadEvent("parse_success")).toBe(true);
    expect(isAnalyticsUploadEvent("manual_capture_started")).toBe(false);
  });

  it("builds the payload with identity and version fields", () => {
    const payload = buildAnalyticsUploadPayload(
      {
        ...DEFAULT_SETTINGS,
        deviceId: "dev-1",
        userId: "usr-1",
      },
      "popup_opened",
      123,
      "0.2.0",
      "example.com",
      undefined,
      { source: "popup" },
    );

    expect(payload).toEqual({
      deviceId: "dev-1",
      userId: "usr-1",
      event: "popup_opened",
      ts: 123,
      host: "example.com",
      duration: undefined,
      extensionVersion: "0.2.0",
      data: { source: "popup" },
    });
  });
});
