// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  createEmailVerificationCode,
  createEmailVerificationCodeInStorage,
  createUser,
  createUserInStorage,
  findUserByToken,
  loginUser,
  loginUserInStorage,
  loadDb,
  loadDbFromJsonFile,
  recordAnalyticsEvent,
  recordAnalyticsEventInJsonStore,
  recordAnalyticsEventInStorage,
  pruneAnalyticsEvents,
  pruneAnalyticsEventsInStorage,
  ANALYTICS_EVENT_RETENTION_MS,
  CURRENT_ANALYTICS_PRIVACY_EPOCH,
  resetDbConnectionForTests,
  saveDb,
  saveDbToJsonFile,
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
    expect(db.devices.some((entry) => entry.deviceId === "dev-2")).toBe(true);
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
    expect(db.devices.some((entry) => entry.deviceId === "dev-anon")).toBe(false);
  });

  it("P_REL_PRIV_15_SQLITE_PRIVACY_EPOCH_PURGES_LEGACY_ANALYTICS_ONCE", () => {
    const dbFile = path.join(os.tmpdir(), `quiz-solver-privacy-epoch-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    const previousDbFile = process.env.ANALYTICS_DB_FILE;
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;
    try {
      const now = Date.now();
      const db = createDb();
      db.devices = [
        { deviceId: "legacy-anonymous", userId: null, installedAt: now, createdAt: now, lastSeenAt: now },
        { deviceId: "account-device", userId: "user-1", installedAt: null, createdAt: now, lastSeenAt: now },
      ];
      db.analytics_events = [{
        eventId: "legacy-secret", event: "parse_success", ts: now, eventDate: new Date(now).toISOString().slice(0, 10),
        host: "private.example", duration: 1, extensionVersion: "old", deviceId: "legacy-anonymous", userId: null,
        data: { questionText: "private question" }, receivedAt: now,
      }];
      saveDb(db);

      resetDbConnectionForTests();
      const legacyDatabase = new DatabaseSync(dbFile);
      legacyDatabase.exec("DELETE FROM analytics_metadata"); // simulate a pre-epoch server database
      legacyDatabase.close();

      const migrated = loadDb();
      expect(migrated.analyticsPrivacyEpoch).toBe(CURRENT_ANALYTICS_PRIVACY_EPOCH);
      expect(migrated.analytics_events).toEqual([]);
      expect(migrated.devices.map(({ deviceId }) => deviceId)).toEqual(["account-device"]);

      recordAnalyticsEventInStorage({ deviceId: "new-anonymous", event: "parse_success", ts: Date.now() });
      resetDbConnectionForTests();
      const afterNewEvent = loadDb();
      expect(afterNewEvent.analyticsPrivacyEpoch).toBe(CURRENT_ANALYTICS_PRIVACY_EPOCH);
      expect(afterNewEvent.analytics_events.map(({ event }) => event)).toEqual(["parse_success"]);
    } finally {
      resetDbConnectionForTests();
      if (previousDbFile === undefined) delete process.env.ANALYTICS_DB_FILE;
      else process.env.ANALYTICS_DB_FILE = previousDbFile;
      for (const suffix of ["", "-wal", "-shm"]) {
        const file = `${dbFile}${suffix}`;
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    }
  });

  it("P_REL_PRIV_16_JSON_PRIVACY_EPOCH_PURGES_LEGACY_ANALYTICS_ONCE", () => {
    const dbFile = path.join(os.tmpdir(), `quiz-solver-privacy-json-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    const jsonFile = dbFile.replace(/\.sqlite$/i, ".json");
    const previousDbFile = process.env.ANALYTICS_DB_FILE;
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;
    try {
      const now = Date.now();
      fs.writeFileSync(jsonFile, JSON.stringify({
        devices: [
          { deviceId: "legacy-anonymous", userId: null },
          { deviceId: "account-device", userId: "user-1" },
        ],
        users: [], email_verification_codes: [],
        analytics_events: [{ eventId: "legacy-secret", event: "parse_success", ts: now, eventDate: "2026-09-28", host: "private.example", deviceId: "legacy-anonymous", data: { questionText: "private" }, receivedAt: now }],
      }), "utf8");

      const migrated = loadDbFromJsonFile();
      expect(migrated.analyticsPrivacyEpoch).toBe(CURRENT_ANALYTICS_PRIVACY_EPOCH);
      expect(migrated.analytics_events).toEqual([]);
      expect(migrated.devices.map(({ deviceId }) => deviceId)).toEqual(["account-device"]);
      expect(JSON.parse(fs.readFileSync(jsonFile, "utf8")).analyticsPrivacyEpoch).toBe(CURRENT_ANALYTICS_PRIVACY_EPOCH);

      recordAnalyticsEventInJsonStore({ deviceId: "new-anonymous", event: "parse_success", ts: Date.now() });
      const afterNewEvent = loadDbFromJsonFile();
      expect(afterNewEvent.analyticsPrivacyEpoch).toBe(CURRENT_ANALYTICS_PRIVACY_EPOCH);
      expect(afterNewEvent.analytics_events.map(({ event }) => event)).toEqual(["parse_success"]);
    } finally {
      resetDbConnectionForTests();
      if (previousDbFile === undefined) delete process.env.ANALYTICS_DB_FILE;
      else process.env.ANALYTICS_DB_FILE = previousDbFile;
      if (fs.existsSync(jsonFile)) fs.unlinkSync(jsonFile);
    }
  });

  it("P_REL_PRIV_17_ANALYTICS_INGESTION_DOES_NOT_MUTATE_DEVICES", () => {
    const now = Date.now();
    const db = createDb();
    db.devices.push({ deviceId: "account-device", userId: "user-1", installedAt: 7, createdAt: 10, lastSeenAt: 20 });
    const originalDevice = structuredClone(db.devices[0]);

    recordAnalyticsEvent(db, { deviceId: "account-device", event: "extension_installed", ts: now });
    recordAnalyticsEvent(db, { deviceId: "unknown-device", event: "parse_success", ts: now });

    expect(db.devices).toEqual([originalDevice]);
    expect(db.analytics_events).toHaveLength(2);
    expect(db.analytics_events.every((event) => event.userId === null)).toBe(true);

    const dbFile = path.join(os.tmpdir(), `quiz-solver-analytics-device-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    const previousDbFile = process.env.ANALYTICS_DB_FILE;
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;
    try {
      saveDb({ ...createDb(), devices: [originalDevice] });
      recordAnalyticsEventInStorage({ deviceId: "account-device", event: "extension_installed", ts: now });
      recordAnalyticsEventInStorage({ deviceId: "unknown-device", event: "parse_success", ts: now });
      const sqliteDb = loadDb();
      expect(sqliteDb.devices).toEqual([originalDevice]);
      expect(sqliteDb.analytics_events).toHaveLength(2);
      expect(sqliteDb.analytics_events.every((event) => event.userId === null)).toBe(true);

      saveDbToJsonFile({ ...createDb(), devices: [originalDevice], analyticsPrivacyEpoch: CURRENT_ANALYTICS_PRIVACY_EPOCH });
      recordAnalyticsEventInJsonStore({ deviceId: "account-device", event: "extension_installed", ts: now });
      const jsonDb = loadDbFromJsonFile();
      expect(jsonDb.devices).toEqual([originalDevice]);
      expect(jsonDb.analytics_events).toHaveLength(1);
      expect(jsonDb.analytics_events[0].userId).toBeNull();
    } finally {
      resetDbConnectionForTests();
      if (previousDbFile === undefined) delete process.env.ANALYTICS_DB_FILE;
      else process.env.ANALYTICS_DB_FILE = previousDbFile;
      for (const suffix of ["", "-wal", "-shm"]) {
        const file = `${dbFile}${suffix}`;
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      const jsonFile = dbFile.replace(/\.sqlite$/i, ".json");
      if (fs.existsSync(jsonFile)) fs.unlinkSync(jsonFile);
    }
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
