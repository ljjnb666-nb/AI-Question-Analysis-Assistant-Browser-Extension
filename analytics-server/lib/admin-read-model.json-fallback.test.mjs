// @vitest-environment node

// These tests pin the JSON compatibility backend of the Admin read models.
// Mocking node:sqlite forces SQLITE_SUPPORTED to false so every read runs the
// JSON implementation; expectations are identical to the SQLite-path suites to
// prove the two storage paths stay semantically interchangeable.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:sqlite", () => ({}));

const { createAdminAnalyticsReadModels } = await import("./admin-read-model.mjs");
const { getStorageBackendInfo, resetDbConnectionForTests, saveDb } = await import("./store.mjs");

let tempDir;

// Guards against silently re-enabling node:sqlite, which would turn this file
// into a duplicate of the SQLite suite instead of the JSON parity check.
expect(getStorageBackendInfo().driver).toBe("json");

function ms(value) {
  return new Date(value).getTime();
}

function event({ id, name, at, deviceId, version, duration, data }) {
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-admin-read-model-json-"));
  process.env.ANALYTICS_DATA_DIR = tempDir;
  delete process.env.ANALYTICS_DB_FILE;
});

afterEach(() => {
  resetDbConnectionForTests();
  delete process.env.ANALYTICS_DATA_DIR;
  delete process.env.ANALYTICS_DB_FILE;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Phase 11C1 analytics read models (JSON compatibility backend)", () => {
  it("C1-RM-J01 returns dense timeseries rows with null ratios on empty days", () => {
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

    const response = createAdminAnalyticsReadModels({ now: () => now }).timeseries(3);
    expect(response.data.map((row) => row.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
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

  it("C1-RM-J02 aggregates overview truth scopes without serializing raw records", () => {
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
          data: { provider: "openai" },
        }),
      ],
      email_verification_codes: [],
    });

    const overview = createAdminAnalyticsReadModels({ now: () => now }).overview(14);
    expect(overview.analyticsScope).toBe("opt_in_only");
    expect(overview.accountScope).toBe("all_registered_accounts");
    expect(overview.activity).toEqual({ dau: 1, wau: 1, mau: 1 });
    expect(overview.accounts).toEqual({ registeredUsers: 1, registrationsToday: 1 });
    expect(overview.observed.installDevicesToday).toBe(1);
    expect(overview.observed.parseOutcomesToday).toEqual({
      success: 1,
      error: 0,
      total: 1,
      successRatio: 1,
    });
    expect(overview.observed.parseOutcomeLatencyWindowMs).toEqual({ samples: 1, average: 1_200 });

    const serialized = JSON.stringify(overview);
    expect(serialized).not.toContain("one@example.test");
    expect(serialized).not.toContain("hash-1");
    expect(serialized).not.toContain("salt-1");
    expect(serialized).not.toContain("dev-a");
  });

  it("C1-RM-J03 groups providers only from observed parse outcomes", () => {
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
      ],
      email_verification_codes: [],
    });

    const response = createAdminAnalyticsReadModels({ now: () => now }).providers(14);
    expect(response.data).toEqual([
      { provider: "openai", success: 1, error: 1, outcomes: 2, successRatio: 0.5 },
    ]);
    expect(JSON.stringify(response)).not.toContain("deepseek");
  });

  it("C1-RM-J04 normalizes error categories into the allowlist", () => {
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
          data: { category: "timeout", exhausted: true },
        }),
        event({
          id: "evt-2",
          name: "parse_error",
          at: "2026-10-07T09:00:00.000Z",
          deviceId: "dev-b",
          data: { category: "not-allowed", exhausted: false },
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

  it("C1-RM-J05 counts the latest valid version per device and skips malformed labels", () => {
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
          version: "1.2.0",
        }),
        event({
          id: "evt-2",
          name: "popup_opened",
          at: "2026-10-07T09:00:00.000Z",
          deviceId: "dev-a",
          version: "beta",
        }),
        event({
          id: "evt-3",
          name: "popup_opened",
          at: "2026-10-07T10:00:00.000Z",
          deviceId: "dev-b",
          version: "0.2.1",
        }),
        event({
          id: "evt-4",
          name: "popup_opened",
          at: "2026-10-07T11:00:00.000Z",
          deviceId: "dev-c",
          version: `1.2.${"9".repeat(80)}`,
        }),
      ],
      email_verification_codes: [],
    });

    const response = createAdminAnalyticsReadModels({ now: () => now }).versions(14);
    expect(response.data).toEqual([
      { extensionVersion: "0.2.1", devices: 1 },
      { extensionVersion: "1.2.0", devices: 1 },
    ]);
    expect(JSON.stringify(response)).not.toContain("beta");
    expect(JSON.stringify(response)).not.toContain("9".repeat(80));
  });

  it("C1-RM-J06 returns dense latency with null averages where no samples exist", () => {
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
