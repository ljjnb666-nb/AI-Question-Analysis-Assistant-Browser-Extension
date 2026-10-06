import { existsSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
import { buildAnalyticsSummary, buildTimeSeries } from "./metrics.mjs";
import {
  createEmailVerificationCodeInStorage,
  loadDb,
  loginUserInStorage,
  recordAnalyticsEventInStorage,
  registerUserWithVerificationCodeInStorage,
  revokeUserSessionInStorage,
  validateUserSessionInStorage,
  RegistrationError,
} from "./store.mjs";
import {
  createFixedWindowRateLimiter,
  DEFAULT_RATE_LIMIT_MAX_BUCKETS,
  normalizeIpAddress,
} from "./security.mjs";
import { normalizeRemoteAnalyticsEvent } from "./telemetry.mjs";
import { ADMIN_SESSION_MAX_COUNT, ADMIN_SESSION_TTL_MS, createAdminSessionStore } from "./admin-sessions.mjs";

const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
const EXTENSION_ORIGIN_PREFIX = "chrome-extension://";
const ADMIN_SESSION_COOKIE = "analytics_admin_session";
const ADMIN_LOGIN_LIMIT = 10;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_DIST_DIR = fileURLToPath(new URL("../../dist-admin/", import.meta.url));
const ADMIN_APP_PATHS = new Set(["/admin", "/admin/analytics", "/admin/users", "/admin/system", "/admin/audit"]);
const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function buildCorsHeaders(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return {};
  if (origin.startsWith(EXTENSION_ORIGIN_PREFIX)) {
    return {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
    };
  }
  return {};
}

function jsonHeaders(req) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Referrer-Policy": "no-referrer",
    ...buildCorsHeaders(req),
  };
}

function sendJson(req, res, statusCode, payload) {
  res.writeHead(statusCode, jsonHeaders(req));
  res.end(JSON.stringify(payload));
}

function adminHeaders(contentType, cacheControl = "no-store") {
  return {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "Content-Security-Policy": ADMIN_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

function sendAdminHtml(res, statusCode, html) {
  res.writeHead(statusCode, adminHeaders("text/html; charset=utf-8"));
  res.end(html);
}

function sendAdminJson(res, statusCode, payload) {
  res.writeHead(statusCode, adminHeaders("application/json; charset=utf-8"));
  res.end(JSON.stringify(payload));
}

function adminAssetContentType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function sendAdminFile(res, filePath, { html = false } = {}) {
  if (!existsSync(filePath)) {
    sendAdminJson(res, 503, { ok: false, error: { code: "ADMIN_APP_NOT_BUILT" } });
    return;
  }
  const contentType = html ? "text/html; charset=utf-8" : adminAssetContentType(filePath);
  const cacheControl = html ? "no-store" : "public, max-age=31536000, immutable";
  res.writeHead(200, adminHeaders(contentType, cacheControl));
  res.end(readFileSync(filePath));
}

function resolveAdminAsset(pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.slice("/admin/".length));
  } catch {
    return null;
  }
  const fullPath = resolve(ADMIN_DIST_DIR, relativePath);
  if (!fullPath.startsWith(`${resolve(ADMIN_DIST_DIR)}${sep}`)) return null;
  return fullPath;
}

function renderAdminTokenGateHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Quiz Solver Admin Login</title>
</head>
<body>
  <main>
    <form method="POST" action="/admin/login">
      <h1>Quiz Solver 管理后台</h1>
      <p>请输入管理口令以建立短期安全会话。</p>
      <label for="adminToken">Admin Token</label>
      <input id="adminToken" name="adminToken" type="password" autocomplete="current-password" required>
      <button type="submit">登录</button>
    </form>
  </main>
