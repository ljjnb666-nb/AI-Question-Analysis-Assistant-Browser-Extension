import { ANALYTICS_EVENT_RETENTION_MS, runAdminReadStorage } from "./store.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 14;
const MAX_DAYS = Math.floor(ANALYTICS_EVENT_RETENTION_MS / DAY_MS);
const PROVIDERS = new Set([
  "anthropic",
  "openai",
  "deepseek",
  "gemini",
  "qwen",
  "moonshot",
  "zhipu",
  "minimax",
  "ollama",
  "custom",
]);
const ERROR_CATEGORIES = new Set([
  "timeout",
  "network",
  "http_4xx",
  "http_5xx",
  "media_unavailable",
  "unsupported",
  "unknown",
]);
const VERSION_PATTERN = /^\d+(?:\.\d+){1,3}(?:[-+][\w.-]{1,16})?$/;
const VERSION_ROW_LIMIT = 100;
const VERSION_TEXT_LIMIT = 64;

export class AdminReadModelError extends Error {
  constructor(code = "ADMIN_STORAGE_UNAVAILABLE", statusCode = 503) {
    super(code);
    this.name = "AdminReadModelError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function startOfUtcDay(ts) {
  const date = new Date(ts);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function dateKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

export function normalizeAdminAnalyticsDays(value, fallback = DEFAULT_DAYS) {
  if (value == null || value === "") return fallback;
  const raw = String(value);
  if (!/^\d+$/.test(raw)) return null;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return null;
  return days;
}

function buildWindow(days, now) {
  const todayStart = startOfUtcDay(now);
  return {
    days,
    from: todayStart - (days - 1) * DAY_MS,
    toExclusive: now + 1,
    todayStart,
  };
}

function ensureFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function safeEventData(event) {
  return event?.data && typeof event.data === "object" && !Array.isArray(event.data) ? event.data : {};
}

function normalizeProvider(value) {
  return PROVIDERS.has(value) ? value : null;
}

function normalizeErrorCategory(value) {
  return ERROR_CATEGORIES.has(value) ? value : "unknown";
}

function normalizeVersion(value) {
  return typeof value === "string" &&
    value.length <= VERSION_TEXT_LIMIT &&
    VERSION_PATTERN.test(value)
    ? value
    : null;
}

function observedDuration(event) {
  const direct = Number(event?.duration);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const nested = Number(safeEventData(event).duration);
  return Number.isFinite(nested) && nested >= 0 ? nested : null;
}

function inRange(ts, from, toExclusive) {
  const numeric = Number(ts);
  return Number.isFinite(numeric) && numeric >= from && numeric < toExclusive;
}

function groupByDate(rows, days, now, registrationsByDate = new Map()) {
  const todayStart = startOfUtcDay(now);
  const map = new Map(rows.map((row) => [row.date, row]));
  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = dateKey(todayStart - offset * DAY_MS);
    const row = map.get(date) || {};
    const parseSuccesses = ensureFiniteNumber(row.parseSuccesses);
    const parseErrors = ensureFiniteNumber(row.parseErrors);
    const total = parseSuccesses + parseErrors;
    series.push({
      date,
      optInDau: ensureFiniteNumber(row.optInDau),
      observedInstallDevices: ensureFiniteNumber(row.observedInstallDevices),
      parseSuccesses,
      parseErrors,
      parseOutcomeSuccessRatio: ratio(parseSuccesses, total),
      registrations: ensureFiniteNumber(registrationsByDate.get(date)),
    });
  }
  return series;
}

function querySqliteOverview(database, days, now) {
  const window = buildWindow(days, now);
  const todayTo = now + 1;
  const weekFrom = now - 7 * DAY_MS;
  const monthFrom = now - 30 * DAY_MS;

  const activity = database
    .prepare(
      `SELECT
         COUNT(DISTINCT CASE WHEN ts >= ? AND ts < ? THEN deviceId END) AS dau,
         COUNT(DISTINCT CASE WHEN ts >= ? AND ts < ? THEN deviceId END) AS wau,
         COUNT(DISTINCT CASE WHEN ts >= ? AND ts < ? THEN deviceId END) AS mau
       FROM analytics_events`,
    )
    .get(window.todayStart, todayTo, weekFrom, todayTo, monthFrom, todayTo);

  const todayObserved = database
    .prepare(
      `SELECT
         COUNT(DISTINCT CASE WHEN event = 'extension_installed' THEN deviceId END) AS installDevices,
         COUNT(DISTINCT CASE WHEN event IN ('parse_success','parse_error') THEN deviceId END) AS parseOutcomeDevices,
         SUM(CASE WHEN event = 'parse_success' THEN 1 ELSE 0 END) AS parseSuccesses,
         SUM(CASE WHEN event = 'parse_error' THEN 1 ELSE 0 END) AS parseErrors
       FROM analytics_events
       WHERE ts >= ? AND ts < ?`,
    )
    .get(window.todayStart, todayTo);

  const latency = database
    .prepare(
      `SELECT
         COUNT(*) AS samples,
         AVG(
           COALESCE(
             duration,
             CASE WHEN json_valid(dataJson) THEN json_extract(dataJson, '$.duration') END
           )
         ) AS averageMs
       FROM analytics_events
       WHERE event IN ('parse_success','parse_error')
         AND ts >= ? AND ts < ?
         AND COALESCE(
           duration,
           CASE WHEN json_valid(dataJson) THEN json_extract(dataJson, '$.duration') END
         ) IS NOT NULL`,
    )
    .get(window.from, window.toExclusive);

  const accounts = database
    .prepare(
      `SELECT
         COUNT(*) AS registeredUsers,
         SUM(CASE WHEN createdAt >= ? AND createdAt < ? THEN 1 ELSE 0 END) AS registrationsToday
       FROM users`,
    )
    .get(window.todayStart, todayTo);

  const parseSuccesses = ensureFiniteNumber(todayObserved?.parseSuccesses);
  const parseErrors = ensureFiniteNumber(todayObserved?.parseErrors);

  return {
    generatedAt: new Date(now).toISOString(),
    analyticsScope: "opt_in_only",
    accountScope: "all_registered_accounts",
    window: {
      days,
      from: new Date(window.from).toISOString(),
      to: new Date(now).toISOString(),
      retentionDays: MAX_DAYS,
    },
    activity: {
      dau: ensureFiniteNumber(activity?.dau),
      wau: ensureFiniteNumber(activity?.wau),
      mau: ensureFiniteNumber(activity?.mau),
    },
    accounts: {
      registeredUsers: ensureFiniteNumber(accounts?.registeredUsers),
      registrationsToday: ensureFiniteNumber(accounts?.registrationsToday),
    },
    observed: {
      installDevicesToday: ensureFiniteNumber(todayObserved?.installDevices),
      parseOutcomeDevicesToday: ensureFiniteNumber(todayObserved?.parseOutcomeDevices),
      parseOutcomesToday: {
        success: parseSuccesses,
        error: parseErrors,
        total: parseSuccesses + parseErrors,
        successRatio: ratio(parseSuccesses, parseSuccesses + parseErrors),
      },
      parseOutcomeLatencyWindowMs: {
        samples: ensureFiniteNumber(latency?.samples),
        average: latency?.averageMs == null ? null : Number(latency.averageMs),
      },
    },
  };
}

function queryJsonOverview(db, days, now) {
  const window = buildWindow(days, now);
  const todayEvents = db.analytics_events.filter((event) => inRange(event.ts, window.todayStart, now + 1));
  const weekEvents = db.analytics_events.filter((event) => inRange(event.ts, now - 7 * DAY_MS, now + 1));
  const monthEvents = db.analytics_events.filter((event) => inRange(event.ts, now - 30 * DAY_MS, now + 1));
  const windowEvents = db.analytics_events.filter((event) => inRange(event.ts, window.from, window.toExclusive));
  const parseSuccesses = todayEvents.filter((event) => event.event === "parse_success").length;
  const parseErrors = todayEvents.filter((event) => event.event === "parse_error").length;
  const durations = windowEvents
    .filter((event) => event.event === "parse_success" || event.event === "parse_error")
    .map(observedDuration)
    .filter((value) => value != null);

  const unique = (events) => new Set(events.map((event) => event.deviceId).filter(Boolean)).size;
  const users = Array.isArray(db.users) ? db.users : [];

  return {
    generatedAt: new Date(now).toISOString(),
    analyticsScope: "opt_in_only",
    accountScope: "all_registered_accounts",
    window: {
      days,
      from: new Date(window.from).toISOString(),
      to: new Date(now).toISOString(),
      retentionDays: MAX_DAYS,
    },
    activity: {
      dau: unique(todayEvents),
      wau: unique(weekEvents),
      mau: unique(monthEvents),
    },
    accounts: {
      registeredUsers: new Set(users.map((user) => user.userId).filter(Boolean)).size,
      registrationsToday: users.filter((user) => inRange(user.createdAt, window.todayStart, now + 1)).length,
    },
    observed: {
      installDevicesToday: unique(todayEvents.filter((event) => event.event === "extension_installed")),
      parseOutcomeDevicesToday: unique(
        todayEvents.filter((event) => event.event === "parse_success" || event.event === "parse_error"),
      ),
      parseOutcomesToday: {
        success: parseSuccesses,
        error: parseErrors,
        total: parseSuccesses + parseErrors,
        successRatio: ratio(parseSuccesses, parseSuccesses + parseErrors),
      },
      parseOutcomeLatencyWindowMs: {
        samples: durations.length,
        average: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
      },
    },
  };
}

function querySqliteTimeseries(database, days, now) {
  const window = buildWindow(days, now);
  const eventRows = database
    .prepare(
      `SELECT
         eventDate AS date,
         COUNT(DISTINCT deviceId) AS optInDau,
         COUNT(DISTINCT CASE WHEN event = 'extension_installed' THEN deviceId END) AS observedInstallDevices,
         SUM(CASE WHEN event = 'parse_success' THEN 1 ELSE 0 END) AS parseSuccesses,
         SUM(CASE WHEN event = 'parse_error' THEN 1 ELSE 0 END) AS parseErrors
       FROM analytics_events
       WHERE ts >= ? AND ts < ?
       GROUP BY eventDate
       ORDER BY eventDate ASC`,
    )
    .all(window.from, window.toExclusive);

  const registrationRows = database
    .prepare(
      `SELECT
         strftime('%Y-%m-%d', createdAt / 1000, 'unixepoch') AS date,
         COUNT(*) AS registrations
       FROM users
       WHERE createdAt >= ? AND createdAt < ?
       GROUP BY date
       ORDER BY date ASC`,
    )
    .all(window.from, window.toExclusive);
  const registrations = new Map(
    registrationRows.map((row) => [row.date, ensureFiniteNumber(row.registrations)]),
  );
  return groupByDate(eventRows, days, now, registrations);
}

function queryJsonTimeseries(db, days, now) {
  const window = buildWindow(days, now);
  const byDate = new Map();
  for (const event of db.analytics_events) {
    if (!inRange(event.ts, window.from, window.toExclusive)) continue;
    const date = dateKey(event.ts);
    const row = byDate.get(date) || {
      date,
      devices: new Set(),
      installs: new Set(),
      parseSuccesses: 0,
      parseErrors: 0,
    };
    if (event.deviceId) row.devices.add(event.deviceId);
    if (event.event === "extension_installed" && event.deviceId) row.installs.add(event.deviceId);
    if (event.event === "parse_success") row.parseSuccesses += 1;
    if (event.event === "parse_error") row.parseErrors += 1;
    byDate.set(date, row);
  }
  const registrationMap = new Map();
  for (const user of db.users || []) {
    if (!inRange(user.createdAt, window.from, window.toExclusive)) continue;
    const date = dateKey(user.createdAt);
    registrationMap.set(date, (registrationMap.get(date) || 0) + 1);
  }
  const rows = [...byDate.values()].map((row) => ({
    date: row.date,
    optInDau: row.devices.size,
    observedInstallDevices: row.installs.size,
    parseSuccesses: row.parseSuccesses,
    parseErrors: row.parseErrors,
  }));
  return groupByDate(rows, days, now, registrationMap);
}

function querySqliteProviders(database, days, now) {
  const window = buildWindow(days, now);
  const rows = database
    .prepare(
      `SELECT
         CASE WHEN json_valid(dataJson) THEN json_extract(dataJson, '$.provider') END AS provider,
         SUM(CASE WHEN event = 'parse_success' THEN 1 ELSE 0 END) AS success,
         SUM(CASE WHEN event = 'parse_error' THEN 1 ELSE 0 END) AS error
       FROM analytics_events
       WHERE event IN ('parse_success','parse_error')
         AND ts >= ? AND ts < ?
       GROUP BY provider
       ORDER BY (success + error) DESC, provider ASC`,
    )
    .all(window.from, window.toExclusive);
  return rows
    .map((row) => ({
      provider: normalizeProvider(row.provider),
      success: ensureFiniteNumber(row.success),
      error: ensureFiniteNumber(row.error),
    }))
    .filter((row) => row.provider)
    .map((row) => ({
      ...row,
      outcomes: row.success + row.error,
      successRatio: ratio(row.success, row.success + row.error),
    }));
}

function queryJsonProviders(db, days, now) {
  const window = buildWindow(days, now);
  const grouped = new Map();
  for (const event of db.analytics_events) {
    if (!inRange(event.ts, window.from, window.toExclusive)) continue;
    if (event.event !== "parse_success" && event.event !== "parse_error") continue;
    const provider = normalizeProvider(safeEventData(event).provider);
    if (!provider) continue;
    const row = grouped.get(provider) || { provider, success: 0, error: 0 };
    row[event.event === "parse_success" ? "success" : "error"] += 1;
    grouped.set(provider, row);
  }
  return [...grouped.values()]
    .map((row) => ({
      ...row,
      outcomes: row.success + row.error,
      successRatio: ratio(row.success, row.success + row.error),
    }))
    .sort((a, b) => b.outcomes - a.outcomes || a.provider.localeCompare(b.provider));
}

function querySqliteErrors(database, days, now) {
  const window = buildWindow(days, now);
  const rows = database
    .prepare(
      `SELECT
         COALESCE(
           CASE WHEN json_valid(dataJson) THEN json_extract(dataJson, '$.category') END,
           'unknown'
         ) AS category,
         COUNT(*) AS count,
         SUM(
           CASE
             WHEN json_valid(dataJson) AND json_extract(dataJson, '$.exhausted') = 1 THEN 1
             ELSE 0
           END
         ) AS exhaustedCount
       FROM analytics_events
       WHERE event = 'parse_error'
         AND ts >= ? AND ts < ?
       GROUP BY category
       ORDER BY count DESC, category ASC`,
    )
    .all(window.from, window.toExclusive);
  const grouped = new Map();
  for (const row of rows) {
    const category = normalizeErrorCategory(row.category);
    const existing = grouped.get(category) || { category, count: 0, exhaustedCount: 0 };
    existing.count += ensureFiniteNumber(row.count);
    existing.exhaustedCount += ensureFiniteNumber(row.exhaustedCount);
    grouped.set(category, existing);
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

function queryJsonErrors(db, days, now) {
  const window = buildWindow(days, now);
  const grouped = new Map();
  for (const event of db.analytics_events) {
    if (event.event !== "parse_error" || !inRange(event.ts, window.from, window.toExclusive)) continue;
    const data = safeEventData(event);
    const category = normalizeErrorCategory(data.category);
    const row = grouped.get(category) || { category, count: 0, exhaustedCount: 0 };
    row.count += 1;
    if (data.exhausted === true) row.exhaustedCount += 1;
    grouped.set(category, row);
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

function querySqliteVersions(database, days, now) {
  const window = buildWindow(days, now);
  const rows = database
    .prepare(
      `WITH ranked AS (
         SELECT
           deviceId,
           extensionVersion,
           ROW_NUMBER() OVER (
             PARTITION BY deviceId
             ORDER BY ts DESC, receivedAt DESC, eventId DESC
           ) AS rank
         FROM analytics_events
         WHERE ts >= ? AND ts < ?
           AND extensionVersion IS NOT NULL
       )
       SELECT extensionVersion, COUNT(*) AS devices
       FROM ranked
       WHERE rank = 1
       GROUP BY extensionVersion
       ORDER BY devices DESC, extensionVersion ASC
       LIMIT ${VERSION_ROW_LIMIT}`,
    )
    .all(window.from, window.toExclusive);
  return rows
    .map((row) => ({ extensionVersion: normalizeVersion(row.extensionVersion), devices: ensureFiniteNumber(row.devices) }))
    .filter((row) => row.extensionVersion);
}

function queryJsonVersions(db, days, now) {
  const window = buildWindow(days, now);
  const latestByDevice = new Map();
  for (const event of db.analytics_events) {
    if (!event.deviceId || !inRange(event.ts, window.from, window.toExclusive)) continue;
    const version = normalizeVersion(event.extensionVersion);
    if (!version) continue;
    const current = latestByDevice.get(event.deviceId);
    const ts = ensureFiniteNumber(event.ts);
    const receivedAt = ensureFiniteNumber(event.receivedAt);
    if (!current || ts > current.ts || (ts === current.ts && receivedAt > current.receivedAt)) {
      latestByDevice.set(event.deviceId, { version, ts, receivedAt });
    }
  }
  const counts = new Map();
  for (const { version } of latestByDevice.values()) {
    counts.set(version, (counts.get(version) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([extensionVersion, devices]) => ({ extensionVersion, devices }))
    .sort((a, b) => b.devices - a.devices || a.extensionVersion.localeCompare(b.extensionVersion))
    .slice(0, VERSION_ROW_LIMIT);
}

function querySqliteLatency(database, days, now) {
  const window = buildWindow(days, now);
  const rows = database
    .prepare(
      `SELECT
         eventDate AS date,
         COUNT(*) AS samples,
         AVG(
           COALESCE(
             duration,
             CASE WHEN json_valid(dataJson) THEN json_extract(dataJson, '$.duration') END
           )
         ) AS averageMs
       FROM analytics_events
       WHERE event IN ('parse_success','parse_error')
         AND ts >= ? AND ts < ?
         AND COALESCE(
           duration,
           CASE WHEN json_valid(dataJson) THEN json_extract(dataJson, '$.duration') END
         ) IS NOT NULL
       GROUP BY eventDate
       ORDER BY eventDate ASC`,
    )
    .all(window.from, window.toExclusive);
  const map = new Map(rows.map((row) => [row.date, row]));
  const todayStart = startOfUtcDay(now);
  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = dateKey(todayStart - offset * DAY_MS);
    const row = map.get(date);
    series.push({
      date,
      samples: ensureFiniteNumber(row?.samples),
      averageMs: row?.averageMs == null ? null : Number(row.averageMs),
    });
  }
  return series;
}

function queryJsonLatency(db, days, now) {
  const window = buildWindow(days, now);
  const grouped = new Map();
  for (const event of db.analytics_events) {
    if (!inRange(event.ts, window.from, window.toExclusive)) continue;
    if (event.event !== "parse_success" && event.event !== "parse_error") continue;
    const duration = observedDuration(event);
    if (duration == null) continue;
    const date = dateKey(event.ts);
    const row = grouped.get(date) || { sum: 0, samples: 0 };
    row.sum += duration;
    row.samples += 1;
    grouped.set(date, row);
  }
  const todayStart = startOfUtcDay(now);
  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = dateKey(todayStart - offset * DAY_MS);
    const row = grouped.get(date);
    series.push({
      date,
      samples: row?.samples || 0,
      averageMs: row?.samples ? row.sum / row.samples : null,
    });
  }
  return series;
}

function readWithFallback(sqlite, json) {
  try {
    return runAdminReadStorage({ sqlite, json });
  } catch {
    throw new AdminReadModelError();
  }
}

function analyticsEnvelope(kind, days, now, data) {
  const window = buildWindow(days, now);
  const metric = {
    timeseries: "observed_activity_and_parse_outcomes",
    providers: "observed_parse_outcomes_by_provider",
    errors: "observed_parse_errors_by_category",
    versions: "latest_observed_version_per_opt_in_device",
    latency: "observed_parse_outcome_duration_ms",
  }[kind];
  return {
    kind,
    metric,
    generatedAt: new Date(now).toISOString(),
    analyticsScope: "opt_in_only",
    ...(kind === "timeseries" ? { accountScope: "all_registered_accounts" } : {}),
    window: {
      days,
      from: new Date(window.from).toISOString(),
      to: new Date(now).toISOString(),
      retentionDays: MAX_DAYS,
    },
    data,
  };
}

export function createAdminAnalyticsReadModels({ now = () => Date.now() } = {}) {
  return {
    overview(days = DEFAULT_DAYS) {
      const current = now();
      return readWithFallback(
        (database) => querySqliteOverview(database, days, current),
        (db) => queryJsonOverview(db, days, current),
      );
    },
    timeseries(days = DEFAULT_DAYS) {
      const current = now();
      return analyticsEnvelope(
        "timeseries",
        days,
        current,
        readWithFallback(
          (database) => querySqliteTimeseries(database, days, current),
          (db) => queryJsonTimeseries(db, days, current),
        ),
      );
    },
    providers(days = DEFAULT_DAYS) {
      const current = now();
      return analyticsEnvelope(
        "providers",
        days,
        current,
        readWithFallback(
          (database) => querySqliteProviders(database, days, current),
          (db) => queryJsonProviders(db, days, current),
        ),
      );
    },
    errors(days = DEFAULT_DAYS) {
      const current = now();
      return analyticsEnvelope(
        "errors",
        days,
        current,
        readWithFallback(
          (database) => querySqliteErrors(database, days, current),
          (db) => queryJsonErrors(db, days, current),
        ),
      );
    },
    versions(days = DEFAULT_DAYS) {
      const current = now();
      return analyticsEnvelope(
        "versions",
        days,
        current,
        readWithFallback(
          (database) => querySqliteVersions(database, days, current),
          (db) => queryJsonVersions(db, days, current),
        ),
      );
    },
    latency(days = DEFAULT_DAYS) {
      const current = now();
      return analyticsEnvelope(
        "latency",
        days,
        current,
        readWithFallback(
          (database) => querySqliteLatency(database, days, current),
          (db) => queryJsonLatency(db, days, current),
        ),
      );
    },
  };
}

export const ADMIN_ANALYTICS_DEFAULT_DAYS = DEFAULT_DAYS;
export const ADMIN_ANALYTICS_MAX_DAYS = MAX_DAYS;
