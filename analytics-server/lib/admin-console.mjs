import { existsSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { normalizeAdminAnalyticsDays } from "./admin-read-model.mjs";
import { normalizeAdminUsersQuery } from "./admin-management-read-model.mjs";
import {
  ADMIN_AUDIT_EVENTS,
  normalizeAdminAuditQuery,
} from "./admin-audit.mjs";

export const ADMIN_SESSION_COOKIE = "analytics_admin_session";
export const ADMIN_LOGIN_LIMIT = 10;
export const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const ADMIN_READ_LIMIT = 120;
export const ADMIN_READ_WINDOW_MS = 5 * 60 * 1000;
export const ADMIN_USERS_READ_LIMIT = 120;
export const ADMIN_USERS_READ_WINDOW_MS = 5 * 60 * 1000;
export const ADMIN_SYSTEM_READ_LIMIT = 60;
export const ADMIN_SYSTEM_READ_WINDOW_MS = 5 * 60 * 1000;
export const ADMIN_AUDIT_READ_LIMIT = 120;
export const ADMIN_AUDIT_READ_WINDOW_MS = 5 * 60 * 1000;

const DEFAULT_ADMIN_DIST_DIR = fileURLToPath(new URL("../../dist-admin/", import.meta.url));
const ADMIN_APP_PATHS = new Set([
  "/admin",
  "/admin/",
  "/admin/analytics",
  "/admin/users",
  "/admin/system",
  "/admin/audit",
]);

export const ADMIN_CSP = [
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

class AdminPortalError extends Error {
  constructor(statusCode, code) {
    super(code);
    this.name = "AdminPortalError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function adminSecurityHeaders() {
  return {
    "Content-Security-Policy": ADMIN_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

function adminHeaders(contentType, cacheControl = "no-store") {
  return {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    ...adminSecurityHeaders(),
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

function redirectAdmin(res, location, cookie) {
  const headers = {
    Location: location,
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    ...adminSecurityHeaders(),
  };
  if (cookie) headers["Set-Cookie"] = cookie;
  res.writeHead(303, headers);
  res.end();
}

function adminAssetContentType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "";
  }
}

function sendAdminFile(res, filePath, { html = false } = {}) {
  if (!existsSync(filePath)) {
    sendAdminJson(res, 503, { ok: false, error: { code: "ADMIN_APP_NOT_BUILT" } });
    return;
  }
  const contentType = html ? "text/html; charset=utf-8" : adminAssetContentType(filePath);
  if (!contentType) {
    sendAdminJson(res, 404, { ok: false, error: { code: "ADMIN_RESOURCE_NOT_FOUND" } });
    return;
  }
  const cacheControl = html ? "no-store" : "public, max-age=31536000, immutable";
  try {
    const body = readFileSync(filePath);
    res.writeHead(200, adminHeaders(contentType, cacheControl));
    res.end(body);
  } catch {
    sendAdminJson(res, 503, { ok: false, error: { code: "ADMIN_APP_UNAVAILABLE" } });
  }
}

function resolveAdminAsset(adminDistDir, pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.slice("/admin/".length));
  } catch {
    return null;
  }
  const root = resolve(adminDistDir);
  const fullPath = resolve(root, relativePath);
  if (!fullPath.startsWith(`${root}${sep}`)) return null;
  return fullPath;
}

function renderAdminLoginHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex, nofollow">
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

async function readRequestText(req, maxBytes = 64 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let raw = "";
    let aborted = false;
    req.on("data", (chunk) => {
      if (aborted) return;
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > maxBytes) {
        aborted = true;
        reject(new AdminPortalError(413, "ADMIN_REQUEST_TOO_LARGE"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!aborted) resolvePromise(raw);
    });
    req.on("error", (error) => {
      if (aborted && error?.code === "ECONNRESET") return;
      reject(error);
    });
  });
}

async function readAdminFormBody(req, errorCode) {
  const contentType = String(req.headers["content-type"] || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new AdminPortalError(415, errorCode);
  }
  return new URLSearchParams(await readRequestText(req));
}

async function readAdminLoginBody(req) {
  return (await readAdminFormBody(req, "ADMIN_LOGIN_REQUIRES_FORM")).get("adminToken") || "";
}

async function readAdminLogoutCsrf(req) {
  return (await readAdminFormBody(req, "ADMIN_CSRF_REQUIRED")).get("csrfToken") || "";
}

export function requireAdminCsrfToken(actual, expected) {
  if (!actual || !expected || !adminTokensMatch(actual, expected)) {
    throw new AdminPortalError(403, "ADMIN_CSRF_REJECTED");
  }
  return true;
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  return match?.[1] || "";
}

export function getAdminCookieValue(req, name = ADMIN_SESSION_COOKIE) {
  const cookieHeader = String(req.headers.cookie || "");
  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    return entry.slice(separator + 1).trim();
  }
  return "";
}

export function requireConfiguredAdminToken(expectedToken) {
  const normalized = String(expectedToken || "").trim();
  if (!normalized) throw new AdminPortalError(503, "ADMIN_AUTH_NOT_CONFIGURED");
  return normalized;
}

export function adminTokensMatch(actual, expected) {
  const actualDigest = createHash("sha256").update(String(actual)).digest();
  const expectedDigest = createHash("sha256").update(String(expected)).digest();
  return actualDigest.length === expectedDigest.length && timingSafeEqual(actualDigest, expectedDigest);
}

function ensureAdminMutationOrigin(req, publicBaseUrl) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return;
  let expectedOrigin;
  try {
    expectedOrigin = new URL(publicBaseUrl).origin;
  } catch {
    throw new AdminPortalError(503, "ADMIN_PUBLIC_ORIGIN_INVALID");
  }
  if (origin !== expectedOrigin) {
    throw new AdminPortalError(403, "ADMIN_ORIGIN_REJECTED");
  }
}

