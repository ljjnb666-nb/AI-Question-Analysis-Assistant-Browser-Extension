# Analytics And Auth

## Start the backend

```bash
set SMTP_HOST=smtp.example.com
set SMTP_PORT=587
set SMTP_USER=mailer@example.com
set SMTP_PASS=your-smtp-password
set SMTP_FROM=Quiz Solver <mailer@example.com>
set ANALYTICS_ADMIN_TOKEN=replace-with-a-long-random-token
npm run build:admin
npm run analytics:server
```

By default the server runs on port `8787`. Production uses Node.js 24 and SQLite; the JSON fallback is compatibility/development behavior, not the production storage contract.

- Local development example: `http://127.0.0.1:8787`
- Public deployment example: `https://analytics.082515.online`

For public deployment, set:

```bash
set ANALYTICS_HOST=0.0.0.0
set ANALYTICS_PORT=8787
set PUBLIC_BASE_URL=https://analytics.082515.online
```

## What it provides

- `POST /auth/send-verification-code`: send a real email verification code
- `POST /auth/register`: email registration for plugin access. Registration runs as one all-or-nothing operation (validate input, verify the one-time code, check the account, create the user, consume the code). Invalid or expired codes always return `400 invalid or expired verification code` regardless of whether the account exists; `409 email already registered` is only returned after a valid code proved email control
- `POST /auth/login`: email login for plugin access; unknown account and wrong password share the same `401 AUTH_INVALID_CREDENTIALS` response
- `POST /auth/session`: server-side session validation authority; requires `Authorization: Bearer <authToken>` and a `{ "userId": "..." }` body. Returns `{ ok: true, user: { userId, email }, expiresAt }` for a live session, or `401 AUTH_SESSION_INVALID` for any invalid, expired, revoked, or mismatched session
- `POST /auth/logout`: validates the bearer session and revokes the stored token server-side; returns `401 AUTH_SESSION_INVALID` for unknown or already-revoked sessions
- `POST /analytics/events`: anonymous/authenticated event ingestion
- `GET /analytics/summary`: legacy metrics API; browser Admin Console does not use this route. Machine/API callers may use `Authorization: Bearer $ANALYTICS_ADMIN_TOKEN`
- `GET /analytics/timeseries?days=14`: legacy timeseries API; browser Admin Console does not use this route. Machine/API callers may use `Authorization: Bearer $ANALYTICS_ADMIN_TOKEN`
- `GET /`: redirects to the independent Admin Console at `/admin`
- `GET /admin/login`: native, POST-only admin login document
- `POST /admin/login`: exchanges a form-encoded admin token for a short-lived browser session
- `GET /admin/api/session`: cookie-only browser Admin session authority; returns session expiry plus the per-session CSRF token used only for same-origin Admin mutations. The long-lived admin bearer is not accepted here
- `GET /admin/api/overview?days=14`: cookie-only aggregate overview. Telemetry activity is explicitly labeled `opt_in_only`; registered-account counts are labeled separately as `all_registered_accounts`
- `GET /admin/api/analytics/timeseries?days=14`: dense daily opt-in activity / observed install / parse outcome series plus separately scoped account registrations
- `GET /admin/api/analytics/providers?days=14`: observed parse outcomes grouped by provider; this is not a current-user provider configuration distribution
- `GET /admin/api/analytics/errors?days=14`: observed terminal parse errors grouped by allowlisted error category
- `GET /admin/api/analytics/versions?days=14`: latest observed extension version per opt-in device inside the requested window, not raw event frequency
- `GET /admin/api/analytics/latency?days=14`: observed parse-outcome duration samples and daily averages
- `GET /admin/api/users?limit=50&cursor=...&q=...`: cookie-only, read-only user directory. Returns only `userId`, `email`, `createdAt`, `linkedDeviceCount`, and `latestDeviceSeenAt`. Device ownership/counts come from `devices.userId`, not denormalized `users.deviceIdsJson`. Pagination is deterministic `createdAt DESC, userId DESC` with an opaque cursor; `limit` is 1–100 (default 50), and optional `q` is a bounded, case-insensitive literal substring search over email/userId.
- `GET /admin/api/system`: cookie-only, read-only sanitized current-process snapshot. Exposes only generated time, current process uptime, storage driver, mailer-configured boolean, single-process authority semantics, analytics retention days, and privacy epoch. It never exposes filesystem paths, environment values, SMTP details, CPU/RAM/disk metrics, historical uptime, or fabricated health/SLA data.
- `GET /admin/api/audit?limit=50&cursor=...`: cookie-only, read-only security audit timeline. The cursor is opaque; `limit` is a strict integer from 1–100 (default 50). Audit reads have an isolated bounded rate-limit namespace and never accept the long-lived Admin bearer.
- `GET /admin`, `/admin/analytics`, `/admin/users`, `/admin/system`, `/admin/audit`: independent Admin Console application routes
- `POST /admin/logout`: invalidates the current browser admin session. A live session must pass the configured Origin check and submit its per-session CSRF token as form data before the session is revoked.

