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

Install Node.js 24 on the server, then deploy the repo and run:

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

If you prefer Docker on the server, use:

```bash
docker compose -f docker-compose.analytics.prod.yml up -d
```

## 5. Reverse proxy

Put Nginx or Caddy in front of the Node process and terminate HTTPS there.

Example Nginx site:

```nginx
See [deploy/nginx/analytics.082515.online.conf](../deploy/nginx/analytics.082515.online.conf).
```

## 6. Verify

Check these URLs after deployment:

- `https://analytics.082515.online/healthz`
- `https://analytics.082515.online/`

The root should redirect to `/admin`; `/admin/login` should load the native admin login gate, and the extension should send events to:

- `POST https://analytics.082515.online/analytics/events`

## 7. Important notes

- `GET /admin/data` requires an admin session cookie or the legacy admin bearer; query-string admin credentials are rejected.
- Browser Admin Console APIs under `/admin/api/*` use the short-lived HttpOnly admin session and do not accept the long-lived admin bearer as browser authority.
- `GET /analytics/summary` and `GET /analytics/timeseries` retain `Authorization: Bearer <ANALYTICS_ADMIN_TOKEN>` for legacy machine/API compatibility.
- Production uses the independent `dist-admin` artifact packaged by `Dockerfile.analytics` and SQLite on a single Node process. Admin sessions and rate limits are process-local, so horizontal scaling requires shared authorities first.
- If this becomes production traffic, move the database file to a persistent volume and add backups.
