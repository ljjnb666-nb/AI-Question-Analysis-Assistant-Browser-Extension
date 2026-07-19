function toDateKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function startOfDay(ts) {
  const date = new Date(ts);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function uniqueCount(items, key) {
  return new Set(items.map((item) => item[key]).filter(Boolean)).size;
}

function withinRange(ts, from, to) {
  return ts >= from && ts < to;
}

export function buildAnalyticsSummary(db, now = Date.now()) {
  const todayStart = startOfDay(now);
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;
  const monthStart = now - 30 * 24 * 60 * 60 * 1000;

  const todayEvents = db.analytics_events.filter((event) => withinRange(event.ts, todayStart, tomorrowStart));
  const weekEvents = db.analytics_events.filter((event) => event.ts >= weekStart);
  const monthEvents = db.analytics_events.filter((event) => event.ts >= monthStart);

  const activationEvents = db.analytics_events.filter((event) => ["settings_saved", "api_key_set", "parse_success"].includes(event.event));
  const todayActivations = activationEvents.filter((event) => withinRange(event.ts, todayStart, tomorrowStart));
  const firstSuccessToday = db.analytics_events.filter((event) => event.event === "parse_success" && withinRange(event.ts, todayStart, tomorrowStart));
  const installedToday = db.analytics_events.filter((event) => event.event === "extension_installed" && withinRange(event.ts, todayStart, tomorrowStart));
  const registeredToday = db.users.filter((user) => withinRange(user.createdAt, todayStart, tomorrowStart));

  return {
    generatedAt: new Date(now).toISOString(),
    daily: {
      dau: uniqueCount(todayEvents, "deviceId"),
      installs: uniqueCount(installedToday, "deviceId"),
      activations: uniqueCount(todayActivations, "deviceId"),
      firstSuccesses: uniqueCount(firstSuccessToday, "deviceId"),
      registrations: uniqueCount(registeredToday, "userId"),
    },
    rolling: {
      wau: uniqueCount(weekEvents, "deviceId"),
      mau: uniqueCount(monthEvents, "deviceId"),
    },
    totals: {
      devices: uniqueCount(db.devices, "deviceId"),
      registeredUsers: uniqueCount(db.users, "userId"),
      events: db.analytics_events.length,
    },
  };
}

export function buildTimeSeries(db, days = 14, now = Date.now()) {
  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const dayStart = startOfDay(now - offset * 24 * 60 * 60 * 1000);
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const events = db.analytics_events.filter((event) => withinRange(event.ts, dayStart, dayEnd));
    const activations = events.filter((event) => ["settings_saved", "api_key_set", "parse_success"].includes(event.event));
    const registrations = db.users.filter((user) => withinRange(user.createdAt, dayStart, dayEnd));
    series.push({
      date: toDateKey(dayStart),
      dau: uniqueCount(events, "deviceId"),
      installs: uniqueCount(events.filter((event) => event.event === "extension_installed"), "deviceId"),
      activations: uniqueCount(activations, "deviceId"),
      registrations: uniqueCount(registrations, "userId"),
    });
  }
  return series;
}
