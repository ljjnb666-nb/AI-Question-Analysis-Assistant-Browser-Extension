// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminSessionStore } from "./admin-sessions.mjs";
import {
  ADMIN_CSP,
  createAdminPortal,
} from "./admin-console.mjs";

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function createReq({
  method = "GET",
  headers = {},
  body = "",
} = {}) {
  const listeners = new Map();
  return {
    method,
    headers,
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
  return JSON.parse(String(res.payload || ""));
}

function createDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-admin-r1-"));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/admin/assets/app.js"></script></body></html>',
  );
  fs.writeFileSync(path.join(dir, "assets", "app.js"), 'console.log("admin-test");');
  return dir;
}

function createHarness({
  adminToken = "real-admin-secret",
  publicBaseUrl = "https://analytics.example.test",
  adminDistDir = createDist(),
  nowImpl = () => 1_000,
  ttlMs = 8 * 60 * 60 * 1000,
  rateLimiter = { consume: () => ({ allowed: true, resetAt: 999_999 }) },
  adminReadRateLimiter = { consume: () => ({ allowed: true, resetAt: 999_999 }) },
  adminUsersReadRateLimiter = { consume: () => ({ allowed: true, resetAt: 999_999 }) },
  adminSystemReadRateLimiter = { consume: () => ({ allowed: true, resetAt: 999_999 }) },
  adminAuditReadRateLimiter = { consume: () => ({ allowed: true, resetAt: 999_999 }) },
  adminSecurityAuditRateLimiter = { consume: () => ({ allowed: true, resetAt: 999_999 }) },
  adminReadModels = {
    overview: vi.fn((days) => ({ generatedAt: "2026-10-07T00:00:00.000Z", analyticsScope: "opt_in_only", window: { days } })),
    timeseries: vi.fn((days) => ({ kind: "timeseries", analyticsScope: "opt_in_only", window: { days }, data: [] })),
    providers: vi.fn((days) => ({ kind: "providers", analyticsScope: "opt_in_only", window: { days }, data: [] })),
    errors: vi.fn((days) => ({ kind: "errors", analyticsScope: "opt_in_only", window: { days }, data: [] })),
    versions: vi.fn((days) => ({ kind: "versions", analyticsScope: "opt_in_only", window: { days }, data: [] })),
    latency: vi.fn((days) => ({ kind: "latency", analyticsScope: "opt_in_only", window: { days }, data: [] })),
  },
  adminManagementReadModels = {
    users: vi.fn((query) => ({
      generatedAt: "2026-10-07T00:00:00.000Z",
      data: [],
      page: { limit: query.limit, nextCursor: null },
      query: { q: query.q },
    })),
    system: vi.fn(() => ({
      generatedAt: "2026-10-07T00:00:00.000Z",
      service: { status: "ok", uptimeSeconds: 10 },
      storage: { driver: "sqlite" },
      email: { configured: true },
      deployment: { authority: "single_process" },
      analytics: { retentionDays: 90, privacyEpoch: 1 },
    })),
  },
  adminAuditReadModel = {
    list: vi.fn((query) => ({
      generatedAt: "2026-10-07T00:00:00.000Z",
      data: [],
      page: { limit: query.limit, nextCursor: null },
    })),
  },
  adminAuditRecorder = vi.fn(),
  isProduction = () => false,
} = {}) {
  let sequence = 0;
  const adminSessions = createAdminSessionStore({
    createToken: () => `session-${++sequence}`,
    createCsrfToken: () => `csrf-${sequence}`,
    maxSessions: 64,
    now: nowImpl,
    ttlMs,
  });
  const portal = createAdminPortal({
    adminToken,
    adminSessions,
    adminSessionTtlMs: ttlMs,
    adminLoginRateLimiter: rateLimiter,
    adminReadRateLimiter,
    adminUsersReadRateLimiter,
    adminSystemReadRateLimiter,
    adminAuditReadRateLimiter,
    adminSecurityAuditRateLimiter,
    adminReadModels,
    adminManagementReadModels,
    adminAuditReadModel,
    adminAuditRecorder,
    nowImpl,
    publicBaseUrl,
    adminDistDir,
    isProduction,
  });
  return {
    portal,
    adminSessions,
    adminDistDir,
    adminReadModels,
    adminManagementReadModels,
    adminAuditReadModel,
    adminAuditRecorder,
  };
}

async function invoke(portal, {
  method = "GET",
  url = "/admin",
  headers = {},
  body = "",
  ip = "127.0.0.1",
} = {}) {
  const req = createReq({ method, headers, body });
  const res = createRes();
  const promise = portal.handle(req, res, new URL(url, "http://127.0.0.1"), ip);
  req.emitBody();
  const handled = await promise;
  return { handled, req, res };
}

function formBody(token) {
  return new URLSearchParams({ adminToken: token }).toString();
}

async function login(portal, token = "real-admin-secret", headers = {}) {
  return invoke(portal, {
    method: "POST",
    url: "/admin/login",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: formBody(token),
  });
}

function cookiePair(res) {
  return String(res.headers["Set-Cookie"] || "").split(";", 1)[0];
}

