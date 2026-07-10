#!/usr/bin/env bash
set -xeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SSH_TARGET="${SSH_TARGET:-root@qr.fedfork.com}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes"

cd "$PROJECT_DIR"

# ── Build frontend ──────────────────────────────────────────────────────────
deno run -A build.ts

# ── Copy oauth metadata for production domain ───────────────────────────────
cp oauth-client-metadata.json dist/oauth-client-metadata.json

# ── Stage on remote ─────────────────────────────────────────────────────────
ssh ${SSH_OPTS} "${SSH_TARGET}" "rm -rf /tmp/stage && mkdir -p /tmp/stage"

scp ${SSH_OPTS} dist/* "${SSH_TARGET}":/tmp/stage/
scp ${SSH_OPTS} Caddyfile "${SSH_TARGET}":/tmp/stage/Caddyfile
scp ${SSH_OPTS} hono-backend/mod.ts "${SSH_TARGET}":/tmp/stage/hono-backend-mod.ts
scp ${SSH_OPTS} deno.json "${SSH_TARGET}":/tmp/stage/deno.json
scp ${SSH_OPTS} deno.lock "${SSH_TARGET}":/tmp/stage/deno.lock

# ── Remote setup ────────────────────────────────────────────────────────────
ssh ${SSH_OPTS} "${SSH_TARGET}" bash -xe <<'REMOTE_EOF'

# ── Deno ────────────────────────────────────────────────────────────────────
if ! command -v deno >/dev/null 2>&1; then
  apt-get update
  apt-get install -y unzip curl
  curl -fsSL https://deno.land/install.sh | sh
  ln -sf /root/.deno/bin/deno /usr/local/bin/deno
fi

# ── Caddy ───────────────────────────────────────────────────────────────────
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

# ── Backend server directories ──────────────────────────────────────────────
mkdir -p /opt/qr-fedfork
cp /tmp/stage/hono-backend-mod.ts /opt/qr-fedfork/mod.ts
cp /tmp/stage/deno.json /opt/qr-fedfork/deno.json
cp /tmp/stage/deno.lock /opt/qr-fedfork/deno.lock

# ── Backend systemd unit ────────────────────────────────────────────────────
cat > /etc/systemd/system/qr-fedfork-backend.service <<'UNIT'
[Unit]
Description=qr.fedfork.com OAuth QR backend
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/qr-fedfork
ExecStart=/usr/local/bin/deno run -A --unstable-kv mod.ts
Environment=PORT=5557
Environment=KV_PATH=/opt/qr-fedfork/kv.db
Restart=always
RestartSec=2
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now qr-fedfork-backend
systemctl restart qr-fedfork-backend
sleep 2
systemctl status --no-pager qr-fedfork-backend || true

# ── Caddy ───────────────────────────────────────────────────────────────────
mv /tmp/stage/Caddyfile /etc/caddy/Caddyfile

# Deploy static files
mkdir -p /var/www/qr.fedfork.com
rm -rf /var/www/qr.fedfork.com/*
mv /tmp/stage/* /var/www/qr.fedfork.com/
chown -R caddy:caddy /var/www/qr.fedfork.com

# Caddy systemd unit — run as root for port 80/443 bind
cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
Documentation=https://caddyserver.com/docs/
After=network.target network-online.target qr-fedfork-backend.service
Requires=network-online.target qr-fedfork-backend.service

[Service]
Type=notify
User=root
Group=root
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
LimitNPROC=512
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy
systemctl status --no-pager caddy.service

echo "Deploy complete → https://qr.fedfork.com"
REMOTE_EOF
