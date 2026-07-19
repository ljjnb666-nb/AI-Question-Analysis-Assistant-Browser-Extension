# Local Docker Analytics

This runs the analytics/auth backend in Docker on the current machine and exposes it on:

- `http://127.0.0.1:8787`

## Start

```bash
docker compose -f docker-compose.analytics.local.yml up -d
```

## Check

```bash
docker compose -f docker-compose.analytics.local.yml ps
curl http://127.0.0.1:8787/healthz
```

Open the dashboard:

- `http://127.0.0.1:8787/`

## Stop

```bash
docker compose -f docker-compose.analytics.local.yml down
```

## Notes

- SQLite data is persisted through `./analytics-server/data`.
- The container listens on `0.0.0.0`, but the published host port is local `127.0.0.1:8787`.
- SMTP now uses the real provider configured in `.env.analytics.local`.
- `PUBLIC_BASE_URL` can already point at `https://analytics.082515.online` even while the container is still running locally.
- Because the extension default backend now points to `https://analytics.082515.online`, local Docker testing requires manually setting the plugin backend URL to `http://127.0.0.1:8787` in the settings panel.
- The local compose file reuses a pre-existing local Node image (`syncmusic-backend`) and bind-mounts the current workspace, so it avoids both Docker Hub pulls and in-container `npm install`.
