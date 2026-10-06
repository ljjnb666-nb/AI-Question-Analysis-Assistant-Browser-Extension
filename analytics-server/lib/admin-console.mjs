import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";

// The browser Admin console concern: same-origin portal routes, the HttpOnly
// session cookie authority, and static serving of the independent dist-admin
// artifact. Extension auth/analytics routes stay in server.mjs untouched.
export const ADMIN_SESSION_COOKIE = "analytics_admin_session";
export const ADMIN_LOGIN_LIMIT = 10;
export const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;

const ADMIN_PORTAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_ADMIN_DIST_DIR = path.join(ADMIN_PORTAL_ROOT, "dist-admin");

// Admin pages ship no inline script/style: every executable or styleable byte
// lives in the audited dist-admin artifact, so the CSP never needs
// unsafe-inline or unsafe-eval.
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

const ADMIN_CACHE_NO_STORE = "no-store, no-cache, must-revalidate, proxy-revalidate";
const ADMIN_ASSET_CACHE_IMMUTABLE = "public, max-age=31536000, immutable";

// Allowlist: admin assets are served only in these shapes. .html is excluded
// on purpose — the shell document is session-gated, never served as an asset.
const ADMIN_ASSET_CONTENT_TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export class AdminHttpError extends Error {
  constructor(statusCode, code, { publicDetail = "", retryAfterSeconds = 0 } = {}) {
    super(code);
    this.name = "AdminHttpError";
    this.statusCode = statusCode;
    this.code = code;
    // Stable operator-facing text for HTML flows; never client-controlled.
    this.publicDetail = String(publicDetail || "");
    this.retryAfterSeconds = Number(retryAfterSeconds) || 0;
  }
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getCookieValue(req, name) {
  const cookieHeader = String(req.headers.cookie || "");
  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    return entry.slice(separator + 1).trim();
  }
  return "";
}

export function adminTokensMatch(actual, expected) {
  const actualDigest = createHash("sha256").update(String(actual)).digest();
  const expectedDigest = createHash("sha256").update(String(expected)).digest();
  return actualDigest.length === expectedDigest.length && timingSafeEqual(actualDigest, expectedDigest);
}

export function requireConfiguredAdminToken(expectedToken) {
  const normalized = String(expectedToken || "").trim();
  if (!normalized) throw new AdminHttpError(503, "ADMIN_AUTH_NOT_CONFIGURED");
  return normalized;
}

export function hasAdminAuthority(req, expectedToken, sessionStore, allowBearer = false) {
  const session = getCookieValue(req, ADMIN_SESSION_COOKIE);
  if (session && sessionStore.has(session)) return true;
  const bearer = allowBearer ? getBearerToken(req) : "";
  return Boolean(bearer && adminTokensMatch(bearer, expectedToken));
}

// The browser Admin authority is the HttpOnly session cookie exclusively; the
// long-lived ANALYTICS_ADMIN_TOKEN never authorizes /admin or /admin/api/*.
function hasAdminSession(req, sessionStore) {
  const session = getCookieValue(req, ADMIN_SESSION_COOKIE);
  return Boolean(session && sessionStore.has(session));
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  return match?.[1] || "";
}

function adminSecurityHeaders(extra = {}) {
  return {
    "Content-Security-Policy": ADMIN_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extra,
  };
}

function sendAdminHtml(res, statusCode, html, cacheControl = ADMIN_CACHE_NO_STORE) {
  res.writeHead(
    statusCode,
    adminSecurityHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheControl,
    }),
  );
  res.end(html);
}

function sendAdminJson(res, statusCode, payload) {
  res.writeHead(
    statusCode,
    adminSecurityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": ADMIN_CACHE_NO_STORE,
    }),
  );
  res.end(JSON.stringify(payload));
}

function sendAdminText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(
    statusCode,
    adminSecurityHeaders({
      "Content-Type": contentType,
      "Cache-Control": ADMIN_CACHE_NO_STORE,
    }),
  );
  res.end(text);
}

