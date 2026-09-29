# Analytics And Auth

## Start the backend

```bash
set SMTP_HOST=smtp.example.com
set SMTP_PORT=587
set SMTP_USER=mailer@example.com
set SMTP_PASS=your-smtp-password
set SMTP_FROM=Quiz Solver <mailer@example.com>
set ANALYTICS_ADMIN_TOKEN=replace-with-a-long-random-token
npm run analytics:server
```

By default the server runs on port `8787`.

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
- `GET /analytics/summary`: daily + rolling metrics summary, requires an admin session cookie or `Authorization: Bearer $ANALYTICS_ADMIN_TOKEN`
- `GET /analytics/timeseries?days=14`: recent DAU/install/activation/registration series, requires an admin session cookie or `Authorization: Bearer $ANALYTICS_ADMIN_TOKEN`
- `GET /`: analytics admin login gate and dashboard
- `POST /admin/login`: exchanges a form-encoded admin token for a short-lived browser session
- `POST /admin/logout`: invalidates the current browser admin session

The dashboard submits the admin token in the login request body. Admin tokens in query parameters are never accepted. Browser sessions expire after 8 hours, are limited to 64 active sessions, and use an `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production). Admin login allows 10 attempts per IP in a 15-minute window. If `ANALYTICS_ADMIN_TOKEN` is blank or missing, protected routes fail closed with `503 ADMIN_AUTH_NOT_CONFIGURED` and do not load analytics data.

## Storage

The server persists data to `analytics-server/data/analytics-db.sqlite`.

If a legacy `analytics-server/data/analytics-db.json` file exists and the SQLite database is still empty, the server imports that JSON snapshot automatically on first boot.

Security notes:

- Verification codes are stored hashed, not in plaintext, and are generated with `crypto.randomInt`.
- Extension account auth tokens are stored hashed, not in plaintext. Analytics admin session credentials are random and held only in the bounded server-memory registry until expiry or eviction.
- Account tokens carry a server-side expiry (`AUTH_SESSION_TTL_MS`, 30 days). The server exposes the validation and revocation authority (`/auth/session`, `/auth/logout`), but the `chrome.storage.local` copy of `userId`/`userEmail`/`authToken` is still only an unverified client cache: until REL-AUTH-01C wires startup validation into the popup / side panel / settings surfaces, those UIs continue to gate on the cached identity.
- Each account has a single active token: registering or logging in again revokes the previous token, and logout revokes the token server-side.
- Databases created before token expiries existed are migrated in place (`ALTER TABLE users ADD COLUMN authTokenExpiresAt`) before any read, write, or legacy JSON import touches the new column; legacy tokens without a provable expiry fail session validation until the next login issues a fresh bounded token.
- Registration and login do not disclose account existence without proof of email control: registration verifies the one-time code before any duplicate check, and login returns the same `AUTH_INVALID_CREDENTIALS` error for unknown accounts and wrong passwords.
- The server enforces basic fixed-window rate limits on auth, event ingestion, and metrics reads.
- JSON request bodies larger than 64 KB are rejected.

## Default plugin behavior

- Users must register or log in with email before popup and side panel actions unlock.
- Registration and login use separate pages in the popup/settings UI.
- Registration requires a verification code that is delivered through SMTP email.
- The extension generates a local `deviceId` automatically.
- Core events are uploaded with `deviceId`, event name, timestamp, host, and extension version.
- The default analytics backend URL is `https://analytics.082515.online`.
