import {
  ANALYTICS_EVENT_RETENTION_MS,
  CURRENT_ANALYTICS_PRIVACY_EPOCH,
  runAdminReadStorage,
} from "./store.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_USER_LIMIT = 50;
const MAX_USER_LIMIT = 100;
const MAX_QUERY_LENGTH = 120;
const MAX_CURSOR_LENGTH = 1024;
const MAX_USER_ID_LENGTH = 256;
const MAX_EMAIL_LENGTH = 320;
const MAX_DEVICE_ID_LENGTH = 256;
const MAX_DATE_MS = 8_640_000_000_000_000;
const USER_SEARCH_FUNCTION = "admin_management_contains";
const userSearchRegisteredDatabases = new WeakSet();

export class AdminManagementReadModelError extends Error {
  constructor(code = "ADMIN_STORAGE_UNAVAILABLE", statusCode = 503) {
    super(code);
    this.name = "AdminManagementReadModelError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function invalidQuery() {
  throw new AdminManagementReadModelError("INVALID_ADMIN_QUERY", 400);
}

function normalizeLimit(value) {
  if (value == null || value === "") return DEFAULT_USER_LIMIT;
  const raw = String(value);
  if (!/^\d+$/.test(raw)) invalidQuery();
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_USER_LIMIT) invalidQuery();
  return limit;
}

function hasAsciiControlCharacters(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function normalizeQuery(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.length > MAX_QUERY_LENGTH || hasAsciiControlCharacters(normalized)) invalidQuery();
  return normalized;
}

function validBoundedString(value, maxLength) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !hasAsciiControlCharacters(value);
}

function compareBinaryStrings(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function normalizeTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > MAX_DATE_MS) {
    throw new AdminManagementReadModelError();
  }
  return numeric;
}

function encodeCursor({ createdAt, userId, q }) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      createdAt,
      userId,
      q,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value, expectedQuery) {
  if (value == null || value === "") return null;
  const raw = String(value);
  if (
    raw.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(raw)
  ) {
    invalidQuery();
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    invalidQuery();
  }

  if (
    !parsed ||
    parsed.v !== 1 ||
    !validBoundedString(parsed.userId, MAX_USER_ID_LENGTH) ||
    !Number.isSafeInteger(parsed.createdAt) ||
    parsed.createdAt < 0 ||
    parsed.createdAt > MAX_DATE_MS ||
    !(
      parsed.q === null ||
      (
        typeof parsed.q === "string" &&
        parsed.q.length > 0 &&
        parsed.q.length <= MAX_QUERY_LENGTH &&
        !hasAsciiControlCharacters(parsed.q)
      )
    ) ||
    parsed.q !== expectedQuery
  ) {
    invalidQuery();
  }

  return {
    createdAt: parsed.createdAt,
    userId: parsed.userId,
    q: parsed.q,
  };
}

export function normalizeAdminUsersQuery({
  limit,
  cursor,
  q,
} = {}) {
  const normalizedQuery = normalizeQuery(q);
  return {
    limit: normalizeLimit(limit),
    q: normalizedQuery,
    cursor: decodeCursor(cursor, normalizedQuery),
  };
}

function ensureSearchFunction(database) {
  if (userSearchRegisteredDatabases.has(database)) return;
  database.function(
    USER_SEARCH_FUNCTION,
    { deterministic: true },
    (value, query) => {
      if (typeof value !== "string" || typeof query !== "string") return 0;
      return value.toLowerCase().includes(query.toLowerCase()) ? 1 : 0;
    },
  );
  userSearchRegisteredDatabases.add(database);
}

function toUserItem(row) {
  if (
    !validBoundedString(row?.userId, MAX_USER_ID_LENGTH) ||
    !validBoundedString(row?.email, MAX_EMAIL_LENGTH)
  ) {
    throw new AdminManagementReadModelError();
  }

  const createdAt = normalizeTimestamp(row.createdAt);
  const linkedDeviceCount = Number(row.linkedDeviceCount);
  const invalidDeviceCount = Number(row.invalidDeviceCount ?? 0);
  if (
    !Number.isSafeInteger(linkedDeviceCount) ||
    linkedDeviceCount < 0 ||
    !Number.isSafeInteger(invalidDeviceCount) ||
    invalidDeviceCount !== 0
  ) {
    throw new AdminManagementReadModelError();
  }

  let latestDeviceSeenAt = null;
  if (row.latestDeviceSeenAt != null) {
    latestDeviceSeenAt = new Date(normalizeTimestamp(row.latestDeviceSeenAt)).toISOString();
  }

  return {
    userId: row.userId,
    email: row.email,
    createdAt: new Date(createdAt).toISOString(),
    linkedDeviceCount,
    latestDeviceSeenAt,
  };
}

