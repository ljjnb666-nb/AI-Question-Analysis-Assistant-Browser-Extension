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
- `POST /auth/register`: email registration for plugin access
- `POST /auth/login`: email login for plugin access
- `POST /analytics/events`: anonymous/authenticated event ingestion
- `GET /analytics/summary`: daily + rolling metrics summary, requires `Authorization: Bearer $ANALYTICS_ADMIN_TOKEN`
- `GET /analytics/timeseries?days=14`: recent DAU/install/activation/registration series, requires `Authorization: Bearer $ANALYTICS_ADMIN_TOKEN`

## Storage

The server persists data to `analytics-server/data/analytics-db.sqlite`.

If a legacy `analytics-server/data/analytics-db.json` file exists and the SQLite database is still empty, the server imports that JSON snapshot automatically on first boot.

Security notes:

- Verification codes are stored hashed, not in plaintext.
- Session tokens are stored hashed, not in plaintext.
- The server enforces basic fixed-window rate limits on auth, event ingestion, and metrics reads.
- JSON request bodies larger than 64 KB are rejected.

## Default plugin behavior

- Users must register or log in with email before popup and side panel actions unlock.
- Registration and login use separate pages in the popup/settings UI.
- Registration requires a verification code that is delivered through SMTP email.
- The extension generates a local `deviceId` automatically.
- Core events are uploaded with `deviceId`, event name, timestamp, host, and extension version.
- The default analytics backend URL is `https://analytics.082515.online`.