function adminRedirect(res, location, cookie = "") {
  const headers = adminSecurityHeaders({
    Location: location,
    "Cache-Control": ADMIN_CACHE_NO_STORE,
  });
  if (cookie) headers["Set-Cookie"] = cookie;
  res.writeHead(303, headers);
  res.end();
}

export function renderAdminLoginPage(publicBaseUrl) {
  const safeBaseUrl = escapeHtml(publicBaseUrl);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Quiz Solver Admin Login</title>
  <link rel="stylesheet" href="/admin/admin-login.css">
</head>
<body>
  <main class="admin-login-panel">
    <form method="POST" action="/admin/login">
      <h1>Quiz Solver Admin</h1>
      <p>请输入管理口令以建立 8 小时安全会话。</p>
      <label for="adminToken">Admin Token</label>
      <input id="adminToken" name="adminToken" type="password" autocomplete="current-password" required>
      <button type="submit">登录</button>
      <p class="admin-meta">服务地址：${safeBaseUrl}</p>
    </form>
  </main>
</body>
</html>`;
}

function renderAdminErrorPage(statusCode, code, publicDetail) {
  const safeCode = escapeHtml(code);
  const safeDetail = escapeHtml(publicDetail || code);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Quiz Solver Admin — ${safeCode}</title>
  <link rel="stylesheet" href="/admin/admin-login.css">
</head>
<body>
  <main class="admin-login-panel">
    <h1>Admin</h1>
    <p>${safeDetail}</p>
    <p class="admin-meta">错误代码：${safeCode}</p>
    <p><a href="/admin/login">返回登录</a></p>
  </main>
</body>
</html>`;
}

// Generic same-origin scaffold for Admin POSTs (login/logout). Native form
// posts from the Admin origin carry an Origin header; a present-but-foreign
// Origin is rejected. Absent Origin (curl, same-server tooling) stays allowed.
function assertSameOrigin(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return;
  const host = String(req.headers.host || "").trim();
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AdminHttpError(403, "ADMIN_FORBIDDEN_ORIGIN");
  }
  if (!host || originHost !== host) {
    throw new AdminHttpError(403, "ADMIN_FORBIDDEN_ORIGIN");
  }
}

