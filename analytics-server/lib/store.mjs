import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { hashSecret, issueOpaqueToken, verifySecret } from "./security.mjs";

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
// ANALYTICS_DATA_DIR redirects the whole data directory (test isolation);
// without it the store resolves the same paths as before.
function getDataDir() {
  return process.env.ANALYTICS_DATA_DIR || join(ROOT_DIR, "..", "data");
}
const SQLITE_SUPPORTED = typeof DatabaseSync === "function";

export function assertProductionStorageAuthority({
  nodeEnv = process.env.NODE_ENV,
  sqliteSupported = SQLITE_SUPPORTED,
} = {}) {
  const isProduction = String(nodeEnv || "").trim().toLowerCase() === "production";
  if (isProduction && !sqliteSupported) {
    throw new Error("PRODUCTION_SQLITE_REQUIRED");
  }
  return sqliteSupported ? "sqlite" : "json";
}

export const ANALYTICS_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const CURRENT_ANALYTICS_PRIVACY_EPOCH = 1;
export const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let dbInstance = null;

function createEmptyDb() {
  return {
    devices: [],
    users: [],
    analytics_events: [],
    email_verification_codes: [],
    analyticsPrivacyEpoch: CURRENT_ANALYTICS_PRIVACY_EPOCH,
  };
}

function ensureDataDir() {
  if (!existsSync(getDataDir())) mkdirSync(getDataDir(), { recursive: true });
}

function getDataFile() {
  return process.env.ANALYTICS_DB_FILE || join(getDataDir(), "analytics-db.sqlite");
}

function getJsonDataFile() {
  const configured = String(process.env.ANALYTICS_DB_FILE || "").trim();
  if (!configured) return join(getDataDir(), "analytics-db.json");
  return configured.replace(/\.sqlite$/i, ".json");
}

function normalizeUserRecord(user) {
  return {
    ...user,
    authToken: user?.authToken ? String(user.authToken) : undefined,
    authTokenHash: user?.authTokenHash ? String(user.authTokenHash) : undefined,
    authTokenSalt: user?.authTokenSalt ? String(user.authTokenSalt) : undefined,
    authTokenExpiresAt: user?.authTokenExpiresAt == null ? undefined : Number(user.authTokenExpiresAt) || undefined,
    deviceIds: Array.isArray(user?.deviceIds) ? user.deviceIds.filter(Boolean) : [],
  };
}

function normalizeVerificationCodeRecord(entry) {
  return {
    ...entry,
    code: entry?.code ? String(entry.code) : undefined,
    codeHash: entry?.codeHash ? String(entry.codeHash) : undefined,
    codeSalt: entry?.codeSalt ? String(entry.codeSalt) : undefined,
  };
}

