#!/usr/bin/env bash
#
# Pull the latest code and restart. Run after pushing to the deployed branch:
#
#   sudo /opt/hrms/deploy/update.sh
#
# The backend applies pending Alembic migrations on startup, so no separate
# migration step is needed.
set -euo pipefail

APP_USER="${APP_USER:-hrms}"
APP_DIR="${APP_DIR:-/opt/hrms}"
BRANCH="${BRANCH:-main}"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"
[[ -d "$APP_DIR/.git" ]] || die "$APP_DIR is not a git checkout; run install.sh first"

as_app() { sudo -u "$APP_USER" env HOME="/home/$APP_USER" "$@"; }

log "Backing up database"
backup="$APP_DIR/backend/pointsystem.db.$(date +%Y%m%d-%H%M%S).bak"
if [[ -f "$APP_DIR/backend/pointsystem.db" ]]; then
  as_app sqlite3 "$APP_DIR/backend/pointsystem.db" ".backup '$backup'" 2>/dev/null \
    || as_app cp "$APP_DIR/backend/pointsystem.db" "$backup"
  echo "    $backup"
  # Keep the five most recent.
  ls -1t "$APP_DIR"/backend/pointsystem.db.*.bak 2>/dev/null | tail -n +6 | xargs -r rm --
fi

log "Fetching $BRANCH"
before="$(as_app git -C "$APP_DIR" rev-parse HEAD)"
as_app git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
as_app git -C "$APP_DIR" reset --hard --quiet "origin/$BRANCH"
after="$(as_app git -C "$APP_DIR" rev-parse HEAD)"

if [[ "$before" == "$after" ]]; then
  log "Already up to date at ${after:0:8}; restarting anyway"
else
  echo "    ${before:0:8} -> ${after:0:8}"
fi

log "Syncing backend dependencies"
as_app uv sync --frozen --project "$APP_DIR/backend"

log "Rebuilding frontend"
as_app npm --prefix "$APP_DIR/frontend" ci --no-audit --no-fund
as_app env NODE_ENV=production npm --prefix "$APP_DIR/frontend" run build

log "Restarting services"
systemctl restart hrms-backend
sleep 2
systemctl restart hrms-frontend

sleep 3
failed=0
for unit in hrms-backend hrms-frontend caddy; do
  # caddy is absent on aaPanel installs (deploy/install-aapanel.sh) — skip it.
  [[ "$unit" == "caddy" ]] && ! systemctl list-unit-files --no-legend "caddy.service" 2>/dev/null | grep -q . && continue
  if systemctl is-active --quiet "$unit"; then
    echo "    ok   $unit"
  else
    echo "    FAIL $unit  -> journalctl -u $unit -n 50"
    failed=1
  fi
done

[[ $failed -eq 0 ]] || die "update finished but a service is down"
log "Updated"
