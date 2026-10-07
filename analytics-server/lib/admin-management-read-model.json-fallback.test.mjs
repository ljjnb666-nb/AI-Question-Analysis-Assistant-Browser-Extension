// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:sqlite", () => ({}));

const {
  AdminManagementReadModelError,
  createAdminManagementReadModels,
  normalizeAdminUsersQuery,
} = await import("./admin-management-read-model.mjs");
const {
  getStorageBackendInfo,
  resetDbConnectionForTests,
  saveDb,
} = await import("./store.mjs");

let tempDir;

expect(getStorageBackendInfo().driver).toBe("json");

function ms(value) {
  return new Date(value).getTime();
}

function user({ userId, email, createdAt, deviceIds = [], ...secrets }) {
  return {
    userId,
    email,
    passwordHash: secrets.passwordHash || `hash-${userId}`,
    passwordSalt: secrets.passwordSalt || `salt-${userId}`,
    createdAt: ms(createdAt),
    deviceIds,
    ...secrets,
  };
}

function device({ deviceId, userId, lastSeenAt }) {
  return {
    deviceId,
    userId,
    installedAt: null,
    createdAt: ms(lastSeenAt),
    lastSeenAt: ms(lastSeenAt),
  };
}

function baseDb({ users = [], devices = [] } = {}) {
  return {
    analyticsPrivacyEpoch: 1,
    users,
    devices,
    analytics_events: [],
    email_verification_codes: [],
  };
}

beforeEach(() => {
  resetDbConnectionForTests();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-admin-management-json-"));
  process.env.ANALYTICS_DATA_DIR = tempDir;
  delete process.env.ANALYTICS_DB_FILE;
});

