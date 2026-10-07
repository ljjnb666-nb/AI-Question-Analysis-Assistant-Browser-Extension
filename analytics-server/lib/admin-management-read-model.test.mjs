// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AdminManagementReadModelError,
  createAdminManagementReadModels,
  normalizeAdminUsersQuery,
} from "./admin-management-read-model.mjs";
import { resetDbConnectionForTests, saveDb } from "./store.mjs";

let tempDir;

function ms(value) {
  return new Date(value).getTime();
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

function user({
  userId,
  email,
  createdAt,
  deviceIds = [],
  passwordHash = `hash-${userId}`,
  passwordSalt = `salt-${userId}`,
  authToken = undefined,
  authTokenHash = undefined,
  authTokenSalt = undefined,
  authTokenExpiresAt = undefined,
}) {
  return {
    userId,
    email,
    passwordHash,
    passwordSalt,
    authToken,
    authTokenHash,
    authTokenSalt,
    authTokenExpiresAt,
    createdAt: ms(createdAt),
    deviceIds,
  };
}

function device({ deviceId, userId, lastSeenAt, createdAt = lastSeenAt, installedAt = null }) {
  return {
    deviceId,
    userId,
    installedAt,
    createdAt: ms(createdAt),
    lastSeenAt: ms(lastSeenAt),
  };
}

beforeEach(() => {
  resetDbConnectionForTests();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-admin-management-"));
  process.env.ANALYTICS_DATA_DIR = tempDir;
  delete process.env.ANALYTICS_DB_FILE;
});

afterEach(() => {
  resetDbConnectionForTests();
  delete process.env.ANALYTICS_DATA_DIR;
  delete process.env.ANALYTICS_DB_FILE;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Phase 11D1 Admin management read models", () => {
  it("D1-RM-01 enforces strict bounded Users query parsing", () => {
    expect(normalizeAdminUsersQuery()).toEqual({
      limit: 50,
      q: null,
      cursor: null,
    });
    expect(normalizeAdminUsersQuery({ limit: "1", q: " Alice@Example.Test " })).toMatchObject({
      limit: 1,
      q: "alice@example.test",
      cursor: null,
    });

    for (const invalid of ["0", "101", "-1", "1.5", "abc", " 50 "]) {
      expect(() => normalizeAdminUsersQuery({ limit: invalid }), invalid).toThrow(
        AdminManagementReadModelError,
      );
    }
    expect(() => normalizeAdminUsersQuery({ q: "x".repeat(121) })).toThrow(
      AdminManagementReadModelError,
    );
  });

  it("D1-RM-02 returns only the allowlisted user DTO and derives devices from devices.userId", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    saveDb(
      baseDb({
        users: [
          user({
            userId: "usr-1",
            email: "owner@example.test",
            createdAt: "2026-10-06T08:00:00.000Z",
            deviceIds: ["fake-a", "fake-b", "fake-c"],
            authToken: "legacy-raw-auth-token",
            authTokenHash: "auth-hash-secret",
            authTokenSalt: "auth-salt-secret",
            authTokenExpiresAt: ms("2026-11-01T00:00:00.000Z"),
            passwordHash: "password-hash-secret",
            passwordSalt: "password-salt-secret",
          }),
        ],
        devices: [
          device({
            deviceId: "real-device-a",
            userId: "usr-1",
            lastSeenAt: "2026-10-07T09:00:00.000Z",
          }),
          device({
            deviceId: "other-device",
            userId: "usr-other",
            lastSeenAt: "2026-10-07T11:00:00.000Z",
          }),
        ],
      }),
    );

    const read = createAdminManagementReadModels({
      now: () => now,
      uptime: () => 12.8,
      isMailerConfigured: () => true,
    });
    const response = read.users(normalizeAdminUsersQuery());

    expect(response.data).toEqual([
      {
        userId: "usr-1",
        email: "owner@example.test",
        createdAt: "2026-10-06T08:00:00.000Z",
        linkedDeviceCount: 1,
        latestDeviceSeenAt: "2026-10-07T09:00:00.000Z",
      },
    ]);
    const serialized = JSON.stringify(response);
    for (const forbidden of [
      "fake-a",
      "real-device-a",
      "password-hash-secret",
      "password-salt-secret",
      "legacy-raw-auth-token",
      "auth-hash-secret",
      "auth-salt-secret",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("D1-RM-03 paginates createdAt DESC / userId DESC without duplicates or omissions", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    const same = "2026-10-07T10:00:00.000Z";
    saveDb(
      baseDb({
        users: [
          user({ userId: "usr-a", email: "a@example.test", createdAt: same }),
          user({ userId: "usr-c", email: "c@example.test", createdAt: same }),
          user({ userId: "usr-b", email: "b@example.test", createdAt: same }),
          user({
            userId: "usr-old",
            email: "old@example.test",
            createdAt: "2026-10-06T10:00:00.000Z",
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
    expect(first.page.nextCursor).toEqual(expect.any(String));

    const second = read.users(
      normalizeAdminUsersQuery({
        limit: "2",
        cursor: first.page.nextCursor,
      }),
    );
    expect(second.data.map((item) => item.userId)).toEqual(["usr-a", "usr-old"]);
    expect(second.page.nextCursor).toBeNull();

    const combined = [...first.data, ...second.data].map((item) => item.userId);
    expect(combined).toEqual(["usr-c", "usr-b", "usr-a", "usr-old"]);
    expect(new Set(combined).size).toBe(4);
  });

  it("D1-RM-04 searches email/userId case-insensitively and treats %, _, and backslash literally", () => {
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
    expect(ids("USR-CASE")).toEqual(["usr-case"]);
  });

  it("D1-RM-05 binds cursors to the normalized search universe", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    saveDb(
      baseDb({
        users: [
          user({
            userId: "usr-a1",
            email: "alpha1@example.test",
            createdAt: "2026-10-07T10:00:00.000Z",
          }),
          user({
            userId: "usr-a2",
            email: "alpha2@example.test",
            createdAt: "2026-10-07T09:00:00.000Z",
          }),
        ],
      }),
    );
    const read = createAdminManagementReadModels({
      now: () => now,
      uptime: () => 1,
      isMailerConfigured: () => false,
    });
    const first = read.users(normalizeAdminUsersQuery({ q: "ALPHA", limit: "1" }));
    expect(first.page.nextCursor).toEqual(expect.any(String));

    expect(() =>
      normalizeAdminUsersQuery({
        q: "beta",
        limit: "1",
        cursor: first.page.nextCursor,
      }),
    ).toThrow(AdminManagementReadModelError);

    const next = read.users(
      normalizeAdminUsersQuery({
        q: "alpha",
        limit: "1",
        cursor: first.page.nextCursor,
      }),
    );
    expect(next.data.map((item) => item.userId)).toEqual(["usr-a2"]);
  });

  it("D1-RM-06 returns a sanitized deterministic System snapshot", () => {
    const now = ms("2026-10-07T12:00:00.000Z");
    saveDb(baseDb());

    const response = createAdminManagementReadModels({
      now: () => now,
      uptime: () => 123.99,
      isMailerConfigured: () => true,
    }).system();

    expect(response).toEqual({
      generatedAt: "2026-10-07T12:00:00.000Z",
      service: {
        status: "ok",
        uptimeSeconds: 123,
      },
      storage: {
        driver: "sqlite",
      },
      email: {
        configured: true,
      },
      deployment: {
        authority: "single_process",
      },
      analytics: {
        retentionDays: 90,
        privacyEpoch: 1,
      },
    });

    const serialized = JSON.stringify(response);
    for (const forbidden of [
      tempDir,
      "ANALYTICS_ADMIN_TOKEN",
      "PUBLIC_BASE_URL",
      "SMTP",
      "analytics-db.sqlite",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("D1-RM-07 fails closed on malformed cursors and invalid runtime evidence", () => {
    for (const cursor of ["%%%", "e30", "x".repeat(1025)]) {
      expect(() => normalizeAdminUsersQuery({ cursor }), cursor).toThrow(
        AdminManagementReadModelError,
      );
    }

    saveDb(baseDb());
    expect(() =>
      createAdminManagementReadModels({
        now: () => ms("2026-10-07T12:00:00.000Z"),
        uptime: () => Number.NaN,
        isMailerConfigured: () => true,
      }).system(),
    ).toThrow(AdminManagementReadModelError);
  });


});