The dashboard submits the admin token in the login request body. Admin tokens in query parameters are never accepted. Browser sessions expire after 8 hours, are limited to 64 active sessions, and use an `HttpOnly`, `SameSite=Strict` cookie scoped to `/admin` (`Secure` in production). Admin login allows 10 attempts per IP in a 15-minute window. If `ANALYTICS_ADMIN_TOKEN` is blank or missing, protected routes fail closed with `503 ADMIN_AUTH_NOT_CONFIGURED` and do not load analytics data.

The Admin analytics read APIs accept only integer `days` values from 1 through 90 (default 14), matching the analytics retention window. They are session-cookie only, use a separate bounded read-rate namespace, return aggregate allowlisted DTOs, and do not serialize raw database rows. Missing denominators are represented as `null` ratios rather than fabricated zero-percent results.

The Admin Users/System read APIs are also browser-session-cookie only and do not accept the long-lived Admin bearer. They use limiter namespaces separate from login and analytics reads. The Users path never calls the broad raw `loadDb()` reader; SQLite selects only allowlisted user fields plus device aggregates, and the JSON compatibility path constructs the same DTO explicitly. Password hashes/salts, account auth tokens/hashes/salts/expiries, verification-code records, denormalized device-id arrays, and raw device ids are never part of these responses. The System path is a current-process snapshot only: `email.configured` means configuration is present, not that SMTP delivery was probed successfully; `service.status = "ok"` means the protected request was handled successfully by the current process, not an SLA or all-subsystem-health claim.

### Admin Audit and CSRF closure

The Admin security audit is a separate authority from anonymous product analytics. SQLite stores it in `admin_audit_events`; JSON remains compatibility/development behavior. Audit entries are retained for at most 180 days and the write path additionally caps retained entries at 10,000. Audit list reads are bounded, cursor-paginated, and do not perform retention deletes as a side effect.

The event vocabulary is intentionally small: Admin login, Admin logout, CSRF rejection, Origin rejection, and unsupported Admin mutation rejection. Outcomes are limited to `success`, `failure`, and `rejected`. Metadata is allowlisted to a bounded HTTP method, a fixed non-user-controlled Admin path vocabulary (unknown mutation paths collapse to `/admin/api/unknown`), and a fixed reason vocabulary. The audit contract never stores or returns the long-lived Admin token, browser session cookie/token, CSRF token, email address, account user id, raw device id, request body, raw URL query, or raw IP address.

For correlation without persisting raw network/session identifiers, the server stores short pseudonymous source/session tags generated with HMAC-SHA-256. When the Admin secret is configured, that server-only secret is used as key material; the key is not stored in the audit table or returned to the browser. These tags are linkable pseudonyms for operational correlation, not user identities.

Each Admin browser session has its own random CSRF token. The token is returned only by the authenticated, same-origin `/admin/api/session` response, kept in frontend memory, and submitted by the native logout form. It is not stored in localStorage/sessionStorage, placed in URLs, or written to Audit. A token from one Admin session cannot authorize a different session.

