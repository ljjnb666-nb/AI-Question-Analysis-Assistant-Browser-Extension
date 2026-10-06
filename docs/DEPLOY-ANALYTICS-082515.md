# Deploy Analytics To analytics.082515.online

This project can now be deployed as a public analytics/auth backend for the extension.

## Target

- Public API origin: `https://analytics.082515.online`
- Extension default backend: `https://analytics.082515.online`

## 1. DNS

Create an `A` record:

- host: `analytics`
- value: your server public IPv4

If you use IPv6, also add an `AAAA` record.

## 2. Server runtime

Install Node.js 24+ on the server (the storage contract is Node 24 + SQLite via
`node:sqlite`; the server fails closed when SQLite is unavailable), then deploy
the repo and run:

```bash
npm install
```

## 3. Environment variables

Set these before starting the backend:

```bash
ANALYTICS_HOST=0.0.0.0
ANALYTICS_PORT=8787
PUBLIC_BASE_URL=https://analytics.082515.online
ANALYTICS_ADMIN_TOKEN=replace-with-a-long-random-secret
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=mailer@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM=Quiz Solver <mailer@example.com>
```

Optional:

```bash
ANALYTICS_DB_FILE=/var/lib/quiz-solver/analytics-db.sqlite
```

You can start from the checked-in template:

```bash
cp .env.analytics.prod.example .env.analytics.prod
```

## 4. Start the backend

```bash
npm run analytics:server
```

The server will listen on all interfaces and store data in SQLite.

The Admin Console build (`dist-admin/`) is required before starting the server:

```bash
npm run build:admin
npm run verify:admin
```

If you prefer Docker on the server, use:

```bash
docker compose -f docker-compose.analytics.prod.yml up -d
```

The Docker image is multi-stage: the Admin console is built in a builder stage
and only the prebuilt `dist-admin/` artifact reaches the runtime image.

## 5. Reverse proxy

Put Nginx or Caddy in front of the Node process and terminate HTTPS there.

Example Nginx site:

```nginx
See [deploy/nginx/analytics.082515.online.conf](../deploy/nginx/analytics.082515.online.conf).
```

## 6. Verify

Check these URLs after deployment:

- `https://analytics.082515.online/healthz`
- `https://analytics.082515.online/` → redirects to `/admin`

The Admin Console lives at `https://analytics.082515.online/admin`. Log in with
`ANALYTICS_ADMIN_TOKEN` at `/admin/login`; a successful login issues an
HttpOnly session cookie scoped to `Path=/admin` with an 8 hour TTL. Sessions
live in process memory only: restarting the server signs every admin out and
the console fails closed back to the login page.

Admin surface (Phase 11B1):

- `GET /admin/login` — native password form
- `POST /admin/login` — exchanges `ANALYTICS_ADMIN_TOKEN` for the session cookie
- `GET /admin`, `GET /admin/*` — Admin Console shell (session required)
- `GET /admin/api/session` — cookie-only session probe (401 → login)
- `POST /admin/logout` — revokes the session and clears the cookie

The long-lived `ANALYTICS_ADMIN_TOKEN` is only sent once through the native
login form; the browser Admin app itself never receives it and `/admin/api/*`
authorizes exclusively through the HttpOnly cookie.

The extension should send events to:

- `POST https://analytics.082515.online/analytics/events`

## 7. Important notes

- `GET /admin/data` requires admin authority (session cookie or
  `Authorization: Bearer <ANALYTICS_ADMIN_TOKEN>`); it is a legacy machine API
  and the Admin Console does not depend on it.
- `GET /analytics/summary` and `GET /analytics/timeseries` require
  `Authorization: Bearer <ANALYTICS_ADMIN_TOKEN>` or a valid admin session.
- Admin responses are protected by a strict CSP (`default-src 'self'`, no
  `unsafe-inline`/`unsafe-eval`), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, and `frame-ancestors 'none'`.
- SQLite is acceptable for early-stage deployment on a single server, but not ideal for horizontal scaling.
- If this becomes production traffic, move the database file to a persistent volume and add backups.
