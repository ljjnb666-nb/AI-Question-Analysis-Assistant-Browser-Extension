# Local Docker Analytics

This runs the analytics/auth backend and the independent Admin Console in Docker on the current machine.

Default local origin:

- `http://localhost:8787`

## Start

The local compose file builds `Dockerfile.analytics`, including the verified `dist-admin` artifact and the Node.js 24 runtime:

```bash
docker compose -f docker-compose.analytics.local.yml up -d --build
```

## Check

```bash
docker compose -f docker-compose.analytics.local.yml ps
curl http://localhost:8787/healthz
```

Open the Admin Console:

- `http://localhost:8787/admin`

Unauthenticated requests redirect to the native login document at `/admin/login`.

## Stop

```bash
docker compose -f docker-compose.analytics.local.yml down
```

## Notes

- SQLite data is persisted through `./analytics-server/data`.
- The container listens on `0.0.0.0`; Docker publishes port `8787` to the host.
- SMTP uses the provider configured in `.env.analytics.local`.
- Admin login/logout POSTs enforce the configured public origin. For local browser testing, leave `PUBLIC_BASE_URL` unset or set it to the exact local origin you open in the browser, such as `http://localhost:8787`.
- Do not point `PUBLIC_BASE_URL` at `https://analytics.082515.online` while opening the Admin Console from localhost; the origin mismatch is rejected by design.
- The extension default backend can remain the production analytics origin. To exercise the local backend from the extension, explicitly set the plugin backend URL to the local origin.
- Local compose now builds the same Node.js 24 / SQLite / Admin artifact contract as production and mounts only the analytics data directory; it no longer bind-mounts the entire repository over `/app`.