function buildUsersResponse(rows, query, now) {
  const hasMore = rows.length > query.limit;
  const visibleRows = rows.slice(0, query.limit);
  const data = visibleRows.map(toUserItem);
  const lastRow = visibleRows.at(-1);
  const nextCursor =
    hasMore && lastRow
      ? encodeCursor({
          createdAt: normalizeTimestamp(lastRow.createdAt),
          userId: lastRow.userId,
          q: query.q,
        })
      : null;

  return {
    generatedAt: new Date(normalizeTimestamp(now)).toISOString(),
    data,
    page: {
      limit: query.limit,
      nextCursor,
    },
    query: {
      q: query.q,
    },
  };
}

function querySqliteUsers(database, query, now) {
  if (query.q) ensureSearchFunction(database);

  const where = [];
  const params = [];

  if (query.q) {
    where.push(
      `(${USER_SEARCH_FUNCTION}(u.email, ?) = 1 OR ${USER_SEARCH_FUNCTION}(u.userId, ?) = 1)`,
    );
    params.push(query.q, query.q);
  }

  if (query.cursor) {
    where.push("(u.createdAt < ? OR (u.createdAt = ? AND u.userId < ?))");
    params.push(
      query.cursor.createdAt,
      query.cursor.createdAt,
      query.cursor.userId,
    );
  }

  const sql = `
    WITH page_users AS (
      SELECT
        u.userId AS userId,
        u.email AS email,
        u.createdAt AS createdAt
      FROM users u
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY u.createdAt DESC, u.userId DESC
      LIMIT ?
    )
    SELECT
      p.userId AS userId,
      p.email AS email,
      p.createdAt AS createdAt,
      COUNT(d.deviceId) AS linkedDeviceCount,
      MAX(d.lastSeenAt) AS latestDeviceSeenAt,
      SUM(
        CASE
          WHEN d.deviceId IS NOT NULL
            AND (length(d.deviceId) < 1 OR length(d.deviceId) > 256)
          THEN 1
          ELSE 0
        END
      ) AS invalidDeviceCount
    FROM page_users p
    LEFT JOIN devices d ON d.userId = p.userId
    GROUP BY p.userId, p.email, p.createdAt
    ORDER BY p.createdAt DESC, p.userId DESC
  `;

  const rows = database.prepare(sql).all(...params, query.limit + 1);
  return buildUsersResponse(rows, query, now);
}

function compareUsers(left, right) {
  const leftCreatedAt = normalizeTimestamp(left.createdAt);
  const rightCreatedAt = normalizeTimestamp(right.createdAt);
  if (leftCreatedAt !== rightCreatedAt) return rightCreatedAt - leftCreatedAt;
  return -compareBinaryStrings(left.userId, right.userId);
}

function matchesCursor(user, cursor) {
  if (!cursor) return true;
  const createdAt = normalizeTimestamp(user.createdAt);
  if (createdAt < cursor.createdAt) return true;
  if (createdAt > cursor.createdAt) return false;
  return compareBinaryStrings(user.userId, cursor.userId) < 0;
}