describe("Phase 11D1 Admin Users/System API authority", () => {
  it("D1-API-01 keeps both management reads cookie-only", async () => {
    const { portal, adminManagementReadModels } = createHarness();

    for (const url of ["/admin/api/users", "/admin/api/system"]) {
      const anonymous = await invoke(portal, { url });
      expect(anonymous.res.statusCode, url).toBe(401);
      expect(parsePayload(anonymous.res).error.code, url).toBe("ADMIN_SESSION_REQUIRED");

      const bearer = await invoke(portal, {
        url,
        headers: { authorization: "Bearer real-admin-secret" },
      });
      expect(bearer.res.statusCode, url).toBe(401);
      expect(parsePayload(bearer.res).error.code, url).toBe("ADMIN_SESSION_REQUIRED");
    }

    expect(adminManagementReadModels.users).not.toHaveBeenCalled();
    expect(adminManagementReadModels.system).not.toHaveBeenCalled();
  });

  it("D1-API-02 fails closed when Admin auth is not configured even with a live session", async () => {
    const { portal, adminSessions, adminManagementReadModels } = createHarness({
      adminToken: "",
    });
    const issued = adminSessions.issue();

    for (const url of ["/admin/api/users", "/admin/api/system"]) {
      const { res } = await invoke(portal, {
        url,
        headers: { cookie: `analytics_admin_session=${issued.token}` },
      });
      expect(res.statusCode, url).toBe(503);
      expect(parsePayload(res).error.code, url).toBe("ADMIN_AUTH_NOT_CONFIGURED");
    }

    expect(adminManagementReadModels.users).not.toHaveBeenCalled();
    expect(adminManagementReadModels.system).not.toHaveBeenCalled();
  });

  it("D1-API-03 serves allowlisted Users/System reads from the authenticated cookie", async () => {
    const { portal, adminManagementReadModels } = createHarness();
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);

    const users = await invoke(portal, {
      url: "/admin/api/users?limit=10&q=Alice%40Example.Test",
      headers: { cookie },
    });
    expect(users.res.statusCode).toBe(200);
    expect(parsePayload(users.res).ok).toBe(true);
    expect(adminManagementReadModels.users).toHaveBeenCalledTimes(1);
    expect(adminManagementReadModels.users.mock.calls[0][0]).toMatchObject({
      limit: 10,
      q: "alice@example.test",
      cursor: null,
    });

    const system = await invoke(portal, {
      url: "/admin/api/system",
      headers: { cookie },
    });
    expect(system.res.statusCode).toBe(200);
    expect(parsePayload(system.res)).toMatchObject({
      ok: true,
      service: { status: "ok" },
      storage: { driver: "sqlite" },
      deployment: { authority: "single_process" },
    });
    expect(adminManagementReadModels.system).toHaveBeenCalledTimes(1);
  });

  it("D1-API-04 rejects malformed Users queries and all System query parameters", async () => {
    const { portal, adminManagementReadModels } = createHarness();
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);

    for (const value of ["0", "101", "-1", "1.5", "abc", " 50 "]) {
      const { res } = await invoke(portal, {
        url: `/admin/api/users?limit=${encodeURIComponent(value)}`,
        headers: { cookie },
      });
      expect(res.statusCode, value).toBe(400);
      expect(parsePayload(res).error.code, value).toBe("INVALID_ADMIN_QUERY");
    }

    const badCursor = await invoke(portal, {
      url: "/admin/api/users?cursor=%25%25%25",
      headers: { cookie },
    });
    expect(badCursor.res.statusCode).toBe(400);
    expect(parsePayload(badCursor.res).error.code).toBe("INVALID_ADMIN_QUERY");

    const unknownUsersQuery = await invoke(portal, {
      url: "/admin/api/users?page=2",
      headers: { cookie },
    });
    expect(unknownUsersQuery.res.statusCode).toBe(400);
    expect(parsePayload(unknownUsersQuery.res).error.code).toBe("INVALID_ADMIN_QUERY");

    const systemQuery = await invoke(portal, {
      url: "/admin/api/system?verbose=1",
      headers: { cookie },
    });
    expect(systemQuery.res.statusCode).toBe(400);
    expect(parsePayload(systemQuery.res).error.code).toBe("INVALID_ADMIN_QUERY");

    expect(adminManagementReadModels.system).not.toHaveBeenCalled();
  });

  it("D1-API-05 rejects management mutations with stable 405 codes", async () => {
    const { portal, adminManagementReadModels } = createHarness();
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);

    for (const url of ["/admin/api/users", "/admin/api/system"]) {
      const { res } = await invoke(portal, {
        method: "POST",
        url,
        headers: { cookie },
      });
      expect(res.statusCode, url).toBe(405);
      expect(parsePayload(res).error.code, url).toBe("ADMIN_METHOD_NOT_ALLOWED");
    }

    expect(adminManagementReadModels.users).not.toHaveBeenCalled();
    expect(adminManagementReadModels.system).not.toHaveBeenCalled();
  });

  it("D1-API-06 isolates Users/System read budgets from Analytics and login", async () => {
    const adminUsersReadRateLimiter = {
      consume: vi.fn(() => ({ allowed: false, resetAt: 6_000 })),
    };
    const adminSystemReadRateLimiter = {
      consume: vi.fn(() => ({ allowed: true, resetAt: 6_000 })),
    };
    const adminReadRateLimiter = {
      consume: vi.fn(() => ({ allowed: true, resetAt: 6_000 })),
    };
    const { portal, adminManagementReadModels, adminReadModels } = createHarness({
      adminUsersReadRateLimiter,
      adminSystemReadRateLimiter,
      adminReadRateLimiter,
      nowImpl: () => 1_000,
    });
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);

    const users = await invoke(portal, {
      url: "/admin/api/users",
      headers: { cookie },
    });
    expect(users.res.statusCode).toBe(429);
    expect(users.res.headers["Retry-After"]).toBe("5");
    expect(parsePayload(users.res).error.code).toBe("ADMIN_RATE_LIMITED");
    expect(adminManagementReadModels.users).not.toHaveBeenCalled();

    const system = await invoke(portal, {
      url: "/admin/api/system",
      headers: { cookie },
    });
    expect(system.res.statusCode).toBe(200);
    expect(adminManagementReadModels.system).toHaveBeenCalledTimes(1);

    const analytics = await invoke(portal, {
      url: "/admin/api/overview",
      headers: { cookie },
    });
    expect(analytics.res.statusCode).toBe(200);
    expect(adminReadModels.overview).toHaveBeenCalledTimes(1);

    expect(adminUsersReadRateLimiter.consume).toHaveBeenCalledTimes(1);
    expect(adminSystemReadRateLimiter.consume).toHaveBeenCalledTimes(1);
    expect(adminReadRateLimiter.consume).toHaveBeenCalledTimes(1);
  });

  it("D1-API-07 hides management read failures behind stable opaque errors", async () => {
    const storageError = Object.assign(new Error("/private/data/analytics-db.sqlite"), {
      code: "ADMIN_STORAGE_UNAVAILABLE",
      statusCode: 503,
    });
    const adminManagementReadModels = {
      users: vi.fn(() => {
        throw storageError;
      }),
      system: vi.fn(() => {
        throw storageError;
      }),
    };
    const { portal } = createHarness({ adminManagementReadModels });
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);

    for (const url of ["/admin/api/users", "/admin/api/system"]) {
      const { res } = await invoke(portal, { url, headers: { cookie } });
      expect(res.statusCode, url).toBe(503);
      expect(parsePayload(res), url).toEqual({
        ok: false,
        error: { code: "ADMIN_STORAGE_UNAVAILABLE" },
      });
      expect(String(res.payload), url).not.toContain("/private/data");
    }
  });
});

