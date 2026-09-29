// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createAnalyticsHandler } from "./server.mjs";
import { createAdminSessionStore } from "./admin-sessions.mjs";

function createReq({ method = "GET", url = "/", headers = {}, body = "", socket = { remoteAddress: "127.0.0.1" } } = {}) {
  const listeners = new Map();
  return {
    method,
    url,
    headers,
    socket,
    destroyed: false,
    on(event, listener) {
      listeners.set(event, listener);
    },
    destroy() {
      this.destroyed = true;
    },
    emitBody() {
      if (body) listeners.get("data")?.(body);
      listeners.get("end")?.();
    },
  };
}

function createRes() {
  return {
    statusCode: 0,
    headers: {},
    payload: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(payload) {
      this.payload = payload;
    },
  };
}

function parsePayload(res) {
  return JSON.parse(res.payload);
}

async function invoke(handler, options = {}) {
  const req = createReq(options);
  const res = createRes();
  const promise = handler(req, res);
  req.emitBody();
  await promise;
  return { req, res };
}

function createHandler(options = {}) {
  return createAnalyticsHandler({
    adminToken: "real-admin-secret",
    isMailerConfigured: () => false,
    loadDbImpl: () => ({ devices: [], users: [], analytics_events: [], email_verification_codes: [] }),
    sendVerificationCodeEmail: vi.fn(),
    ...options,
  });
}

function formBody(token) {
  return new URLSearchParams({ adminToken: token }).toString();
}

function sessionCookie(res) {
  return String(res.headers["Set-Cookie"] || "").split(";", 1)[0];
}

async function login(handler, token = "real-admin-secret") {
  return invoke(handler, {
    method: "POST",
    url: "/admin/login",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formBody(token),
  });
}

