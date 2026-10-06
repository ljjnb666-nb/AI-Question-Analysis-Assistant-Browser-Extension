// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAdminAnalyticsReadModels, normalizeAdminAnalyticsDays } from "./admin-read-model.mjs";
import { resetDbConnectionForTests, saveDb } from "./store.mjs";

let tempDir;

function ms(value) {
  return new Date(value).getTime();
}

function event({
  id,
  name,
  at,
  deviceId,
  version,
  duration,
  data,
}) {
  return {
    eventId: id,
    event: name,
    ts: ms(at),
    eventDate: at.slice(0, 10),
    host: null,
    duration: duration ?? null,
    extensionVersion: version ?? null,
    deviceId,
    userId: null,
    data: data ?? null,
    receivedAt: ms(at) + 10,
  };
}

beforeEach(() => {
  resetDbConnectionForTests();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-admin-read-model-"));
  process.env.ANALYTICS_DATA_DIR = tempDir;
  delete process.env.ANALYTICS_DB_FILE;
});

afterEach(() => {
  resetDbConnectionForTests();
  delete process.env.ANALYTICS_DATA_DIR;
  delete process.env.ANALYTICS_DB_FILE;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Phase 11C1 analytics read models", () => {
  it("C1-RM-01 enforces the bounded 1-90 day query contract", () => {
    expect(normalizeAdminAnalyticsDays(null)).toBe(14);
    expect(normalizeAdminAnalyticsDays("")).toBe(14);
    expect(normalizeAdminAnalyticsDays("1")).toBe(1);
    expect(normalizeAdminAnalyticsDays("90")).toBe(90);
    for (const invalid of ["0", "91", "-1", "1.5", "abc", " 14 "]) {
      expect(normalizeAdminAnalyticsDays(invalid), invalid).toBeNull();
    }
  });

  it("C1-RM-02 aggregates opt-in activity and account counts without exposing raw records", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    saveDb({
      analyticsPrivacyEpoch: 1,
      devices: [],
      users: [
        {
          userId: "usr-1",
          email: "one@example.test",
          passwordHash: "hash-1",
          passwordSalt: "salt-1",
          createdAt: ms("2026-10-07T08:30:00.000Z"),
          deviceIds: [],
        },
        {
          userId: "usr-2",
          email: "two@example.test",
          passwordHash: "hash-2",
          passwordSalt: "salt-2",
          createdAt: ms("2026-10-06T08:30:00.000Z"),
          deviceIds: [],
        },
      ],
      analytics_events: [
        event({
          id: "evt-1",
          name: "extension_installed",
          at: "2026-10-07T08:00:00.000Z",
          deviceId: "dev-a",
          version: "0.2.0",
        }),
        event({
          id: "evt-2",
          name: "parse_success",
          at: "2026-10-07T09:00:00.000Z",
          deviceId: "dev-a",
          version: "0.2.0",
          duration: 1_200,
          data: { provider: "openai", route: "text" },
        }),
        event({
          id: "evt-3",
          name: "parse_error",
          at: "2026-10-07T10:00:00.000Z",
          deviceId: "dev-a",
          version: "0.2.1",
          duration: 800,
          data: { provider: "openai", route: "text", category: "timeout", exhausted: true },
        }),
        event({
          id: "evt-4",
          name: "parse_success",
          at: "2026-10-07T11:00:00.000Z",
          deviceId: "dev-b",
          version: "0.2.0",
          duration: 500,
          data: { provider: "gemini", route: "vision" },
        }),
        event({
          id: "evt-5",
          name: "popup_opened",
          at: "2026-10-06T11:00:00.000Z",
          deviceId: "dev-c",
          version: "0.1.9",
        }),
      ],
      email_verification_codes: [],
    });

    const read = createAdminAnalyticsReadModels({ now: () => now });
    const overview = read.overview(14);

    expect(overview.analyticsScope).toBe("opt_in_only");
    expect(overview.window.days).toBe(14);
    expect(overview.window.retentionDays).toBe(90);
    expect(overview.activity).toEqual({ dau: 2, wau: 3, mau: 3 });
    expect(overview.accounts).toEqual({ registeredUsers: 2, registrationsToday: 1 });
    expect(overview.observed.installDevicesToday).toBe(1);
    expect(overview.observed.parseOutcomeDevicesToday).toBe(2);
    expect(overview.observed.parseOutcomesToday).toEqual({
      success: 2,
      error: 1,
      total: 3,
      successRatio: 2 / 3,
    });
    expect(overview.observed.parseOutcomeLatencyWindowMs.samples).toBe(3);
    expect(overview.observed.parseOutcomeLatencyWindowMs.average).toBeCloseTo(2500 / 3);

    const serialized = JSON.stringify(overview);
    expect(serialized).not.toContain("one@example.test");
    expect(serialized).not.toContain("hash-1");
    expect(serialized).not.toContain("salt-1");
  });

  it("C1-RM-03 returns dense timeseries rows and null ratios when no parse outcomes exist", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    saveDb({
      analyticsPrivacyEpoch: 1,
      devices: [],
      users: [],
      analytics_events: [
        event({
          id: "evt-1",
          name: "popup_opened",
          at: "2026-10-06T11:00:00.000Z",
          deviceId: "dev-a",
          version: "0.2.0",
        }),
      ],
      email_verification_codes: [],
    });

    const read = createAdminAnalyticsReadModels({ now: () => now });
    const response = read.timeseries(3);

    expect(response.analyticsScope).toBe("opt_in_only");
    expect(response.data).toHaveLength(3);
    expect(response.data.map((row) => row.date)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
    expect(response.data[0]).toMatchObject({
      optInDau: 0,
      observedInstallDevices: 0,
      parseSuccesses: 0,
      parseErrors: 0,
      parseOutcomeSuccessRatio: null,
      registrations: 0,
    });
    expect(response.data[1].optInDau).toBe(1);
    expect(response.data[1].parseOutcomeSuccessRatio).toBeNull();
  });

  it("C1-RM-04 groups providers only from observed parse outcomes", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    saveDb({
      analyticsPrivacyEpoch: 1,
      devices: [],
      users: [],
      analytics_events: [
        event({
          id: "evt-1",
          name: "settings_saved",
          at: "2026-10-07T07:00:00.000Z",
          deviceId: "dev-a",
          data: { providerId: "deepseek" },
        }),
        event({
          id: "evt-2",
          name: "parse_success",
          at: "2026-10-07T08:00:00.000Z",
          deviceId: "dev-a",
          data: { provider: "openai" },
        }),
        event({
          id: "evt-3",
          name: "parse_error",
          at: "2026-10-07T09:00:00.000Z",
          deviceId: "dev-a",
          data: { provider: "openai", category: "network" },
        }),
        event({
          id: "evt-4",
          name: "parse_success",
          at: "2026-10-07T10:00:00.000Z",
          deviceId: "dev-b",
          data: { provider: "gemini" },
        }),
      ],
      email_verification_codes: [],
    });

    const response = createAdminAnalyticsReadModels({ now: () => now }).providers(14);
    expect(response.data).toEqual([
      { provider: "openai", success: 1, error: 1, outcomes: 2, successRatio: 0.5 },
      { provider: "gemini", success: 1, error: 0, outcomes: 1, successRatio: 1 },
    ]);
    expect(JSON.stringify(response)).not.toContain("deepseek");
  });

  it("C1-RM-05 normalizes error categories and counts exhausted terminal errors", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    saveDb({
      analyticsPrivacyEpoch: 1,
      devices: [],
      users: [],
      analytics_events: [
        event({
          id: "evt-1",
          name: "parse_error",
          at: "2026-10-07T08:00:00.000Z",
          deviceId: "dev-a",
          data: { provider: "openai", category: "timeout", exhausted: true },
        }),
        event({
          id: "evt-2",
          name: "parse_error",
          at: "2026-10-07T09:00:00.000Z",
          deviceId: "dev-b",
          data: { provider: "gemini", category: "not-allowed", exhausted: false },
        }),
      ],
      email_verification_codes: [],
    });

    const response = createAdminAnalyticsReadModels({ now: () => now }).errors(14);
    expect(response.data).toEqual([
      { category: "timeout", count: 1, exhaustedCount: 1 },
      { category: "unknown", count: 1, exhaustedCount: 0 },
    ]);
  });

  it("C1-RM-06 counts latest observed extension version per device instead of raw event frequency", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    saveDb({
      analyticsPrivacyEpoch: 1,
      devices: [],
      users: [],
      analytics_events: [
        event({
          id: "evt-1",
          name: "popup_opened",
          at: "2026-10-07T08:00:00.000Z",
          deviceId: "dev-a",
          version: "0.2.0",
        }),
        event({
          id: "evt-2",
          name: "parse_success",
          at: "2026-10-07T09:00:00.000Z",
          deviceId: "dev-a",
          version: "0.2.1",
        }),
        event({
          id: "evt-3",
          name: "popup_opened",
          at: "2026-10-07T09:30:00.000Z",
          deviceId: "dev-b",
          version: "0.2.0",
        }),
        event({
          id: "evt-4",
          name: "popup_opened",
          at: "2026-10-07T10:00:00.000Z",
          deviceId: "dev-c",
          version: "0.2.0",
        }),
      ],
      email_verification_codes: [],
    });

    const response = createAdminAnalyticsReadModels({ now: () => now }).versions(14);
    expect(response.data).toEqual([
      { extensionVersion: "0.2.0", devices: 2 },
      { extensionVersion: "0.2.1", devices: 1 },
    ]);
  });

  it("C1-RM-07 returns dense observed parse-outcome latency without inventing samples", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    saveDb({
      analyticsPrivacyEpoch: 1,
      devices: [],
      users: [],
      analytics_events: [
        event({
          id: "evt-1",
          name: "parse_success",
          at: "2026-10-06T08:00:00.000Z",
          deviceId: "dev-a",
          duration: 100,
        }),
        event({
          id: "evt-2",
          name: "parse_error",
          at: "2026-10-06T09:00:00.000Z",
          deviceId: "dev-b",
          duration: 300,
        }),
      ],
      email_verification_codes: [],
    });

    const response = createAdminAnalyticsReadModels({ now: () => now }).latency(3);
    expect(response.data).toEqual([
      { date: "2026-10-05", samples: 0, averageMs: null },
      { date: "2026-10-06", samples: 2, averageMs: 200 },
      { date: "2026-10-07", samples: 0, averageMs: null },
    ]);
  });
});
