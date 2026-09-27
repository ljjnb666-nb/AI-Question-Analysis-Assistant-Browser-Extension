// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEmailVerificationCode,
  createEmailVerificationCodeInStorage,
  createUser,
  createUserInStorage,
  findUserByToken,
  loginUser,
  loginUserInStorage,
  loadDb,
  recordAnalyticsEvent,
  recordAnalyticsEventInStorage,
  pruneAnalyticsEvents,
  pruneAnalyticsEventsInStorage,
  ANALYTICS_EVENT_RETENTION_MS,
  resetDbConnectionForTests,
  saveDb,
  verifyEmailCode,
  verifyEmailCodeInStorage,
} from "./store.mjs";

function createDb() {
  return {
    devices: [],
    users: [],
    analytics_events: [],
    email_verification_codes: [],
  };
}

describe("analytics store", () => {
  it("stores verification codes hashed and verifies them", () => {
    const db = createDb();
    const { code } = createEmailVerificationCode(db, "user@example.com");

    expect(db.email_verification_codes).toHaveLength(1);
    expect(db.email_verification_codes[0].code).toBeUndefined();
    expect(db.email_verification_codes[0].codeHash).toBeTruthy();

    verifyEmailCode(db, "user@example.com", code);

    expect(db.email_verification_codes[0].consumedAt).toBeTypeOf("number");
  });

  it("stores auth tokens hashed and resolves users by bearer token", () => {
    const db = createDb();
    const { user, authToken } = createUser(db, "user@example.com", "secret-123", "dev-1");

    expect(user.authToken).toBeUndefined();
    expect(user.authTokenHash).toBeTruthy();
    expect(findUserByToken(db, authToken)?.userId).toBe(user.userId);
  });

  it("keeps analytics pseudonymous while auth endpoints maintain account-device association", () => {
    const db = createDb();
    createEmailVerificationCode(db, "user@example.com");
    const created = createUser(db, "user@example.com", "secret-123", "dev-1");

    const loggedIn = loginUser(db, "user@example.com", "secret-123", "dev-2");
    expect(loggedIn.authToken).not.toBe(created.authToken);

    recordAnalyticsEvent(
      db,
      {
        deviceId: "dev-2",
        event: "parse_success",
        ts: Date.now(),
      },
    );

    expect(db.analytics_events[0].userId).toBeNull();
    expect(db.devices.find((entry) => entry.deviceId === "dev-2")?.userId).toBe(loggedIn.user.userId);
  });

  it("ignores client supplied userId when the request is unauthenticated", () => {
    const db = createDb();

    recordAnalyticsEvent(
      db,
      {
        deviceId: "dev-anon",
        event: "parse_success",
        ts: Date.now(),
        userId: "usr-forged",
      },
      "",
    );

    expect(db.analytics_events[0].userId).toBeNull();
    expect(db.devices.find((entry) => entry.deviceId === "dev-anon")?.userId).toBeNull();
  });

  it("persists and reloads records through sqlite storage", () => {
    const dbFile = path.join(os.tmpdir(), `quiz-solver-store-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;

    const db = createDb();
    const { code } = createEmailVerificationCode(db, "persist@example.com");
    verifyEmailCode(db, "persist@example.com", code);
    const { user } = createUser(db, "persist@example.com", "secret-123", "dev-persist");
    recordAnalyticsEvent(
      db,
      {
        deviceId: "dev-persist",
        event: "parse_success",
        ts: Date.now(),
      },
      "",
    );

    saveDb(db);
    const reloaded = loadDb();

    expect(reloaded.users.find((entry) => entry.userId === user.userId)?.email).toBe("persist@example.com");
    expect(reloaded.devices.find((entry) => entry.deviceId === "dev-persist")).toBeTruthy();
    expect(reloaded.analytics_events.some((entry) => entry.event === "parse_success")).toBe(true);
    expect(reloaded.email_verification_codes).toHaveLength(1);

    resetDbConnectionForTests();
    delete process.env.ANALYTICS_DB_FILE;
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
  });

  it("writes auth and analytics records incrementally in sqlite storage", () => {
    const dbFile = path.join(os.tmpdir(), `quiz-solver-direct-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;

    const { code } = createEmailVerificationCodeInStorage("direct@example.com");
    verifyEmailCodeInStorage("direct@example.com", code);
    const created = createUserInStorage("direct@example.com", "secret-123", "dev-direct");
    const loggedIn = loginUserInStorage("direct@example.com", "secret-123", "dev-direct-2");
    recordAnalyticsEventInStorage(
      {
        deviceId: "dev-direct-2",
        event: "parse_success",
        ts: Date.now(),
      },
      loggedIn.authToken,
    );

    const reloaded = loadDb();
    expect(reloaded.users.find((entry) => entry.userId === created.user.userId)?.email).toBe("direct@example.com");
    expect(reloaded.devices.find((entry) => entry.deviceId === "dev-direct-2")?.userId).toBe(loggedIn.user.userId);
    expect(reloaded.analytics_events.some((entry) => entry.event === "parse_success")).toBe(true);
    expect(reloaded.email_verification_codes).toHaveLength(1);

    resetDbConnectionForTests();
    delete process.env.ANALYTICS_DB_FILE;
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
  });

  it("prunes received analytics events beyond the fixed 90 day retention window", () => {
    const now = Date.now();
    const db = createDb();
    db.analytics_events = [
      { eventId: "old", ts: now, receivedAt: now - ANALYTICS_EVENT_RETENTION_MS - 1 },
      { eventId: "recent", ts: now - 100 * 24 * 60 * 60 * 1000, receivedAt: now - 1 },
    ];

    expect(pruneAnalyticsEvents(db, now)).toBe(1);
    expect(db.analytics_events.map((event) => event.eventId)).toEqual(["recent"]);
  });

  it("prunes old events from SQLite by server receivedAt", () => {
    const dbFile = path.join(os.tmpdir(), `quiz-solver-retention-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;
    const now = Date.now();
    const db = createDb();
    db.analytics_events = [
      { eventId: "old", event: "parse_success", ts: now, eventDate: new Date(now).toISOString().slice(0, 10), deviceId: "dev-old", receivedAt: now - ANALYTICS_EVENT_RETENTION_MS - 1 },
      { eventId: "recent", event: "parse_success", ts: now - 100 * 24 * 60 * 60 * 1000, eventDate: new Date(now).toISOString().slice(0, 10), deviceId: "dev-recent", receivedAt: now - 1 },
    ];
    saveDb(db);

    expect(pruneAnalyticsEventsInStorage(now)).toBe(1);
    expect(loadDb().analytics_events.map((event) => event.eventId)).toEqual(["recent"]);

    resetDbConnectionForTests();
    delete process.env.ANALYTICS_DB_FILE;
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
  });
});
