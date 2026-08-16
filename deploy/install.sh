#!/usr/bin/env bash
#
# One-shot installer for Ubuntu 22.04 / 24.04.
#
#   sudo DOMAIN=hrms.example.com ADMIN_EMAIL=you@example.com ./deploy/install.sh
#
# Idempotent: safe to re-run. Re-running upgrades the checkout, rebuilds, and
# restarts, but never re-seeds a database that already has users and never
# regenerates JWT_SECRET_KEY (which would log everyone out).
set -euo pipefail

APP_USER="${APP_USER:-hrms}"
APP_DIR="${APP_DIR:-/opt/hrms}"
ENV_DIR="${ENV_DIR:-/etc/hrms}"
REPO_URL="${REPO_URL:-https://github.com/shafqatameen/OutcomeOriented-HRMS-FOR-STARTUPS.git}"
BRANCH="${BRANCH:-main}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-22}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight --

[[ $EUID -eq 0 ]] || die "run with sudo"
[[ -n "${DOMAIN:-}" ]] || die "set DOMAIN, e.g. DOMAIN=hrms.example.com sudo -E ./deploy/install.sh"
[[ -n "${ADMIN_EMAIL:-}" ]] || die "set ADMIN_EMAIL (Let's Encrypt uses it for expiry notices)"

# Caddy cannot get a certificate if the domain does not already resolve here,
# so check before doing any work rather than failing at the last step.
log "Checking DNS for $DOMAIN"
resolved="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
public_ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo '')"
if [[ -z "$resolved" ]]; then
  warn "$DOMAIN does not resolve yet. Point an A record at this server or TLS issuance will fail."
elif [[ -n "$public_ip" && "$resolved" != "$public_ip" ]]; then
  warn "$DOMAIN resolves to $resolved but this host appears to be $public_ip."
else
  echo "    $DOMAIN -> $resolved"
fi

# --------------------------------------------------------------- packages ----

log "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https rsync

if ! command -v node >/dev/null || [[ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]]; then
  log "Installing Node.js $NODE_MAJOR"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
echo "    node $(node -v), npm $(npm -v)"

if ! command -v uv >/dev/null; then
  log "Installing uv"
  curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR=/usr/local/bin INSTALLER_NO_MODIFY_PATH=1 sh
fi
echo "    $(uv --version)"

if ! command -v caddy >/dev/null; then
  log "Installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
fi
echo "    $(caddy version)"

# ------------------------------------------------------------------- user ----

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "Creating service user $APP_USER"
  useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
fi

# ------------------------------------------------------------------- code ----

if [[ -d "$APP_DIR/.git" ]]; then
  log "Updating checkout at $APP_DIR"
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard --quiet "origin/$BRANCH"
elif [[ -d "$SCRIPT_DIR/../.git" && "$(cd "$SCRIPT_DIR/.." && pwd)" != "$APP_DIR" ]]; then
  log "Copying local checkout to $APP_DIR"
  mkdir -p "$APP_DIR"
  rsync -a --delete \
    --exclude node_modules --exclude .next --exclude .venv --exclude '*.db' \
    "$SCRIPT_DIR/../" "$APP_DIR/"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
else
  log "Cloning $REPO_URL"
  mkdir -p "$APP_DIR"
  chown "$APP_USER:$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ------------------------------------------------------------------- env -----

mkdir -p "$ENV_DIR"

# The secret signs session JWTs. Generated once and never rewritten: replacing
# it invalidates every issued cookie.
if [[ ! -f "$ENV_DIR/backend.env" ]]; then
  log "Writing $ENV_DIR/backend.env"
  cat >"$ENV_DIR/backend.env" <<EOF
JWT_SECRET_KEY=$(openssl rand -base64 48 | tr -d '\n=' | cut -c1-64)
FRONTEND_ORIGIN=https://$DOMAIN
COOKIE_SECURE=true
EOF
else
  log "Keeping existing $ENV_DIR/backend.env"
  # Domain may have changed on a re-run; CORS must follow it.
  sed -i "s|^FRONTEND_ORIGIN=.*|FRONTEND_ORIGIN=https://$DOMAIN|" "$ENV_DIR/backend.env"
  grep -q '^COOKIE_SECURE=' "$ENV_DIR/backend.env" || echo 'COOKIE_SECURE=true' >>"$ENV_DIR/backend.env"
  # The Google callback is an API path, so it follows the domain too. Google
  # matches this string exactly, so a stale domain here fails every connection
  # with redirect_uri_mismatch long after the rest of the app has moved on.
  sed -i "s|^GOOGLE_REDIRECT_URI=.*|GOOGLE_REDIRECT_URI=https://$DOMAIN/api/integrations/google/callback|" "$ENV_DIR/backend.env"
  sed -i "s|^GOOGLE_LOGIN_REDIRECT_URI=.*|GOOGLE_LOGIN_REDIRECT_URI=https://$DOMAIN/api/auth/google/callback|" "$ENV_DIR/backend.env"
