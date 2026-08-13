#!/usr/bin/env bash
#
# Restarts the frontend through aaPanel's own Node.js Project supervisor
# (nodejs-service.py) rather than a raw detached process, so its dashboard
# (status, PID, PM2 Monitor) reflects the real process instead of a stale
# "Stopped" for one it never launched.
#
# Must run as root: aaPanel's project state file
# (/www/server/panel/data/node_state.json) is root-owned mode 600, so
# nodejs-service.py can start the process fine when run as another user but
# silently fails to record it — which is why this is a separate script from
# update-aapanel-manual.sh, which runs as www for git/npm ownership reasons.
#
set -euo pipefail

FRONTEND_PORT="${FRONTEND_PORT:-3010}"
FRONTEND_AAPANEL_NAME="${FRONTEND_AAPANEL_NAME:-BH_Tasks_Frontend}"
AAPANEL_PYTHON="/www/server/panel/pyenv/bin/python"
NODEJS_SERVICE="/www/server/panel/script/nodejs-service.py"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root"
[[ -x "$AAPANEL_PYTHON" && -f "$NODEJS_SERVICE" ]] || die "aaPanel nodejs-service.py not found"

log "Restarting frontend (port $FRONTEND_PORT) via aaPanel"

# Frees the port in case a prior deploy left a process aaPanel doesn't know
# about — its own restart would otherwise fail with EADDRINUSE, same as
# clicking Restart in the UI while that's running.
pid="$(ss -ltnp 2>/dev/null | awk -v p=":${FRONTEND_PORT}\$" '$4 ~ p {print $NF}' | grep -oP 'pid=\K[0-9]+' | head -n1 || true)"
[[ -z "${pid:-}" ]] && pid="$(fuser -n tcp "$FRONTEND_PORT" 2>/dev/null | tr -d ' ' || true)"
if [[ -n "${pid:-}" ]]; then
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -9 "$pid" 2>/dev/null || true
fi

"$AAPANEL_PYTHON" "$NODEJS_SERVICE" "$FRONTEND_AAPANEL_NAME" restart

sleep 3
if ss -ltn 2>/dev/null | grep -q ":${FRONTEND_PORT} "; then
  echo "    ok   port $FRONTEND_PORT listening"
else
  die "aaPanel restart finished but port $FRONTEND_PORT isn't listening"
fi
log "Frontend updated"