function queryJsonUsers(db, query, now) {
  const users = Array.isArray(db?.users) ? db.users : [];
  const filtered = [];

  for (const user of users) {
    if (
      !validBoundedString(user?.userId, MAX_USER_ID_LENGTH) ||
      !validBoundedString(user?.email, MAX_EMAIL_LENGTH)
    ) {
      throw new AdminManagementReadModelError();
    }
    normalizeTimestamp(user.createdAt);

    if (
      query.q &&
      !user.email.toLowerCase().includes(query.q) &&
      !user.userId.toLowerCase().includes(query.q)
    ) {
      continue;
    }
    if (!matchesCursor(user, query.cursor)) continue;
    filtered.push(user);
  }

  filtered.sort(compareUsers);
  const pageUsers = filtered.slice(0, query.limit + 1);
  const pageIds = new Set(pageUsers.map((user) => user.userId));
  const devicesByUser = new Map();
  const seenDeviceIds = new Map();
  const devices = Array.isArray(db?.devices) ? db.devices : [];

  for (const device of devices) {
    if (!pageIds.has(device?.userId)) continue;
    if (!validBoundedString(device?.deviceId, MAX_DEVICE_ID_LENGTH)) {
      throw new AdminManagementReadModelError();
    }
    const lastSeenAt = normalizeTimestamp(device.lastSeenAt);
    const existingOwner = seenDeviceIds.get(device.deviceId);
    if (existingOwner && existingOwner !== device.userId) {
      throw new AdminManagementReadModelError();
    }
    seenDeviceIds.set(device.deviceId, device.userId);

    const state = devicesByUser.get(device.userId) || {
      ids: new Set(),
      latestDeviceSeenAt: null,
    };
    state.ids.add(device.deviceId);
    state.latestDeviceSeenAt =
      state.latestDeviceSeenAt == null
        ? lastSeenAt
        : Math.max(state.latestDeviceSeenAt, lastSeenAt);
    devicesByUser.set(device.userId, state);
  }

  const rows = pageUsers.map((user) => {
    const deviceState = devicesByUser.get(user.userId);
    return {
      userId: user.userId,
      email: user.email,
      createdAt: user.createdAt,
      linkedDeviceCount: deviceState?.ids.size || 0,
      latestDeviceSeenAt: deviceState?.latestDeviceSeenAt ?? null,
    };
  });

  return buildUsersResponse(rows, query, now);
}

function readUsers(query, now) {
  try {
    return runAdminReadStorage({
      sqlite: (database) => querySqliteUsers(database, query, now),
      json: (db) => queryJsonUsers(db, query, now),
    });
  } catch (error) {
    if (error instanceof AdminManagementReadModelError) throw error;
    throw new AdminManagementReadModelError();
  }
}

function readSystemStorageState() {
  try {
    return runAdminReadStorage({
      sqlite: (database) => {
        const row = database
          .prepare("SELECT value FROM analytics_metadata WHERE key = ?")
          .get("analyticsPrivacyEpoch");
        return {
          driver: "sqlite",
          privacyEpoch: Number(row?.value),
        };
      },
      json: (db) => ({
        driver: "json",
        privacyEpoch: Number(db?.analyticsPrivacyEpoch),
      }),
    });
  } catch {
    throw new AdminManagementReadModelError();
  }
}

function normalizeUptime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new AdminManagementReadModelError("ADMIN_INTERNAL_ERROR", 500);
  }
  return Math.floor(numeric);
}

export function createAdminManagementReadModels({
  now = () => Date.now(),
  uptime = () => process.uptime(),
  isMailerConfigured,
} = {}) {
  if (typeof isMailerConfigured !== "function") {
    throw new TypeError("isMailerConfigured is required");
  }

  return {
    users(query = normalizeAdminUsersQuery()) {
      const current = now();
      normalizeTimestamp(current);
      return readUsers(query, current);
    },

    system() {
      const current = now();
      normalizeTimestamp(current);
      const storage = readSystemStorageState();
      if (
        storage.privacyEpoch !== CURRENT_ANALYTICS_PRIVACY_EPOCH ||
        (storage.driver !== "sqlite" && storage.driver !== "json")
      ) {
        throw new AdminManagementReadModelError();
      }

      let mailerConfigured;
      try {
        mailerConfigured = Boolean(isMailerConfigured());
      } catch {
        throw new AdminManagementReadModelError("ADMIN_INTERNAL_ERROR", 500);
      }

      return {
        generatedAt: new Date(current).toISOString(),
        service: {
          status: "ok",
          uptimeSeconds: normalizeUptime(uptime()),
        },
        storage: {
          driver: storage.driver,
        },
        email: {
          configured: mailerConfigured,
        },
        deployment: {
          authority: "single_process",
        },
        analytics: {
          retentionDays: Math.floor(ANALYTICS_EVENT_RETENTION_MS / DAY_MS),
          privacyEpoch: storage.privacyEpoch,
        },
      };
    },
  };
}

export const ADMIN_USERS_DEFAULT_LIMIT = DEFAULT_USER_LIMIT;
export const ADMIN_USERS_MAX_LIMIT = MAX_USER_LIMIT;
export const ADMIN_USERS_MAX_QUERY_LENGTH = MAX_QUERY_LENGTH;