fi

# Google Calendar, on the same footing as the mail keys below: the redirect URI
# is derived because it is public and must track the domain, while the client id
# and secret are left blank because this script lives in the repository and a
# real secret written from it would be a committed secret. Blank client id means
# the integration reports itself unconfigured and the rest of the app is
# unaffected.
if ! grep -q '^GOOGLE_CLIENT_ID=' "$ENV_DIR/backend.env"; then
  log "Adding empty Google Calendar settings to $ENV_DIR/backend.env"
  cat >>"$ENV_DIR/backend.env" <<EOF

# OAuth client from console.cloud.google.com, with the Calendar API enabled.
# Register GOOGLE_REDIRECT_URI below as an Authorised redirect URI, verbatim.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://$DOMAIN/api/integrations/google/callback
EOF
fi

# Mail keys are added empty and never given a value here: this script is in the
# repository, so a real password written from it would be a committed password.
# Fill them in on the server, then restart the backend. Blank MAIL_HOST simply
# means mail is off - the app runs fine without it.
if ! grep -q '^MAIL_HOST=' "$ENV_DIR/backend.env"; then
  log "Adding empty mail settings to $ENV_DIR/backend.env - fill these in to enable mail"
  cat >>"$ENV_DIR/backend.env" <<'EOF'

# Outbound SMTP. 587 is STARTTLS, 465 is implicit TLS.
MAIL_HOST=
MAIL_PORT=587
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_FROM=
MAIL_FROM_NAME=OutcomeOriented
MAIL_TIMEOUT=15
EOF
fi

# The sign-in callback is a second, separate Authorised redirect URI on the same
# OAuth client as the calendar one. Both must be registered; Google matches the
# redirect against the flow the code was issued for, so one cannot cover both.
if ! grep -q '^GOOGLE_LOGIN_REDIRECT_URI=' "$ENV_DIR/backend.env"; then
  log "Adding Google sign-in redirect to $ENV_DIR/backend.env"
  cat >>"$ENV_DIR/backend.env" <<EOF
GOOGLE_LOGIN_REDIRECT_URI=https://$DOMAIN/api/auth/google/callback
EOF
fi

# Self-service sign-up. On by default, and narrower than it sounds: a
# self-registered account confirms its address, sets a password, then sits
# inactive with no permissions until an administrator approves it.
if ! grep -q '^PUBLIC_SIGNUP_ENABLED=' "$ENV_DIR/backend.env"; then
  log "Adding PUBLIC_SIGNUP_ENABLED to $ENV_DIR/backend.env"
  echo 'PUBLIC_SIGNUP_ENABLED=true' >>"$ENV_DIR/backend.env"
fi

chown root:"$APP_USER" "$ENV_DIR/backend.env"
chmod 640 "$ENV_DIR/backend.env"

# NEXT_PUBLIC_* is inlined at build time, so this must exist before npm run build.
log "Writing frontend build env"
cat >"$APP_DIR/frontend/.env.production" <<EOF
# Browser-visible: same origin, Caddy strips /api before proxying to FastAPI.
NEXT_PUBLIC_API_URL=https://$DOMAIN/api
# Server Components talk to the backend directly, bypassing the proxy.
INTERNAL_API_URL=http://127.0.0.1:$BACKEND_PORT
EOF
chown "$APP_USER:$APP_USER" "$APP_DIR/frontend/.env.production"

# ---------------------------------------------------------------- backend ----

log "Installing backend dependencies"
sudo -u "$APP_USER" env HOME="/home/$APP_USER" uv sync --frozen --project "$APP_DIR/backend"

# --------------------------------------------------------------- frontend ----

log "Installing frontend dependencies (this takes a few minutes)"
sudo -u "$APP_USER" env HOME="/home/$APP_USER" npm --prefix "$APP_DIR/frontend" ci --no-audit --no-fund