describe("analytics handler", () => {
  it("requires admin token for metrics endpoints", async () => {
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      isMailerConfigured: () => false,
      loadDbImpl: () => ({ devices: [], users: [], analytics_events: [], email_verification_codes: [] }),
      sendVerificationCodeEmail: vi.fn(),
    });

    const req = createReq({ method: "GET", url: "/analytics/summary" });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(401);
    expect(parsePayload(res).error).toMatch(/admin authorization required/i);
  });

  it("rejects oversized json bodies", async () => {
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      isMailerConfigured: () => false,
      loadDbImpl: () => ({ devices: [], users: [], analytics_events: [], email_verification_codes: [] }),
      sendVerificationCodeEmail: vi.fn(),
    });

    const hugeValue = "x".repeat(70 * 1024);
    const req = createReq({
      method: "POST",
      url: "/analytics/events",
      body: JSON.stringify({ deviceId: "dev-1", event: "parse_success", data: hugeValue }),
    });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(413);
    expect(parsePayload(res).error).toMatch(/request body exceeds/i);
  });

  it("P_REL_PRIV_20_CURRENT_CONSENT_VERSION_ACCEPTED persists only normalized analytics fields", async () => {
    const recordAnalyticsEventImpl = vi.fn();
    const handler = createHandler({ recordAnalyticsEventImpl });
    const { res } = await invoke(handler, {
      method: "POST",
      url: "/analytics/events",
      headers: { authorization: "Bearer account-secret" },
      body: JSON.stringify({
        deviceId: "dev-safe-123",
        analyticsConsentVersion: 1,
        event: "parse_success",
        ts: Date.now(),
        host: "sensitive-course.example.edu",
        userId: "account-id",
        duration: 125,
        data: {
          provider: "openai", route: "text", attempt: 2, source: "sidepanel_commit",
          questionText: "question-secret", answer: "answer-secret", blockId: "block-secret",
          apiKey: "api-secret", authToken: "account-secret", password: "password-secret",
          verificationCode: "123456", error: "raw-provider-error", nested: { value: "secret" },
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(recordAnalyticsEventImpl).toHaveBeenCalledTimes(1);
    expect(recordAnalyticsEventImpl).toHaveBeenCalledWith({
      deviceId: "dev-safe-123", event: "parse_success", ts: expect.any(Number), duration: 125,
      data: { provider: "openai", route: "text", attempt: 2, source: "sidepanel_commit" },
    });
    expect(recordAnalyticsEventImpl.mock.calls[0]).toHaveLength(1);
    expect(JSON.stringify(recordAnalyticsEventImpl.mock.calls[0])).not.toContain("sensitive-course.example.edu");
  });

  it("P_REL_PRIV_18_LEGACY_CLIENT_REJECTED without the explicit-consent protocol", async () => {
    const recordAnalyticsEventImpl = vi.fn();
    const handler = createHandler({ recordAnalyticsEventImpl });
    const { res } = await invoke(handler, {
      method: "POST",
      url: "/analytics/events",
      body: JSON.stringify({ deviceId: "legacy-device", event: "parse_success", ts: 123 }),
    });

    expect(res.statusCode).toBe(400);
    expect(recordAnalyticsEventImpl).not.toHaveBeenCalled();
  });

  it("P_REL_PRIV_19_STALE_CONSENT_VERSION_REJECTED including unsupported and malformed versions", async () => {
    const recordAnalyticsEventImpl = vi.fn();
    const handler = createHandler({ recordAnalyticsEventImpl });
    for (const analyticsConsentVersion of [0, 999, "1", 1.5, null]) {
      const { res } = await invoke(handler, {
        method: "POST",
        url: "/analytics/events",
        body: JSON.stringify({
          deviceId: "legacy-device", analyticsConsentVersion, event: "parse_success", ts: 123,
        }),
      });
      expect(res.statusCode).toBe(400);
    }
    expect(recordAnalyticsEventImpl).not.toHaveBeenCalled();
  });

  it("rejects unknown analytics event names", async () => {
    const recordAnalyticsEventImpl = vi.fn();
    const handler = createHandler({ recordAnalyticsEventImpl });
    const { res } = await invoke(handler, {
      method: "POST", url: "/analytics/events",
      body: JSON.stringify({ deviceId: "dev-safe-123", event: "unknown_event" }),
    });

    expect(res.statusCode).toBe(400);
    expect(recordAnalyticsEventImpl).not.toHaveBeenCalled();
  });

  it("rate limits repeated verification code sends", async () => {
    const db = { devices: [], users: [], analytics_events: [], email_verification_codes: [] };
    const sendVerificationCodeEmail = vi.fn().mockResolvedValue(undefined);
    const createEmailVerificationCodeImpl = vi.fn().mockReturnValue({
      code: "123456",
      expiresAt: Date.now() + 60_000,
    });
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      createEmailVerificationCodeImpl,
      isMailerConfigured: () => true,
      loadDbImpl: () => db,
      sendVerificationCodeEmail,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const req = createReq({
        method: "POST",
        url: "/auth/send-verification-code",
        body: JSON.stringify({ email: "user@example.com" }),
      });
      const res = createRes();
      const promise = handler(req, res);
      req.emitBody();
      await promise;
      expect(res.statusCode).toBe(200);
    }

    const req = createReq({
      method: "POST",
      url: "/auth/send-verification-code",
      body: JSON.stringify({ email: "user@example.com" }),
    });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(429);
    expect(sendVerificationCodeEmail).toHaveBeenCalledTimes(3);
    expect(createEmailVerificationCodeImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects browser requests from non-extension origins", async () => {
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      isMailerConfigured: () => true,
      sendVerificationCodeEmail: vi.fn(),
    });

    const req = createReq({
      method: "POST",
      url: "/analytics/events",
      headers: { origin: "https://example.com" },
      body: JSON.stringify({ deviceId: "dev-1", event: "parse_success" }),
    });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(403);
    expect(parsePayload(res).error).toMatch(/origin is not allowed/i);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("echoes extension origins in cors headers", async () => {
    const handler = createAnalyticsHandler({
      adminToken: "admin-token",
      isMailerConfigured: () => false,
      sendVerificationCodeEmail: vi.fn(),
    });

    const req = createReq({
      method: "GET",
      url: "/healthz",
      headers: { origin: "chrome-extension://abcdefghijklmnop" },
    });
    const res = createRes();
    const promise = handler(req, res);
    req.emitBody();
    await promise;

    expect(res.statusCode).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("chrome-extension://abcdefghijklmnop");
    expect(res.headers.Vary).toBe("Origin");
  });

  it("fails closed when admin configuration is missing across all protected routes", async () => {
    const loadDbImpl = vi.fn();
    const handler = createHandler({ adminToken: "", loadDbImpl });
    for (const url of ["/", "/admin/data", "/analytics/summary", "/analytics/timeseries"]) {
      const { res } = await invoke(handler, { url });
      expect(res.statusCode, url).toBe(503);
      expect(parsePayload(res).error).toBe("ADMIN_AUTH_NOT_CONFIGURED");
    }
    expect(loadDbImpl).not.toHaveBeenCalled();
  });

  it("renders a POST-only login gate without loading admin data", async () => {
    const loadDbImpl = vi.fn();
    const handler = createHandler({ loadDbImpl });
    const { res } = await invoke(handler, { url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('method="POST" action="/admin/login"');
    expect(res.payload).not.toContain('method="GET"');
    expect(loadDbImpl).not.toHaveBeenCalled();
  });

  it("rejects query-token authority and strips the legacy root query", async () => {
    const loadDbImpl = vi.fn(() => ({ devices: [], users: [], analytics_events: [], email_verification_codes: [] }));
    const handler = createHandler({ loadDbImpl });
    const data = await invoke(handler, { url: "/admin/data?adminToken=real-admin-secret" });
    expect(data.res.statusCode).toBe(401);
    expect(data.res.payload).not.toContain("real-admin-secret");

    const root = await invoke(handler, { url: "/?adminToken=real-admin-secret" });
    expect(root.res.statusCode).toBe(303);
    expect(root.res.headers.Location).toBe("/");
    expect(String(root.res.payload || "")).not.toContain("real-admin-secret");
    expect(loadDbImpl).not.toHaveBeenCalled();
  });

  it("rejects invalid admin login without a cookie or admin data load", async () => {
    const loadDbImpl = vi.fn();
    const handler = createHandler({ loadDbImpl });
    const { res } = await login(handler, "wrong-secret");
    expect(res.statusCode).toBe(401);
    expect(res.headers["Set-Cookie"]).toBeUndefined();
    expect(res.payload).not.toContain("wrong-secret");
    expect(loadDbImpl).not.toHaveBeenCalled();
  });

  it("exchanges the long-lived secret for a bounded strict, httpOnly session cookie", async () => {
    const handler = createHandler({ createAdminSessionToken: () => "short-session-credential" });
    const { res } = await login(handler);
    expect(res.statusCode).toBe(303);
    expect(res.headers.Location).toBe("/");
    const cookie = res.headers["Set-Cookie"];
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=28800");
    expect(cookie).not.toContain("real-admin-secret");
    expect(cookie).toContain("short-session-credential");

    vi.stubEnv("NODE_ENV", "production");
    try {
      const productionLogin = await login(createHandler());
      expect(productionLogin.res.headers["Set-Cookie"]).toContain("Secure");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("renders the dashboard for a session without embedding either credential", async () => {
    const handler = createHandler({ createAdminSessionToken: () => "short-session-credential" });
    const signedIn = await login(handler);
    const { res } = await invoke(handler, { url: "/", headers: { cookie: sessionCookie(signedIn.res) } });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatch(/插件使用状态面板/);
    expect(res.payload).not.toContain("real-admin-secret");
    expect(res.payload).not.toContain("short-session-credential");
    expect(res.payload).not.toContain("adminToken=");
    expect(res.payload).not.toContain("tokenQuery");
    expect(res.payload).toContain('fetch("/admin/data", { cache: "no-store" })');
  });

  it("authorizes admin data with the session cookie and rejects query credentials", async () => {
    const handler = createHandler();
    const signedIn = await login(handler);
    const authorized = await invoke(handler, { url: "/admin/data", headers: { cookie: sessionCookie(signedIn.res) } });
    expect(authorized.res.statusCode).toBe(200);
    expect(parsePayload(authorized.res).ok).toBe(true);

    const query = await invoke(handler, { url: "/analytics/summary?adminToken=real-admin-secret" });
    expect(query.res.statusCode).toBe(401);
  });

  it("expires sessions using the injected clock", async () => {
    let now = 1_000;
    const handler = createHandler({ nowImpl: () => now, adminSessionTtlMs: 500 });
    const signedIn = await login(handler);
    now += 501;
    const { res } = await invoke(handler, { url: "/admin/data", headers: { cookie: sessionCookie(signedIn.res) } });
    expect(res.statusCode).toBe(401);
  });

  it("retains explicit Bearer API access and rejects the same credential in a query", async () => {
    const handler = createHandler();
    const bearer = await invoke(handler, {
      url: "/analytics/summary",
      headers: { authorization: "Bearer real-admin-secret" },
    });
    expect(bearer.res.statusCode).toBe(200);
    const query = await invoke(handler, { url: "/analytics/summary?adminToken=real-admin-secret" });
    expect(query.res.statusCode).toBe(401);
  });

  it("rate limits repeated invalid admin login attempts", async () => {
    const handler = createHandler();
    let last;
    for (let attempt = 0; attempt < 11; attempt += 1) last = await login(handler, "wrong-secret");
    expect(last.res.statusCode).toBe(429);
    expect(last.res.headers["Set-Cookie"]).toBeUndefined();
  });

  it("P_REL_ADM_12_ADMIN_RATE_LIMIT_PROXY_SPOOF: shares one admin login bucket despite changing XFF", async () => {
    const createAdminSessionToken = vi.fn(() => "must-not-be-issued");
    const handler = createHandler({ createAdminSessionToken });
    let last;

    for (let attempt = 1; attempt <= 11; attempt += 1) {
      last = await invoke(handler, {
        method: "POST",
        url: "/admin/login",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-for": `1.1.1.${attempt}`,
          "x-real-ip": "203.0.113.50",
        },
        body: formBody("wrong-secret"),
        socket: { remoteAddress: "127.0.0.1" },
      });
      expect(last.res.statusCode).toBe(attempt === 11 ? 429 : 401);
      expect(last.res.headers["Set-Cookie"]).toBeUndefined();
    }

    expect(createAdminSessionToken).not.toHaveBeenCalled();
  });

  it("bounds session storage, evicts the oldest active session, and removes expired entries", () => {
    let now = 0;
    let sequence = 0;
    const sessions = createAdminSessionStore({
      createToken: () => `session-${++sequence}`,
      maxSessions: 2,
      now: () => now,
      ttlMs: 10,
    });
    const first = sessions.issue().token;
    const second = sessions.issue().token;
    now = 5;
    const third = sessions.issue().token;
    expect(sessions.size).toBe(2);
    expect(sessions.has(first)).toBe(false);
    expect(sessions.has(second)).toBe(true);
    now = 10;
    expect(sessions.has(second)).toBe(false);
    expect(sessions.size).toBe(1);
    expect(sessions.has(third)).toBe(true);
  });
});

describe("auth core endpoints", () => {
  const SESSION_USER = { userId: "usr-session-1", email: "session@example.com" };
  const SESSION_TOKEN = ["tok", "session"].join("_");

  it("AUTH_CORE_03_VALID_SESSION validates a matching bearer and userId", async () => {
    const validateUserSessionImpl = vi.fn(() => ({ user: SESSION_USER, expiresAt: 4102444800000 }));
    const handler = createHandler({ validateUserSessionImpl });
    const { res } = await invoke(handler, {
      method: "POST",
      url: "/auth/session",
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      body: JSON.stringify({ userId: SESSION_USER.userId }),
    });

    expect(res.statusCode).toBe(200);
    expect(parsePayload(res)).toEqual({
      ok: true,
      user: SESSION_USER,
      expiresAt: 4102444800000,
    });
    expect(validateUserSessionImpl).toHaveBeenCalledWith(SESSION_USER.userId, SESSION_TOKEN, expect.any(Number));
  });

  it("AUTH_CORE_04_FORGED_TOKEN and AUTH_CORE_05_USER_ID_MISMATCH share one stable 401 code", async () => {
    const validateUserSessionImpl = vi.fn(() => null);
    const handler = createHandler({ validateUserSessionImpl });

    const forged = await invoke(handler, {
      method: "POST",
      url: "/auth/session",
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      body: JSON.stringify({ userId: SESSION_USER.userId }),
    });
    const mismatched = await invoke(handler, {
      method: "POST",
      url: "/auth/session",
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      body: JSON.stringify({ userId: "usr-somebody-else" }),
    });
    const missingAuth = await invoke(handler, {
      method: "POST",
      url: "/auth/session",
      body: JSON.stringify({ userId: SESSION_USER.userId }),
    });

    for (const { res } of [forged, mismatched, missingAuth]) {
      expect(res.statusCode).toBe(401);
      expect(parsePayload(res)).toEqual({ ok: false, error: "AUTH_SESSION_INVALID" });
    }
    expect(validateUserSessionImpl).toHaveBeenCalledTimes(3);
  });

  it("AUTH_CORE_07_LOGOUT_REVOKES revokes the proven session and rejects userId-only revokes", async () => {
    const revokeUserSessionImpl = vi.fn(() => true);
    const handler = createHandler({ revokeUserSessionImpl });
    const { res } = await invoke(handler, {
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      body: JSON.stringify({ userId: SESSION_USER.userId }),
    });

    expect(res.statusCode).toBe(200);
    expect(parsePayload(res)).toEqual({ ok: true });
    expect(revokeUserSessionImpl).toHaveBeenCalledWith(SESSION_USER.userId, SESSION_TOKEN, expect.any(Number));

    const rejecting = createHandler({ revokeUserSessionImpl: vi.fn(() => false) });
    const rejected = await invoke(rejecting, {
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      body: JSON.stringify({ userId: SESSION_USER.userId }),
    });
    expect(rejected.res.statusCode).toBe(401);
    expect(parsePayload(rejected.res)).toEqual({ ok: false, error: "AUTH_SESSION_INVALID" });
  });

  it("AUTH_CORE_08_REVOKED_TOKEN fails session validation after a successful logout", async () => {
    const handler = createHandler({ revokeUserSessionImpl: vi.fn(() => true), validateUserSessionImpl: vi.fn(() => null) });
    const logout = await invoke(handler, {
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      body: JSON.stringify({ userId: SESSION_USER.userId }),
    });
    expect(logout.res.statusCode).toBe(200);

    const session = await invoke(handler, {
      method: "POST",
      url: "/auth/session",
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      body: JSON.stringify({ userId: SESSION_USER.userId }),
    });
    expect(session.res.statusCode).toBe(401);
    expect(parsePayload(session.res)).toEqual({ ok: false, error: "AUTH_SESSION_INVALID" });
  });

  it("AUTH_CORE_20_SECRET_RESPONSE never echoes internal failure material", async () => {
    const leakyMessage = ["sqlite", "SMTP_PASS=hunter2", SESSION_TOKEN, "password-hash-deadbeef"].join(" ");
    const handler = createHandler({
      validateUserSessionImpl: vi.fn(() => {
        throw new Error(leakyMessage);
      }),
    });
    const { res } = await invoke(handler, {
      method: "POST",
      url: "/auth/session",
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      body: JSON.stringify({ userId: SESSION_USER.userId }),
    });

    expect(res.statusCode).toBe(503);
    expect(parsePayload(res)).toEqual({ ok: false, error: "AUTH_SERVICE_UNAVAILABLE" });
    expect(res.payload).not.toContain("hunter2");
    expect(res.payload).not.toContain(SESSION_TOKEN);
    expect(res.payload).not.toContain("sqlite");

    const revokeHandler = createHandler({
      revokeUserSessionImpl: vi.fn(() => {
        throw new Error(leakyMessage);
      }),
    });
    const revoke = await invoke(revokeHandler, {
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      body: JSON.stringify({ userId: SESSION_USER.userId }),
    });
    expect(revoke.res.statusCode).toBe(503);
    expect(parsePayload(revoke.res)).toEqual({ ok: false, error: "AUTH_SERVICE_UNAVAILABLE" });
    expect(revoke.res.payload).not.toContain(SESSION_TOKEN);
  });

  it("rate limits session validation per client ip", async () => {
    const validateUserSessionImpl = vi.fn(() => ({ user: SESSION_USER, expiresAt: 4102444800000 }));
    const handler = createHandler({ validateUserSessionImpl });
    let last;
    for (let attempt = 0; attempt < 121; attempt += 1) {
      last = await invoke(handler, {
        method: "POST",
        url: "/auth/session",
        headers: { authorization: `Bearer ${SESSION_TOKEN}` },
        body: JSON.stringify({ userId: SESSION_USER.userId }),
      });
    }
    expect(last.res.statusCode).toBe(429);
    expect(validateUserSessionImpl).toHaveBeenCalledTimes(120);
  });
});
