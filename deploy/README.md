# Deploying to a VPS

Ubuntu 22.04 / 24.04, one domain, automatic HTTPS.

```
https://your-domain
  ├─ /api/*  → Caddy strips /api → 127.0.0.1:8000   FastAPI  (systemd: hrms-backend)
  └─ /*      →                     127.0.0.1:3000   Next.js  (systemd: hrms-frontend)
```

Both app processes bind to loopback only — Caddy is the sole public listener.
Serving both halves from one origin is deliberate: the session cookie stays
first-party and CORS never enters the picture in the browser. Server Components
skip the proxy and call `127.0.0.1:8000` directly.

## Install

Point an **A record** for your domain at the VPS IP first — Caddy cannot get a
certificate until the domain resolves to the server.

```bash
ssh root@your-vps-ip
git clone https://github.com/shafqatameen/OutcomeOriented-HRMS-FOR-STARTUPS.git /opt/hrms
cd /opt/hrms
chmod +x deploy/*.sh

DOMAIN=hrms.example.com ADMIN_EMAIL=you@example.com ./deploy/install.sh
```

To choose the seeded passwords instead of getting random ones, prefix them:

```bash
DOMAIN=hrms.example.com ADMIN_EMAIL=you@example.com \
SEED_PASSWORD_ABDU='...' SEED_PASSWORD_ANNU='...' SEED_PASSWORD_SAM='...' \
./deploy/install.sh
```

The script installs Node 22, uv, and Caddy; creates the `hrms` service user;
builds both apps; writes the systemd units and Caddyfile; seeds the database if
it is empty; then starts everything and verifies it. It is idempotent — re-running
upgrades in place, and it will not re-seed a populated database or regenerate
`JWT_SECRET_KEY` (which would log everyone out).

Seeded account passwords are printed **once**. Save them.

## Deploying changes

```bash
sudo /opt/hrms/deploy/update.sh
```

Backs up the database, fast-forwards to `origin/main`, reinstalls dependencies,
rebuilds the frontend, restarts both services, and verifies. Alembic migrations
are applied by the backend at startup, so there is no separate migration step.

## Operating

```bash
systemctl status hrms-backend hrms-frontend caddy
journalctl -u hrms-backend -f          # API logs
journalctl -u hrms-frontend -f         # Next.js logs
tail -f /var/log/caddy/hrms.log        # access logs
systemctl restart hrms-backend
```

| Thing | Location |
|---|---|
| Code | `/opt/hrms` |
| Database | `/opt/hrms/backend/pointsystem.db` |
| Backend secrets | `/etc/hrms/backend.env` (mode 640, root:hrms) |
| Frontend build env | `/opt/hrms/frontend/.env.production` |
| Caddy config | `/etc/caddy/Caddyfile` (generated — edit `deploy/Caddyfile` and re-run install) |

## Backups

`update.sh` snapshots the database before each deploy and keeps the last five.
That covers deploy accidents, not disk loss — for real backups, copy the `.db`
off the box on a schedule:

```bash
# /etc/cron.daily/hrms-backup
sqlite3 /opt/hrms/backend/pointsystem.db ".backup '/var/backups/hrms-$(date +\%F).db'"
```

## Notes and limits

- **SQLite.** Fine for a small team, and the whole database is one file to back
  up. It does not survive being served from two machines, and concurrent writes
  serialize. Moving to Postgres means changing `SQLALCHEMY_DATABASE_URL` in
  `backend/app/core/database.py` and dropping the SQLite-only `connect_args`.
- **Rebuild required for API URL changes.** `NEXT_PUBLIC_API_URL` is inlined
  into the client bundle at build time, so changing the domain means re-running
  `install.sh` (which rewrites `.env.production` and rebuilds), not just a
  service restart.
- **Changing the domain** also changes `FRONTEND_ORIGIN`; re-run `install.sh`
  with the new `DOMAIN` and it updates both plus the Caddyfile.
- **First request after install is slow** — that is Caddy fetching the
  certificate. Subsequent requests are normal.