Successful Admin login and live-session logout are fail-closed with respect to Audit: if the required Audit write fails, the success path is not allowed to pretend it completed. Security rejection events use a separate bounded per-process write-rate namespace to prevent hostile requests from turning Audit into a database write amplifier. Within that budget, an Audit storage failure degrades the Admin request to an opaque storage failure; once the rejection-audit budget is exhausted, the original security rejection still occurs but no additional Audit row is written. Anonymous unsupported `/admin/api/*` mutations are not persisted; authenticated mutation attempts are recorded with a fixed allowlisted path or the `/admin/api/unknown` sentinel.

Admin browser sessions and their CSRF tokens remain process-local and bounded. A backend process restart invalidates existing Admin sessions and requires re-login. Persistent Audit records survive that restart. This distinction is intentional: Audit persistence must not turn session state into distributed or durable authentication authority.

All Browser Admin Portal responses under `/admin` and `/admin/api/*`—including HTML, JSON, assets, redirects, and failures—use the Admin security header policy, including CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, same-origin opener/resource policies, and a restrictive permissions policy. The legacy machine-compatible `/admin/data` route remains outside this Browser Admin Portal contract so its historical cross-origin/API compatibility is not silently changed. No account-management mutation (ban/delete/role/password/device revoke/etc.) is introduced by this phase.

## Storage

The server persists data to `analytics-server/data/analytics-db.sqlite`.

If a legacy `analytics-server/data/analytics-db.json` file exists and the SQLite database is still empty, the server imports that JSON snapshot automatically on first boot.

Security notes:

- Verification codes are stored hashed, not in plaintext, and are generated with `crypto.randomInt`.
- Extension account auth tokens are stored hashed, not in plaintext. Analytics admin session credentials are random and held only in the bounded server-memory registry until expiry or eviction.
- Account tokens carry a server-side expiry (`AUTH_SESSION_TTL_MS`, 30 days). The server exposes the validation and revocation authority (`/auth/session`, `/auth/logout`). The `chrome.storage.local` copy of `userId`/`userEmail`/`authToken` is only a client cache; it does not establish authenticated authority. UI startup/session state is validated against the server session authority before authenticated actions unlock.
- Each account has a single active token: registering or logging in again revokes the previous token, and logout revokes the token server-side.
- Databases created before token expiries existed are migrated in place (`ALTER TABLE users ADD COLUMN authTokenExpiresAt`) before any read, write, or legacy JSON import touches the new column; legacy tokens without a provable expiry fail session validation until the next login issues a fresh bounded token.
- Registration and login do not disclose account existence without proof of email control: registration verifies the one-time code before any duplicate check, and login returns the same `AUTH_INVALID_CREDENTIALS` error for unknown accounts and wrong passwords.
- Login failures use a runtime dummy password verifier for unknown accounts, so unknown-email and wrong-password paths both pay comparable scrypt verification cost.
- The server enforces per-process fixed-window rate limits on auth, event ingestion, and metrics reads. Each namespace has its own bounded limiter; active buckets are never evicted or reset by capacity pressure, and expired buckets are reclaimed by a sweep. This is a single-process limiter, not a distributed one: horizontally scaled replicas would each enforce their own window and would need a shared limiter to enforce a global quota.
- JSON request bodies larger than 64 KB are rejected.

## Default plugin behavior

- Users must register or log in with email before popup and side panel actions unlock.
- Registration and login use separate pages in the popup/settings UI.
- Registration requires a verification code that is delivered through SMTP email.
- The extension generates a local `deviceId` automatically.
- Usage analytics is optional and **off by default**; events are sent only after the user explicitly turns the setting on and saves it. Before consent, no analytics events are uploaded.
- Core events are uploaded with `deviceId`, the consent protocol version, event name, timestamp, extension version, and a small allowlist of event-specific fields. They do not include the page hostname, question or answer content, screenshots or images, API key, auth token, password, verification code, email address, or client-supplied account identity. See [../PRIVACY.md](../PRIVACY.md) for the full data-flow contract.
- The default analytics backend URL is `https://analytics.082515.online`.
