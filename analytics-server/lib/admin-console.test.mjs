// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ADMIN_CSP, createAdminPortal } from "./admin-console.mjs";
import { createAnalyticsHandler } from "./server.mjs";

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

const EMPTY_DB = () => ({ devices: [], users: [], analytics_events: [], email_verification_codes: [] });

function createAdminDistFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-admin-dist-"));
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html lang="zh-CN"><head><title>Quiz Solver Admin Console</title>` +
      `<link rel="stylesheet" href="/admin/assets/admin-test.css">` +
      `<script type="module" src="/admin/assets/admin-test.js"></script></head>` +
      `<body><div id="admin-root"></div></body></html>`,
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "assets", "admin-test.js"), 'console.log("admin scaffold artifact");\n', "utf8");
  fs.writeFileSync(path.join(dir, "assets", "admin-test.css"), "#admin-root{display:block}\n", "utf8");
  fs.writeFileSync(path.join(dir, "admin-login.css"), ".admin-login-panel{margin:0 auto}\n", "utf8");
  return dir;
}

function createHandler(options = {}) {
  const adminDistDir = options.adminDistDir === undefined ? createAdminDistFixture() : options.adminDistDir;
  const handler = createAnalyticsHandler({
    adminToken: "real-admin-secret",
    isMailerConfigured: () => false,
    loadDbImpl: EMPTY_DB,
    sendVerificationCodeEmail: vi.fn(),
    ...options,
    adminDistDir,
  });
  handler.__adminDistDir = adminDistDir;
  return handler;
}

function formBody(token) {
  return new URLSearchParams({ adminToken: token }).toString();
}

function sessionCookie(res) {
  return String(res.headers["Set-Cookie"] || "").split(";", 1)[0];
}

function cookieValue(res) {
  const cookie = sessionCookie(res);
  return cookie.slice(cookie.indexOf("=") + 1).split(";")[0];
}

async function login(handler, token = "real-admin-secret") {
  return invoke(handler, {
    method: "POST",
    url: "/admin/login",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formBody(token),
  });
}

function loginAsSession(handler) {
  return login(handler).then((signedIn) => sessionCookie(signedIn.res));
}

describe("ADMIN11B1 admin portal auth", () => {
  it("ADMIN11B1-01: GET /admin without a session redirects to /admin/login", async () => {
    const handler = createHandler();
    for (const url of ["/admin", "/admin/", "/admin/users", "/admin?adminToken=real-admin-secret"]) {
      const { res } = await invoke(handler, { url });
      expect(res.statusCode, url).toBe(303);
      expect(res.headers.Location, url).toBe("/admin/login");
      expect(String(res.payload || ""), url).not.toContain("real-admin-secret");
    }
  });

  it("ADMIN11B1-02: GET /admin/login renders a native password form and escapes dynamic config", async () => {
    const hostileBaseUrl = 'https://analytics.example"><script>alert(1)</script>';
    const handler = createHandler({ publicBaseUrl: hostileBaseUrl });
    const { res } = await invoke(handler, { url: "/admin/login" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toContain("text/html");
    expect(res.payload).toContain('method="POST" action="/admin/login"');
    expect(res.payload).toContain('name="adminToken" type="password" autocomplete="current-password"');
    expect(res.payload).toContain('rel="stylesheet" href="/admin/admin-login.css"');
    expect(res.payload).not.toContain("method=\"GET\"");
    expect(res.payload).not.toContain("<script>alert(1)</script>");
    expect(res.payload).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("ADMIN11B1-03: wrong admin secret is rejected with 401 and no cookie", async () => {
    const handler = createHandler();
    const { res } = await login(handler, "wrong-secret");
    expect(res.statusCode).toBe(401);
    expect(res.headers["Set-Cookie"]).toBeUndefined();
    expect(res.payload).not.toContain("wrong-secret");
  });

  it("ADMIN11B1-04: a valid login issues a fresh random HttpOnly session cookie", async () => {
    const handler = createHandler();
    const first = await login(handler);
    expect(first.res.statusCode).toBe(303);
    expect(first.res.headers.Location).toBe("/admin");
    expect(first.res.headers["Set-Cookie"]).toContain("HttpOnly");
    expect(first.res.headers["Set-Cookie"]).not.toContain("real-admin-secret");
    const second = await login(handler);
    expect(cookieValue(second.res)).toBeTruthy();
    expect(cookieValue(second.res)).not.toBe(cookieValue(first.res));
  });

  it("ADMIN11B1-05: production cookies are marked Secure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const byEnv = await login(createHandler());
      expect(byEnv.res.headers["Set-Cookie"]).toContain("Secure");
    } finally {
      vi.unstubAllEnvs();
    }
    const byHttps = await login(createHandler({ publicBaseUrl: "https://analytics.082515.online" }));
    expect(byHttps.res.headers["Set-Cookie"]).toContain("Secure");
  });

  it("ADMIN11B1-06: the session cookie is SameSite=Strict", async () => {
    const handler = createHandler();
    const { res } = await login(handler);
    expect(res.headers["Set-Cookie"]).toContain("SameSite=Strict");
  });

  it("ADMIN11B1-07: the session cookie Path is narrowed to /admin", async () => {
    const handler = createHandler();
    const { res } = await login(handler);
    expect(res.headers["Set-Cookie"]).toContain("Path=/admin");
    expect(res.headers["Set-Cookie"]).not.toMatch(/Path=\/(?!admin)/);
  });

  it("ADMIN11B1-08: an expired session is denied across the protected Admin surface", async () => {
    let now = 1_000;
    const handler = createHandler({ nowImpl: () => now, adminSessionTtlMs: 500 });
    const signedIn = await login(handler);
    const cookie = sessionCookie(signedIn.res);
    now += 501;
    const shell = await invoke(handler, { url: "/admin", headers: { cookie } });
    expect(shell.res.statusCode).toBe(303);
    expect(shell.res.headers.Location).toBe("/admin/login");
    const api = await invoke(handler, { url: "/admin/api/session", headers: { cookie } });
    expect(api.res.statusCode).toBe(401);
    expect(parsePayload(api.res).error).toBe("ADMIN_SESSION_REQUIRED");
    const legacyData = await invoke(handler, { url: "/admin/data", headers: { cookie } });
    expect(legacyData.res.statusCode).toBe(401);
  });

  it("ADMIN11B1-09: logout revokes the server session and clears the cookie", async () => {
    const handler = createHandler();
    const credential = await loginAsSession(handler);
    const loggedOut = await invoke(handler, {
      method: "POST",
      url: "/admin/logout",
      headers: { cookie: credential },
    });
    expect(loggedOut.res.statusCode).toBe(303);
    expect(loggedOut.res.headers.Location).toBe("/admin/login");
    const cleared = String(loggedOut.res.headers["Set-Cookie"]);
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("Path=/admin");
    const replay = await invoke(handler, { url: "/admin/api/session", headers: { cookie: credential } });
    expect(replay.res.statusCode).toBe(401);
    const shell = await invoke(handler, { url: "/admin", headers: { cookie: credential } });
    expect(shell.res.statusCode).toBe(303);
  });

  it("ADMIN11B1-10: a missing ANALYTICS_ADMIN_TOKEN fails closed on the Admin surface", async () => {
    const loadDbImpl = vi.fn();
    const handler = createHandler({ adminToken: "", loadDbImpl });
    const api = await invoke(handler, { url: "/admin/api/session" });
    expect(api.res.statusCode).toBe(503);
    expect(parsePayload(api.res).error).toBe("ADMIN_AUTH_NOT_CONFIGURED");
    const gate = await login(handler, "real-admin-secret");
    expect(gate.res.statusCode).toBe(503);
    expect(gate.res.payload).toContain("ADMIN_AUTH_NOT_CONFIGURED");
    expect(gate.res.headers["Set-Cookie"]).toBeUndefined();
    const shell = await invoke(handler, { url: "/admin" });
    expect(shell.res.statusCode).toBe(303);
    expect(loadDbImpl).not.toHaveBeenCalled();
  });
});

describe("ADMIN11B1 secret leakage", () => {
  it("ADMIN11B1-11: the long-lived admin token never appears in served Admin HTML", async () => {
    const handler = createHandler();
    const credential = await loginAsSession(handler);
    for (const url of ["/admin/login", "/admin"]) {
      const { res } = await invoke(handler, { url, headers: url === "/admin" ? { cookie: credential } : {} });
      expect(res.statusCode, url).toBe(200);
      expect(res.payload, url).not.toContain("real-admin-secret");
      expect(res.payload, url).not.toContain("ANALYTICS_ADMIN_TOKEN");
    }
  });

  it("ADMIN11B1-12: served JS assets are byte-identical to the built artifact", async () => {
    const handler = createHandler();
    const { res } = await invoke(handler, { url: "/admin/assets/admin-test.js" });
    expect(res.statusCode).toBe(200);
    const onDisk = fs.readFileSync(path.join(handler.__adminDistDir, "assets", "admin-test.js"), "utf8");
    expect(Buffer.isBuffer(res.payload)).toBe(true);
    expect(res.payload.toString("utf8")).toBe(onDisk);
  });

  it("ADMIN11B1-13: the session credential is never embedded into the Admin shell HTML", async () => {
    const handler = createHandler({ createAdminSessionToken: () => "short-session-credential" });
    const credential = await loginAsSession(handler);
    const { res } = await invoke(handler, { url: "/admin", headers: { cookie: credential } });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain("short-session-credential");
    expect(res.payload).not.toContain("analytics_admin_session=");
  });

  it("ADMIN11B1-14: an adminToken in the query never grants Admin authority", async () => {
    const handler = createHandler();
    const shell = await invoke(handler, { url: "/admin?adminToken=real-admin-secret" });
    expect(shell.res.statusCode).toBe(303);
    expect(shell.res.headers.Location).toBe("/admin/login");
    const api = await invoke(handler, { url: "/admin/api/session?adminToken=real-admin-secret" });
    expect(api.res.statusCode).toBe(401);
    const legacy = await invoke(handler, { url: "/admin/data?adminToken=real-admin-secret" });
    expect(legacy.res.statusCode).toBe(401);
    const deep = await invoke(handler, { url: "/admin/users?adminToken=real-admin-secret" });
    expect(deep.res.statusCode).toBe(303);
  });
});

describe("ADMIN11B1 admin api authority", () => {
  it("ADMIN11B1-15: unauthorized session probes get one stable 401 contract", async () => {
    const handler = createHandler();
    for (const headers of [{}, { cookie: "analytics_admin_session=forged-credential" }]) {
      const { res } = await invoke(handler, { url: "/admin/api/session", headers });
      expect(res.statusCode).toBe(401);
      expect(parsePayload(res)).toEqual({ ok: false, error: "ADMIN_SESSION_REQUIRED" });
    }
    const unknown = await invoke(handler, { url: "/admin/api/unknown" });
    expect(unknown.res.statusCode).toBe(404);
    expect(parsePayload(unknown.res).error).toBe("ADMIN_NOT_FOUND");
  });

  it("ADMIN11B1-16: a valid session cookie authorizes the session endpoint", async () => {
    const handler = createHandler();
    const credential = await loginAsSession(handler);
    const { res } = await invoke(handler, { url: "/admin/api/session", headers: { cookie: credential } });
    expect(res.statusCode).toBe(200);
    const payload = parsePayload(res);
    expect(payload.ok).toBe(true);
    expect(payload.session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("ADMIN11B1-17: the long-lived Bearer token is not a browser Admin authority", async () => {
    const handler = createHandler();
    const api = await invoke(handler, {
      url: "/admin/api/session",
      headers: { authorization: "Bearer real-admin-secret" },
    });
    expect(api.res.statusCode).toBe(401);
    expect(parsePayload(api.res).error).toBe("ADMIN_SESSION_REQUIRED");
    const shell = await invoke(handler, {
      url: "/admin",
      headers: { authorization: "Bearer real-admin-secret" },
    });
    expect(shell.res.statusCode).toBe(303);
    expect(shell.res.headers.Location).toBe("/admin/login");
    // The Admin API namespace stays cookie-only: no CORS echo for any origin.
    const cors = await invoke(handler, {
      url: "/admin/api/session",
      headers: { origin: "chrome-extension://abcdefghijklmnop" },
    });
    expect(cors.res.statusCode).toBe(401);
    expect(cors.headers?.["Access-Control-Allow-Origin"] ?? cors.res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

describe("ADMIN11B1 security headers", () => {
  it("ADMIN11B1-18: admin HTML responses carry the frozen CSP without unsafe directives", async () => {
    const handler = createHandler();
    const credential = await loginAsSession(handler);
    for (const request of [
      { url: "/admin/login" },
      { url: "/admin", headers: { cookie: credential } },
    ]) {
      const { res } = await invoke(handler, request);
      expect(res.statusCode, request.url).toBe(200);
      expect(res.headers["Content-Security-Policy"], request.url).toBe(ADMIN_CSP);
      expect(res.headers["Content-Security-Policy"], request.url).toContain("default-src 'self'");
      expect(res.headers["Content-Security-Policy"], request.url).toContain("script-src 'self'");
      expect(res.headers["Content-Security-Policy"], request.url).toContain("style-src 'self'");
      expect(res.headers["Content-Security-Policy"], request.url).toContain("connect-src 'self'");
      expect(res.headers["Content-Security-Policy"], request.url).toContain("form-action 'self'");
      expect(res.headers["Content-Security-Policy"], request.url).not.toContain("unsafe-inline");
      expect(res.headers["Content-Security-Policy"], request.url).not.toContain("unsafe-eval");
    }
  });

  it("ADMIN11B1-19: admin responses are nosniff", async () => {
    const handler = createHandler();
    const credential = await loginAsSession(handler);
    for (const request of [
      { url: "/admin/login" },
      { url: "/admin", headers: { cookie: credential } },
      { url: "/admin/api/session", headers: { cookie: credential } },
      { url: "/admin/assets/admin-test.js" },
      { url: "/admin/admin-login.css" },
    ]) {
      const { res } = await invoke(handler, request);
      expect(res.headers["X-Content-Type-Options"], request.url).toBe("nosniff");
    }
  });

  it("ADMIN11B1-20: admin responses forbid referrers", async () => {
    const handler = createHandler();
    const credential = await loginAsSession(handler);
    for (const request of [
      { url: "/admin/login" },
      { url: "/admin", headers: { cookie: credential } },
      { url: "/admin/api/session", headers: { cookie: credential } },
    ]) {
      const { res } = await invoke(handler, request);
      expect(res.headers["Referrer-Policy"], request.url).toBe("no-referrer");
    }
  });

  it("ADMIN11B1-21: admin pages cannot be framed", async () => {
    const handler = createHandler();
    const credential = await loginAsSession(handler);
    for (const request of [
      { url: "/admin/login" },
      { url: "/admin", headers: { cookie: credential } },
    ]) {
      const { res } = await invoke(handler, request);
      expect(res.headers["Content-Security-Policy"], request.url).toContain("frame-ancestors 'none'");
      expect(res.headers["Content-Security-Policy"], request.url).toContain("base-uri 'none'");
      expect(res.headers["Content-Security-Policy"], request.url).toContain("object-src 'none'");
    }
  });
});

describe("ADMIN11B1 static admin artifact serving", () => {
  it("serves the shell for deep SPA routes behind the session gate", async () => {
    const handler = createHandler();
    const credential = await loginAsSession(handler);
    const deep = await invoke(handler, { url: "/admin/users", headers: { cookie: credential } });
    expect(deep.res.statusCode).toBe(200);
    expect(deep.res.headers["Content-Type"]).toContain("text/html");
    expect(deep.res.payload).toContain("Quiz Solver Admin Console");
    expect(deep.res.headers["Cache-Control"]).toContain("no-store");
  });

  it("serves hashed assets with immutable caching and correct content types", async () => {
    const handler = createHandler();
    const script = await invoke(handler, { url: "/admin/assets/admin-test.js" });
    expect(script.res.statusCode).toBe(200);
    expect(script.res.headers["Content-Type"]).toContain("text/javascript");
    expect(script.res.headers["Cache-Control"]).toContain("immutable");
    const stylesheet = await invoke(handler, { url: "/admin/admin-login.css" });
    expect(stylesheet.res.statusCode).toBe(200);
    expect(stylesheet.res.headers["Content-Type"]).toContain("text/css");
    expect(stylesheet.res.headers["Cache-Control"]).toContain("no-store");
  });

  it("rejects asset path traversal and unknown asset types", async () => {
    const handler = createHandler();
    for (const url of [
      "/admin/assets/..%2f..%2fserver.mjs",
      "/admin/assets/%2e%2e%2fserver.mjs",
      "/admin/assets/..\\..\\server.mjs",
      "/admin/assets/admin-test.exe",
      "/admin/assets/missing.js",
    ]) {
      const { res } = await invoke(handler, { url });
      expect(res.statusCode, url).toBe(404);
      expect(String(res.payload || ""), url).not.toContain("createAnalyticsHandler");
    }
  });

  it("fails closed with the stable internal contract when the admin build is missing", async () => {
    const handler = createHandler({ adminDistDir: path.join(os.tmpdir(), "quiz-admin-dist-missing") });
    const credential = await loginAsSession(handler);
    const { res } = await invoke(handler, { url: "/admin", headers: { cookie: credential } });
    expect(res.statusCode).toBe(500);
    expect(res.payload).toContain("ADMIN_INTERNAL_ERROR");
    expect(res.payload).not.toContain("ENOENT");
    expect(res.payload).not.toContain("stack");
  });

  it("keeps the legacy /admin/data JSON API owned by the machine surface", async () => {
    const handler = createHandler();
    const bearer = await invoke(handler, {
      url: "/admin/data",
      headers: { authorization: "Bearer real-admin-secret" },
    });
    expect(bearer.res.statusCode).toBe(200);
    expect(parsePayload(bearer.res).ok).toBe(true);
  });
});

describe("ADMIN11B1 request forgery scaffold", () => {
  it("rejects foreign Origin headers on Admin form posts and allows same-origin", async () => {
    const handler = createHandler();
    const foreign = await invoke(handler, {
      method: "POST",
      url: "/admin/login",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://evil.example",
        host: "analytics.082515.online",
      },
      body: formBody("real-admin-secret"),
    });
    expect(foreign.res.statusCode).toBe(403);
    expect(foreign.res.headers["Set-Cookie"]).toBeUndefined();

    const sameOrigin = await invoke(handler, {
      method: "POST",
      url: "/admin/login",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://analytics.082515.online",
        host: "analytics.082515.online",
      },
      body: formBody("real-admin-secret"),
    });
    expect(sameOrigin.res.statusCode).toBe(303);
    expect(sameOrigin.res.headers["Set-Cookie"]).toContain("HttpOnly");

    // Server-to-server clients without Origin keep working.
    const noOrigin = await login(createHandler({ publicBaseUrl: "https://analytics.082515.online" }));
    expect(noOrigin.res.statusCode).toBe(303);
  });

  it("renders the rate limit contract for flooded logins with a Retry-After", async () => {
    const handler = createHandler();
    let last;
    for (let attempt = 0; attempt < 11; attempt += 1) last = await login(handler, "wrong-secret");
    expect(last.res.statusCode).toBe(429);
    expect(last.res.headers["Retry-After"]).toBe("900");
    expect(last.res.payload).toContain("ADMIN_RATE_LIMITED");
    expect(last.res.payload).toContain("retry after 900s");
    expect(last.res.headers["Set-Cookie"]).toBeUndefined();
  });
});

describe("ADMIN11B1 portal wiring", () => {
  it("requires a session store when constructed directly", () => {
    expect(() => createAdminPortal({ adminSessionTtlMs: 1000 })).toThrow(/adminSessions/);
  });
});