export function getAdminSession(req, sessionStore) {
  const sessionToken = getAdminCookieValue(req);
  return sessionToken ? sessionStore.get(sessionToken) : null;
}

export function hasAdminAuthority(req, expectedToken, sessionStore, allowBearer = false) {
  if (getAdminSession(req, sessionStore)) return true;
  const bearer = allowBearer ? getBearerToken(req) : "";
  return Boolean(bearer && adminTokensMatch(bearer, expectedToken));
}

function buildSessionCookie(token, ttlMs, secure) {
  return `${ADMIN_SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? "; Secure" : ""}`;
}

function buildClearCookie(secure) {
  return `${ADMIN_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0${secure ? "; Secure" : ""}`;
}

function consumeAdminLoginRateLimit(rateLimiter, ip, nowImpl) {
  const result = rateLimiter.consume(`admin-login:ip:${ip}`, ADMIN_LOGIN_LIMIT, ADMIN_LOGIN_WINDOW_MS);
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - nowImpl()) / 1000));
    const error = new AdminPortalError(429, "ADMIN_RATE_LIMITED");
    error.retryAfter = retryAfter;
    throw error;
  }
}

function consumeBoundedAdminReadRateLimit(
  rateLimiter,
  key,
  limit,
  windowMs,
  ip,
  nowImpl,
) {
  const result = rateLimiter.consume(`${key}:ip:${ip}`, limit, windowMs);
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - nowImpl()) / 1000));
    const error = new AdminPortalError(429, "ADMIN_RATE_LIMITED");
    error.retryAfter = retryAfter;
    throw error;
  }
}

function consumeAdminReadRateLimit(rateLimiter, ip, nowImpl) {
  consumeBoundedAdminReadRateLimit(
    rateLimiter,
    "admin-read",
    ADMIN_READ_LIMIT,
    ADMIN_READ_WINDOW_MS,
    ip,
    nowImpl,
  );
}

function consumeAdminUsersReadRateLimit(rateLimiter, ip, nowImpl) {
  consumeBoundedAdminReadRateLimit(
    rateLimiter,
    "admin-users-read",
    ADMIN_USERS_READ_LIMIT,
    ADMIN_USERS_READ_WINDOW_MS,
    ip,
    nowImpl,
  );
}

function consumeAdminSystemReadRateLimit(rateLimiter, ip, nowImpl) {
  consumeBoundedAdminReadRateLimit(
    rateLimiter,
    "admin-system-read",
    ADMIN_SYSTEM_READ_LIMIT,
    ADMIN_SYSTEM_READ_WINDOW_MS,
    ip,
    nowImpl,
  );
}

function consumeAdminAuditReadRateLimit(rateLimiter, ip, nowImpl) {
  consumeBoundedAdminReadRateLimit(
    rateLimiter,
    "admin-audit-read",
    ADMIN_AUDIT_READ_LIMIT,
    ADMIN_AUDIT_READ_WINDOW_MS,
    ip,
    nowImpl,
  );
}