function getDatabase() {
  if (!SQLITE_SUPPORTED) {
    throw new Error("sqlite backend is unavailable in this Node runtime");
  }
  if (dbInstance) return dbInstance;

  ensureDataDir();
  dbInstance = new DatabaseSync(getDataFile());
  dbInstance.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS devices (
      deviceId TEXT PRIMARY KEY,
      userId TEXT,
      installedAt INTEGER,
      createdAt INTEGER NOT NULL,
      lastSeenAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      userId TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      passwordSalt TEXT NOT NULL,
      authTokenHash TEXT,
      authTokenSalt TEXT,
      authToken TEXT,
      authTokenExpiresAt INTEGER,
      createdAt INTEGER NOT NULL,
      deviceIdsJson TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS analytics_events (
      eventId TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      ts INTEGER NOT NULL,
      eventDate TEXT NOT NULL,
      host TEXT,
      duration INTEGER,
      extensionVersion TEXT,
      deviceId TEXT NOT NULL,
      userId TEXT,
      dataJson TEXT,
      receivedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_verification_codes (
      codeId TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      codeHash TEXT,
      codeSalt TEXT,
      code TEXT,
      createdAt INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL,
      consumedAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS analytics_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_events_ts ON analytics_events(ts);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_event_ts ON analytics_events(event, ts);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_device_ts ON analytics_events(deviceId, ts);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_version_ts ON analytics_events(extensionVersion, ts);
    CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(createdAt);
  `);

  // Schema migration must complete before anything that reads or writes
  // authTokenExpiresAt — including the legacy JSON import below, whose
  // saveDb round-trip inserts that column.
  ensureAuthTokenExpiresAtColumn(dbInstance);
  maybeMigrateLegacyJson(dbInstance);
  migrateAnalyticsPrivacyEpochSqlite(dbInstance);
  pruneSqliteAnalyticsEvents(dbInstance, Date.now());
  return dbInstance;
}

// CREATE TABLE IF NOT EXISTS does not add columns to pre-existing databases,
// so the token expiry column has to be added idempotently for older files.
// Existing rows keep NULL: legacy tokens without a provable expiry fail
// closed during session validation until the next login re-issues one.
function ensureAuthTokenExpiresAtColumn(database) {
  const columns = database.prepare("PRAGMA table_info(users)").all();
  if (columns.some((column) => column.name === "authTokenExpiresAt")) return false;
  database.exec("ALTER TABLE users ADD COLUMN authTokenExpiresAt INTEGER");
  return true;
}

export function pruneAnalyticsEvents(db, now = Date.now()) {
  const cutoff = now - ANALYTICS_EVENT_RETENTION_MS;
  const events = Array.isArray(db.analytics_events) ? db.analytics_events : [];
  const retained = events.filter((event) => {
    const receivedAt = Number(event.receivedAt);
    return Number.isFinite(receivedAt) && receivedAt >= cutoff;
  });
  const removed = events.length - retained.length;
  db.analytics_events = retained;
  return removed;
}

function pruneSqliteAnalyticsEvents(database, now = Date.now()) {
  return database.prepare("DELETE FROM analytics_events WHERE receivedAt < ?").run(now - ANALYTICS_EVENT_RETENTION_MS).changes;
}

function migrateAnalyticsPrivacyEpochSqlite(database) {
  const row = database.prepare("SELECT value FROM analytics_metadata WHERE key = ?").get("analyticsPrivacyEpoch");
  if (Number(row?.value ?? 0) >= CURRENT_ANALYTICS_PRIVACY_EPOCH) return false;

  runInTransaction((tx) => {
    tx.exec("DELETE FROM analytics_events; DELETE FROM devices WHERE userId IS NULL;");
    tx.prepare("INSERT INTO analytics_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run("analyticsPrivacyEpoch", String(CURRENT_ANALYTICS_PRIVACY_EPOCH));
  });
  return true;
}

function migrateAnalyticsPrivacyEpochJson(db) {
  if (Number(db.analyticsPrivacyEpoch ?? 0) >= CURRENT_ANALYTICS_PRIVACY_EPOCH) return false;
  db.analytics_events = [];
  db.devices = (Array.isArray(db.devices) ? db.devices : []).filter((device) => Boolean(device.userId));
  db.analyticsPrivacyEpoch = CURRENT_ANALYTICS_PRIVACY_EPOCH;
  return true;
}

function runInTransaction(work) {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work(database);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function maybeMigrateLegacyJson(database) {
  if (process.env.ANALYTICS_DB_FILE) return;
  const hasUsers = Number(database.prepare("SELECT COUNT(*) AS count FROM users").get().count || 0) > 0;
  const hasEvents = Number(database.prepare("SELECT COUNT(*) AS count FROM analytics_events").get().count || 0) > 0;
  const hasDevices = Number(database.prepare("SELECT COUNT(*) AS count FROM devices").get().count || 0) > 0;
  const hasCodes =
    Number(database.prepare("SELECT COUNT(*) AS count FROM email_verification_codes").get().count || 0) > 0;

  if (hasUsers || hasEvents || hasDevices || hasCodes) return;
  if (!existsSync(getJsonDataFile())) return;

  const parsed = JSON.parse(readFileSync(getJsonDataFile(), "utf8"));
  const legacyDb = {
    ...createEmptyDb(),
    ...parsed,
    analyticsPrivacyEpoch: Number(parsed.analyticsPrivacyEpoch ?? 0),
    devices: Array.isArray(parsed.devices) ? parsed.devices : [],
    users: Array.isArray(parsed.users) ? parsed.users.map(normalizeUserRecord) : [],
    analytics_events: Array.isArray(parsed.analytics_events) ? parsed.analytics_events : [],
    email_verification_codes: Array.isArray(parsed.email_verification_codes)
      ? parsed.email_verification_codes.map(normalizeVerificationCodeRecord)
      : [],
  };

  saveDb(legacyDb);
}

function safeParseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function loadDbFromJsonFile() {
  ensureDataDir();
  const file = getJsonDataFile();
  if (!existsSync(file)) {
    const emptyDb = createEmptyDb();
    saveDbToJsonFile(emptyDb);
    return emptyDb;
  }

  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const db = {
    ...createEmptyDb(),
    ...parsed,
    devices: Array.isArray(parsed.devices) ? parsed.devices : [],
    users: Array.isArray(parsed.users) ? parsed.users.map(normalizeUserRecord) : [],
    analytics_events: Array.isArray(parsed.analytics_events) ? parsed.analytics_events : [],
    analyticsPrivacyEpoch: Number(parsed.analyticsPrivacyEpoch ?? 0),
    email_verification_codes: Array.isArray(parsed.email_verification_codes)
      ? parsed.email_verification_codes.map(normalizeVerificationCodeRecord)
      : [],
  };
  const epochMigrated = migrateAnalyticsPrivacyEpochJson(db);
  if (epochMigrated || pruneAnalyticsEvents(db)) saveDbToJsonFile(db);
  return db;
}

export function saveDbToJsonFile(db) {
  ensureDataDir();
  writeFileSync(getJsonDataFile(), JSON.stringify({ ...db, analyticsPrivacyEpoch: Number(db.analyticsPrivacyEpoch ?? CURRENT_ANALYTICS_PRIVACY_EPOCH) }, null, 2), "utf8");
}

export function getStorageBackendInfo() {
  if (SQLITE_SUPPORTED) {
    return {
      driver: "sqlite",
      label: "SQLite",
      detail: "当前运行在本机后端存储。",
      file: getDataFile(),
    };
  }

  return {
    driver: "json",
    label: "JSON 文件",
    detail: "当前运行在本机 Docker 后端存储。",
    file: getJsonDataFile(),
  };
}

export function loadDb() {
  if (!SQLITE_SUPPORTED) {
    return loadDbFromJsonFile();
  }
  const database = getDatabase();
  pruneSqliteAnalyticsEvents(database, Date.now());

  const devices = database.prepare("SELECT deviceId, userId, installedAt, createdAt, lastSeenAt FROM devices").all();
  const users = database
    .prepare(
      "SELECT userId, email, passwordHash, passwordSalt, authTokenHash, authTokenSalt, authToken, authTokenExpiresAt, createdAt, deviceIdsJson FROM users",
    )
    .all()
    .map((row) =>
      normalizeUserRecord({
        ...row,
        deviceIds: safeParseJson(row.deviceIdsJson, []),
      }),
    );
  const analytics_events = database
    .prepare(
      "SELECT eventId, event, ts, eventDate, host, duration, extensionVersion, deviceId, userId, dataJson, receivedAt FROM analytics_events ORDER BY ts ASC, receivedAt ASC",
    )
    .all()
    .map((row) => ({
      ...row,
      data: safeParseJson(row.dataJson, null),
    }));
  const email_verification_codes = database
    .prepare(
      "SELECT codeId, email, codeHash, codeSalt, code, createdAt, expiresAt, consumedAt FROM email_verification_codes",
    )
    .all()
    .map(normalizeVerificationCodeRecord);
  const analyticsPrivacyEpoch = Number(
    database.prepare("SELECT value FROM analytics_metadata WHERE key = ?").get("analyticsPrivacyEpoch")?.value ?? 0,
  );

  return {
    devices,
    users,
    analytics_events,
    email_verification_codes,
    analyticsPrivacyEpoch,
  };
}

export function resetDbConnectionForTests() {
  dbInstance?.close?.();
  dbInstance = null;
}

export function runAdminReadStorage({ sqlite, json }) {
  if (typeof sqlite !== "function" || typeof json !== "function") {
    throw new TypeError("sqlite and json admin read handlers are required");
  }
  if (SQLITE_SUPPORTED) {
    return sqlite(getDatabase());
  }
  return json(loadDbFromJsonFile());
}

export function saveDb(db) {
  if (!SQLITE_SUPPORTED) {
    saveDbToJsonFile(db);
    return;
  }
  runInTransaction((database) => {
    database.exec(`
      DELETE FROM devices;
      DELETE FROM users;
      DELETE FROM analytics_events;
      DELETE FROM email_verification_codes;
    `);

    const insertDevice = database.prepare(
      "INSERT INTO devices (deviceId, userId, installedAt, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?)",
    );
    for (const device of db.devices) {
      insertDevice.run(
        device.deviceId,
        device.userId ?? null,
        device.installedAt ?? null,
        device.createdAt,
        device.lastSeenAt,
      );
    }

    const insertUser = database.prepare(
      "INSERT INTO users (userId, email, passwordHash, passwordSalt, authTokenHash, authTokenSalt, authToken, authTokenExpiresAt, createdAt, deviceIdsJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const user of db.users) {
      insertUser.run(
        user.userId,
        user.email,
        user.passwordHash,
        user.passwordSalt,
        user.authTokenHash ?? null,
        user.authTokenSalt ?? null,
        user.authToken ?? null,
        user.authTokenExpiresAt ?? null,
        user.createdAt,
        JSON.stringify(Array.isArray(user.deviceIds) ? user.deviceIds : []),
      );
    }

    const insertEvent = database.prepare(
      "INSERT INTO analytics_events (eventId, event, ts, eventDate, host, duration, extensionVersion, deviceId, userId, dataJson, receivedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const event of db.analytics_events) {
      insertEvent.run(
        event.eventId,
        event.event,
        event.ts,
        event.eventDate,
        event.host ?? null,
        event.duration ?? null,
        event.extensionVersion ?? null,
        event.deviceId,
        event.userId ?? null,
        event.data == null ? null : JSON.stringify(event.data),
        event.receivedAt,
      );
    }

    const insertCode = database.prepare(
      "INSERT INTO email_verification_codes (codeId, email, codeHash, codeSalt, code, createdAt, expiresAt, consumedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const code of db.email_verification_codes) {
      insertCode.run(
        code.codeId,
        code.email,
        code.codeHash ?? null,
        code.codeSalt ?? null,
        code.code ?? null,
        code.createdAt,
        code.expiresAt,
        code.consumedAt ?? null,
      );
    }
    database
      .prepare("INSERT INTO analytics_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run("analyticsPrivacyEpoch", String(Number(db.analyticsPrivacyEpoch ?? CURRENT_ANALYTICS_PRIVACY_EPOCH)));
  });
}

export function generateId(prefix) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  const next = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return next.length === expected.length && timingSafeEqual(next, expected);
}

export function issueAuthToken() {
  return issueOpaqueToken("tok");
}

function issueStoredAuthToken(user, now = Date.now()) {
  const authToken = issueAuthToken();
  const digest = hashSecret(authToken);
  user.authTokenHash = digest.hash;
  user.authTokenSalt = digest.salt;
  user.authTokenExpiresAt = now + AUTH_SESSION_TTL_MS;
  delete user.authToken;
  return authToken;
}

function appendDeviceId(deviceIds, deviceId) {
  const normalizedDeviceId = String(deviceId || "").trim();
  if (!normalizedDeviceId) return Array.isArray(deviceIds) ? deviceIds : [];
  const next = Array.isArray(deviceIds) ? [...deviceIds] : [];
  if (!next.includes(normalizedDeviceId)) next.push(normalizedDeviceId);
  return next;
}

function hydrateUserRow(row) {
  if (!row) return null;
  return normalizeUserRecord({
    ...row,
    deviceIds: safeParseJson(row.deviceIdsJson, []),
  });
}

function findStoredUserByEmail(database, email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  const row = database
    .prepare(
      "SELECT userId, email, passwordHash, passwordSalt, authTokenHash, authTokenSalt, authToken, createdAt, deviceIdsJson FROM users WHERE email = ?",
    )
    .get(normalized);
  return hydrateUserRow(row);
}

function upsertStoredDevice(database, deviceId, userId, installedAt) {
  const normalizedDeviceId = String(deviceId || "").trim();
  if (!normalizedDeviceId) {
    throw new Error("deviceId is required");
  }

  const now = Date.now();
  const existing = database.prepare("SELECT deviceId, userId, installedAt, createdAt FROM devices WHERE deviceId = ?").get(normalizedDeviceId);
  if (!existing) {
    database
      .prepare("INSERT INTO devices (deviceId, userId, installedAt, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?)")
      .run(normalizedDeviceId, userId ?? null, installedAt ?? null, now, now);
    return;
  }

  database
    .prepare("UPDATE devices SET userId = ?, installedAt = ?, lastSeenAt = ? WHERE deviceId = ?")
    .run(
      userId || existing.userId || null,
      existing.installedAt ?? installedAt ?? null,
      now,
      normalizedDeviceId,
    );
}

export function createEmailVerificationCodeInStorage(email) {
  if (!SQLITE_SUPPORTED) {
    const db = loadDbFromJsonFile();
    const result = createEmailVerificationCode(db, email);
    saveDbToJsonFile(db);
    return result;
  }
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) throw new Error("email is required");

  const now = Date.now();
  const expiresAt = now + 10 * 60 * 1000;
  const code = issueVerificationCode();
  const digest = hashSecret(code);

  runInTransaction((database) => {
    database
      .prepare("DELETE FROM email_verification_codes WHERE email = ? OR expiresAt <= ?")
      .run(normalized, now);
    database
      .prepare(
        "INSERT INTO email_verification_codes (codeId, email, codeHash, codeSalt, code, createdAt, expiresAt, consumedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(generateId("emc"), normalized, digest.hash, digest.salt, null, now, expiresAt, null);
  });

  return { code, expiresAt };
}

// Stable, public registration failures. The HTTP boundary maps these onto
// fixed status/error codes; any other error is treated as an internal
// storage failure and never surfaced.
export class RegistrationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RegistrationError";
  }
}

function matchesVerificationCode(entry, normalizedCode) {
  if (entry.codeHash && entry.codeSalt) {
    return verifySecret(normalizedCode, entry.codeSalt, entry.codeHash);
  }
  return entry.code === normalizedCode;
}

function consumeVerificationCodeRow(database, match, normalizedCode, now) {
  if (match.code) {
    const digest = hashSecret(normalizedCode);
    database
      .prepare("UPDATE email_verification_codes SET codeHash = ?, codeSalt = ?, code = NULL, consumedAt = ? WHERE codeId = ?")
      .run(digest.hash, digest.salt, now, match.codeId);
    return;
  }
  database
    .prepare("UPDATE email_verification_codes SET consumedAt = ? WHERE codeId = ?")
    .run(now, match.codeId);
}

export function verifyEmailCodeInStorage(email, code) {
  if (!SQLITE_SUPPORTED) {
    const db = loadDbFromJsonFile();
    const result = verifyEmailCode(db, email, code);
    saveDbToJsonFile(db);
    return result;
  }
  const normalized = String(email || "").trim().toLowerCase();
  const normalizedCode = String(code || "").trim();
  const now = Date.now();

  return runInTransaction((database) => {
    const candidates = database
      .prepare(
        "SELECT codeId, email, codeHash, codeSalt, code, createdAt, expiresAt, consumedAt FROM email_verification_codes WHERE email = ? AND consumedAt IS NULL AND expiresAt > ?",
      )
      .all(normalized, now)
      .map(normalizeVerificationCodeRecord);

    const match = candidates.find((entry) => matchesVerificationCode(entry, normalizedCode));
    if (!match) throw new Error("invalid or expired verification code");

    consumeVerificationCodeRow(database, match, normalizedCode, now);
  });
}

function insertStoredUser(database, user) {
  database
    .prepare(
      "INSERT INTO users (userId, email, passwordHash, passwordSalt, authTokenHash, authTokenSalt, authToken, authTokenExpiresAt, createdAt, deviceIdsJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      user.userId,
      user.email,
      user.passwordHash,
      user.passwordSalt,
      user.authTokenHash ?? null,
      user.authTokenSalt ?? null,
      null,
      user.authTokenExpiresAt ?? null,
      user.createdAt,
      JSON.stringify(user.deviceIds),
    );
}

export function createUserInStorage(email, password, deviceId) {
  if (!SQLITE_SUPPORTED) {
    const db = loadDbFromJsonFile();
    const result = createUser(db, email, password, deviceId);
    saveDbToJsonFile(db);
    return result;
  }
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) throw new Error("email is required");
  if (String(password || "").length < 6) throw new Error("password must be at least 6 characters");

  const passwordDigest = hashPassword(password);
  const user = {
    userId: generateId("usr"),
    email: normalized,
    passwordHash: passwordDigest.hash,
    passwordSalt: passwordDigest.salt,
    createdAt: Date.now(),
    deviceIds: appendDeviceId([], deviceId),
  };
  const authToken = issueStoredAuthToken(user);

  runInTransaction((database) => {
    if (findStoredUserByEmail(database, normalized)) {
      throw new Error("email already registered");
    }

    insertStoredUser(database, user);

    if (deviceId) {
      upsertStoredDevice(database, deviceId, user.userId, null);
    }
  });

  return { user, authToken };
}

// Authoritative registration: input validation, code verification, the
// duplicate check, account creation, and code consumption run inside one
// transaction boundary. Account existence is only ever evaluated after a
// valid one-time code proved email control, and every failure rolls back so
// the code is neither consumed nor left behind with partial session state.
export function registerUserWithVerificationCodeInStorage(email, password, verificationCode, deviceId) {
  const normalized = String(email || "").trim().toLowerCase();
  const normalizedCode = String(verificationCode || "").trim();
  if (!normalized) throw new RegistrationError("email is required");
  if (String(password || "").length < 6) throw new RegistrationError("password must be at least 6 characters");
  if (!normalizedCode) throw new RegistrationError("verification code is required");

  if (!SQLITE_SUPPORTED) {
    const db = loadDbFromJsonFile();
    const result = registerUserWithVerificationCode(db, normalized, password, normalizedCode, deviceId);
    saveDbToJsonFile(db);
    return result;
  }

  const now = Date.now();
  return runInTransaction((database) => {
    const candidates = database
      .prepare(
        "SELECT codeId, email, codeHash, codeSalt, code, createdAt, expiresAt, consumedAt FROM email_verification_codes WHERE email = ? AND consumedAt IS NULL AND expiresAt > ?",
      )
      .all(normalized, now)
      .map(normalizeVerificationCodeRecord);
    const match = candidates.find((entry) => matchesVerificationCode(entry, normalizedCode));
    if (!match) throw new RegistrationError("invalid or expired verification code");

    if (findStoredUserByEmail(database, normalized)) {
      throw new RegistrationError("email already registered");
    }

    const passwordDigest = hashPassword(password);
    const user = {
      userId: generateId("usr"),
      email: normalized,
      passwordHash: passwordDigest.hash,
      passwordSalt: passwordDigest.salt,
      createdAt: now,
      deviceIds: appendDeviceId([], deviceId),
    };
    const authToken = issueStoredAuthToken(user, now);
    insertStoredUser(database, user);
    if (deviceId) {
      upsertStoredDevice(database, deviceId, user.userId, null);
    }
    consumeVerificationCodeRow(database, match, normalizedCode, now);
    return { user, authToken };
  });
}

export function registerUserWithVerificationCode(db, email, password, verificationCode, deviceId, now = Date.now()) {
  const normalized = String(email || "").trim().toLowerCase();
  const normalizedCode = String(verificationCode || "").trim();
  if (!normalized) throw new RegistrationError("email is required");
  if (String(password || "").length < 6) throw new RegistrationError("password must be at least 6 characters");
  if (!normalizedCode) throw new RegistrationError("verification code is required");

  const entry = db.email_verification_codes.find((item) => {
    if (item.email !== normalized || item.consumedAt || item.expiresAt <= now) return false;
    return matchesVerificationCode(item, normalizedCode);
  });
  if (!entry) throw new RegistrationError("invalid or expired verification code");

  if (findUserByEmail(db, normalized)) {
    throw new RegistrationError("email already registered");
  }

  const { user, authToken } = createUser(db, normalized, password, deviceId);
  if (entry.code) {
    const digest = hashSecret(normalizedCode);
    entry.codeHash = digest.hash;
    entry.codeSalt = digest.salt;
    delete entry.code;
  }
  entry.consumedAt = now;
  return { user, authToken };
}

// AUTH-CORE-INV-10: failed logins must pay comparable password-verification
// cost whether or not the account exists, or response timing would reveal
// registered emails. A dummy credential is generated once at module init
// with the same hashPassword/verifyPassword scrypt parameters; its raw
// secret stays in this closure only and is never persisted or logged.
const DUMMY_LOGIN_PASSWORD_DIGEST = hashPassword(randomBytes(32).toString("hex"));

function verifyLoginPassword(user, password) {
  const record = user
    ? { salt: user.passwordSalt, hash: user.passwordHash }
    : DUMMY_LOGIN_PASSWORD_DIGEST;
  return verifyPassword(password, record.salt, record.hash);
}

export function loginUserInStorage(email, password, deviceId) {
  if (!SQLITE_SUPPORTED) {
    const db = loadDbFromJsonFile();
    const result = loginUser(db, email, password, deviceId);
    saveDbToJsonFile(db);
    return result;
  }
  const normalized = String(email || "").trim().toLowerCase();

  return runInTransaction((database) => {
    const user = findStoredUserByEmail(database, normalized);
    const passwordMatches = verifyLoginPassword(user, password);
    if (!user) throw new Error("account not found");
    if (!passwordMatches) throw new Error("invalid password");

    const nextDeviceIds = appendDeviceId(user.deviceIds, deviceId);
    user.deviceIds = nextDeviceIds;
    const authToken = issueStoredAuthToken(user);

    database
      .prepare("UPDATE users SET authTokenHash = ?, authTokenSalt = ?, authToken = NULL, authTokenExpiresAt = ?, deviceIdsJson = ? WHERE userId = ?")
      .run(
        user.authTokenHash ?? null,
        user.authTokenSalt ?? null,
        user.authTokenExpiresAt ?? null,
        JSON.stringify(nextDeviceIds),
        user.userId,
      );

    if (deviceId) {
      upsertStoredDevice(database, deviceId, user.userId, null);
    }

    return { user, authToken };
  });
}

export function findUserByEmailInStorage(email) {
  if (!SQLITE_SUPPORTED) {
    return findUserByEmail(loadDbFromJsonFile(), email);
  }
  return findStoredUserByEmail(getDatabase(), email);
}

// A session is valid only when the stored token hash matches AND the token
// carries a provable, unexpired expiry. Records without an expiry (pre-TTL
// legacy tokens) fail closed and require a fresh login.
function validateSessionRecord(record, authToken, now) {
  if (!record) return null;
  if (!record.authTokenHash || !record.authTokenSalt) return null;
  const expiresAt = Number(record.authTokenExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  if (!verifySecret(String(authToken || ""), record.authTokenSalt, record.authTokenHash)) return null;
  return { user: { userId: record.userId, email: record.email }, expiresAt };
}

export function validateUserSession(db, userId, authToken, now = Date.now()) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId || !String(authToken || "")) return null;
  const user = db.users.find((entry) => entry.userId === normalizedUserId);
  return validateSessionRecord(user, authToken, now);
}

export function validateUserSessionInStorage(userId, authToken, now = Date.now()) {
  if (!SQLITE_SUPPORTED) {
    return validateUserSession(loadDbFromJsonFile(), userId, authToken, now);
  }
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId || !String(authToken || "")) return null;
  const row = getDatabase()
    .prepare(
      "SELECT userId, email, authTokenHash, authTokenSalt, authToken, authTokenExpiresAt, deviceIdsJson FROM users WHERE userId = ?",
    )
    .get(normalizedUserId);
  return validateSessionRecord(hydrateUserRow(row), authToken, now);
}

export function revokeUserSession(db, userId, authToken, now = Date.now()) {
  const session = validateUserSession(db, userId, authToken, now);
  if (!session) return false;
  const user = db.users.find((entry) => entry.userId === session.user.userId);
  if (user) {
    user.authTokenHash = undefined;
    user.authTokenSalt = undefined;
    user.authTokenExpiresAt = undefined;
    delete user.authToken;
  }
  return true;
}

export function revokeUserSessionInStorage(userId, authToken, now = Date.now()) {
  if (!SQLITE_SUPPORTED) {
    const db = loadDbFromJsonFile();
    const result = revokeUserSession(db, userId, authToken, now);
    if (result) saveDbToJsonFile(db);
    return result;
  }
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return false;
  return runInTransaction((database) => {
    const row = database
      .prepare(
        "SELECT userId, email, authTokenHash, authTokenSalt, authToken, authTokenExpiresAt, deviceIdsJson FROM users WHERE userId = ?",
      )
      .get(normalizedUserId);
    if (!validateSessionRecord(hydrateUserRow(row), authToken, now)) return false;
    database
      .prepare("UPDATE users SET authTokenHash = NULL, authTokenSalt = NULL, authToken = NULL, authTokenExpiresAt = NULL WHERE userId = ?")
      .run(normalizedUserId);
    return true;
  });
}

export function pruneAnalyticsEventsInStorage(now = Date.now()) {  if (!SQLITE_SUPPORTED) {
    const db = loadDbFromJsonFile();
    const removed = pruneAnalyticsEvents(db, now);
    if (removed) saveDbToJsonFile(db);
    return removed;
  }
  return pruneSqliteAnalyticsEvents(getDatabase(), now);
}

export function recordAnalyticsEventInStorage(payload) {
  if (!SQLITE_SUPPORTED) {
    return recordAnalyticsEventInJsonStore(payload);
  }
  return runInTransaction((database) => {
    pruneSqliteAnalyticsEvents(database, Date.now());

    database
      .prepare(
        "INSERT INTO analytics_events (eventId, event, ts, eventDate, host, duration, extensionVersion, deviceId, userId, dataJson, receivedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        generateId("evt"),
        payload.event,
        Number(payload.ts || Date.now()),
        new Date(Number(payload.ts || Date.now())).toISOString().slice(0, 10),
        payload.host || null,
        payload.duration ?? null,
        payload.extensionVersion || null,
        payload.deviceId,
        null,
        payload.data == null ? null : JSON.stringify(payload.data),
        Date.now(),
      );
  });
}

export function recordAnalyticsEventInJsonStore(payload) {
  const db = loadDbFromJsonFile();
  const result = recordAnalyticsEvent(db, payload);
  saveDbToJsonFile(db);
  return result;
}

export function ensureDevice(db, deviceId, userId) {
  const now = Date.now();
  let device = db.devices.find((entry) => entry.deviceId === deviceId);
  if (!device) {
    device = {
      deviceId,
      userId: userId || null,
      installedAt: null,
      createdAt: now,
      lastSeenAt: now,
    };
    db.devices.push(device);
  } else {
    device.lastSeenAt = now;
    if (userId) device.userId = userId;
  }
  return device;
}

export function findUserByEmail(db, email) {
  const normalized = String(email || "").trim().toLowerCase();
  return db.users.find((entry) => entry.email === normalized) || null;
}

export function findUserByToken(db, token) {
  if (!token) return null;
  for (const entry of db.users) {
    if (entry.authTokenHash && entry.authTokenSalt && verifySecret(token, entry.authTokenSalt, entry.authTokenHash)) {
      return entry;
    }
    if (entry.authToken && entry.authToken === token) {
      const digest = hashSecret(token);
      entry.authTokenHash = digest.hash;
      entry.authTokenSalt = digest.salt;
      delete entry.authToken;
      return entry;
    }
  }
  return null;
}

export function createUser(db, email, password, deviceId) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) throw new Error("email is required");
  if (findUserByEmail(db, normalized)) throw new Error("email already registered");
  if (String(password || "").length < 6) throw new Error("password must be at least 6 characters");

  const passwordDigest = hashPassword(password);
  const user = {
    userId: generateId("usr"),
    email: normalized,
    passwordHash: passwordDigest.hash,
    passwordSalt: passwordDigest.salt,
    createdAt: Date.now(),
    deviceIds: deviceId ? [deviceId] : [],
  };
  const authToken = issueStoredAuthToken(user);
  db.users.push(user);
  if (deviceId) ensureDevice(db, deviceId, user.userId);
  return { user, authToken };
}

export function issueVerificationCode() {
  return `${randomInt(100000, 1000000)}`;
}

export function createEmailVerificationCode(db, email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) throw new Error("email is required");
  const now = Date.now();
  const expiresAt = now + 10 * 60 * 1000;
  const code = issueVerificationCode();
  const digest = hashSecret(code);
  db.email_verification_codes = db.email_verification_codes.filter((entry) => {
    return entry.email !== normalized && entry.expiresAt > now;
  });
  db.email_verification_codes.push({
    codeId: generateId("emc"),
    email: normalized,
    codeHash: digest.hash,
    codeSalt: digest.salt,
    createdAt: now,
    expiresAt,
    consumedAt: null,
  });
  return { code, expiresAt };
}

export function verifyEmailCode(db, email, code) {
  const normalized = String(email || "").trim().toLowerCase();
  const normalizedCode = String(code || "").trim();
  const now = Date.now();
  const entry = db.email_verification_codes.find((item) => {
    if (item.email !== normalized || item.consumedAt || item.expiresAt <= now) return false;
    if (item.codeHash && item.codeSalt) {
      return verifySecret(normalizedCode, item.codeSalt, item.codeHash);
    }
    return item.code === normalizedCode;
  });
  if (!entry) throw new Error("invalid or expired verification code");
  if (entry.code) {
    const digest = hashSecret(normalizedCode);
    entry.codeHash = digest.hash;
    entry.codeSalt = digest.salt;
    delete entry.code;
  }
  entry.consumedAt = now;
}

export function loginUser(db, email, password, deviceId) {
  const user = findUserByEmail(db, email);
  const passwordMatches = verifyLoginPassword(user, password);
  if (!user) throw new Error("account not found");
  if (!passwordMatches) throw new Error("invalid password");
  const authToken = issueStoredAuthToken(user);
  if (deviceId && !user.deviceIds.includes(deviceId)) user.deviceIds.push(deviceId);
  if (deviceId) ensureDevice(db, deviceId, user.userId);
  return { user, authToken };
}

export function recordAnalyticsEvent(db, payload) {
  pruneAnalyticsEvents(db, Date.now());
  db.analytics_events.push({
    eventId: generateId("evt"),
    event: payload.event,
    ts: Number(payload.ts || Date.now()),
    eventDate: new Date(Number(payload.ts || Date.now())).toISOString().slice(0, 10),
    host: payload.host || null,
    duration: payload.duration ?? null,
    extensionVersion: payload.extensionVersion || null,
    deviceId: payload.deviceId,
    userId: null,
    data: payload.data || null,
    receivedAt: Date.now(),
  });
}
