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
- `GET /admin/api/session`: cookie-only browser Admin session authority; the long-lived admin bearer is not accepted here
- `GET /admin/api/overview?days=14`: cookie-only aggregate overview. Telemetry activity is explicitly labeled `opt_in_only`; registered-account counts are labeled separately as `all_registered_accounts`
- `GET /admin/api/analytics/timeseries?days=14`: dense daily opt-in activity / observed install / parse outcome series plus separately scoped account registrations
- `GET /admin/api/analytics/providers?days=14`: observed parse outcomes grouped by provider; this is not a current-user provider configuration distribution
- `GET /admin/api/analytics/errors?days=14`: observed terminal parse errors grouped by allowlisted error category
- `GET /admin/api/analytics/versions?days=14`: latest observed extension version per opt-in device inside the requested window, not raw event frequency
- `GET /admin/api/analytics/latency?days=14`: observed parse-outcome duration samples and daily averages
- `GET /admin`, `/admin/analytics`, `/admin/users`, `/admin/system`, `/admin/audit`: independent Admin Console application routes
- `POST /admin/logout`: invalidates the current browser admin session

The dashboard submits the admin token in the login request body. Admin tokens in query parameters are never accepted. Browser sessions expire after 8 hours, are limited to 64 active sessions, and use an `HttpOnly`, `SameSite=Strict` cookie scoped to `/admin` (`Secure` in production). Admin login allows 10 attempts per IP in a 15-minute window. If `ANALYTICS_ADMIN_TOKEN` is blank or missing, protected routes fail closed with `503 ADMIN_AUTH_NOT_CONFIGURED` and do not load analytics data.

The Admin analytics read APIs accept only integer `days` values from 1 through 90 (default 14), matching the analytics retention window. They are session-cookie only, use a separate bounded read-rate namespace, return aggregate allowlisted DTOs, and do not serialize raw database rows. Missing denominators are represented as `null` ratios rather than fabricated zero-percent results.

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
