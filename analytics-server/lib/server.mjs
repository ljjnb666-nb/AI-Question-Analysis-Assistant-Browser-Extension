import { URL } from "node:url";
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
import {
  createAdminPortal,
  hasAdminAuthority,
  requireConfiguredAdminToken,
} from "./admin-console.mjs";
import { createAdminAnalyticsReadModels } from "./admin-read-model.mjs";
import { createAdminManagementReadModels } from "./admin-management-read-model.mjs";
import {
  createAdminAuditReadModel,
  createAdminAuditRecorder,
} from "./admin-audit.mjs";

const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
const EXTENSION_ORIGIN_PREFIX = "chrome-extension://";
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

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  return match?.[1] || "";
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
    createAdminCsrfToken,
    adminReadModelsImpl,
    adminManagementReadModelsImpl,
    adminAuditReadModelImpl,
    adminAuditRecorderImpl,
    uptimeImpl = () => process.uptime(),
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
    createCsrfToken: createAdminCsrfToken,
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
    adminRead: createNamespaceLimiter(),
    adminUsersRead: createNamespaceLimiter(),
    adminSystemRead: createNamespaceLimiter(),
    adminAuditRead: createNamespaceLimiter(),
    adminSecurityAudit: createNamespaceLimiter(),
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

  const adminReadModels = adminReadModelsImpl || createAdminAnalyticsReadModels({ now: nowImpl });
  const adminManagementReadModels =
    adminManagementReadModelsImpl ||
    createAdminManagementReadModels({
      now: nowImpl,
      uptime: uptimeImpl,
      isMailerConfigured,
    });
  const adminAuditReadModel =
    adminAuditReadModelImpl || createAdminAuditReadModel({ now: nowImpl });
  const adminAuditRecorder =
    adminAuditRecorderImpl ||
    createAdminAuditRecorder({
      now: nowImpl,
      tagKey:
        typeof adminToken === "string" && Buffer.byteLength(adminToken, "utf8") >= 16
          ? adminToken
          : undefined,
    });
  const adminPortal = createAdminPortal({
    adminToken,
    adminSessions,
    adminSessionTtlMs,
    adminLoginRateLimiter: rateLimiters.adminLogin,
    adminReadRateLimiter: rateLimiters.adminRead,
    adminUsersReadRateLimiter: rateLimiters.adminUsersRead,
    adminSystemReadRateLimiter: rateLimiters.adminSystemRead,
    adminAuditReadRateLimiter: rateLimiters.adminAuditRead,
    adminSecurityAuditRateLimiter: rateLimiters.adminSecurityAudit,
    adminReadModels,
    adminManagementReadModels,
    adminAuditReadModel,
    adminAuditRecorder,
    nowImpl,
    publicBaseUrl,
  });

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

      if (
        (url.pathname === "/" || url.pathname.startsWith("/admin")) &&
        (await adminPortal.handle(req, res, url, ip))
      ) {
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
      const externalStatusCode = Number(err?.statusCode);
      const statusCode =
        err instanceof HttpError
          ? err.statusCode
          : Number.isInteger(externalStatusCode) && externalStatusCode >= 400 && externalStatusCode <= 599
            ? externalStatusCode
            : 400;
      sendJson(req, res, statusCode, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