</body>
</html>`;
}

function ensureTrustedBrowserOrigin(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return;
  if (!origin.startsWith(EXTENSION_ORIGIN_PREFIX)) {
    throw new HttpError(403, "browser origin is not allowed");
  }
}

async function readRequestText(req, maxBytes = DEFAULT_BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let aborted = false;

    req.on("data", (chunk) => {
      if (aborted) return;
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > maxBytes) {
        aborted = true;
        reject(new HttpError(413, `request body exceeds ${maxBytes} bytes`));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (aborted) return;
      resolve(raw);
    });
    req.on("error", (error) => {
      if (aborted && error?.code === "ECONNRESET") return;
      reject(error);
    });
  });
}

async function readJsonBody(req, maxBytes = DEFAULT_BODY_LIMIT_BYTES) {
  const raw = await readRequestText(req, maxBytes);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, "invalid json body");
  }
}

async function readAdminLoginBody(req) {
  const contentType = String(req.headers["content-type"] || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new HttpError(415, "admin login requires form-encoded body");
  }
  const raw = await readRequestText(req);
  return new URLSearchParams(raw).get("adminToken") || "";
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  return match?.[1] || "";
}

function getCookieValue(req, name) {
  const cookieHeader = String(req.headers.cookie || "");
  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    return entry.slice(separator + 1).trim();
  }
  return "";
}

function requireConfiguredAdminToken(expectedToken) {
  const normalized = String(expectedToken || "").trim();
  if (!normalized) throw new HttpError(503, "ADMIN_AUTH_NOT_CONFIGURED");
  return normalized;
}

function adminTokensMatch(actual, expected) {
  const actualDigest = createHash("sha256").update(String(actual)).digest();
  const expectedDigest = createHash("sha256").update(String(expected)).digest();
  return actualDigest.length === expectedDigest.length && timingSafeEqual(actualDigest, expectedDigest);
}

function getAdminSession(req, sessionStore) {
  const sessionToken = getCookieValue(req, ADMIN_SESSION_COOKIE);
  return sessionToken ? sessionStore.get(sessionToken) : null;
}

function hasAdminAuthority(req, expectedToken, sessionStore, allowBearer = false) {
  if (getAdminSession(req, sessionStore)) return true;
  const bearer = allowBearer ? getBearerToken(req) : "";
  return Boolean(bearer && adminTokensMatch(bearer, expectedToken));
}

function redirect(res, location, cookie) {
  const headers = {
    Location: location,
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Referrer-Policy": "no-referrer",
  };
  if (cookie) headers["Set-Cookie"] = cookie;
  res.writeHead(303, headers);
  res.end();
}

function enforceRateLimit(rateLimiter, key, limit, windowMs, nowImpl = () => Date.now()) {
  const result = rateLimiter.consume(key, limit, windowMs);
  if (!result.allowed) {
    // Retry-After must use the same clock the limiter consumed its window
    // with, so fake-clock tests stay deterministic.
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - nowImpl()) / 1000));
    throw new HttpError(429, `rate limit exceeded; retry after ${retryAfter}s`);
  }
}

export function createAnalyticsHandler(options = {}) {
  const {
    adminToken = process.env.ANALYTICS_ADMIN_TOKEN,
    createEmailVerificationCodeImpl = createEmailVerificationCodeInStorage,
    isMailerConfigured,
    loadDbImpl = loadDb,
    loginUserImpl = loginUserInStorage,
    publicBaseUrl = process.env.PUBLIC_BASE_URL || "http://127.0.0.1:8787",
    rateLimitMaxBuckets = DEFAULT_RATE_LIMIT_MAX_BUCKETS,
    nowImpl = () => Date.now(),
    adminSessionTtlMs = ADMIN_SESSION_TTL_MS,
    adminSessionMaxCount = ADMIN_SESSION_MAX_COUNT,
    createAdminSessionToken,
    recordAnalyticsEventImpl = recordAnalyticsEventInStorage,
    registerUserImpl = registerUserWithVerificationCodeInStorage,
    revokeUserSessionImpl = revokeUserSessionInStorage,
    sendVerificationCodeEmail,
    validateUserSessionImpl = validateUserSessionInStorage,
  } = options;

  if (typeof isMailerConfigured !== "function") {
    throw new Error("isMailerConfigured is required");
  }
  if (typeof sendVerificationCodeEmail !== "function") {
    throw new Error("sendVerificationCodeEmail is required");
  }

  const adminSessions = createAdminSessionStore({
    createToken: createAdminSessionToken,
    maxSessions: adminSessionMaxCount,
    now: nowImpl,
    ttlMs: adminSessionTtlMs,
  });

  // One bounded limiter per namespace: isolation is structural (separate Maps),
  // so exhausting one namespace's bucket capacity can never consume another
  // namespace's. These are per-process authorities; the authoritative
  // deployment is a single Node process, and horizontal replicas would need a
  // shared/external limiter instead.
  const createNamespaceLimiter = () =>
    createFixedWindowRateLimiter({ now: nowImpl, maxBuckets: rateLimitMaxBuckets });
  const rateLimiters = {
    adminLogin: createNamespaceLimiter(),
    sendCodeIp: createNamespaceLimiter(),
    sendCodeEmail: createNamespaceLimiter(),
    registerIp: createNamespaceLimiter(),
    loginIp: createNamespaceLimiter(),
    sessionIp: createNamespaceLimiter(),
    logoutIp: createNamespaceLimiter(),
    eventsIp: createNamespaceLimiter(),
    summaryIp: createNamespaceLimiter(),
    timeseriesIp: createNamespaceLimiter(),
  };

  return async function analyticsHandler(req, res) {
    if (!req.url) {
      sendJson(req, res, 404, { ok: false, error: "missing url" });
      return;
    }

    if (req.method === "OPTIONS") {
      sendJson(req, res, 204, { ok: true });
      return;
    }

    const url = new URL(req.url, "http://127.0.0.1");
    const ip = normalizeIpAddress(req);

    try {
      if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(req, res, 200, { ok: true, mailerConfigured: isMailerConfigured() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        redirect(res, "/admin");
        return;
      }

      if (req.method === "GET" && url.pathname === "/admin/login") {
        requireConfiguredAdminToken(adminToken);
        if (getAdminSession(req, adminSessions)) {
          redirect(res, "/admin");
          return;
        }
        sendAdminHtml(res, 200, renderAdminTokenGateHtml());
        return;
      }

      if (req.method === "GET" && url.pathname === "/admin/api/session") {
        requireConfiguredAdminToken(adminToken);
        const session = getAdminSession(req, adminSessions);
        if (!session) {
          sendAdminJson(res, 401, { ok: false, error: { code: "ADMIN_SESSION_REQUIRED" } });
          return;
        }
        sendAdminJson(res, 200, {
          ok: true,
          expiresAt: new Date(session.expiresAt).toISOString(),
        });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/admin/assets/")) {
        requireConfiguredAdminToken(adminToken);
        if (!getAdminSession(req, adminSessions)) {
          sendAdminJson(res, 401, { ok: false, error: { code: "ADMIN_SESSION_REQUIRED" } });
          return;
        }
        const assetPath = resolveAdminAsset(url.pathname);
        if (!assetPath) {
          sendAdminJson(res, 404, { ok: false, error: { code: "ADMIN_RESOURCE_NOT_FOUND" } });
          return;
        }
        sendAdminFile(res, assetPath);
        return;
      }

      if (req.method === "GET" && ADMIN_APP_PATHS.has(url.pathname)) {
        requireConfiguredAdminToken(adminToken);
        if (!getAdminSession(req, adminSessions)) {
          redirect(res, "/admin/login");
          return;
        }
        sendAdminFile(res, resolve(ADMIN_DIST_DIR, "index.html"), { html: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/admin/login") {
        const normalizedAdminToken = requireConfiguredAdminToken(adminToken);
        enforceRateLimit(rateLimiters.adminLogin, `admin-login:ip:${ip}`, ADMIN_LOGIN_LIMIT, ADMIN_LOGIN_WINDOW_MS, nowImpl);
        const submittedToken = await readAdminLoginBody(req);
        if (!submittedToken || !adminTokensMatch(submittedToken, normalizedAdminToken)) {
          sendAdminHtml(res, 401, "<!doctype html><html><head><meta charset=\"utf-8\"><title>Unauthorized</title></head><body><p>Admin authentication failed.</p></body></html>");
          return;
        }
        const session = adminSessions.issue();
        const secure = process.env.NODE_ENV === "production" || publicBaseUrl.startsWith("https://");
        const cookie = `${ADMIN_SESSION_COOKIE}=${session.token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${Math.floor(adminSessionTtlMs / 1000)}${secure ? "; Secure" : ""}`;
        redirect(res, "/admin", cookie);
        return;
      }

      if (req.method === "POST" && url.pathname === "/admin/logout") {
        const session = getCookieValue(req, ADMIN_SESSION_COOKIE);
        if (session) adminSessions.delete(session);
        redirect(
          res,
          "/admin/login",
          `${ADMIN_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0${process.env.NODE_ENV === "production" || publicBaseUrl.startsWith("https://") ? "; Secure" : ""}`,
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/admin/data") {
        const normalizedAdminToken = requireConfiguredAdminToken(adminToken);
        if (!hasAdminAuthority(req, normalizedAdminToken, adminSessions, true)) {
          throw new HttpError(401, "admin authorization required");
        }
        const db = loadDbImpl();
        sendJson(req, res, 200, {
          ok: true,
          summary: buildAnalyticsSummary(db),
          series: buildTimeSeries(db, 14),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/auth/send-verification-code") {
        ensureTrustedBrowserOrigin(req);
        enforceRateLimit(rateLimiters.sendCodeIp, `send-code:ip:${ip}`, 10, 15 * 60 * 1000, nowImpl);
        // Mailer availability is a service-level condition, not client
        // diagnostics: the response stays a stable opaque code so internal
        // configuration (SMTP_* variable names, transport errors) never
        // reaches the client.
        if (!isMailerConfigured()) {
          throw new HttpError(503, "EMAIL_SERVICE_UNAVAILABLE");
        }
        const body = await readJsonBody(req);
        const email = String(body.email || "").trim().toLowerCase();
        if (!email) {
          throw new HttpError(400, "email is required");
        }
        enforceRateLimit(rateLimiters.sendCodeEmail, `send-code:email:${email}`, 3, 10 * 60 * 1000, nowImpl);
        const { code, expiresAt } = createEmailVerificationCodeImpl(email);
        try {
          await sendVerificationCodeEmail(email, code);
        } catch (err) {
          // Internal reason stays server-side; the client only gets the
          // stable contract code. Only the transport error class is logged,
          // never message payloads or credentials.
          console.error("[analytics-server] verification email delivery failed", err && err.code ? err.code : "");
          throw new HttpError(503, "EMAIL_SERVICE_UNAVAILABLE");
        }
        sendJson(req, res, 200, { ok: true, expiresAt });
        return;
      }

      if (req.method === "POST" && url.pathname === "/auth/register") {
        ensureTrustedBrowserOrigin(req);
        enforceRateLimit(rateLimiters.registerIp, `register:ip:${ip}`, 20, 15 * 60 * 1000, nowImpl);
        const body = await readJsonBody(req);
        // One authoritative primitive performs validation, code verification,
        // the duplicate check, creation, and code consumption atomically, so a
        // failed registration never burns the one-time code and account
        // existence is only surfaced after a valid code proved email control.
        let registered;
        try {
          registered = registerUserImpl(body.email, body.password, body.verificationCode, body.deviceId);
        } catch (err) {
          if (err instanceof RegistrationError) {
            if (err.message === "email already registered") throw new HttpError(409, err.message);
            throw new HttpError(400, err.message);
          }
          throw new HttpError(503, "AUTH_SERVICE_UNAVAILABLE");
        }
        sendJson(req, res, 200, {
          ok: true,
          user: { userId: registered.user.userId, email: registered.user.email },
          authToken: registered.authToken,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/auth/login") {
        ensureTrustedBrowserOrigin(req);
        enforceRateLimit(rateLimiters.loginIp, `login:ip:${ip}`, 30, 15 * 60 * 1000, nowImpl);
        const body = await readJsonBody(req);
        // Unknown account and wrong password share one stable response so the
        // login endpoint never discloses whether an email is registered.
        let loggedIn;
        try {
          loggedIn = loginUserImpl(body.email, body.password, body.deviceId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message === "account not found" || message === "invalid password") {
            throw new HttpError(401, "AUTH_INVALID_CREDENTIALS");
          }
          throw new HttpError(503, "AUTH_SERVICE_UNAVAILABLE");
        }
        sendJson(req, res, 200, {
          ok: true,
          user: { userId: loggedIn.user.userId, email: loggedIn.user.email },
          authToken: loggedIn.authToken,
        });
        return;
      }

      // Session validation is server-authoritative: userId is only a lookup
      // hint and every request must prove the bearer token against the stored
      // hash plus a live expiry. All failures share one stable error code so
      // callers cannot distinguish missing users from bad or expired tokens.
      if (req.method === "POST" && url.pathname === "/auth/session") {
        ensureTrustedBrowserOrigin(req);
        enforceRateLimit(rateLimiters.sessionIp, `session:ip:${ip}`, 120, 5 * 60 * 1000, nowImpl);
        const body = await readJsonBody(req);
        let session;
        try {
          session = validateUserSessionImpl(String(body.userId || ""), getBearerToken(req), nowImpl());
        } catch {
          throw new HttpError(503, "AUTH_SERVICE_UNAVAILABLE");
        }
        if (!session) throw new HttpError(401, "AUTH_SESSION_INVALID");
        sendJson(req, res, 200, {
          ok: true,
          user: { userId: session.user.userId, email: session.user.email },
          expiresAt: session.expiresAt,
        });
        return;
      }

      // Logout revokes the server-side session only after the bearer token is
      // proven; a correct userId alone never revokes anything.
      if (req.method === "POST" && url.pathname === "/auth/logout") {
        ensureTrustedBrowserOrigin(req);
        enforceRateLimit(rateLimiters.logoutIp, `logout:ip:${ip}`, 30, 15 * 60 * 1000, nowImpl);
        const body = await readJsonBody(req);
        let revoked;
        try {
          revoked = revokeUserSessionImpl(String(body.userId || ""), getBearerToken(req), nowImpl());
        } catch {
          throw new HttpError(503, "AUTH_SERVICE_UNAVAILABLE");
        }
        if (!revoked) throw new HttpError(401, "AUTH_SESSION_INVALID");
        sendJson(req, res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/analytics/events") {
        ensureTrustedBrowserOrigin(req);
        enforceRateLimit(rateLimiters.eventsIp, `events:ip:${ip}`, 240, 5 * 60 * 1000, nowImpl);
        const body = await readJsonBody(req);
        const safePayload = normalizeRemoteAnalyticsEvent(body);
        if (!safePayload) throw new HttpError(400, "invalid analytics event");
        recordAnalyticsEventImpl(safePayload);
        sendJson(req, res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/analytics/summary") {
        const normalizedAdminToken = requireConfiguredAdminToken(adminToken);
        if (!hasAdminAuthority(req, normalizedAdminToken, adminSessions, true)) {
          throw new HttpError(401, "admin authorization required");
        }
        enforceRateLimit(rateLimiters.summaryIp, `summary:ip:${ip}`, 60, 5 * 60 * 1000, nowImpl);
        const db = loadDbImpl();
        sendJson(req, res, 200, { ok: true, summary: buildAnalyticsSummary(db) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/analytics/timeseries") {
        const normalizedAdminToken = requireConfiguredAdminToken(adminToken);
        if (!hasAdminAuthority(req, normalizedAdminToken, adminSessions, true)) {
          throw new HttpError(401, "admin authorization required");
        }
        enforceRateLimit(rateLimiters.timeseriesIp, `timeseries:ip:${ip}`, 60, 5 * 60 * 1000, nowImpl);
        const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days") || "14")));
        const db = loadDbImpl();
        sendJson(req, res, 200, { ok: true, series: buildTimeSeries(db, days) });
        return;
      }

      sendJson(req, res, 404, { ok: false, error: "not found" });
    } catch (err) {
      if (url.pathname.startsWith("/admin/api/")) {
        const knownCode = err instanceof HttpError ? String(err.message || "") : "";
        const allowedCodes = new Set([
          "ADMIN_AUTH_NOT_CONFIGURED",
          "ADMIN_SESSION_REQUIRED",
          "ADMIN_RATE_LIMITED",
          "ADMIN_RESOURCE_NOT_FOUND",
        ]);
        const code = allowedCodes.has(knownCode) ? knownCode : "ADMIN_INTERNAL_ERROR";
        const statusCode = err instanceof HttpError ? err.statusCode : 500;
        sendAdminJson(res, statusCode, { ok: false, error: { code } });
        return;
      }
      const statusCode = err instanceof HttpError ? err.statusCode : 400;
      sendJson(req, res, statusCode, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