log "Building frontend"
sudo -u "$APP_USER" env HOME="/home/$APP_USER" NODE_ENV=production npm --prefix "$APP_DIR/frontend" run build

# ---------------------------------------------------------------- systemd ----

log "Installing systemd units"
for unit in hrms-backend hrms-frontend; do
  sed -e "s|@APP_USER@|$APP_USER|g" \
      -e "s|@APP_DIR@|$APP_DIR|g" \
      -e "s|@ENV_DIR@|$ENV_DIR|g" \
      -e "s|@BACKEND_PORT@|$BACKEND_PORT|g" \
      -e "s|@FRONTEND_PORT@|$FRONTEND_PORT|g" \
      "$APP_DIR/deploy/$unit.service" >"/etc/systemd/system/$unit.service"
done
systemctl daemon-reload

# ------------------------------------------------------------------ caddy ----

log "Configuring Caddy for $DOMAIN"
sed -e "s|@DOMAIN@|$DOMAIN|g" \
    -e "s|@ADMIN_EMAIL@|$ADMIN_EMAIL|g" \
    -e "s|@BACKEND_PORT@|$BACKEND_PORT|g" \
    -e "s|@FRONTEND_PORT@|$FRONTEND_PORT|g" \
    "$APP_DIR/deploy/Caddyfile" >/etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile >/dev/null || die "generated Caddyfile is invalid"

# ---------------------------------------------------------------- firewall ---

if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  log "Opening HTTP/HTTPS in ufw"
  ufw allow 80/tcp  >/dev/null
  ufw allow 443/tcp >/dev/null
fi

# ------------------------------------------------------------------- start ---

log "Starting services"
systemctl enable --now hrms-backend
systemctl restart hrms-backend

# The backend creates/migrates the SQLite database on startup; wait for it to be
# answering before seeding, otherwise seed.py races the migration.
#
# Probed on /openapi.json because it is the only endpoint that is both public and
# always present. The account list used to serve this purpose, but it was public
# - it let anyone enumerate who had an account - and has been removed.
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$BACKEND_PORT/openapi.json" >/dev/null 2>&1 && break
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:$BACKEND_PORT/openapi.json" >/dev/null 2>&1; then
  warn "backend is not responding; check: journalctl -u hrms-backend -n 50"
else
  # Run unconditionally: seed.py only creates accounts when there are none, only
  # ever fills gaps on an existing database, and says which it did. That is a
  # better place for the decision than a check out here, which had to guess.
  log "Seeding initial accounts (skipped automatically if they already exist)"
  echo "    Save any passwords printed below — they are not stored in plaintext anywhere."
  sudo -u "$APP_USER" env HOME="/home/$APP_USER" \
    SEED_PASSWORD_ABDU="${SEED_PASSWORD_ABDU:-}" \
    SEED_PASSWORD_ANNU="${SEED_PASSWORD_ANNU:-}" \
    SEED_PASSWORD_SAM="${SEED_PASSWORD_SAM:-}" \
    SEED_EMAIL_ABDU="${SEED_EMAIL_ABDU:-}" \
    SEED_EMAIL_ANNU="${SEED_EMAIL_ANNU:-}" \
    SEED_EMAIL_SAM="${SEED_EMAIL_SAM:-}" \
    bash -c "cd '$APP_DIR/backend' && .venv/bin/python seed.py"
fi

systemctl enable --now hrms-frontend
systemctl restart hrms-frontend
systemctl reload caddy || systemctl restart caddy

# ------------------------------------------------------------------ verify ---

log "Verifying"
sleep 3
failed=0
for unit in hrms-backend hrms-frontend caddy; do
  if systemctl is-active --quiet "$unit"; then
    echo "    ok   $unit"
  else
    echo "    FAIL $unit  -> journalctl -u $unit -n 50"
    failed=1
  fi
done

if curl -fsS -o /dev/null "http://127.0.0.1:$FRONTEND_PORT/login"; then
  echo "    ok   frontend responds on :$FRONTEND_PORT"
else
  echo "    FAIL frontend not responding on :$FRONTEND_PORT"; failed=1
fi

printf '\n'
if [[ $failed -eq 0 ]]; then
  log "Done — https://$DOMAIN"
  echo "    Certificate issuance takes a few seconds on first request."
else
  die "one or more checks failed (see above)"
fi
