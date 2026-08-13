#!/usr/bin/env bash
#
# Deploy for the manually-cloned aaPanel setup: app lives at
# /www/wwwroot/OutcomeOriented-HRMS-FOR-STARTUPS, owned by and run as the
# `www` user, with backend/frontend as plain background processes (uvicorn +
# `next start`) rather than systemd units or pm2. This kills whatever is
# bound to their ports and relaunches them the same way aaPanel originally
# started them.
#
# Run as the www user (matches the repo's ownership and the running
# processes), by hand or via the GitHub Actions deploy workflow:
#
#   su -s /bin/bash www -c '/www/wwwroot/OutcomeOriented-HRMS-FOR-STARTUPS/deploy/update-aapanel-manual.sh'
#
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/OutcomeOriented-HRMS-FOR-STARTUPS}"
BRANCH="${BRANCH:-main}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3010}"
# aaPanel's Node.js Project name for the frontend, so its dashboard status
# stays accurate instead of showing "Stopped" for a process it didn't launch.
FRONTEND_AAPANEL_NAME="${FRONTEND_AAPANEL_NAME:-BH_Tasks_Frontend}"
AAPANEL_PYTHON="/www/server/panel/pyenv/bin/python"
NODEJS_SERVICE="/www/server/panel/script/nodejs-service.py"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[[ -d "$APP_DIR/.git" ]] || die "$APP_DIR is not a git checkout"

log "Fetching $BRANCH"
before="$(git -C "$APP_DIR" rev-parse HEAD)"
git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
git -C "$APP_DIR" reset --hard --quiet "origin/$BRANCH"
after="$(git -C "$APP_DIR" rev-parse HEAD)"
if [[ "$before" == "$after" ]]; then
  log "Already up to date at ${after:0:8}; restarting anyway"
else
  echo "    ${before:0:8} -> ${after:0:8}"
fi

log "Syncing backend dependencies"
if command -v uv >/dev/null 2>&1; then
  uv sync --frozen --project "$APP_DIR/backend"
else
  "$APP_DIR/backend/.venv/bin/pip" install -q -r "$APP_DIR/backend/requirements.txt"
fi

log "Rebuilding frontend"
npm --prefix "$APP_DIR/frontend" ci --no-audit --no-fund
NODE_ENV=production npm --prefix "$APP_DIR/frontend" run build

# Next.js and uvicorn both obscure their argv, so processes are identified by
# the port they're bound to rather than by matching command text.
kill_port() {
  local port="$1" pid
  pid="$(ss -ltnp 2>/dev/null | awk -v p=":${port}\$" '$4 ~ p {print $NF}' | grep -oP 'pid=\K[0-9]+' | head -n1 || true)"
  [[ -z "${pid:-}" ]] && pid="$(fuser -n tcp "$port" 2>/dev/null | tr -d ' ' || true)"
  [[ -z "${pid:-}" ]] && return 0
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -9 "$pid" 2>/dev/null || true
}

log "Restarting backend (port $BACKEND_PORT)"
kill_port "$BACKEND_PORT"
# setsid (without -f) silently no-ops if this subshell is already a process
# group leader, leaving the process attached to the SSH session and hanging
# the deploy connection even after everything else has finished. -f forces
# a real fork so detachment always happens.
( cd "$APP_DIR/backend" && setsid -f nohup ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" >>uvicorn.log 2>&1 </dev/null & )
disown -a 2>/dev/null || true

log "Restarting frontend (port $FRONTEND_PORT)"
# Frees the port in case a prior deploy left an orphaned process aaPanel
# doesn't know about (its own "restart" would otherwise fail with
# EADDRINUSE, same as clicking Restart in the UI while that's running).
kill_port "$FRONTEND_PORT"
if [[ -x "$AAPANEL_PYTHON" && -f "$NODEJS_SERVICE" ]]; then
  # Goes through aaPanel's own Node.js Project supervisor so its dashboard
  # (status, PID, PM2 Monitor) reflects the real process instead of a stale
  # "Stopped" for one it never launched.
  "$AAPANEL_PYTHON" "$NODEJS_SERVICE" "$FRONTEND_AAPANEL_NAME" restart
else
  ( cd "$APP_DIR/frontend" && setsid -f nohup npm run start >>next.log 2>&1 </dev/null & )
  disown -a 2>/dev/null || true
fi

sleep 3
failed=0
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if ss -ltn 2>/dev/null | grep -q ":${port} "; then
    echo "    ok   port $port listening"
  else
    echo "    FAIL port $port not listening"
    failed=1
  fi
done
[[ $failed -eq 0 ]] || die "update finished but a port isn't listening"
log "Updated"