function requireAdminApiSession(req, adminSessions) {
  const session = getAdminSession(req, adminSessions);
  if (!session) throw new AdminPortalError(401, "ADMIN_SESSION_REQUIRED");
  return session;
}

function parseAdminDays(url) {
  const days = normalizeAdminAnalyticsDays(url.searchParams.get("days"));
  if (days == null) throw new AdminPortalError(400, "INVALID_ADMIN_QUERY");
  return days;
}

async function handleAdminReadApi({
  pathname,
  method,
  req,
  res,
  url,
  ip,
  adminToken,
  adminSessions,
  adminReadRateLimiter,
  adminReadModels,
  nowImpl,
}) {
  const routes = {
    "/admin/api/overview": "overview",
    "/admin/api/analytics/timeseries": "timeseries",
    "/admin/api/analytics/providers": "providers",
    "/admin/api/analytics/errors": "errors",
    "/admin/api/analytics/versions": "versions",
    "/admin/api/analytics/latency": "latency",
  };
  const operation = routes[pathname];
  if (!operation) return false;
  if (method !== "GET") {
    sendAdminJson(res, 405, { ok: false, error: { code: "ADMIN_METHOD_NOT_ALLOWED" } });
    return true;
  }
  requireConfiguredAdminToken(adminToken);
  requireAdminApiSession(req, adminSessions);
  consumeAdminReadRateLimit(adminReadRateLimiter, ip, nowImpl);
  const days = parseAdminDays(url);
  const handler = adminReadModels?.[operation];
  if (typeof handler !== "function") {
    throw new AdminPortalError(503, "ADMIN_STORAGE_UNAVAILABLE");
  }
  const payload = await handler(days);
  sendAdminJson(res, 200, { ok: true, ...payload });
  return true;
}

async function handleAdminManagementReadApi({
  pathname,
  method,
  req,
  res,
  url,
  ip,
  adminToken,
  adminSessions,
  adminUsersReadRateLimiter,
  adminSystemReadRateLimiter,
  adminManagementReadModels,
  nowImpl,
}) {
  if (pathname !== "/admin/api/users" && pathname !== "/admin/api/system") {
    return false;
  }
  if (method !== "GET") {
    sendAdminJson(res, 405, { ok: false, error: { code: "ADMIN_METHOD_NOT_ALLOWED" } });
    return true;
  }

  requireConfiguredAdminToken(adminToken);
  requireAdminApiSession(req, adminSessions);

  if (pathname === "/admin/api/users") {
    consumeAdminUsersReadRateLimit(adminUsersReadRateLimiter, ip, nowImpl);
    const allowedQueryKeys = new Set(["limit", "cursor", "q"]);
    if ([...url.searchParams.keys()].some((key) => !allowedQueryKeys.has(key))) {
      throw new AdminPortalError(400, "INVALID_ADMIN_QUERY");
    }
    const query = normalizeAdminUsersQuery({
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
      q: url.searchParams.get("q"),
    });
    const handler = adminManagementReadModels?.users;
    if (typeof handler !== "function") {
      throw new AdminPortalError(503, "ADMIN_STORAGE_UNAVAILABLE");
    }
    const payload = await handler(query);
    sendAdminJson(res, 200, { ok: true, ...payload });
    return true;
  }

  consumeAdminSystemReadRateLimit(adminSystemReadRateLimiter, ip, nowImpl);
  if ([...url.searchParams.keys()].length > 0) {
    throw new AdminPortalError(400, "INVALID_ADMIN_QUERY");
  }
  const handler = adminManagementReadModels?.system;
  if (typeof handler !== "function") {
    throw new AdminPortalError(503, "ADMIN_STORAGE_UNAVAILABLE");
  }
  const payload = await handler();
  sendAdminJson(res, 200, { ok: true, ...payload });
  return true;
}