describe("Phase 11C1 admin analytics API authority", () => {
  it("C1-API-01 rejects aggregate reads without the HttpOnly Admin session", async () => {
    const { portal, adminReadModels } = createHarness();
    const { res } = await invoke(portal, { url: "/admin/api/overview" });
    expect(res.statusCode).toBe(401);
    expect(parsePayload(res).error.code).toBe("ADMIN_SESSION_REQUIRED");
    expect(adminReadModels.overview).not.toHaveBeenCalled();
  });

  it("C1-API-01B keeps aggregate APIs fail-closed when Admin auth is not configured", async () => {
    const { portal, adminSessions, adminReadModels } = createHarness({ adminToken: "" });
    const issued = adminSessions.issue();
    const { res } = await invoke(portal, {
      url: "/admin/api/overview",
      headers: { cookie: `analytics_admin_session=${issued.token}` },
    });
    expect(res.statusCode).toBe(503);
    expect(parsePayload(res).error.code).toBe("ADMIN_AUTH_NOT_CONFIGURED");
    expect(adminReadModels.overview).not.toHaveBeenCalled();
  });

  it("C1-API-02 never accepts the long-lived Admin bearer as browser analytics authority", async () => {
    const { portal, adminReadModels } = createHarness();
    const { res } = await invoke(portal, {
      url: "/admin/api/analytics/timeseries",
      headers: { authorization: "Bearer real-admin-secret" },
    });
    expect(res.statusCode).toBe(401);
    expect(parsePayload(res).error.code).toBe("ADMIN_SESSION_REQUIRED");
    expect(adminReadModels.timeseries).not.toHaveBeenCalled();
  });

  it("C1-API-03 serves all frozen read-model routes from the authenticated cookie", async () => {
    const { portal, adminReadModels } = createHarness();
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);
    const cases = [
      ["/admin/api/overview?days=30", "overview"],
      ["/admin/api/analytics/timeseries?days=30", "timeseries"],
      ["/admin/api/analytics/providers?days=30", "providers"],
      ["/admin/api/analytics/errors?days=30", "errors"],
      ["/admin/api/analytics/versions?days=30", "versions"],
      ["/admin/api/analytics/latency?days=30", "latency"],
    ];
    for (const [url, operation] of cases) {
      const { res } = await invoke(portal, { url, headers: { cookie } });
      expect(res.statusCode, url).toBe(200);
      expect(parsePayload(res).ok, url).toBe(true);
      expect(adminReadModels[operation], url).toHaveBeenCalledWith(30);
    }
  });

  it("C1-API-04 applies the 14-day default and rejects malformed or out-of-retention windows", async () => {
    const { portal, adminReadModels } = createHarness();
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);

    const defaultWindow = await invoke(portal, {
      url: "/admin/api/analytics/providers",
      headers: { cookie },
    });
    expect(defaultWindow.res.statusCode).toBe(200);
    expect(adminReadModels.providers).toHaveBeenCalledWith(14);

    for (const value of ["0", "91", "-1", "1.5", "abc"]) {
      const { res } = await invoke(portal, {
        url: `/admin/api/analytics/providers?days=${encodeURIComponent(value)}`,
        headers: { cookie },
      });
      expect(res.statusCode, value).toBe(400);
      expect(parsePayload(res).error.code, value).toBe("INVALID_ADMIN_QUERY");
    }
  });

  it("C1-API-05 rejects non-GET reads and preserves the stable unknown-route 404", async () => {
    const { portal } = createHarness();
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);

    const mutation = await invoke(portal, {
      method: "POST",
      url: "/admin/api/overview",
      headers: { cookie },
    });
    expect(mutation.res.statusCode).toBe(405);
    expect(parsePayload(mutation.res).error.code).toBe("ADMIN_METHOD_NOT_ALLOWED");

    const missing = await invoke(portal, {
      url: "/admin/api/analytics/not-real",
      headers: { cookie },
    });
    expect(missing.res.statusCode).toBe(404);
    expect(parsePayload(missing.res).error.code).toBe("ADMIN_RESOURCE_NOT_FOUND");
  });

  it("C1-API-06 rate limits aggregate reads without consuming the login limiter", async () => {
    const adminReadRateLimiter = {
      consume: vi.fn(() => ({ allowed: false, resetAt: 6_000 })),
    };
    const { portal, adminReadModels } = createHarness({
      adminReadRateLimiter,
      nowImpl: () => 1_000,
    });
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);
    const { res } = await invoke(portal, {
      url: "/admin/api/overview",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe("5");
    expect(parsePayload(res).error.code).toBe("ADMIN_RATE_LIMITED");
    expect(adminReadModels.overview).not.toHaveBeenCalled();
  });

  it("C1-API-07 hides read-model failures behind ADMIN_STORAGE_UNAVAILABLE", async () => {
    const storageError = Object.assign(new Error("sqlite /secret/path failed"), {
      code: "ADMIN_STORAGE_UNAVAILABLE",
      statusCode: 503,
    });
    const adminReadModels = {
      overview: vi.fn(() => {
        throw storageError;
      }),
    };
    const { portal } = createHarness({ adminReadModels });
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);
    const { res } = await invoke(portal, {
      url: "/admin/api/overview",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(503);
    expect(parsePayload(res)).toEqual({
      ok: false,
      error: { code: "ADMIN_STORAGE_UNAVAILABLE" },
    });
    expect(String(res.payload)).not.toContain("secret/path");
  });
});

