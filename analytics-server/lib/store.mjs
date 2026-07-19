import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { hashSecret, issueOpaqueToken, verifySecret } from "./security.mjs";

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(ROOT_DIR, "..", "data");
const DEFAULT_DATA_FILE = join(DATA_DIR, "analytics-db.sqlite");
const LEGACY_JSON_FILE = join(DATA_DIR, "analytics-db.json");
const SQLITE_SUPPORTED = typeof DatabaseSync === "function";

let dbInstance = null;

function createEmptyDb() {
  return {
    devices: [],
    users: [],
    analytics_events: [],
    email_verification_codes: [],
  };
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function getDataFile() {
  return process.env.ANALYTICS_DB_FILE || DEFAULT_DATA_FILE;
}

function getJsonDataFile() {
  const configured = String(process.env.ANALYTICS_DB_FILE || "").trim();
  if (!configured) return LEGACY_JSON_FILE;
  return configured.replace(/\.sqlite$/i, ".json");
}

function normalizeUserRecord(user) {
  return {
    ...user,
    authToken: user?.authToken ? String(user.authToken) : undefined,
    authTokenHash: user?.authTokenHash ? String(user.authTokenHash) : undefined,
    authTokenSalt: user?.authTokenSalt ? String(user.authTokenSalt) : undefined,
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
  `);

  maybeMigrateLegacyJson(dbInstance);
  return dbInstance;
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
  if (!existsSync(LEGACY_JSON_FILE)) return;

  const parsed = JSON.parse(readFileSync(LEGACY_JSON_FILE, "utf8"));
  const legacyDb = {
    ...createEmptyDb(),
    ...parsed,
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

function loadDbFromJsonFile() {
  ensureDataDir();
  const file = getJsonDataFile();
  if (!existsSync(file)) {
    return createEmptyDb();
  }

  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return {
    ...createEmptyDb(),
    ...parsed,
    devices: Array.isArray(parsed.devices) ? parsed.devices : [],
    users: Array.isArray(parsed.users) ? parsed.users.map(normalizeUserRecord) : [],
    analytics_events: Array.isArray(parsed.analytics_events) ? parsed.analytics_events : [],
    email_verification_codes: Array.isArray(parsed.email_verification_codes)
      ? parsed.email_verification_codes.map(normalizeVerificationCodeRecord)
      : [],
  };
}

function saveDbToJsonFile(db) {
  ensureDataDir();
  writeFileSync(getJsonDataFile(), JSON.stringify(db, null, 2), "utf8");
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

  const devices = database.prepare("SELECT deviceId, userId, installedAt, createdAt, lastSeenAt FROM devices").all();
  const users = database
    .prepare(
      "SELECT userId, email, passwordHash, passwordSalt, authTokenHash, authTokenSalt, authToken, createdAt, deviceIdsJson FROM users",
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

  return {
    devices,
    users,
    analytics_events,
    email_verification_codes,
  };
}

export function resetDbConnectionForTests() {
  dbInstance?.close?.();
  dbInstance = null;
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
      "INSERT INTO users (userId, email, passwordHash, passwordSalt, authTokenHash, authTokenSalt, authToken, createdAt, deviceIdsJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
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

function issueStoredAuthToken(user) {
  const authToken = issueAuthToken();
  const digest = hashSecret(authToken);
  user.authTokenHash = digest.hash;
  user.authTokenSalt = digest.salt;
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

function getUserRows(database) {
  return database
    .prepare(
      "SELECT userId, email, passwordHash, passwordSalt, authTokenHash, authTokenSalt, authToken, createdAt, deviceIdsJson FROM users",
    )
    .all();
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

function findStoredUserByToken(database, token) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) return null;

  for (const row of getUserRows(database)) {
    const user = hydrateUserRow(row);
    if (!user) continue;

    if (user.authTokenHash && user.authTokenSalt && verifySecret(normalizedToken, user.authTokenSalt, user.authTokenHash)) {
      return user;
    }

    if (user.authToken && user.authToken === normalizedToken) {
      const digest = hashSecret(normalizedToken);
      database
        .prepare("UPDATE users SET authTokenHash = ?, authTokenSalt = ?, authToken = NULL WHERE userId = ?")
        .run(digest.hash, digest.salt, user.userId);
      user.authTokenHash = digest.hash;
      user.authTokenSalt = digest.salt;
      delete user.authToken;
      return user;
    }
  }

  return null;
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

    const match = candidates.find((entry) => {
      if (entry.codeHash && entry.codeSalt) {
        return verifySecret(normalizedCode, entry.codeSalt, entry.codeHash);
      }
      return entry.code === normalizedCode;
    });

    if (!match) throw new Error("invalid or expired verification code");

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
  });
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

    database
      .prepare(
        "INSERT INTO users (userId, email, passwordHash, passwordSalt, authTokenHash, authTokenSalt, authToken, createdAt, deviceIdsJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        user.userId,
        user.email,
        user.passwordHash,
        user.passwordSalt,
        user.authTokenHash ?? null,
        user.authTokenSalt ?? null,
        null,
        user.createdAt,
        JSON.stringify(user.deviceIds),
      );

    if (deviceId) {
      upsertStoredDevice(database, deviceId, user.userId, null);
    }
  });

  return { user, authToken };
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
    if (!user) throw new Error("account not found");
    if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      throw new Error("invalid password");
    }

    const nextDeviceIds = appendDeviceId(user.deviceIds, deviceId);
    user.deviceIds = nextDeviceIds;
    const authToken = issueStoredAuthToken(user);

    database
      .prepare("UPDATE users SET authTokenHash = ?, authTokenSalt = ?, authToken = NULL, deviceIdsJson = ? WHERE userId = ?")
      .run(
        user.authTokenHash ?? null,
        user.authTokenSalt ?? null,
        JSON.stringify(nextDeviceIds),
        user.userId,
      );

    if (deviceId) {
      upsertStoredDevice(database, deviceId, user.userId, null);
    }

    return { user, authToken };
  });
}

export function recordAnalyticsEventInStorage(payload, authToken) {
  if (!SQLITE_SUPPORTED) {
    const db = loadDbFromJsonFile();
    const result = recordAnalyticsEvent(db, payload, authToken);
    saveDbToJsonFile(db);
    return result;
  }
  return runInTransaction((database) => {
    const resolvedUser = authToken ? findStoredUserByToken(database, authToken) : null;
    const userId = resolvedUser?.userId || null;
    upsertStoredDevice(
      database,
      payload.deviceId,
      userId,
      payload.event === "extension_installed" ? Number(payload.ts || Date.now()) : null,
    );

    if (resolvedUser) {
      const nextDeviceIds = appendDeviceId(resolvedUser.deviceIds, payload.deviceId);
      if (nextDeviceIds.length !== resolvedUser.deviceIds.length) {
        database
          .prepare("UPDATE users SET deviceIdsJson = ? WHERE userId = ?")
          .run(JSON.stringify(nextDeviceIds), resolvedUser.userId);
      }
    }

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
        userId,
        payload.data == null ? null : JSON.stringify(payload.data),
        Date.now(),
      );
  });
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
  return `${Math.floor(100000 + Math.random() * 900000)}`;
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
  if (!user) throw new Error("account not found");
  if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    throw new Error("invalid password");
  }
  const authToken = issueStoredAuthToken(user);
  if (deviceId && !user.deviceIds.includes(deviceId)) user.deviceIds.push(deviceId);
  if (deviceId) ensureDevice(db, deviceId, user.userId);
  return { user, authToken };
}

export function recordAnalyticsEvent(db, payload, authToken) {
  const resolvedUser = findUserByToken(db, authToken);
  const userId = resolvedUser?.userId || null;
  const device = ensureDevice(db, payload.deviceId, userId);
  if (resolvedUser && !resolvedUser.deviceIds.includes(payload.deviceId)) {
    resolvedUser.deviceIds.push(payload.deviceId);
  }
  if (payload.event === "extension_installed" && !device.installedAt) {
    device.installedAt = payload.ts;
  }
  db.analytics_events.push({
    eventId: generateId("evt"),
    event: payload.event,
    ts: Number(payload.ts || Date.now()),
    eventDate: new Date(Number(payload.ts || Date.now())).toISOString().slice(0, 10),
    host: payload.host || null,
    duration: payload.duration ?? null,
    extensionVersion: payload.extensionVersion || null,
    deviceId: payload.deviceId,
    userId,
    data: payload.data || null,
    receivedAt: Date.now(),
  });
}