async function handleAdminAuditReadApi({
  pathname,
  method,
  req,
  res,
  url,
  ip,
  adminToken,
  adminSessions,
  adminAuditReadRateLimiter,
  adminAuditReadModel,
  nowImpl,
}) {
  if (pathname !== "/admin/api/audit") return false;
  if (method !== "GET") {
    sendAdminJson(res, 405, { ok: false, error: { code: "ADMIN_METHOD_NOT_ALLOWED" } });
    return true;
  }

  requireConfiguredAdminToken(adminToken);
  requireAdminApiSession(req, adminSessions);
  consumeAdminAuditReadRateLimit(adminAuditReadRateLimiter, ip, nowImpl);

  const allowedQueryKeys = new Set(["limit", "cursor"]);
  if ([...url.searchParams.keys()].some((key) => !allowedQueryKeys.has(key))) {
    throw new AdminPortalError(400, "INVALID_ADMIN_QUERY");
  }

  const query = normalizeAdminAuditQuery({
    limit: url.searchParams.get("limit"),
    cursor: url.searchParams.get("cursor"),
  });
  const handler = adminAuditReadModel?.list;
  if (typeof handler !== "function") {
    throw new AdminPortalError(503, "ADMIN_STORAGE_UNAVAILABLE");
  }
  const payload = await handler(query);
  sendAdminJson(res, 200, { ok: true, ...payload });
  return true;
}

function stableAdminErrorCode(error) {
  const allowed = new Set([
    "ADMIN_AUTH_NOT_CONFIGURED",
    "ADMIN_SESSION_REQUIRED",
    "ADMIN_RATE_LIMITED",
    "ADMIN_RESOURCE_NOT_FOUND",
    "ADMIN_REQUEST_TOO_LARGE",
    "ADMIN_LOGIN_REQUIRES_FORM",
    "ADMIN_CSRF_REQUIRED",
    "ADMIN_CSRF_REJECTED",
    "ADMIN_PUBLIC_ORIGIN_INVALID",
    "ADMIN_ORIGIN_REJECTED",
    "INVALID_ADMIN_QUERY",
    "ADMIN_STORAGE_UNAVAILABLE",
  ]);
  const code = typeof error?.code === "string" ? error.code : "";
  return allowed.has(code) ? code : "ADMIN_INTERNAL_ERROR";
}

