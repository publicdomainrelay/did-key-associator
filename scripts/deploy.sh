#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: scripts/deploy.sh [--static-only] [--dry-run]" >&2
  echo "  --static-only  ship dist/ and the Caddyfile, reload caddy; no backend file or unit" >&2
  echo "  --dry-run      build and smoke-test locally, print every upload and remote command, connect to nothing" >&2
  echo "  env: SSH_TARGET (default root@qr.fedfork.com), DEPLOY_TS (default now, UTC)" >&2
}

MODE=full
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --static-only) MODE=static ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SSH_TARGET="${SSH_TARGET:-root@qr.fedfork.com}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes)

DOMAIN=qr.fedfork.com
WWW_DIR=/var/www/qr.fedfork.com
CADDYFILE=/etc/caddy/Caddyfile
BACKEND_DIR=/opt/qr-fedfork
BACKEND_NAME=qr-fedfork-backend
BACKEND_BIN="$BACKEND_DIR/$BACKEND_NAME"
UNIT_NAME=qr-fedfork-backend.service
UNIT_PATH="/etc/systemd/system/$UNIT_NAME"
BACKEND_PORT=5557
ROUTE_PATH=/xrpc/com.fedfork.atprotoOauthQR
HEALTH_URL="http://127.0.0.1:$BACKEND_PORT$ROUTE_PATH"
TS="${DEPLOY_TS:-$(date -u +%Y%m%dT%H%M%SZ)}"
BACKUP_DIR="/root/qr-backup/$TS"
REMOTE_STAGE="/tmp/qr-stage-$TS"

LOCAL_STAGE="$(mktemp -d)"
SMOKE_DIR=""
SMOKE_PID=""
cleanup() {
  if [ -n "$SMOKE_PID" ]; then kill "$SMOKE_PID" 2>/dev/null || true; fi
  rm -rf "$LOCAL_STAGE"
  if [ -n "$SMOKE_DIR" ]; then rm -rf "$SMOKE_DIR"; fi
}
trap cleanup EXIT

smoke_backend() {
  local bin="$1"
  SMOKE_DIR="$(mktemp -d)"
  cp "$bin" "$SMOKE_DIR/$BACKEND_NAME"
  (cd "$SMOKE_DIR" && exec env -i PATH=/usr/bin:/bin HOME="$SMOKE_DIR" \
    "./$BACKEND_NAME" --port 0 --port-file ./port >"$SMOKE_DIR/log" 2>&1) &
  SMOKE_PID=$!
  local port="" i
  for i in $(seq 1 100); do
    if [ -s "$SMOKE_DIR/port" ]; then port="$(cat "$SMOKE_DIR/port")"; break; fi
    sleep 0.1
  done
  if [ -z "$port" ]; then
    echo "local smoke: backend did not write its port file" >&2
    exit 1
  fi
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$ROUTE_PATH" || true)"
  kill "$SMOKE_PID" 2>/dev/null || true
  wait "$SMOKE_PID" 2>/dev/null || true
  SMOKE_PID=""
  if [ "$code" != 401 ]; then
    echo "local smoke: GET $ROUTE_PATH answered $code, want 401" >&2
    exit 1
  fi
  echo "local smoke: backend started from an empty dir on port $port and answered $ROUTE_PATH with 401"
}

cd "$PROJECT_DIR"

deno task build:static
mkdir -p "$LOCAL_STAGE/www"
cp -a dist/. "$LOCAL_STAGE/www/"
cp Caddyfile "$LOCAL_STAGE/Caddyfile"
METADATA_SHA="$(sha256sum "$LOCAL_STAGE/www/oauth-client-metadata.json" | cut -d' ' -f1)"

if [ "$MODE" = full ]; then
  deno task compile:backend
  cp "dist-backend/$BACKEND_NAME" "$LOCAL_STAGE/$BACKEND_NAME"
  smoke_backend "$LOCAL_STAGE/$BACKEND_NAME"
  cat >"$LOCAL_STAGE/$UNIT_NAME" <<UNIT
[Unit]
Description=qr.fedfork.com OAuth QR backend
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$BACKEND_DIR
ExecStart=$BACKEND_BIN
Environment=PORT=$BACKEND_PORT
Environment=PORT_FILE=$BACKEND_DIR/port-bound-to
Environment=KV_PATH=$BACKEND_DIR/kv.db
Restart=always
RestartSec=2
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
fi

{
  echo "#!/usr/bin/env bash"
  echo "set -euo pipefail"
  echo "if [ -d $BACKUP_DIR/www ]; then rm -rf $WWW_DIR && cp -a $BACKUP_DIR/www $WWW_DIR; fi"
  echo "if [ -f $BACKUP_DIR/Caddyfile ]; then cp -a $BACKUP_DIR/Caddyfile $CADDYFILE; fi"
  if [ "$MODE" = full ]; then
    echo "if [ -d $BACKUP_DIR/backend ]; then cp -a $BACKUP_DIR/backend/. $BACKEND_DIR/; fi"
    echo "if [ ! -f $BACKUP_DIR/backend/$BACKEND_NAME ]; then rm -f $BACKEND_BIN; fi"
    echo "if [ -f $BACKUP_DIR/$UNIT_NAME ]; then cp -a $BACKUP_DIR/$UNIT_NAME $UNIT_PATH; else rm -f $UNIT_PATH; fi"
    echo "systemctl daemon-reload"
    echo "if [ -f $UNIT_PATH ]; then systemctl restart $UNIT_NAME; else systemctl stop $UNIT_NAME || true; fi"
  fi
  echo "systemctl reload caddy || systemctl restart caddy"
  echo "echo restored from $BACKUP_DIR"
} >"$LOCAL_STAGE/restore.sh"