afterEach(() => {
  resetDbConnectionForTests();
  delete process.env.ANALYTICS_DATA_DIR;
  delete process.env.ANALYTICS_DB_FILE;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Phase 11D1 Admin management read models (JSON compatibility)", () => {
  it("D1-RM-J01 mirrors deterministic cursor pagination and device authority", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    const same = "2026-10-07T10:00:00.000Z";
    saveDb(
      baseDb({
        users: [
          user({
            userId: "usr-a",
            email: "a@example.test",
            createdAt: same,
            deviceIds: ["fake-a", "fake-b"],
          }),
          user({
            userId: "usr-c",
            email: "c@example.test",
            createdAt: same,
          }),
          user({
            userId: "usr-b",
            email: "b@example.test",
            createdAt: same,
          }),
          user({
            userId: "usr-old",
            email: "old@example.test",
            createdAt: "2026-10-06T10:00:00.000Z",
          }),
        ],
        devices: [
          device({
            deviceId: "real-a",
            userId: "usr-a",
            lastSeenAt: "2026-10-07T09:00:00.000Z",
          }),
        ],
      }),
    );

    const read = createAdminManagementReadModels({
      now: () => now,
      uptime: () => 1,
      isMailerConfigured: () => false,
    });
    const first = read.users(normalizeAdminUsersQuery({ limit: "2" }));
    expect(first.data.map((item) => item.userId)).toEqual(["usr-c", "usr-b"]);

    const second = read.users(
      normalizeAdminUsersQuery({
        limit: "2",
        cursor: first.page.nextCursor,
      }),
    );
    expect(second.data.map((item) => item.userId)).toEqual(["usr-a", "usr-old"]);
    expect(second.data[0]).toMatchObject({
      linkedDeviceCount: 1,
      latestDeviceSeenAt: "2026-10-07T09:00:00.000Z",
    });
    expect(second.page.nextCursor).toBeNull();
  });

  it("D1-RM-J02 mirrors literal case-insensitive search semantics", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    saveDb(
      baseDb({
        users: [
          user({
            userId: "usr-percent",
            email: "percent%marker@example.test",
            createdAt: "2026-10-07T10:00:00.000Z",
          }),
          user({
            userId: "usr_under",
            email: "under_score@example.test",
            createdAt: "2026-10-07T09:00:00.000Z",
          }),
          user({
            userId: "usr-backslash",
            email: "slash\\marker@example.test",
            createdAt: "2026-10-07T08:00:00.000Z",
          }),
          user({
            userId: "usr-case",
            email: "Alice@Example.Test",
            createdAt: "2026-10-07T07:00:00.000Z",
          }),
        ],
      }),
    );
    const read = createAdminManagementReadModels({
      now: () => now,
      uptime: () => 1,
      isMailerConfigured: () => false,
    });
    const ids = (q) =>
      read.users(normalizeAdminUsersQuery({ q })).data.map((item) => item.userId);

    expect(ids("%")).toEqual(["usr-percent"]);
    expect(ids("_")).toEqual(["usr_under"]);
    expect(ids("\\")).toEqual(["usr-backslash"]);
    expect(ids("ALICE@EXAMPLE")).toEqual(["usr-case"]);
  });

  it("D1-RM-J03 never serializes raw authentication or device identifiers", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    saveDb(
      baseDb({
        users: [
          user({
            userId: "usr-1",
            email: "owner@example.test",
            createdAt: "2026-10-07T10:00:00.000Z",
            passwordHash: "password-hash-secret",
            passwordSalt: "password-salt-secret",
            authToken: "raw-token-secret",
            authTokenHash: "auth-hash-secret",
            authTokenSalt: "auth-salt-secret",
            authTokenExpiresAt: now + 1000,
          }),
        ],
        devices: [
          device({
            deviceId: "raw-device-secret",
            userId: "usr-1",
            lastSeenAt: "2026-10-07T11:00:00.000Z",
          }),
          // JSON compatibility can contain duplicate rows that SQLite's primary
          // key would reject. The read model mirrors primary-key semantics by
          // counting the same device id once.
          device({
            deviceId: "raw-device-secret",
            userId: "usr-1",
            lastSeenAt: "2026-10-07T11:00:00.000Z",
          }),
        ],
      }),
    );

    const response = createAdminManagementReadModels({
      now: () => now,
      uptime: () => 1,
      isMailerConfigured: () => false,
    }).users(normalizeAdminUsersQuery());

    expect(response.data[0].linkedDeviceCount).toBe(1);
    const serialized = JSON.stringify(response);
    for (const forbidden of [
      "raw-device-secret",
      "password-hash-secret",
      "password-salt-secret",
      "raw-token-secret",
      "auth-hash-secret",
      "auth-salt-secret",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("D1-RM-J04 mirrors the sanitized System DTO on JSON fallback", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    saveDb(baseDb());

    const response = createAdminManagementReadModels({
      now: () => now,
      uptime: () => 45.75,
      isMailerConfigured: () => false,
    }).system();

    expect(response).toEqual({
      generatedAt: "2026-10-07T12:00:00.000Z",
      service: {
        status: "ok",
        uptimeSeconds: 45,
      },
      storage: {
        driver: "json",
      },
      email: {
        configured: false,
      },
      deployment: {
        authority: "single_process",
      },
      analytics: {
        retentionDays: 90,
        privacyEpoch: 1,
      },
    });
    expect(JSON.stringify(response)).not.toContain(tempDir);
  });

  it("D1-RM-J05 fails closed when duplicate JSON device ownership conflicts", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    saveDb(
      baseDb({
        users: [
          user({
            userId: "usr-a",
            email: "a@example.test",
            createdAt: "2026-10-07T10:00:00.000Z",
          }),
          user({
            userId: "usr-b",
            email: "b@example.test",
            createdAt: "2026-10-07T09:00:00.000Z",
          }),
        ],
        devices: [
          device({
            deviceId: "dup-device",
            userId: "usr-a",
            lastSeenAt: "2026-10-07T10:30:00.000Z",
          }),
          device({
            deviceId: "dup-device",
            userId: "usr-b",
            lastSeenAt: "2026-10-07T10:45:00.000Z",
          }),
        ],
      }),
    );

    const read = createAdminManagementReadModels({
      now: () => now,
      uptime: () => 1,
      isMailerConfigured: () => false,
    });
    expect(() => read.users(normalizeAdminUsersQuery())).toThrow(
      AdminManagementReadModelError,
    );
  });


});