export function createAdminPortal({
  adminToken,
  adminSessions,
  adminSessionTtlMs,
  adminLoginRateLimiter,
  adminReadRateLimiter,
  adminUsersReadRateLimiter,
  adminSystemReadRateLimiter,
  adminAuditReadRateLimiter,
  adminReadModels,
  adminManagementReadModels,
  adminAuditReadModel,
  adminAuditRecorder,
  nowImpl = () => Date.now(),
  publicBaseUrl,
  adminDistDir = DEFAULT_ADMIN_DIST_DIR,
  isProduction = () => process.env.NODE_ENV === "production",
} = {}) {
  if (!adminSessions || typeof adminSessions.get !== "function" || typeof adminSessions.issue !== "function") {
    throw new TypeError("adminSessions store is required");
  }
  if (!adminLoginRateLimiter || typeof adminLoginRateLimiter.consume !== "function") {
    throw new TypeError("adminLoginRateLimiter is required");
  }
  if (!adminReadRateLimiter || typeof adminReadRateLimiter.consume !== "function") {
    throw new TypeError("adminReadRateLimiter is required");
  }
  if (!adminUsersReadRateLimiter || typeof adminUsersReadRateLimiter.consume !== "function") {
    throw new TypeError("adminUsersReadRateLimiter is required");
  }
  if (!adminSystemReadRateLimiter || typeof adminSystemReadRateLimiter.consume !== "function") {
    throw new TypeError("adminSystemReadRateLimiter is required");
  }
  if (!adminAuditReadRateLimiter || typeof adminAuditReadRateLimiter.consume !== "function") {
    throw new TypeError("adminAuditReadRateLimiter is required");
  }
  if (typeof adminAuditRecorder !== "function") {
    throw new TypeError("adminAuditRecorder is required");
  }

  function recordAudit(entry) {
    return adminAuditRecorder(entry);
  }

  return {
    async handle(req, res, url, ip) {
      const pathname = url.pathname;
      const method = String(req.method || "GET").toUpperCase();

      if (method === "GET" && pathname.startsWith("/admin") && url.searchParams.has("adminToken")) {
        url.searchParams.delete("adminToken");
        const sanitizedQuery = url.searchParams.toString();
        redirectAdmin(res, `${pathname}${sanitizedQuery ? `?${sanitizedQuery}` : ""}`);
        return true;
      }

      if (pathname === "/admin/data") return false;

      try {
        if (method === "GET" && pathname === "/") {
          redirectAdmin(res, "/admin");
          return true;
        }

        if (pathname === "/admin/login") {
          if (method === "GET") {
            requireConfiguredAdminToken(adminToken);
            if (getAdminSession(req, adminSessions)) {
              redirectAdmin(res, "/admin");
            } else {
              sendAdminHtml(res, 200, renderAdminLoginHtml());
            }
            return true;
          }
          if (method === "POST") {
            ensureAdminMutationOrigin(req, publicBaseUrl);
            const normalizedAdminToken = requireConfiguredAdminToken(adminToken);
            consumeAdminLoginRateLimit(adminLoginRateLimiter, ip, nowImpl);
            const submittedToken = await readAdminLoginBody(req);
            if (!submittedToken || !adminTokensMatch(submittedToken, normalizedAdminToken)) {
              recordAudit({
                event: ADMIN_AUDIT_EVENTS.LOGIN,
                outcome: "failure",
                ip,
                metadata: { reason: "invalid_credentials" },
              });
              sendAdminHtml(
                res,
                401,
                '<!doctype html><html><head><meta charset="utf-8"><title>Unauthorized</title></head><body><p>Admin authentication failed.</p></body></html>',
              );
              return true;
            }
            const session = adminSessions.issue();
            try {
              recordAudit({
                event: ADMIN_AUDIT_EVENTS.LOGIN,
                outcome: "success",
                ip,
                sessionToken: session.token,
              });
            } catch (error) {
              adminSessions.delete(session.token);
              throw error;
            }
            const secure = isProduction() || publicBaseUrl.startsWith("https://");
            redirectAdmin(res, "/admin", buildSessionCookie(session.token, adminSessionTtlMs, secure));
            return true;
          }
          sendAdminJson(res, 405, { ok: false, error: { code: "ADMIN_METHOD_NOT_ALLOWED" } });
          return true;
        }

        if (pathname === "/admin/logout") {
          if (method !== "POST") {
            sendAdminJson(res, 405, { ok: false, error: { code: "ADMIN_METHOD_NOT_ALLOWED" } });
            return true;
          }
          ensureAdminMutationOrigin(req, publicBaseUrl);
          const sessionToken = getAdminCookieValue(req);
          const session = sessionToken ? adminSessions.get(sessionToken) : null;
          if (session) {
            const csrfToken = await readAdminLogoutCsrf(req);
            requireAdminCsrfToken(csrfToken, session.csrfToken);
            recordAudit({
              event: ADMIN_AUDIT_EVENTS.LOGOUT,
              outcome: "success",
              ip,
              sessionToken,
            });
            adminSessions.delete(sessionToken);
          }
          const secure = isProduction() || publicBaseUrl.startsWith("https://");
          redirectAdmin(res, "/admin/login", buildClearCookie(secure));
          return true;
        }

        if (pathname === "/admin/api/session") {
          if (method !== "GET") {
            sendAdminJson(res, 405, { ok: false, error: { code: "ADMIN_METHOD_NOT_ALLOWED" } });
            return true;
          }
          requireConfiguredAdminToken(adminToken);
          const session = getAdminSession(req, adminSessions);
          if (!session) {
            sendAdminJson(res, 401, { ok: false, error: { code: "ADMIN_SESSION_REQUIRED" } });
            return true;
          }
          sendAdminJson(res, 200, {
            ok: true,
            expiresAt: new Date(session.expiresAt).toISOString(),
            csrfToken: session.csrfToken,
          });
          return true;
        }

        if (
          await handleAdminReadApi({
            pathname,
            method,
            req,
            res,
            url,
            ip,
            adminToken,
            adminSessions,
            adminReadRateLimiter,
            adminReadModels,
            nowImpl,
          })
        ) {
          return true;
        }

        if (
          await handleAdminManagementReadApi({
            pathname,
            method,
            req,
            res,
            url,
            ip,
            adminToken,
            adminSessions,
            adminUsersReadRateLimiter,
            adminSystemReadRateLimiter,
            adminManagementReadModels,
            nowImpl,
          })
        ) {
          return true;
        }

        if (
          await handleAdminAuditReadApi({
            pathname,
            method,
            req,
            res,
            url,
            ip,
            adminToken,
            adminSessions,
            adminAuditReadRateLimiter,
            adminAuditReadModel,
            nowImpl,
          })
        ) {
          return true;
        }

        if (pathname.startsWith("/admin/api/")) {
          if (method !== "GET") {
            recordAudit({
              event: ADMIN_AUDIT_EVENTS.MUTATION_REJECTED,
              outcome: "rejected",
              ip,
              sessionToken: getAdminCookieValue(req),
              metadata: {
                method,
                path: "/admin/api/unknown",
                reason: "unsupported_mutation",
              },
            });
          }
          sendAdminJson(res, 404, { ok: false, error: { code: "ADMIN_RESOURCE_NOT_FOUND" } });
          return true;
        }

        if (method === "GET" && pathname.startsWith("/admin/assets/")) {
          requireConfiguredAdminToken(adminToken);
          if (!getAdminSession(req, adminSessions)) {
            sendAdminJson(res, 401, { ok: false, error: { code: "ADMIN_SESSION_REQUIRED" } });
            return true;
          }
          const assetPath = resolveAdminAsset(adminDistDir, pathname);
          if (!assetPath) {
            sendAdminJson(res, 404, { ok: false, error: { code: "ADMIN_RESOURCE_NOT_FOUND" } });
            return true;
          }
          sendAdminFile(res, assetPath);
          return true;
        }

        if (method === "GET" && ADMIN_APP_PATHS.has(pathname)) {
          requireConfiguredAdminToken(adminToken);
          if (!getAdminSession(req, adminSessions)) {
            redirectAdmin(res, "/admin/login");
            return true;
          }
          sendAdminFile(res, resolve(adminDistDir, "index.html"), { html: true });
          return true;
        }

        if (pathname === "/admin" || pathname.startsWith("/admin/")) {
          sendAdminJson(res, method === "GET" ? 404 : 405, {
            ok: false,
            error: { code: method === "GET" ? "ADMIN_RESOURCE_NOT_FOUND" : "ADMIN_METHOD_NOT_ALLOWED" },
          });
          return true;
        }

        return false;
      } catch (error) {
        let effectiveError = error;
        let code = stableAdminErrorCode(effectiveError);
        if (
          code === "ADMIN_ORIGIN_REJECTED" ||
          code === "ADMIN_CSRF_REJECTED" ||
          code === "ADMIN_CSRF_REQUIRED" ||
          (
            code === "ADMIN_RATE_LIMITED" &&
            pathname === "/admin/login" &&
            method === "POST"
          )
        ) {
          try {
            recordAudit({
              event:
                code === "ADMIN_ORIGIN_REJECTED"
                  ? ADMIN_AUDIT_EVENTS.ORIGIN_REJECTED
                  : code === "ADMIN_RATE_LIMITED"
                    ? ADMIN_AUDIT_EVENTS.LOGIN
                    : ADMIN_AUDIT_EVENTS.CSRF_REJECTED,
              outcome: "rejected",
              ip,
              sessionToken: getAdminCookieValue(req),
              metadata: {
                method,
                path: pathname,
                reason:
                  code === "ADMIN_ORIGIN_REJECTED"
                    ? "origin_mismatch"
                    : code === "ADMIN_RATE_LIMITED"
                      ? "rate_limited"
                      : code.toLowerCase(),
              },
            });
          } catch (auditError) {
            effectiveError = auditError;
            code = stableAdminErrorCode(auditError);
          }
        }
        const externalStatusCode = Number(effectiveError?.statusCode);
        const statusCode =
          effectiveError instanceof AdminPortalError
            ? effectiveError.statusCode
            : Number.isInteger(externalStatusCode) && externalStatusCode >= 400 && externalStatusCode <= 599
              ? externalStatusCode
              : 500;
        const headers = effectiveError?.retryAfter ? { "Retry-After": String(effectiveError.retryAfter) } : null;
        const publicError =
          code === "ADMIN_RATE_LIMITED" && effectiveError?.retryAfter
            ? `rate limit exceeded; retry after ${effectiveError.retryAfter}s`
            : code;
        const payload = pathname.startsWith("/admin/api/")
          ? { ok: false, error: { code } }
          : { ok: false, error: publicError };
        if (headers) {
          res.writeHead(statusCode, { ...adminHeaders("application/json; charset=utf-8"), ...headers });
          res.end(JSON.stringify(payload));
        } else {
          sendAdminJson(res, statusCode, payload);
        }
        return true;
      }
    },
  };
}