async function readAdminLoginBody(req, maxBytes = 64 * 1024) {
  const contentType = String(req.headers["content-type"] || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new AdminHttpError(415, "ADMIN_LOGIN_REQUIRES_FORM");
  }
  return new Promise((resolve, reject) => {
    let raw = "";
    let aborted = false;
    req.on("data", (chunk) => {
      if (aborted) return;
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > maxBytes) {
        aborted = true;
        reject(new AdminHttpError(413, "ADMIN_REQUEST_TOO_LARGE"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (aborted) return;
      try {
        resolve(new URLSearchParams(raw).get("adminToken") || "");
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", (error) => {
      if (aborted && error?.code === "ECONNRESET") return;
      reject(error);
    });
  });
}

function buildAdminSessionCookie(token, ttlMs, secure) {
  return `${ADMIN_SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? "; Secure" : ""}`;
}

function buildAdminClearCookie(secure) {
  return `${ADMIN_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0${secure ? "; Secure" : ""}`;
}

function resolveAdminAssetName(baseDir, relativeName) {
  const cleaned = String(relativeName || "").replace(/\\/g, "/");
  // Flat file names only: no separators, no dot segments, no hidden files.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(cleaned) || cleaned.includes("..")) return null;
  const resolvedRoot = path.resolve(baseDir);
  const target = path.resolve(resolvedRoot, cleaned);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) return null;
  return target;
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

export function createAdminPortal({
  adminToken = process.env.ANALYTICS_ADMIN_TOKEN,
  adminSessions,
  adminSessionTtlMs,
  adminDistDir = DEFAULT_ADMIN_DIST_DIR,
  isProductionImpl = isProduction,
  loginRateLimiter,
  nowImpl = () => Date.now(),
  publicBaseUrl = "http://127.0.0.1:8787",
} = {}) {
  if (!adminSessions || typeof adminSessions.has !== "function" || typeof adminSessions.issue !== "function") {
    throw new TypeError("adminSessions store is required");
  }
  if (!Number.isFinite(adminSessionTtlMs) || adminSessionTtlMs < 1) {
    throw new RangeError("adminSessionTtlMs must be a positive number");
  }

  async function readShellHtml() {
    return readFile(path.join(path.resolve(adminDistDir), "index.html"), "utf8");
  }

  async function serveAsset(res, relativeName, { immutable, baseDir }) {
    const extension = path.extname(String(relativeName || "")).toLowerCase();
    const contentType = ADMIN_ASSET_CONTENT_TYPES[extension];
    if (!contentType) {
      sendAdminText(res, 404, "admin asset not found");
      return;
    }
    const filePath = resolveAdminAssetName(path.join(path.resolve(adminDistDir), baseDir), relativeName);
    if (!filePath) {
      sendAdminText(res, 404, "admin asset not found");
      return;
    }
    let body;
    try {
      body = await readFile(filePath);
    } catch {
      sendAdminText(res, 404, "admin asset not found");
      return;
    }
    res.writeHead(
      200,
      adminSecurityHeaders({
        "Content-Type": contentType,
        "Cache-Control": immutable ? ADMIN_ASSET_CACHE_IMMUTABLE : ADMIN_CACHE_NO_STORE,
        "Content-Length": body.length,
      }),
    );
    res.end(body);
  }

  async function handleLogin(req, res, ip) {
    // Fail closed on missing configuration before any rate-limit budget is
    // consumed, mirroring the legacy protected routes.
    const normalizedAdminToken = requireConfiguredAdminToken(adminToken);
    assertSameOrigin(req);
    if (loginRateLimiter) {
      const result = loginRateLimiter.consume(`admin-login:ip:${ip}`, ADMIN_LOGIN_LIMIT, ADMIN_LOGIN_WINDOW_MS);
      if (!result.allowed) {
        const retryAfter = Math.max(1, Math.ceil((result.resetAt - nowImpl()) / 1000));
        throw new AdminHttpError(429, "ADMIN_RATE_LIMITED", {
          publicDetail: `rate limit exceeded; retry after ${retryAfter}s`,
          retryAfterSeconds: retryAfter,
        });
      }
    }
    const submittedToken = await readAdminLoginBody(req);
    if (!submittedToken || !adminTokensMatch(submittedToken, normalizedAdminToken)) {
      throw new AdminHttpError(401, "ADMIN_AUTH_FAILED", { publicDetail: "Admin authentication failed." });
    }
    const session = adminSessions.issue();
    const secure = isProductionImpl() || publicBaseUrl.startsWith("https://");
    adminRedirect(res, "/admin", buildAdminSessionCookie(session.token, adminSessionTtlMs, secure));
  }

  function handleLogout(req, res) {
    assertSameOrigin(req);
    const session = getCookieValue(req, ADMIN_SESSION_COOKIE);
    if (session) adminSessions.delete(session);
    const secure = isProductionImpl() || publicBaseUrl.startsWith("https://");
    adminRedirect(res, "/admin/login", buildAdminClearCookie(secure));
  }

  function handleApiSession(req, res) {
    // Fail closed when the long-lived secret is not configured at all.
    requireConfiguredAdminToken(adminToken);
    const credential = getCookieValue(req, ADMIN_SESSION_COOKIE);
    const session = credential ? adminSessions.get(credential) : null;
    if (!session) throw new AdminHttpError(401, "ADMIN_SESSION_REQUIRED");
    // Only authoritative metadata; the credential itself never leaves the cookie.
    sendAdminJson(res, 200, { ok: true, session: { expiresAt: session.expiresAt } });
  }

  function handleApiNotFound(res) {
    sendAdminJson(res, 404, { ok: false, error: "ADMIN_NOT_FOUND" });
  }

  async function handleShell(req, res, pathname) {
    const candidate = pathname === "/admin" || pathname === "/admin/" ? "" : pathname.slice("/admin/".length);
    let decoded;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      sendAdminText(res, 404, "admin route not found");
      return;
    }

    // Strict asset namespace first: /admin/assets/<file> never falls back to
    // the shell so a wrong asset is a 404, not HTML with the wrong MIME.
    if (decoded.startsWith("assets/")) {
      await serveAsset(res, decoded.slice("assets/".length), { immutable: true, baseDir: "assets" });
      return;
    }

    if (decoded && decoded.split("/").pop()?.includes(".")) {
      await serveAsset(res, decoded, { immutable: false, baseDir: "." });
      return;
    }

    // Deep SPA routes collapse to the shell behind the session gate.
    if (!hasAdminSession(req, adminSessions)) {
      adminRedirect(res, "/admin/login");
      return;
    }
    const html = await readShellHtml();
    sendAdminHtml(res, 200, html);
  }

  return {
    // Returns true when the request was handled (or explicitly rejected) by
    // the Admin portal; false hands control back to the legacy router, which
    // still owns /admin/data and the machine Bearer analytics APIs.
    async handle(req, res, url, ip) {
      const { pathname } = url;
      const method = String(req.method || "GET").toUpperCase();
      // Legacy machine/session JSON API stays owned by server.mjs; the Admin
      // SPA must not depend on it (Phase 11B1 compatibility contract).
      if (pathname === "/admin/data") return false;
      try {
        if (method === "GET" && pathname === "/") {
          adminRedirect(res, "/admin");
          return true;
        }

        if (pathname === "/admin/login") {
          if (method === "GET") {
            if (hasAdminSession(req, adminSessions)) {
              adminRedirect(res, "/admin");
            } else {
              sendAdminHtml(res, 200, renderAdminLoginPage(publicBaseUrl));
            }
            return true;
          }
          if (method === "POST") {
            await handleLogin(req, res, ip);
            return true;
          }
          sendAdminJson(res, 405, { ok: false, error: "ADMIN_METHOD_NOT_ALLOWED" });
          return true;
        }

        if (pathname === "/admin/logout") {
          if (method === "POST") {
            handleLogout(req, res);
            return true;
          }
          sendAdminJson(res, 405, { ok: false, error: "ADMIN_METHOD_NOT_ALLOWED" });
          return true;
        }

        if (pathname === "/admin/api/session") {
          if (method !== "GET") {
            sendAdminJson(res, 405, { ok: false, error: "ADMIN_METHOD_NOT_ALLOWED" });
            return true;
          }
          handleApiSession(req, res);
          return true;
        }

        if (pathname.startsWith("/admin/api/")) {
          handleApiNotFound(res);
          return true;
        }

        if (method === "GET" && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
          await handleShell(req, res, pathname);
          return true;
        }

        if (pathname === "/admin" || pathname.startsWith("/admin/")) {
          sendAdminJson(res, 405, { ok: false, error: "ADMIN_METHOD_NOT_ALLOWED" });
          return true;
        }

        return false;
      } catch (error) {
        if (error instanceof AdminHttpError) {
          const wantsJson = pathname.startsWith("/admin/api/");
          if (wantsJson) {
            sendAdminJson(res, error.statusCode, { ok: false, error: error.code });
          } else {
            const headers = adminSecurityHeaders({
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": ADMIN_CACHE_NO_STORE,
            });
            if (error.retryAfterSeconds) headers["Retry-After"] = String(error.retryAfterSeconds);
            res.writeHead(error.statusCode, headers);
            res.end(renderAdminErrorPage(error.statusCode, error.code, error.publicDetail));
          }
          return true;
        }
        // Unexpected Admin portal failure: stable opaque code, details only in
        // the server-side log.
        console.error(
          "[analytics-server] admin portal internal error",
          pathname,
          error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        );
        if (pathname.startsWith("/admin/api/")) {
          sendAdminJson(res, 500, { ok: false, error: "ADMIN_INTERNAL_ERROR" });
        } else {
          sendAdminHtml(res, 500, renderAdminErrorPage(500, "ADMIN_INTERNAL_ERROR", "Admin internal error."));
        }
        return true;
      }
    },
  };
}
