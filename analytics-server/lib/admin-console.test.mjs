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
  adminReadModels = {
    overview: vi.fn((days) => ({ generatedAt: "2026-10-07T00:00:00.000Z", analyticsScope: "opt_in_only", window: { days } })),
    timeseries: vi.fn((days) => ({ kind: "timeseries", analyticsScope: "opt_in_only", window: { days }, data: [] })),
    providers: vi.fn((days) => ({ kind: "providers", analyticsScope: "opt_in_only", window: { days }, data: [] })),
    errors: vi.fn((days) => ({ kind: "errors", analyticsScope: "opt_in_only", window: { days }, data: [] })),
    versions: vi.fn((days) => ({ kind: "versions", analyticsScope: "opt_in_only", window: { days }, data: [] })),
    latency: vi.fn((days) => ({ kind: "latency", analyticsScope: "opt_in_only", window: { days }, data: [] })),
  },
  isProduction = () => false,
} = {}) {
  let sequence = 0;
  const adminSessions = createAdminSessionStore({
    createToken: () => `session-${++sequence}`,
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
    adminReadModels,
    nowImpl,
    publicBaseUrl,
    adminDistDir,
    isProduction,
  });
  return { portal, adminSessions, adminDistDir, adminReadModels };
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

    const logout = await invoke(portal, {
      method: "POST",
      url: "/admin/logout",
      headers: { cookie, origin: "https://analytics.example.test" },
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
});
