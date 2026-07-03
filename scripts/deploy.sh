#!/usr/bin/env bash
set -xeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
export SSH_TARGET="${SSH_TARGET:-root@qr.fedfork.com}"

cd "$PROJECT_DIR"

# ── Build ────────────────────────────────────────────────────────────────
deno run -A build.ts

# ── Patch oauth metadata for production domain ───────────────────────────
cat > dist/oauth-client-metadata.json <<'JSON'
{
  "client_id": "https://qr.fedfork.com/oauth-client-metadata.json",
  "dpop_bound_access_tokens": true,
  "application_type": "web",
  "redirect_uris": [
    "https://qr.fedfork.com"
  ],
  "grant_types": [
    "authorization_code",
    "refresh_token"
  ],
  "response_types": [
    "code"
  ],
  "scope": "atproto repo:com.publicdomainrelay.temp.badgeBlueKeys",
  "token_endpoint_auth_method": "none",
  "client_name": "DID Key Associator",
  "client_uri": "https://qr.fedfork.com"
}
JSON

# ── Stage on remote ──────────────────────────────────────────────────────
ssh -o StrictHostKeyChecking=accept-new "${SSH_TARGET}" bash -xe <<'EOF'
rm -rf /tmp/stage
mkdir -p /tmp/stage
EOF

scp -o StrictHostKeyChecking=accept-new dist/* "${SSH_TARGET}":/tmp/stage/
scp -o StrictHostKeyChecking=accept-new Caddyfile "${SSH_TARGET}":/tmp/stage/Caddyfile

# ── Remote setup ─────────────────────────────────────────────────────────
ssh -o StrictHostKeyChecking=accept-new "${SSH_TARGET}" bash -xe <<'REMOTE_EOF'

# Install Caddy if absent (official Cloudsmith repo).
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

# Deploy Caddyfile (before wildcard — so it's not swept into /var/www).
mv /tmp/stage/Caddyfile /etc/caddy/Caddyfile

# Deploy static files.
mkdir -p /var/www/qr.fedfork.com
rm -rf /var/www/qr.fedfork.com/*
mv /tmp/stage/* /var/www/qr.fedfork.com/
chown -R caddy:caddy /var/www/qr.fedfork.com

# Caddy systemd unit — run as root for port 80/443 bind.
cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
Documentation=https://caddyserver.com/docs/
After=network.target network-online.target
Requires=network-online.target

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