describe("Phase 11B1-R1 admin portal authority", () => {
  it("R1-ADMIN-01 redirects root to the independent Admin surface", async () => {
    const { portal } = createHarness();
    const { handled, res } = await invoke(portal, { url: "/" });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(303);
    expect(res.headers.Location).toBe("/admin");
  });

  it("R1-ADMIN-02 strips long-lived query credentials before legacy Admin routing", async () => {
    const { portal } = createHarness();
    const stripped = await invoke(portal, { url: "/admin/data?adminToken=query-credential&next=1" });
    expect(stripped.handled).toBe(true);
    expect(stripped.res.statusCode).toBe(303);
    expect(stripped.res.headers.Location).toBe("/admin/data?next=1");
    expect(stripped.res.headers.Location).not.toContain("query-credential");

    const clean = await invoke(portal, { url: "/admin/data" });
    expect(clean.handled).toBe(false);
  });

  it("R1-ADMIN-03 fails closed when Admin auth is not configured", async () => {
    const { portal } = createHarness({ adminToken: "" });
    const { res } = await invoke(portal, { url: "/admin/login" });
    expect(res.statusCode).toBe(503);
    expect(parsePayload(res)).toEqual({
      ok: false,
      error: "ADMIN_AUTH_NOT_CONFIGURED",
    });
  });

  it("R1-ADMIN-04 exchanges the long-lived secret for a scoped HttpOnly session", async () => {
    const { portal } = createHarness();
    const { res } = await login(portal);
    expect(res.statusCode).toBe(303);
    expect(res.headers.Location).toBe("/admin");
    expect(res.headers["Set-Cookie"]).toContain("HttpOnly");
    expect(res.headers["Set-Cookie"]).toContain("SameSite=Strict");
    expect(res.headers["Set-Cookie"]).toContain("Path=/admin");
    expect(res.headers["Set-Cookie"]).toContain("Max-Age=28800");
    expect(res.headers["Set-Cookie"]).toContain("Secure");
    expect(res.headers["Set-Cookie"]).not.toContain("real-admin-secret");
  });

  it("R1-ADMIN-05 keeps browser Admin API authority cookie-only", async () => {
    const { portal } = createHarness();
    const bearerOnly = await invoke(portal, {
      url: "/admin/api/session",
      headers: { authorization: "Bearer real-admin-secret" },
    });
    expect(bearerOnly.res.statusCode).toBe(401);
    expect(parsePayload(bearerOnly.res).error.code).toBe("ADMIN_SESSION_REQUIRED");

    const signedIn = await login(portal);
    const authorized = await invoke(portal, {
      url: "/admin/api/session",
      headers: { cookie: cookiePair(signedIn.res) },
    });
    expect(authorized.res.statusCode).toBe(200);
    const payload = parsePayload(authorized.res);
    expect(payload.ok).toBe(true);
    expect(payload.expiresAt).toBe(new Date(1_000 + 8 * 60 * 60 * 1000).toISOString());
    expect(String(authorized.res.payload)).not.toContain("session-1");
  });

  it("R1-ADMIN-06 enforces the configured public origin on Admin mutations", async () => {
    const { portal } = createHarness({ publicBaseUrl: "https://analytics.example.test" });
    const rejected = await login(portal, "real-admin-secret", {
      origin: "https://evil.example",
    });
    expect(rejected.res.statusCode).toBe(403);
    expect(parsePayload(rejected.res).error).toBe("ADMIN_ORIGIN_REJECTED");
    expect(rejected.res.headers["Set-Cookie"]).toBeUndefined();

    const opaqueOrigin = await login(portal, "real-admin-secret", {
      origin: "null",
    });
    expect(opaqueOrigin.res.statusCode).toBe(403);
    expect(parsePayload(opaqueOrigin.res).error).toBe("ADMIN_ORIGIN_REJECTED");
    expect(opaqueOrigin.res.headers["Set-Cookie"]).toBeUndefined();

    const accepted = await login(portal, "real-admin-secret", {
      origin: "https://analytics.example.test",
    });
    expect(accepted.res.statusCode).toBe(303);
  });

  it("R1-ADMIN-07 gates assets by session and rejects traversal", async () => {
    const { portal } = createHarness();
    const denied = await invoke(portal, { url: "/admin/assets/app.js" });
    expect(denied.res.statusCode).toBe(401);
    expect(parsePayload(denied.res).error.code).toBe("ADMIN_SESSION_REQUIRED");

    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);
    const asset = await invoke(portal, {
      url: "/admin/assets/app.js",
      headers: { cookie },
    });
    expect(asset.res.statusCode).toBe(200);
    expect(asset.res.headers["Content-Type"]).toContain("text/javascript");
    expect(String(asset.res.payload)).toContain("admin-test");

    const traversal = await invoke(portal, {
      url: "/admin/assets/..%2F..%2Fanalytics-server%2Flib%2Fserver.mjs",
      headers: { cookie },
    });
    expect(traversal.res.statusCode).toBe(404);
    expect(parsePayload(traversal.res).error.code).toBe("ADMIN_RESOURCE_NOT_FOUND");
  });

  it("R1-ADMIN-08 serves only known protected app routes", async () => {
    const { portal } = createHarness();
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);

    for (const url of ["/admin", "/admin/users", "/admin/analytics", "/admin/system", "/admin/audit"]) {
      const { res } = await invoke(portal, { url, headers: { cookie } });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["Content-Security-Policy"], url).toBe(ADMIN_CSP);
    }

    const unknown = await invoke(portal, { url: "/admin/not-a-page", headers: { cookie } });
    expect(unknown.res.statusCode).toBe(404);
    expect(parsePayload(unknown.res).error.code).toBe("ADMIN_RESOURCE_NOT_FOUND");
  });

  it("R1-ADMIN-09 fails closed when the Admin artifact is missing", async () => {
    const missing = path.join(os.tmpdir(), "quiz-admin-r1-definitely-missing");
    fs.rmSync(missing, { recursive: true, force: true });
    const { portal } = createHarness({ adminDistDir: missing });
    const signedIn = await login(portal);
    const { res } = await invoke(portal, {
      url: "/admin",
      headers: { cookie: cookiePair(signedIn.res) },
    });
    expect(res.statusCode).toBe(503);
    expect(parsePayload(res).error.code).toBe("ADMIN_APP_NOT_BUILT");
  });

  it("R1-ADMIN-10 returns a stable unknown Admin API contract", async () => {
    const { portal } = createHarness();
    const { res } = await invoke(portal, { url: "/admin/api/not-a-route" });
    expect(res.statusCode).toBe(404);
    expect(parsePayload(res)).toEqual({
      ok: false,
      error: { code: "ADMIN_RESOURCE_NOT_FOUND" },
    });
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("R1-ADMIN-11 revokes the session on logout", async () => {
    const { portal } = createHarness();
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);

    const sessionState = await invoke(portal, {
      url: "/admin/api/session",
      headers: { cookie },
    });
    const csrfToken = parsePayload(sessionState.res).csrfToken;

    const logout = await invoke(portal, {
      method: "POST",
      url: "/admin/logout",
      headers: {
        cookie,
        origin: "https://analytics.example.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrfToken }).toString(),
    });
    expect(logout.res.statusCode).toBe(303);
    expect(logout.res.headers.Location).toBe("/admin/login");
    expect(logout.res.headers["Set-Cookie"]).toContain("Max-Age=0");

    const session = await invoke(portal, {
      url: "/admin/api/session",
      headers: { cookie },
    });
    expect(session.res.statusCode).toBe(401);
  });

  it("R1-ADMIN-12 preserves the bounded Admin login rate-limit contract", async () => {
    const rateLimiter = {
      consume: () => ({ allowed: false, resetAt: 6_000 }),
    };
    const { portal } = createHarness({ rateLimiter, nowImpl: () => 1_000 });
    const { res } = await login(portal);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe("5");
    expect(parsePayload(res).error).toBe("rate limit exceeded; retry after 5s");
    expect(res.headers["Set-Cookie"]).toBeUndefined();
  });

  it("E-PORTAL-01 returns per-session CSRF without exposing the session cookie value", async () => {
    const { portal } = createHarness();
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);
    const { res } = await invoke(portal, {
      url: "/admin/api/session",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const payload = parsePayload(res);
    expect(payload.csrfToken).toBe("csrf-1");
    expect(String(res.payload)).not.toContain("session-1");
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("E-PORTAL-02 rejects missing/wrong logout CSRF and preserves the live session", async () => {
    const { portal, adminAuditRecorder } = createHarness();
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);

    for (const csrfToken of ["", "wrong-csrf"]) {
      const rejected = await invoke(portal, {
        method: "POST",
        url: "/admin/logout",
        headers: {
          cookie,
          origin: "https://analytics.example.test",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrfToken }).toString(),
      });
      expect(rejected.res.statusCode, csrfToken).toBe(403);
      expect(parsePayload(rejected.res).error, csrfToken).toBe("ADMIN_CSRF_REJECTED");

      const stillLive = await invoke(portal, {
        url: "/admin/api/session",
        headers: { cookie },
      });
      expect(stillLive.res.statusCode, csrfToken).toBe(200);
    }

    expect(adminAuditRecorder).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "admin_csrf_rejected",
        outcome: "rejected",
        metadata: expect.objectContaining({ path: "/admin/logout" }),
      }),
    );
  });

  it("E-PORTAL-02B rejects a CSRF token issued to a different live Admin session", async () => {
    const { portal } = createHarness();

    const firstLogin = await login(portal);
    const firstCookie = cookiePair(firstLogin.res);
    const firstState = await invoke(portal, {
      url: "/admin/api/session",
      headers: { cookie: firstCookie },
    });
    const firstCsrf = parsePayload(firstState.res).csrfToken;

    const secondLogin = await login(portal);
    const secondCookie = cookiePair(secondLogin.res);
    const secondState = await invoke(portal, {
      url: "/admin/api/session",
      headers: { cookie: secondCookie },
    });
    const secondCsrf = parsePayload(secondState.res).csrfToken;

    expect(secondCsrf).not.toBe(firstCsrf);

    const rejected = await invoke(portal, {
      method: "POST",
      url: "/admin/logout",
      headers: {
        cookie: secondCookie,
        origin: "https://analytics.example.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrfToken: firstCsrf }).toString(),
    });
    expect(rejected.res.statusCode).toBe(403);
    expect(parsePayload(rejected.res).error).toBe("ADMIN_CSRF_REJECTED");

    const firstStillLive = await invoke(portal, {
      url: "/admin/api/session",
      headers: { cookie: firstCookie },
    });
    const secondStillLive = await invoke(portal, {
      url: "/admin/api/session",
      headers: { cookie: secondCookie },
    });
    expect(firstStillLive.res.statusCode).toBe(200);
    expect(secondStillLive.res.statusCode).toBe(200);
  });

  it("E-PORTAL-03 audits login failure, login success, and logout without raw secrets", async () => {
    const adminAuditRecorder = vi.fn();
    const { portal } = createHarness({ adminAuditRecorder });

    const failed = await login(portal, "wrong-secret");
    expect(failed.res.statusCode).toBe(401);

    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);
    const sessionState = await invoke(portal, {
      url: "/admin/api/session",
      headers: { cookie },
    });
    const csrfToken = parsePayload(sessionState.res).csrfToken;

    const logout = await invoke(portal, {
      method: "POST",
      url: "/admin/logout",
      headers: {
        cookie,
        origin: "https://analytics.example.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrfToken }).toString(),
    });
    expect(logout.res.statusCode).toBe(303);

    expect(adminAuditRecorder).toHaveBeenCalledWith(
      expect.objectContaining({ event: "admin_login", outcome: "failure" }),
    );
    expect(adminAuditRecorder).toHaveBeenCalledWith(
      expect.objectContaining({ event: "admin_login", outcome: "success" }),
    );
    expect(adminAuditRecorder).toHaveBeenCalledWith(
      expect.objectContaining({ event: "admin_logout", outcome: "success" }),
    );

    const serializedCalls = JSON.stringify(adminAuditRecorder.mock.calls);
    expect(serializedCalls).not.toContain("real-admin-secret");
    expect(serializedCalls).not.toContain("wrong-secret");
    expect(serializedCalls).not.toContain(csrfToken);
  });

  it("E-PORTAL-04 keeps the Audit read API cookie-only and bounded", async () => {
    const adminAuditReadModel = {
      list: vi.fn((query) => ({
        generatedAt: "2026-10-07T12:00:00.000Z",
        data: [],
        page: { limit: query.limit, nextCursor: null },
      })),
    };
    const { portal } = createHarness({ adminAuditReadModel });

    const anonymous = await invoke(portal, { url: "/admin/api/audit" });
    expect(anonymous.res.statusCode).toBe(401);

    const bearer = await invoke(portal, {
      url: "/admin/api/audit",
      headers: { authorization: "Bearer real-admin-secret" },
    });
    expect(bearer.res.statusCode).toBe(401);

    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);
    const ok = await invoke(portal, {
      url: "/admin/api/audit?limit=25",
      headers: { cookie },
    });
    expect(ok.res.statusCode).toBe(200);
    expect(adminAuditReadModel.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, cursor: null }),
    );

    const unknown = await invoke(portal, {
      url: "/admin/api/audit?q=secret",
      headers: { cookie },
    });
    expect(unknown.res.statusCode).toBe(400);
    expect(parsePayload(unknown.res).error.code).toBe("INVALID_ADMIN_QUERY");
  });

  it("E-PORTAL-05 applies hardened security headers to redirects and errors", async () => {
    const { portal } = createHarness();

    const root = await invoke(portal, { url: "/" });
    expect(root.res.statusCode).toBe(303);
    expect(root.res.headers["Content-Security-Policy"]).toBe(ADMIN_CSP);
    expect(root.res.headers["Referrer-Policy"]).toBe("strict-origin");
    expect(root.res.headers["X-Frame-Options"]).toBe("DENY");
    expect(root.res.headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(root.res.headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(root.res.headers["Permissions-Policy"]).toContain("camera=()");

    const loginPage = await invoke(portal, { url: "/admin/login" });
    expect(loginPage.res.statusCode).toBe(200);
    expect(loginPage.res.headers["Referrer-Policy"]).toBe("strict-origin");
    expect(String(loginPage.res.payload)).toContain(
      '<meta name="referrer" content="strict-origin">',
    );

    const unknown = await invoke(portal, { url: "/admin/api/not-real" });
    expect(unknown.res.statusCode).toBe(404);
    expect(unknown.res.headers["Content-Security-Policy"]).toBe(ADMIN_CSP);
    expect(unknown.res.headers["X-Frame-Options"]).toBe("DENY");
  });

  it("E-PORTAL-07 isolates Audit read rate limits from other Admin reads", async () => {
    const adminAuditReadRateLimiter = {
      consume: vi.fn(() => ({ allowed: false, resetAt: 6_000 })),
    };
    const adminReadRateLimiter = {
      consume: vi.fn(() => ({ allowed: true, resetAt: 6_000 })),
    };
    const adminUsersReadRateLimiter = {
      consume: vi.fn(() => ({ allowed: true, resetAt: 6_000 })),
    };
    const adminSystemReadRateLimiter = {
      consume: vi.fn(() => ({ allowed: true, resetAt: 6_000 })),
    };
    const {
      portal,
      adminReadModels,
      adminManagementReadModels,
      adminAuditReadModel,
    } = createHarness({
      adminAuditReadRateLimiter,
      adminReadRateLimiter,
      adminUsersReadRateLimiter,
      adminSystemReadRateLimiter,
      nowImpl: () => 1_000,
    });
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);

    const audit = await invoke(portal, {
      url: "/admin/api/audit",
      headers: { cookie },
    });
    expect(audit.res.statusCode).toBe(429);
    expect(parsePayload(audit.res).error.code).toBe("ADMIN_RATE_LIMITED");
    expect(adminAuditReadModel.list).not.toHaveBeenCalled();

    const overview = await invoke(portal, {
      url: "/admin/api/overview",
      headers: { cookie },
    });
    expect(overview.res.statusCode).toBe(200);
    expect(adminReadModels.overview).toHaveBeenCalledTimes(1);

    const users = await invoke(portal, {
      url: "/admin/api/users",
      headers: { cookie },
    });
    expect(users.res.statusCode).toBe(200);
    expect(adminManagementReadModels.users).toHaveBeenCalledTimes(1);

    const system = await invoke(portal, {
      url: "/admin/api/system",
      headers: { cookie },
    });
    expect(system.res.statusCode).toBe(200);
    expect(adminManagementReadModels.system).toHaveBeenCalledTimes(1);
  });

  it("E-PORTAL-10 bounds rejection-audit writes and ignores anonymous mutation spam", async () => {
    const adminAuditRecorder = vi.fn();
    const adminSecurityAuditRateLimiter = {
      consume: vi.fn(() => ({ allowed: false, resetAt: 6_000 })),
    };
    const { portal } = createHarness({
      adminAuditRecorder,
      adminSecurityAuditRateLimiter,
      nowImpl: () => 1_000,
    });

    const anonymousMutation = await invoke(portal, {
      method: "POST",
      url: "/admin/api/unknown-secret-looking-path",
    });
    expect(anonymousMutation.res.statusCode).toBe(404);
    expect(adminAuditRecorder).not.toHaveBeenCalled();

    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);
    adminAuditRecorder.mockClear();

    const authenticatedMutation = await invoke(portal, {
      method: "POST",
      url: "/admin/api/users",
      headers: { cookie },
    });
    expect(authenticatedMutation.res.statusCode).toBe(405);
    expect(adminSecurityAuditRateLimiter.consume).toHaveBeenCalled();
    expect(adminAuditRecorder).not.toHaveBeenCalled();

    const crossOriginLogout = await invoke(portal, {
      method: "POST",
      url: "/admin/logout",
      headers: {
        cookie,
        origin: "https://evil.example",
      },
    });
    expect(crossOriginLogout.res.statusCode).toBe(403);
    expect(parsePayload(crossOriginLogout.res).error).toBe("ADMIN_ORIGIN_REJECTED");
    expect(adminAuditRecorder).not.toHaveBeenCalled();
  });

  it("E-PORTAL-11 records authenticated mutation attempts with fixed path vocabulary", async () => {
    const adminAuditRecorder = vi.fn();
    const { portal } = createHarness({ adminAuditRecorder });
    const signedIn = await login(portal);
    const cookie = cookiePair(signedIn.res);
    adminAuditRecorder.mockClear();

    const known = await invoke(portal, {
      method: "POST",
      url: "/admin/api/users",
      headers: { cookie },
    });
    expect(known.res.statusCode).toBe(405);
    expect(adminAuditRecorder).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "admin_mutation_rejected",
        outcome: "rejected",
        metadata: {
          method: "POST",
          path: "/admin/api/users",
          reason: "unsupported_mutation",
        },
      }),
    );

    adminAuditRecorder.mockClear();
    const unknown = await invoke(portal, {
      method: "POST",
      url: "/admin/api/attackerSecret123",
      headers: { cookie },
    });
    expect(unknown.res.statusCode).toBe(404);
    expect(adminAuditRecorder).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          method: "POST",
          path: "/admin/api/unknown",
          reason: "unsupported_mutation",
        },
      }),
    );
    expect(JSON.stringify(adminAuditRecorder.mock.calls)).not.toContain(
      "attackerSecret123",
    );
  });

  it("E-PORTAL-08 binds unique CSRF tokens to each Admin session", async () => {
    const { portal } = createHarness();

    const firstLogin = await login(portal);
    const firstCookie = cookiePair(firstLogin.res);
    const firstState = await invoke(portal, {
      url: "/admin/api/session",
      headers: { cookie: firstCookie },
    });
    const firstCsrf = parsePayload(firstState.res).csrfToken;

    const secondLogin = await login(portal);
    const secondCookie = cookiePair(secondLogin.res);
    const secondState = await invoke(portal, {
      url: "/admin/api/session",
      headers: { cookie: secondCookie },
    });
    const secondCsrf = parsePayload(secondState.res).csrfToken;

    expect(firstCsrf).not.toBe(secondCsrf);

    const crossSession = await invoke(portal, {
      method: "POST",
      url: "/admin/logout",
      headers: {
        cookie: secondCookie,
        origin: "https://analytics.example.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrfToken: firstCsrf }).toString(),
    });
    expect(crossSession.res.statusCode).toBe(403);
    expect(parsePayload(crossSession.res).error).toBe("ADMIN_CSRF_REJECTED");

    const secondStillLive = await invoke(portal, {
      url: "/admin/api/session",
      headers: { cookie: secondCookie },
    });
    expect(secondStillLive.res.statusCode).toBe(200);
    expect(parsePayload(secondStillLive.res).csrfToken).toBe(secondCsrf);
  });

  it("E-PORTAL-09 audits Admin login rate-limit rejections without credentials", async () => {
    const adminAuditRecorder = vi.fn();
    const rateLimiter = {
      consume: () => ({ allowed: false, resetAt: 6_000 }),
    };
    const { portal } = createHarness({
      rateLimiter,
      adminAuditRecorder,
      nowImpl: () => 1_000,
    });

    const { res } = await login(portal, "real-admin-secret");
    expect(res.statusCode).toBe(429);
    expect(adminAuditRecorder).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "admin_login",
        outcome: "rejected",
        metadata: expect.objectContaining({ reason: "rate_limited" }),
      }),
    );
    expect(JSON.stringify(adminAuditRecorder.mock.calls)).not.toContain(
      "real-admin-secret",
    );
  });

  it("E-PORTAL-06 fails closed if a successful login cannot be audited", async () => {
    const { portal } = createHarness({
      adminAuditRecorder: vi.fn(() => {
        const error = new Error("ADMIN_STORAGE_UNAVAILABLE");
        error.code = "ADMIN_STORAGE_UNAVAILABLE";
        error.statusCode = 503;
        throw error;
      }),
    });

    const loginAttempt = await login(portal);
    expect(loginAttempt.res.statusCode).toBe(503);
    expect(loginAttempt.res.headers["Set-Cookie"]).toBeUndefined();
    expect(parsePayload(loginAttempt.res).error).toBe("ADMIN_STORAGE_UNAVAILABLE");
  });

});
