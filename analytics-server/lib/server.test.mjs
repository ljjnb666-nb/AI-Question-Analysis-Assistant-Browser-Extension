// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAnalyticsHandler } from "./server.mjs";
import { createAdminSessionStore } from "./admin-sessions.mjs";
import {
  createEmailVerificationCodeInStorage,
  createUserInStorage,
  findUserByEmailInStorage,
  resetDbConnectionForTests,
  validateUserSessionInStorage,
  verifyEmailCodeInStorage,
} from "./store.mjs";

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
    adminAuditRecorderImpl: vi.fn(),
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

  it("AUTH_UI_SERVER_SMTP_UNCONFIGURED returns a safe opaque error without SMTP variable names", async () => {
    const handler = createHandler({ isMailerConfigured: () => false });

    const { res } = await invoke(handler, {
      method: "POST",
      url: "/auth/send-verification-code",
      body: JSON.stringify({ email: "user@example.com" }),
    });

    expect(res.statusCode).toBe(503);
    expect(parsePayload(res)).toEqual({ ok: false, error: "EMAIL_SERVICE_UNAVAILABLE" });
    for (const secretName of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "mailer is not configured"]) {
      expect(res.payload).not.toContain(secretName);
    }
  });

  it("AUTH_UI_SERVER_SMTP_FAILURE keeps transport errors internal and returns EMAIL_SERVICE_UNAVAILABLE", async () => {
    const sendVerificationCodeEmail = vi.fn().mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED 10.0.0.8:587"), { code: "ECONNREFUSED" }),
    );
    const handler = createHandler({
      isMailerConfigured: () => true,
      sendVerificationCodeEmail,
    });

    const { res } = await invoke(handler, {
      method: "POST",
      url: "/auth/send-verification-code",
      body: JSON.stringify({ email: "user@example.com" }),
    });

    expect(res.statusCode).toBe(503);
    expect(parsePayload(res)).toEqual({ ok: false, error: "EMAIL_SERVICE_UNAVAILABLE" });
    expect(res.payload).not.toContain("ECONNREFUSED");
    expect(res.payload).not.toContain("10.0.0.8");
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

  it("redirects the legacy root to the independent admin console without consuming query credentials", async () => {
    const loadDbImpl = vi.fn();
    const handler = createHandler({ loadDbImpl });
    const { res } = await invoke(handler, { url: "/?adminToken=real-admin-secret" });
    expect(res.statusCode).toBe(303);
    expect(res.headers.Location).toBe("/admin");
    expect(String(res.payload || "")).not.toContain("real-admin-secret");
    expect(loadDbImpl).not.toHaveBeenCalled();
  });

  it("strips query credentials from every Admin GET surface", async () => {
    const handler = createHandler();
    for (const url of [
      "/admin?adminToken=query-credential",
      "/admin/login?adminToken=query-credential",
      "/admin/api/session?adminToken=query-credential&next=1",
    ]) {
      const { res } = await invoke(handler, { url });
      expect(res.statusCode, url).toBe(303);
      expect(res.headers.Location, url).not.toContain("adminToken");
      expect(res.headers.Location, url).not.toContain("query-credential");
    }
  });

  it("fails closed when admin configuration is missing across protected admin and metrics routes", async () => {
    const loadDbImpl = vi.fn();
    const handler = createHandler({ adminToken: "", loadDbImpl });
    for (const url of [
      "/admin/login",
      "/admin",
      "/admin/api/session",
      "/admin/api/users",
      "/admin/api/system",
      "/admin/data",
      "/analytics/summary",
      "/analytics/timeseries",
    ]) {
      const { res } = await invoke(handler, { url });
      expect(res.statusCode, url).toBe(503);
      const payload = parsePayload(res);
      expect(payload.error === "ADMIN_AUTH_NOT_CONFIGURED" || payload.error?.code === "ADMIN_AUTH_NOT_CONFIGURED").toBe(true);
    }
    expect(loadDbImpl).not.toHaveBeenCalled();
  });

  it("renders a POST-only native login gate with strict admin security headers", async () => {
    const loadDbImpl = vi.fn();
    const handler = createHandler({ loadDbImpl });
    const { res } = await invoke(handler, { url: "/admin/login" });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('method="POST" action="/admin/login"');
    expect(res.payload).not.toContain('method="GET"');
    expect(res.payload).not.toContain("real-admin-secret");
    expect(res.headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(res.headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["Referrer-Policy"]).toBe("no-referrer");
    expect(loadDbImpl).not.toHaveBeenCalled();
  });

  it("strips query-token credentials before rejecting unauthenticated legacy Admin data access", async () => {
    const loadDbImpl = vi.fn(() => ({ devices: [], users: [], analytics_events: [], email_verification_codes: [] }));
    const handler = createHandler({ loadDbImpl });
    const stripped = await invoke(handler, { url: "/admin/data?adminToken=query-credential" });
    expect(stripped.res.statusCode).toBe(303);
    expect(stripped.res.headers.Location).toBe("/admin/data");
    expect(String(stripped.res.payload || "")).not.toContain("query-credential");

    const data = await invoke(handler, { url: "/admin/data" });
    expect(data.res.statusCode).toBe(401);
    expect(loadDbImpl).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated admin application routes to the native login gate", async () => {
    const handler = createHandler();
    for (const url of ["/admin", "/admin/users", "/admin/analytics", "/admin/system", "/admin/audit"]) {
      const { res } = await invoke(handler, { url });
      expect(res.statusCode, url).toBe(303);
      expect(res.headers.Location, url).toBe("/admin/login");
    }
  });

  it("rejects cross-origin admin login before issuing any session", async () => {
    const createAdminSessionToken = vi.fn(() => "must-not-be-issued");
    const handler = createHandler({ createAdminSessionToken });
    const { res } = await invoke(handler, {
      method: "POST",
      url: "/admin/login",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://evil.example",
      },
      body: formBody("real-admin-secret"),
    });
    expect(res.statusCode).toBe(403);
    expect(parsePayload(res).error).toBe("ADMIN_ORIGIN_REJECTED");
    expect(createAdminSessionToken).not.toHaveBeenCalled();
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

  it("exchanges the long-lived secret for a bounded strict, httpOnly admin-path session cookie", async () => {
    const handler = createHandler({ createAdminSessionToken: () => "short-session-credential" });
    const { res } = await login(handler);
    expect(res.statusCode).toBe(303);
    expect(res.headers.Location).toBe("/admin");
    const cookie = res.headers["Set-Cookie"];
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/admin");
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

  it("uses the HttpOnly cookie as browser admin authority and never accepts the long-lived bearer on admin APIs", async () => {
    const handler = createHandler({ createAdminSessionToken: () => "short-session-credential" });
    const signedIn = await login(handler);
    const cookie = sessionCookie(signedIn.res);

    const authorized = await invoke(handler, { url: "/admin/api/session", headers: { cookie } });
    expect(authorized.res.statusCode).toBe(200);
    expect(parsePayload(authorized.res).ok).toBe(true);
    expect(authorized.res.payload).not.toContain("real-admin-secret");
    expect(authorized.res.payload).not.toContain("short-session-credential");

    const bearerOnly = await invoke(handler, {
      url: "/admin/api/session",
      headers: { authorization: "Bearer real-admin-secret" },
    });
    expect(bearerOnly.res.statusCode).toBe(401);
    expect(parsePayload(bearerOnly.res).error.code).toBe("ADMIN_SESSION_REQUIRED");
  });

  it("D1-SERVER-01 wires real Users/System read models without exposing raw storage", async () => {
    const dbFile = path.join(
      os.tmpdir(),
      `quiz-solver-admin-management-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
    const previousDbFile = process.env.ANALYTICS_DB_FILE;
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;

    try {
      createUserInStorage("owner@example.com", "secret-123", "dev-owner");
      const handler = createHandler({
        nowImpl: () => new Date("2026-10-07T12:00:00.000Z").getTime(),
        uptimeImpl: () => 88.9,
        isMailerConfigured: () => true,
        createAdminSessionToken: () => "management-session",
      });
      const signedIn = await login(handler);
      const cookie = sessionCookie(signedIn.res);

      const users = await invoke(handler, {
        url: "/admin/api/users?limit=1&q=OWNER",
        headers: { cookie },
      });
      expect(users.res.statusCode).toBe(200);
      const usersPayload = parsePayload(users.res);
      expect(usersPayload).toMatchObject({
        ok: true,
        page: { limit: 1, nextCursor: null },
        query: { q: "owner" },
      });
      expect(usersPayload.data).toHaveLength(1);
      expect(usersPayload.data[0]).toMatchObject({
        email: "owner@example.com",
        linkedDeviceCount: 1,
      });
      for (const forbiddenKey of [
        "passwordHash",
        "passwordSalt",
        "authToken",
        "authTokenHash",
        "authTokenSalt",
        "authTokenExpiresAt",
        "deviceIds",
        "deviceId",
      ]) {
        expect(JSON.stringify(usersPayload)).not.toContain(forbiddenKey);
      }

      const system = await invoke(handler, {
        url: "/admin/api/system",
        headers: { cookie },
      });
      expect(system.res.statusCode).toBe(200);
      expect(parsePayload(system.res)).toEqual({
        ok: true,
        generatedAt: "2026-10-07T12:00:00.000Z",
        service: { status: "ok", uptimeSeconds: 88 },
        storage: { driver: "sqlite" },
        email: { configured: true },
        deployment: { authority: "single_process" },
        analytics: { retentionDays: 90, privacyEpoch: 1 },
      });
      expect(system.res.payload).not.toContain(dbFile);
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

  it("rejects admin asset traversal outside the isolated artifact root", async () => {
    const handler = createHandler({ createAdminSessionToken: () => "short-session-credential" });
    const signedIn = await login(handler);
    const { res } = await invoke(handler, {
      url: "/admin/assets/..%2F..%2Fanalytics-server%2Flib%2Fserver.mjs",
      headers: { cookie: sessionCookie(signedIn.res) },
    });
    expect(res.statusCode).toBe(404);
    expect(parsePayload(res).error.code).toBe("ADMIN_RESOURCE_NOT_FOUND");
    expect(res.payload).not.toContain("analyticsHandler");
  });

  it("rejects cross-origin logout without revoking the live admin session", async () => {
    const handler = createHandler({ createAdminSessionToken: () => "short-session-credential" });
    const signedIn = await login(handler);
    const cookie = sessionCookie(signedIn.res);
    const rejected = await invoke(handler, {
      method: "POST",
      url: "/admin/logout",
      headers: { cookie, origin: "https://evil.example" },
    });
    expect(rejected.res.statusCode).toBe(403);
    expect(parsePayload(rejected.res).error).toBe("ADMIN_ORIGIN_REJECTED");

    const session = await invoke(handler, { url: "/admin/api/session", headers: { cookie } });
    expect(session.res.statusCode).toBe(200);
  });

  it("revokes the admin session on CSRF-protected logout and clears the admin-path cookie", async () => {
    const handler = createHandler({
      createAdminSessionToken: () => "short-session-credential",
      createAdminCsrfToken: () => "short-csrf-credential",
    });
    const signedIn = await login(handler);
    const cookie = sessionCookie(signedIn.res);
    const state = await invoke(handler, {
      url: "/admin/api/session",
      headers: { cookie },
    });
    const csrfToken = parsePayload(state.res).csrfToken;

    const loggedOut = await invoke(handler, {
      method: "POST",
      url: "/admin/logout",
      headers: {
        cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrfToken }).toString(),
    });
    expect(loggedOut.res.statusCode).toBe(303);
    expect(loggedOut.res.headers.Location).toBe("/admin/login");
    expect(loggedOut.res.headers["Set-Cookie"]).toContain("Path=/admin");
    expect(loggedOut.res.headers["Set-Cookie"]).toContain("Max-Age=0");

    const session = await invoke(handler, { url: "/admin/api/session", headers: { cookie } });
    expect(session.res.statusCode).toBe(401);
    expect(parsePayload(session.res).error.code).toBe("ADMIN_SESSION_REQUIRED");
  });

  it("E-RESTART-01 invalidates process-local Admin sessions after handler restart", async () => {
    const first = createHandler({
      createAdminSessionToken: () => "restart-session-credential",
      createAdminCsrfToken: () => "restart-csrf-credential",
    });
    const signedIn = await login(first);
    const cookie = sessionCookie(signedIn.res);

    const beforeRestart = await invoke(first, {
      url: "/admin/api/session",
      headers: { cookie },
    });
    expect(beforeRestart.res.statusCode).toBe(200);

    const restarted = createHandler({
      createAdminSessionToken: () => "new-process-session",
      createAdminCsrfToken: () => "new-process-csrf",
    });
    const afterRestart = await invoke(restarted, {
      url: "/admin/api/session",
      headers: { cookie },
    });
    expect(afterRestart.res.statusCode).toBe(401);
    expect(parsePayload(afterRestart.res).error.code).toBe("ADMIN_SESSION_REQUIRED");
  });

  it("E-AUDIT-INTEGRATION-01 persists Audit across process restart while sessions fail closed", async () => {
    const dbFile = path.join(
      os.tmpdir(),
      `quiz-solver-admin-audit-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
    );
    const previousDbFile = process.env.ANALYTICS_DB_FILE;
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;

    try {
      const first = createAnalyticsHandler({
        adminToken: "short-admin",
        isMailerConfigured: () => false,
        sendVerificationCodeEmail: vi.fn(),
        createAdminSessionToken: () => "first-process-session",
        createAdminCsrfToken: () => "first-process-csrf",
        nowImpl: () => Date.parse("2026-10-07T12:00:00.000Z"),
      });
      const firstLogin = await login(first, "short-admin");
      const oldCookie = sessionCookie(firstLogin.res);

      const firstAudit = await invoke(first, {
        url: "/admin/api/audit",
        headers: { cookie: oldCookie },
      });
      expect(firstAudit.res.statusCode).toBe(200);
      const firstEvents = parsePayload(firstAudit.res).data;
      expect(firstEvents).toEqual([
        expect.objectContaining({
          event: "admin_login",
          outcome: "success",
        }),
      ]);
      const firstIpHash = firstEvents[0].ipHash;
      expect(firstIpHash).toMatch(/^ip_[0-9a-f]{16}$/);
      expect(firstAudit.res.payload).not.toContain("short-admin");
      expect(firstAudit.res.payload).not.toContain("first-process-session");

      resetDbConnectionForTests();

      const restarted = createAnalyticsHandler({
        adminToken: "short-admin",
        isMailerConfigured: () => false,
        sendVerificationCodeEmail: vi.fn(),
        createAdminSessionToken: () => "second-process-session",
        createAdminCsrfToken: () => "second-process-csrf",
        nowImpl: () => Date.parse("2026-10-07T12:01:00.000Z"),
      });

      const oldSessionAfterRestart = await invoke(restarted, {
        url: "/admin/api/session",
        headers: { cookie: oldCookie },
      });
      expect(oldSessionAfterRestart.res.statusCode).toBe(401);

      const secondLogin = await login(restarted, "short-admin");
      const newCookie = sessionCookie(secondLogin.res);
      const persistedAudit = await invoke(restarted, {
        url: "/admin/api/audit",
        headers: { cookie: newCookie },
      });
      expect(persistedAudit.res.statusCode).toBe(200);
      const events = parsePayload(persistedAudit.res).data;
      expect(events).toHaveLength(2);
      expect(events.map((entry) => entry.event)).toEqual([
        "admin_login",
        "admin_login",
      ]);
      expect(events[0].createdAt).toBe("2026-10-07T12:01:00.000Z");
      expect(events[1].createdAt).toBe("2026-10-07T12:00:00.000Z");
      expect(events[0].ipHash).toBe(firstIpHash);
      expect(events[1].ipHash).toBe(firstIpHash);
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

  it("returns the stable Admin API not-found contract for unknown namespace routes", async () => {
    const handler = createHandler();
    const { res } = await invoke(handler, { url: "/admin/api/not-a-route" });
    expect(res.statusCode).toBe(404);
    expect(parsePayload(res)).toEqual({
      ok: false,
      error: { code: "ADMIN_RESOURCE_NOT_FOUND" },
    });
    expect(res.headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
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
    const { res } = await invoke(handler, { url: "/admin/api/session", headers: { cookie: sessionCookie(signedIn.res) } });
    expect(res.statusCode).toBe(401);
    expect(parsePayload(res).error.code).toBe("ADMIN_SESSION_REQUIRED");
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

describe("auth core registration code consumption", () => {
  function createRealStorageHandler() {
    const dbFile = path.join(os.tmpdir(), `quiz-solver-auth-register-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    const previousDbFile = process.env.ANALYTICS_DB_FILE;
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;
    const cleanup = () => {
      resetDbConnectionForTests();
      if (previousDbFile === undefined) delete process.env.ANALYTICS_DB_FILE;
      else process.env.ANALYTICS_DB_FILE = previousDbFile;
      for (const suffix of ["", "-wal", "-shm"]) {
        const file = `${dbFile}${suffix}`;
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    };
    return { handler: createHandler(), cleanup };
  }

  it("AUTH_CORE_21_INVALID_PASSWORD_DOES_NOT_CONSUME_CODE keeps the code usable", async () => {
    const { handler, cleanup } = createRealStorageHandler();
    try {
      const { code } = createEmailVerificationCodeInStorage("burn@example.com");
      const invalid = await invoke(handler, {
        method: "POST",
        url: "/auth/register",
        body: JSON.stringify({ email: "burn@example.com", password: "123", verificationCode: code }),
      });
      expect(invalid.res.statusCode).toBe(400);
      expect(parsePayload(invalid.res).error).toMatch(/password must be at least 6 characters/i);

      const retry = await invoke(handler, {
        method: "POST",
        url: "/auth/register",
        body: JSON.stringify({ email: "burn@example.com", password: "secret-123", verificationCode: code, deviceId: "dev-burn" }),
      });
      expect(retry.res.statusCode).toBe(200);
      expect(parsePayload(retry.res).ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("AUTH_CORE_22_DUPLICATE_ACCOUNT_DOES_NOT_CONSUME_CODE keeps the code usable", async () => {
    const { handler, cleanup } = createRealStorageHandler();
    try {
      createUserInStorage("dupe@example.com", "secret-123", "dev-existing");
      const { code } = createEmailVerificationCodeInStorage("dupe@example.com");

      const duplicate = await invoke(handler, {
        method: "POST",
        url: "/auth/register",
        body: JSON.stringify({ email: "dupe@example.com", password: "secret-123", verificationCode: code }),
      });
      expect(duplicate.res.statusCode).toBe(409);
      expect(parsePayload(duplicate.res).error).toMatch(/email already registered/i);
      expect(() => verifyEmailCodeInStorage("dupe@example.com", code)).not.toThrow();
    } finally {
      cleanup();
    }
  });

  it("AUTH_CORE_23_SUCCESS_CONSUMES_CODE_ONCE consumes the code exactly once", async () => {
    const { handler, cleanup } = createRealStorageHandler();
    try {
      const { code } = createEmailVerificationCodeInStorage("success@example.com");

      const created = await invoke(handler, {
        method: "POST",
        url: "/auth/register",
        body: JSON.stringify({ email: "success@example.com", password: "secret-123", verificationCode: code, deviceId: "dev-success" }),
      });
      expect(created.res.statusCode).toBe(200);
      expect(parsePayload(created.res).authToken).toBeTruthy();

      expect(() => verifyEmailCodeInStorage("success@example.com", code)).toThrow(/invalid or expired/i);
    } finally {
      cleanup();
    }
  });
});

describe("auth core enumeration safety", () => {
  function createRealStorageHandler() {
    const dbFile = path.join(os.tmpdir(), `quiz-solver-auth-enum-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
    const previousDbFile = process.env.ANALYTICS_DB_FILE;
    resetDbConnectionForTests();
    process.env.ANALYTICS_DB_FILE = dbFile;
    const cleanup = () => {
      resetDbConnectionForTests();
      if (previousDbFile === undefined) delete process.env.ANALYTICS_DB_FILE;
      else process.env.ANALYTICS_DB_FILE = previousDbFile;
      for (const suffix of ["", "-wal", "-shm"]) {
        const file = `${dbFile}${suffix}`;
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    };
    return { handler: createHandler(), cleanup };
  }

  async function registerWithCode(handler, email, verificationCode) {
    return invoke(handler, {
      method: "POST",
      url: "/auth/register",
      body: JSON.stringify({ email, password: "secret-123", verificationCode }),
    });
  }

  it("AUTH_CORE_25_REGISTER_UNKNOWN_EMAIL_INVALID_CODE fails generically without creating a user", async () => {
    const { handler, cleanup } = createRealStorageHandler();
    try {
      const { res } = await registerWithCode(handler, "ghost@example.com", ["000", "000"].join(""));
      expect(res.statusCode).toBe(400);
      expect(parsePayload(res).error).toBe("invalid or expired verification code");
      expect(findUserByEmailInStorage("ghost@example.com")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("AUTH_CORE_26_REGISTER_EXISTING_EMAIL_INVALID_CODE is externally indistinguishable from an unknown email", async () => {
    const { handler, cleanup } = createRealStorageHandler();
    try {
      createUserInStorage("taken@example.com", "secret-123", "dev-taken");

      const unknown = await registerWithCode(handler, "ghost@example.com", ["000", "000"].join(""));
      const existing = await registerWithCode(handler, "taken@example.com", ["000", "000"].join(""));

      expect(existing.res.statusCode).toBe(unknown.res.statusCode);
      expect(parsePayload(existing.res).error).toBe(parsePayload(unknown.res).error);
      // The existing account is untouched by the probing attempt.
      expect(findUserByEmailInStorage("taken@example.com")?.userId).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it("AUTH_CORE_27_DUPLICATE_VALID_CODE_NOT_PARTIAL keeps the account and the code intact", async () => {
    const { handler, cleanup } = createRealStorageHandler();
    try {
      const existing = createUserInStorage("dupe-valid@example.com", "secret-123", "dev-original");
      const { code } = createEmailVerificationCodeInStorage("dupe-valid@example.com");

      const duplicate = await registerWithCode(handler, "dupe-valid@example.com", code);
      expect(duplicate.res.statusCode).toBe(409);
      expect(parsePayload(duplicate.res).error).toBe("email already registered");

      // No second account and no disturbed session on the original account.
      expect(findUserByEmailInStorage("dupe-valid@example.com")?.userId).toBe(existing.user.userId);
      expect(validateUserSessionInStorage(existing.user.userId, existing.authToken)).not.toBeNull();

      // The proven-code duplicate path must not consume the one-time code.
      expect(() => verifyEmailCodeInStorage("dupe-valid@example.com", code)).not.toThrow();
    } finally {
      cleanup();
    }
  });

  it("AUTH_CORE_29_LOGIN_UNKNOWN_EMAIL, AUTH_CORE_30_LOGIN_WRONG_PASSWORD, and AUTH_CORE_34_HTTP_LOGIN_ENUMERATION_STILL_UNIFIED keep one 401 payload", async () => {
    const { handler, cleanup } = createRealStorageHandler();
    try {
      createUserInStorage("login@example.com", "secret-123", "dev-login");

      const unknown = await invoke(handler, {
        method: "POST",
        url: "/auth/login",
        body: JSON.stringify({ email: "ghost@example.com", password: "secret-123" }),
      });
      const wrongPassword = await invoke(handler, {
        method: "POST",
        url: "/auth/login",
        body: JSON.stringify({ email: "login@example.com", password: "wrong-password" }),
      });

      expect(unknown.res.statusCode).toBe(401);
      expect(parsePayload(unknown.res)).toEqual({ ok: false, error: "AUTH_INVALID_CREDENTIALS" });
      expect(wrongPassword.res.statusCode).toBe(unknown.res.statusCode);
      expect(parsePayload(wrongPassword.res)).toEqual(parsePayload(unknown.res));
    } finally {
      cleanup();
    }
  });

  it("AUTH_CORE_31_SUCCESSFUL_ATOMIC_REGISTRATION creates one account with a consumed code and a valid bounded token", async () => {
    const { handler, cleanup } = createRealStorageHandler();
    try {
      const { code } = createEmailVerificationCodeInStorage("atomic@example.com");

      const created = await registerWithCode(handler, "atomic@example.com", code);
      expect(created.res.statusCode).toBe(200);

      const payload = parsePayload(created.res);
      expect(payload.ok).toBe(true);
      expect(findUserByEmailInStorage("atomic@example.com")?.userId).toBe(payload.user.userId);
      expect(validateUserSessionInStorage(payload.user.userId, payload.authToken)).not.toBeNull();
      expect(() => verifyEmailCodeInStorage("atomic@example.com", code)).toThrow(/invalid or expired/i);
    } finally {
      cleanup();
    }
  });
});

describe("rate limiter resource bounds server wiring (REL-RATE-01)", () => {
  const SESSION_USER = { userId: "usr-rate-1", email: "rate@example.com" };
  const SESSION_TOKEN = ["tok", "rate"].join("_");

  function adminLoginAttempt(handler, remoteAddress) {
    return invoke(handler, {
      method: "POST",
      url: "/admin/login",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody("wrong-secret"),
      socket: { remoteAddress },
    });
  }

  it("RATE_11_TRUSTED_PROXY_IDENTITY_REGRESSION: direct clients share one bucket regardless of forwarded headers", async () => {
    const handler = createHandler();
    let last;
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      last = await invoke(handler, {
        method: "POST",
        url: "/admin/login",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-for": `10.0.0.${attempt}`,
          "x-real-ip": `10.9.9.${attempt}`,
        },
        body: formBody("wrong-secret"),
        socket: { remoteAddress: "203.0.113.77" },
      });
      expect(last.res.statusCode).toBe(attempt === 11 ? 429 : 401);
    }
  });

  it("RATE_12_ADMIN_LOGIN_RATE_LIMIT_REGRESSION: 10/15min limit, deterministic Retry-After, and window reset", async () => {
    let now = 1_000_000;
    const handler = createHandler({ nowImpl: () => now });
    let last;
    for (let attempt = 0; attempt < 11; attempt += 1) last = await adminLoginAttempt(handler, "127.0.0.1");

    expect(last.res.statusCode).toBe(429);
    expect(last.res.headers["Set-Cookie"]).toBeUndefined();
    expect(last.res.payload).toContain("retry after 900s");

    now += 15 * 60 * 1000;
    const recovered = await adminLoginAttempt(handler, "127.0.0.1");
    expect(recovered.res.statusCode).toBe(401);
  });

  it("RATE_13_SEND_CODE_IP_AND_EMAIL_LIMIT_REGRESSION: ip and email buckets stay independent fixed windows", async () => {
    let now = 1_000_000;
    const createEmailVerificationCodeImpl = vi.fn(() => ({ code: "123456", expiresAt: now + 600_000 }));
    const sendVerificationCodeEmail = vi.fn();
    const handler = createHandler({
      nowImpl: () => now,
      isMailerConfigured: () => true,
      createEmailVerificationCodeImpl,
      sendVerificationCodeEmail,
    });
    const sendCode = (email) =>
      invoke(handler, {
        method: "POST",
        url: "/auth/send-verification-code",
        body: JSON.stringify({ email }),
      });

    for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
      expect((await sendCode(email)).res.statusCode).toBe(200);
    }

    let last;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      last = await sendCode("repeat@example.com");
    }
    expect(last.res.statusCode).toBe(429);

    const otherEmail = await sendCode("other@example.com");
    expect(otherEmail.res.statusCode).toBe(200);

    expect(sendVerificationCodeEmail).toHaveBeenCalledTimes(7);
    expect(createEmailVerificationCodeImpl).toHaveBeenCalledTimes(7);
  });

  it("RATE_14_AUTH_SESSION_LIMIT_REGRESSION: 120/5min limit still resets after the window", async () => {
    let now = 1_000_000;
    const validateUserSessionImpl = vi.fn(() => ({ user: SESSION_USER, expiresAt: 4102444800000 }));
    const handler = createHandler({ nowImpl: () => now, validateUserSessionImpl });
    const sessionRequest = () =>
      invoke(handler, {
        method: "POST",
        url: "/auth/session",
        headers: { authorization: `Bearer ${SESSION_TOKEN}` },
        body: JSON.stringify({ userId: SESSION_USER.userId }),
      });

    let last;
    for (let attempt = 0; attempt < 121; attempt += 1) last = await sessionRequest();
    expect(last.res.statusCode).toBe(429);
    expect(validateUserSessionImpl).toHaveBeenCalledTimes(120);

    now += 5 * 60 * 1000;
    const recovered = await sessionRequest();
    expect(recovered.res.statusCode).toBe(200);
    expect(validateUserSessionImpl).toHaveBeenCalledTimes(121);
  });

  it("RATE_15_NAMESPACE_CAPACITY_ISOLATION_SERVER_LEVEL: a saturated admin-login namespace cannot starve session validation", async () => {
    const validateUserSessionImpl = vi.fn(() => ({ user: SESSION_USER, expiresAt: 4102444800000 }));
    const handler = createHandler({ rateLimitMaxBuckets: 2, validateUserSessionImpl });

    expect((await adminLoginAttempt(handler, "203.0.113.1")).res.statusCode).toBe(401);
    expect((await adminLoginAttempt(handler, "203.0.113.2")).res.statusCode).toBe(401);

    const saturated = await adminLoginAttempt(handler, "203.0.113.3");
    expect(saturated.res.statusCode).toBe(429);

    const session = await invoke(handler, {
      method: "POST",
      url: "/auth/session",
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      body: JSON.stringify({ userId: SESSION_USER.userId }),
      socket: { remoteAddress: "203.0.113.9" },
    });
    expect(session.res.statusCode).toBe(200);
    expect(validateUserSessionImpl).toHaveBeenCalled();
  });
});