REMOTE=()
r() { REMOTE+=("$1"); }

r "set -euo pipefail"
r "mkdir -p $BACKUP_DIR"
r "if [ -d $WWW_DIR ]; then cp -a $WWW_DIR $BACKUP_DIR/www; fi"
r "if [ -f $CADDYFILE ]; then cp -a $CADDYFILE $BACKUP_DIR/Caddyfile; fi"
if [ "$MODE" = full ]; then
  r "mkdir -p $BACKUP_DIR/backend"
  r "if [ -d $BACKEND_DIR ]; then find $BACKEND_DIR -maxdepth 1 -type f ! -name 'kv.db*' -exec cp -a {} $BACKUP_DIR/backend/ \\;; fi"
  r "if [ -f $UNIT_PATH ]; then cp -a $UNIT_PATH $BACKUP_DIR/$UNIT_NAME; fi"
fi
r "install -m 0700 $REMOTE_STAGE/restore.sh $BACKUP_DIR/restore.sh"
r "trap 'rc=\$?; if [ \$rc -ne 0 ]; then echo \"deploy failed (rc=\$rc), restoring from $BACKUP_DIR\" >&2; bash $BACKUP_DIR/restore.sh || true; fi' EXIT"
if [ "$MODE" = full ]; then
  r "if [ -f $UNIT_PATH ]; then diff -u $UNIT_PATH $REMOTE_STAGE/$UNIT_NAME || true; fi"
  r "mkdir -p $BACKEND_DIR"
  r "install -m 0755 $REMOTE_STAGE/$BACKEND_NAME $BACKEND_BIN.new"
  r "mv -f $BACKEND_BIN.new $BACKEND_BIN"
  r "install -m 0644 $REMOTE_STAGE/$UNIT_NAME $UNIT_PATH"
  r "systemctl daemon-reload"
  r "systemctl enable $UNIT_NAME"
  r "systemctl restart $UNIT_NAME"
  r "code=000; for i in \$(seq 1 30); do code=\$(curl -s -o /dev/null -w '%{http_code}' $HEALTH_URL || true); if [ \"\$code\" = 401 ]; then break; fi; sleep 1; done; if [ \"\$code\" != 401 ]; then echo \"backend unhealthy: GET $HEALTH_URL answered \$code, want 401\" >&2; exit 1; fi"
fi
r "caddy validate --config $REMOTE_STAGE/Caddyfile --adapter caddyfile"
r "rm -rf $WWW_DIR.new $WWW_DIR.old"
r "mkdir -p $WWW_DIR.new"
r "cp -a $REMOTE_STAGE/www/. $WWW_DIR.new/"
r "chown -R caddy:caddy $WWW_DIR.new"
r "if [ -d $WWW_DIR ]; then mv $WWW_DIR $WWW_DIR.old; fi"
r "mv $WWW_DIR.new $WWW_DIR"
r "rm -rf $WWW_DIR.old"
r "install -m 0644 $REMOTE_STAGE/Caddyfile $CADDYFILE"
r "systemctl reload caddy"
r "got=\$(curl -fsS --resolve $DOMAIN:443:127.0.0.1 https://$DOMAIN/oauth-client-metadata.json | sha256sum | cut -d' ' -f1 || true); if [ \"\$got\" != $METADATA_SHA ]; then echo \"static check failed: oauth-client-metadata.json sha256 \$got, want $METADATA_SHA\" >&2; exit 1; fi"
r "rm -rf $REMOTE_STAGE"
r "echo deployed mode=$MODE backup=$BACKUP_DIR"

printf '%s\n' "${REMOTE[@]}" >"$LOCAL_STAGE/remote.sh"

echo "target: $SSH_TARGET"
echo "mode: $MODE"
echo "backup: $BACKUP_DIR"
echo "restore: ssh $SSH_TARGET bash $BACKUP_DIR/restore.sh"
(cd "$LOCAL_STAGE" && find . -type f | sed 's|^\./||' | LC_ALL=C sort) | while read -r rel; do
  echo "upload: $rel -> $SSH_TARGET:$REMOTE_STAGE/$rel"
done
if [ "$MODE" = full ]; then
  sed 's/^/unit: /' "$LOCAL_STAGE/$UNIT_NAME"
fi
sed 's/^/restore.sh: /' "$LOCAL_STAGE/restore.sh"
for c in "${REMOTE[@]}"; do
  echo "remote: $c"
done

if [ "$DRY_RUN" = 1 ]; then
  echo "dry-run: nothing uploaded, no remote command run"
  exit 0
fi

tar -C "$LOCAL_STAGE" -cf - . |
  ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "rm -rf $REMOTE_STAGE && mkdir -p $REMOTE_STAGE && tar -C $REMOTE_STAGE -xf -"
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" bash "$REMOTE_STAGE/remote.sh"
echo "deployed: https://$DOMAIN (backup $BACKUP_DIR; restore: ssh $SSH_TARGET bash $BACKUP_DIR/restore.sh)"
