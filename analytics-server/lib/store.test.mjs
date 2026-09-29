// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as nodeCrypto from "node:crypto";

// randomInt and scryptSync are wrapped (not replaced) so every other crypto
// primitive keeps its real behaviour; the AUTH_CORE_16 and AUTH_CORE_32/33
// tests pin the RNG and KDF-parity contracts on them.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    randomInt: vi.fn(actual.randomInt),
    scryptSync: vi.fn(actual.scryptSync),
  };
});

import {
  ANALYTICS_EVENT_RETENTION_MS,
  AUTH_SESSION_TTL_MS,
  createEmailVerificationCode,
  createEmailVerificationCodeInStorage,
  createUser,
  createUserInStorage,
  findUserByEmailInStorage,
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
  CURRENT_ANALYTICS_PRIVACY_EPOCH,
  registerUserWithVerificationCodeInStorage,
  resetDbConnectionForTests,
  revokeUserSession,
  revokeUserSessionInStorage,
  saveDb,
  saveDbToJsonFile,
  validateUserSession,
  validateUserSessionInStorage,
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

describe("auth core session lifecycle", () => {
  it("AUTH_CORE_01_TOKEN_HAS_EXPIRY bounds register and login tokens with AUTH_SESSION_TTL_MS", () => {
    const db = createDb();
    const registered = createUser(db, "expiry@example.com", "secret-123", "dev-1");
    const registerNow = Date.now();
    expect(registered.user.authTokenExpiresAt).toBeGreaterThan(registerNow);
    expect(registered.user.authTokenExpiresAt).toBeLessThanOrEqual(registerNow + AUTH_SESSION_TTL_MS);

    const loginNow = Date.now();
    const loggedIn = loginUser(db, "expiry@example.com", "secret-123", "dev-1");
    expect(loggedIn.user.authTokenExpiresAt).toBeGreaterThan(loginNow);
    // Password verification runs scrypt before issuance, so the expiry is
    // bounded by the clock taken AFTER the login call completed.
    expect(loggedIn.user.authTokenExpiresAt).toBeLessThanOrEqual(Date.now() + AUTH_SESSION_TTL_MS);
  });

  it("AUTH_CORE_02_LOGIN_ROTATES_TOKEN invalidates the previous token", () => {
    const db = createDb();
    const first = createUser(db, "rotate@example.com", "secret-123", "dev-1");
    const second = loginUser(db, "rotate@example.com", "secret-123", "dev-2");

    expect(second.authToken).not.toBe(first.authToken);
    expect(validateUserSession(db, first.user.userId, first.authToken, Date.now())).toBeNull();
    expect(validateUserSession(db, second.user.userId, second.authToken, Date.now())?.user.userId).toBe(first.user.userId);
  });

  it("AUTH_CORE_03_VALID_SESSION accepts a matching userId and bearer token", () => {
    const db = createDb();
    const { user, authToken } = createUser(db, "valid@example.com", "secret-123", "dev-1");

    const session = validateUserSession(db, user.userId, authToken);
    expect(session?.user).toEqual({ userId: user.userId, email: "valid@example.com" });
    expect(session?.expiresAt).toBe(user.authTokenExpiresAt);
  });

  it("AUTH_CORE_04_FORGED_TOKEN rejects a forged token for a real userId", () => {
    const db = createDb();
    const { user } = createUser(db, "forged@example.com", "secret-123", "dev-1");

    expect(validateUserSession(db, user.userId, ["tok", "forged"].join("_"))).toBeNull();
    expect(validateUserSession(db, user.userId, "")).toBeNull();
  });

  it("AUTH_CORE_05_USER_ID_MISMATCH rejects a real token paired with the wrong userId", () => {
    const db = createDb();
    const { authToken } = createUser(db, "mismatch@example.com", "secret-123", "dev-1");

    expect(validateUserSession(db, "usr-somebody-else", authToken)).toBeNull();
  });

  it("AUTH_CORE_06_EXPIRED_TOKEN rejects tokens past their expiry", () => {
    const db = createDb();
    const { user, authToken } = createUser(db, "expired@example.com", "secret-123", "dev-1");

    const afterExpiry = user.authTokenExpiresAt + 1;
    expect(validateUserSession(db, user.userId, authToken, afterExpiry)).toBeNull();
    expect(validateUserSession(db, user.userId, authToken, user.authTokenExpiresAt)).toBeNull();
    expect(validateUserSession(db, user.userId, authToken, user.authTokenExpiresAt - 1)).not.toBeNull();
  });

  it("AUTH_CORE_07_LOGOUT_REVOKES clears the server-side session for the valid bearer", () => {
    const db = createDb();
    const { user, authToken } = createUser(db, "revoke@example.com", "secret-123", "dev-1");

    expect(revokeUserSession(db, user.userId, authToken)).toBe(true);
    expect(user.authTokenHash).toBeUndefined();
    expect(user.authTokenSalt).toBeUndefined();
    expect(user.authTokenExpiresAt).toBeUndefined();
  });

  it("AUTH_CORE_08_REVOKED_TOKEN fails session validation after logout", () => {
    const db = createDb();
    const { user, authToken } = createUser(db, "revoked@example.com", "secret-123", "dev-1");

    expect(revokeUserSession(db, user.userId, authToken)).toBe(true);
    expect(validateUserSession(db, user.userId, authToken)).toBeNull();
  });

  it("AUTH_CORE_09_LEGACY_NO_EXPIRY fails closed for legacy tokens without an expiry", () => {
    const db = createDb();
    const { user, authToken } = createUser(db, "legacy@example.com", "secret-123", "dev-1");
    delete user.authTokenExpiresAt;

    expect(validateUserSession(db, user.userId, authToken)).toBeNull();
  });

  it("AUTH_CORE_10_SERVER_RESTART keeps non-expired tokens valid across a DB reopen", () => {
    const dbFile = path.join(os.tmpdir(), `quiz-solver-auth-session-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    const previousDbFile = process.env.ANALYTICS_DB_FILE;
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;
    try {
      const created = createUserInStorage("restart@example.com", "secret-123", "dev-restart");
      const before = validateUserSessionInStorage(created.user.userId, created.authToken);
      expect(before?.user.email).toBe("restart@example.com");

      resetDbConnectionForTests();
      const after = validateUserSessionInStorage(created.user.userId, created.authToken);
      expect(after?.user).toEqual({ userId: created.user.userId, email: "restart@example.com" });
      expect(after?.expiresAt).toBe(before?.expiresAt);
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

  it("AUTH_CORE_08_REVOKED_TOKEN fails closed in SQLite storage and rejects userId-only revoke attempts", () => {
    const dbFile = path.join(os.tmpdir(), `quiz-solver-auth-revoke-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    const previousDbFile = process.env.ANALYTICS_DB_FILE;
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;
    try {
      const created = createUserInStorage("revoke-sqlite@example.com", "secret-123", "dev-revoke");

      expect(revokeUserSessionInStorage(created.user.userId, ["tok", "wrong"].join("_"))).toBe(false);
      expect(validateUserSessionInStorage(created.user.userId, created.authToken)).not.toBeNull();

      expect(revokeUserSessionInStorage(created.user.userId, created.authToken)).toBe(true);
      expect(validateUserSessionInStorage(created.user.userId, created.authToken)).toBeNull();
      expect(revokeUserSessionInStorage(created.user.userId, created.authToken)).toBe(false);
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

  it("migrates pre-existing SQLite databases by adding the expiry column and failing legacy sessions closed", () => {
    const dbFile = path.join(os.tmpdir(), `quiz-solver-auth-legacy-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    const previousDbFile = process.env.ANALYTICS_DB_FILE;
    resetDbConnectionForTests();
    try {
      // Simulate a database written before authTokenExpiresAt existed.
      const legacyDatabase = new DatabaseSync(dbFile);
      try {
        legacyDatabase.exec(`
          CREATE TABLE users (
            userId TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            passwordHash TEXT NOT NULL,
            passwordSalt TEXT NOT NULL,
            authTokenHash TEXT,
            authTokenSalt TEXT,
            authToken TEXT,
            createdAt INTEGER NOT NULL,
            deviceIdsJson TEXT NOT NULL DEFAULT '[]'
          );
        `);
        const legacyDigest = nodeCrypto.scryptSync("secret-123", "legacy-salt", 64).toString("hex");
        legacyDatabase
          .prepare(
            "INSERT INTO users (userId, email, passwordHash, passwordSalt, authTokenHash, authTokenSalt, authToken, createdAt, deviceIdsJson) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, '[]')",
          )
          .run("usr-legacy", "legacy-migration@example.com", legacyDigest, "legacy-salt", "legacy-hash", "legacy-salt", 0);
      } finally {
        legacyDatabase.close();
      }

      process.env.ANALYTICS_DB_FILE = dbFile;
      // Opening the store must add the missing column without touching data.
      expect(loadDb().users.map((user) => user.email)).toEqual(["legacy-migration@example.com"]);

      const legacyToken = ["tok", "legacy"].join("_");
      expect(validateUserSessionInStorage("usr-legacy", legacyToken)).toBeNull();
      expect(findUserByEmailInStorage("legacy-migration@example.com")?.userId).toBe("usr-legacy");

      // A fresh login re-issues a bounded token through the migrated schema.
      const loggedIn = loginUserInStorage("legacy-migration@example.com", "secret-123", "dev-legacy");
      expect(validateUserSessionInStorage(loggedIn.user.userId, loggedIn.authToken)).not.toBeNull();
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
});

describe("verification code lifecycle", () => {
  it("AUTH_CORE_16_CRYPTO_CODE_GENERATOR derives codes from crypto.randomInt", () => {
    const randomIntMock = vi.mocked(nodeCrypto.randomInt);
    randomIntMock.mockReturnValueOnce(654321);
    try {
      const db = createDb();
      const { code } = createEmailVerificationCode(db, "rng@example.com");
      expect(code).toBe("654321");
      expect(randomIntMock).toHaveBeenCalledWith(100000, 1000000);
      expect(code).toMatch(/^\d{6}$/);
    } finally {
      randomIntMock.mockReset();
    }
  });

  it("AUTH_CORE_17_CODE_REPLAY rejects a consumed verification code", () => {
    const db = createDb();
    const { code } = createEmailVerificationCode(db, "replay@example.com");
    verifyEmailCode(db, "replay@example.com", code);

    expect(() => verifyEmailCode(db, "replay@example.com", code)).toThrow(/invalid or expired/i);
  });

  it("AUTH_CORE_18_CODE_EXPIRED rejects codes past their 10 minute window", () => {
    const db = createDb();
    const { code } = createEmailVerificationCode(db, "expired-code@example.com");
    db.email_verification_codes[0].expiresAt = Date.now() - 1;

    expect(() => verifyEmailCode(db, "expired-code@example.com", code)).toThrow(/invalid or expired/i);
  });

  it("AUTH_CORE_19_NEW_CODE_REVOKES_OLD invalidates the previous code for the same email", () => {
    const db = createDb();
    const first = createEmailVerificationCode(db, "rotate-code@example.com");
    const second = createEmailVerificationCode(db, "rotate-code@example.com");

    expect(second.code).not.toBe(first.code);
    expect(() => verifyEmailCode(db, "rotate-code@example.com", first.code)).toThrow(/invalid or expired/i);
    expect(() => verifyEmailCode(db, "rotate-code@example.com", second.code)).not.toThrow();
  });
});

describe("auth core registration and migration hardening", () => {
  it("AUTH_CORE_24_LEGACY_EMPTY_SQLITE_JSON_IMPORT migrates the schema before importing legacy users", () => {
    const dataDir = path.join(os.tmpdir(), `quiz-solver-auth-dataimport-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const previousDataDir = process.env.ANALYTICS_DATA_DIR;
    const previousDbFile = process.env.ANALYTICS_DB_FILE;
    delete process.env.ANALYTICS_DB_FILE;
    resetDbConnectionForTests();
    try {
      fs.mkdirSync(dataDir, { recursive: true });

      // An old pre-TTL database: schema without authTokenExpiresAt, empty users.
      const legacyDatabase = new DatabaseSync(path.join(dataDir, "analytics-db.sqlite"));
      try {
        legacyDatabase.exec(`
          CREATE TABLE users (
            userId TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            passwordHash TEXT NOT NULL,
            passwordSalt TEXT NOT NULL,
            authTokenHash TEXT,
            authTokenSalt TEXT,
            authToken TEXT,
            createdAt INTEGER NOT NULL,
            deviceIdsJson TEXT NOT NULL DEFAULT '[]'
          );
        `);
      } finally {
        legacyDatabase.close();
      }

      // A legacy JSON snapshot with one user whose password is known and whose
      // token has no provable expiry.
      const importedDigest = nodeCrypto.scryptSync("secret-123", "legacy-import-salt", 64).toString("hex");
      fs.writeFileSync(
        path.join(dataDir, "analytics-db.json"),
        JSON.stringify({
          devices: [],
          analytics_events: [],
          email_verification_codes: [],
          users: [{
            userId: "usr-imported",
            email: "imported@example.com",
            passwordHash: importedDigest,
            passwordSalt: "legacy-import-salt",
            authTokenHash: "imported-token-hash",
            authTokenSalt: "imported-token-salt",
            createdAt: 0,
            deviceIds: [],
          }],
        }),
        "utf8",
      );

      process.env.ANALYTICS_DATA_DIR = dataDir;
      const opened = loadDb();

      // Schema gained the expiry column and the user was imported.
      const probe = new DatabaseSync(path.join(dataDir, "analytics-db.sqlite"));
      try {
        expect(probe.prepare("PRAGMA table_info(users)").all().map((column) => column.name)).toContain("authTokenExpiresAt");
      } finally {
        probe.close();
      }
      expect(opened.users.map((user) => user.email)).toEqual(["imported@example.com"]);

      // The imported legacy token has no provable expiry and fails closed.
      expect(validateUserSessionInStorage("usr-imported", ["tok", "imported"].join("_"))).toBeNull();

      // A fresh login on the migrated schema issues a bounded valid session.
      const loggedIn = loginUserInStorage("imported@example.com", "secret-123", "dev-import");
      expect(validateUserSessionInStorage(loggedIn.user.userId, loggedIn.authToken)).not.toBeNull();

      // A second reopen stays healthy with no data loss.
      resetDbConnectionForTests();
      expect(loadDb().users).toHaveLength(1);
      expect(validateUserSessionInStorage(loggedIn.user.userId, loggedIn.authToken)).not.toBeNull();
    } finally {
      resetDbConnectionForTests();
      if (previousDataDir === undefined) delete process.env.ANALYTICS_DATA_DIR;
      else process.env.ANALYTICS_DATA_DIR = previousDataDir;
      if (previousDbFile === undefined) delete process.env.ANALYTICS_DB_FILE;
      else process.env.ANALYTICS_DB_FILE = previousDbFile;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("AUTH_CORE_28_REGISTRATION_CREATE_FAILURE_ROLLBACK leaves code and tables untouched when creation fails", () => {
    const dbFile = path.join(os.tmpdir(), `quiz-solver-auth-rollback-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    const previousDbFile = process.env.ANALYTICS_DB_FILE;
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;
    try {
      const { code } = createEmailVerificationCodeInStorage("rollback@example.com");

      // Simulate a storage-level creation failure inside the registration
      // transaction via a raising trigger on the users table.
      const saboteur = new DatabaseSync(dbFile);
      try {
        saboteur.exec("CREATE TRIGGER fail_user_insert BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT, 'simulated create failure'); END;");
      } finally {
        saboteur.close();
      }

      expect(() =>
        registerUserWithVerificationCodeInStorage("rollback@example.com", "secret-123", code, "dev-rollback"),
      ).toThrow();

      // All-or-nothing: no user, no device, and the code is still unconsumed.
      const afterFailure = loadDb();
      expect(afterFailure.users).toHaveLength(0);
      expect(afterFailure.devices).toHaveLength(0);
      expect(afterFailure.email_verification_codes[0].consumedAt ?? null).toBeNull();

      // With the failure removed the same code still registers successfully.
      const remover = new DatabaseSync(dbFile);
      try {
        remover.exec("DROP TRIGGER fail_user_insert");
      } finally {
        remover.close();
      }
      const registered = registerUserWithVerificationCodeInStorage("rollback@example.com", "secret-123", code, "dev-rollback");
      expect(registered.user.email).toBe("rollback@example.com");
      expect(validateUserSessionInStorage(registered.user.userId, registered.authToken)).not.toBeNull();
      expect(loadDb().email_verification_codes[0].consumedAt ?? null).not.toBeNull();
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
});

describe("auth core login failure kdf parity", () => {
  it("AUTH_CORE_32_LOGIN_FAILURE_KDF_PARITY runs one comparable scrypt verification per failed SQLite login", () => {
    const dbFile = path.join(os.tmpdir(), `quiz-solver-auth-parity-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    const previousDbFile = process.env.ANALYTICS_DB_FILE;
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;
    const scryptMock = vi.mocked(nodeCrypto.scryptSync);
    try {
      const created = createUserInStorage("parity@example.com", "secret-123", "dev-parity");

      // Known account + wrong password: exactly one real-record verification.
      scryptMock.mockClear();
      expect(() => loginUserInStorage("parity@example.com", "wrong-password", "dev-parity")).toThrow("invalid password");
      expect(scryptMock).toHaveBeenCalledTimes(1);
      const wrongPasswordCall = scryptMock.mock.calls[0];
      expect(wrongPasswordCall[1]).toBe(created.user.passwordSalt);
      expect(wrongPasswordCall[2]).toBe(64);

      // Unknown account: exactly one dummy-record verification with the same
      // scrypt key length, so both failure paths pay comparable KDF cost.
      scryptMock.mockClear();
      expect(() => loginUserInStorage("ghost@example.com", "wrong-password", "dev-parity")).toThrow("account not found");
      expect(scryptMock).toHaveBeenCalledTimes(1);
      const unknownCall = scryptMock.mock.calls[0];
      expect(unknownCall[2]).toBe(64);
      expect(unknownCall[1]).not.toBe(created.user.passwordSalt);

      // Successful login keeps verifying against the real record.
      scryptMock.mockClear();
      const loggedIn = loginUserInStorage("parity@example.com", "secret-123", "dev-parity");
      expect(loggedIn.authToken).toBeTruthy();
      expect(scryptMock.mock.calls[0][1]).toBe(created.user.passwordSalt);
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

  it("AUTH_CORE_33_JSON_LOGIN_FAILURE_KDF_PARITY gives the JSON login path the same KDF workload", () => {
    const db = createDb();
    const created = createUser(db, "json-parity@example.com", "secret-123", "dev-json");
    const scryptMock = vi.mocked(nodeCrypto.scryptSync);

    scryptMock.mockClear();
    expect(() => loginUser(db, "json-parity@example.com", "wrong-password", "dev-json")).toThrow("invalid password");
    expect(scryptMock).toHaveBeenCalledTimes(1);
    expect(scryptMock.mock.calls[0][2]).toBe(64);

    scryptMock.mockClear();
    expect(() => loginUser(db, "ghost@example.com", "wrong-password", "dev-json")).toThrow("account not found");
    expect(scryptMock).toHaveBeenCalledTimes(1);
    expect(scryptMock.mock.calls[0][2]).toBe(64);
    expect(scryptMock.mock.calls[0][1]).not.toBe(created.user.passwordSalt);
  });
});
