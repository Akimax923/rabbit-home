#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN=""
EMAIL=""
HTTP_ONLY=0
INSTALL_NODE=0
ALLOW_REGISTRATION=true
REGISTRATION_CODE=""
NPM_REGISTRY="https://registry.npmjs.org/"
APP_DIR=/opt/rabbit-home
APP_USER=rabbit-home
SOURCE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)


verify_runtime() {
  local base_url=${1:-http://127.0.0.1:3100}
  local expected_version
  local health
  local client_file
  local handshake

  expected_version=$(node -p "require('$APP_DIR/package.json').version")
  health=$(curl --retry 10 --retry-delay 1 --retry-connrefused -fsS "$base_url/api/health")
  grep -Fq "\"version\":\"$expected_version\"" <<<"$health" || {
    echo "运行版本不一致，期望 $expected_version，health 返回：$health" >&2
    return 1
  }

  client_file=$(mktemp)
  curl -fsS "$base_url/vendor/socket.io.min.js?v=$expected_version" -o "$client_file"
  if [[ $(wc -c < "$client_file") -lt 10000 ]] || head -c 1 "$client_file" | grep -Eq '[<{]'; then
    echo "Socket.IO 客户端文件无效：$base_url/vendor/socket.io.min.js" >&2
    rm -f "$client_file"
    return 1
  fi
  rm -f "$client_file"

  handshake=$(curl -fsS "$base_url/socket.io/?EIO=4&transport=polling&t=deploy-check")
  [[ "$handshake" == 0* ]] || {
    echo "Socket.IO 握手失败：$handshake" >&2
    return 1
  }
}

usage() {
  cat <<USAGE
用法：sudo bash deploy/install.sh [选项]
  --domain rabbit.example.com   配置域名并申请 Let's Encrypt 证书
  --email you@example.com       Let's Encrypt 通知邮箱
  --http-only                   仅配置 HTTP（测试用途）
  --install-node                自动安装官方 Node.js 24
  --registration-code CODE      注册时要求输入邀请码
  --close-registration          关闭新账号注册
  --app-dir PATH                安装目录，默认 /opt/rabbit-home
  --npm-registry URL            npm 源，国内网络可用 https://registry.npmmirror.com
USAGE
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN=${2:?}; shift 2 ;;
    --email) EMAIL=${2:?}; shift 2 ;;
    --http-only) HTTP_ONLY=1; shift ;;
    --install-node) INSTALL_NODE=1; shift ;;
    --registration-code) REGISTRATION_CODE=${2:?}; shift 2 ;;
    --close-registration) ALLOW_REGISTRATION=false; shift ;;
    --app-dir) APP_DIR=${2:?}; shift 2 ;;
    --npm-registry) NPM_REGISTRY=${2:?}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage; exit 1 ;;
  esac
done
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "请使用 sudo 运行" >&2; exit 1; }
if [[ -n "$DOMAIN" && "$HTTP_ONLY" -eq 0 && -z "$EMAIL" ]]; then echo "配置 HTTPS 时必须提供 --email" >&2; exit 1; fi

apt-get update
apt-get install -y git nginx rsync curl ca-certificates openssl
if [[ -n "$DOMAIN" && "$HTTP_ONLY" -eq 0 ]]; then apt-get install -y certbot python3-certbot-nginx; fi

NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0); fi
if [[ "$NODE_MAJOR" -lt 24 ]]; then
  if [[ "$INSTALL_NODE" -eq 1 ]]; then bash "$SOURCE_DIR/deploy/bootstrap-node24.sh"; else echo "需要 Node.js 24.15+。请先运行：sudo bash deploy/bootstrap-node24.sh" >&2; exit 1; fi
fi
NODE_BIN=$(command -v node)

if ! id "$APP_USER" >/dev/null 2>&1; then useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"; fi
mkdir -p "$APP_DIR" "$APP_DIR/data" "$APP_DIR/backups"
rsync -a --delete \
  --exclude .git --exclude .github --exclude node_modules --exclude .env --exclude 'data/*' --exclude 'backups/*' \
  "$SOURCE_DIR/" "$APP_DIR/"
cd "$APP_DIR"
if [[ -f package-lock.json ]]; then
  npm ci --registry="$NPM_REGISTRY" --omit=dev --no-audit --no-fund
else
  echo "提示：未找到 package-lock.json，使用 npm install。建议生成并提交 lockfile。"
  npm install --registry="$NPM_REGISTRY" --omit=dev --no-audit --no-fund
fi
npm run check
npm test
npm run build
npm prune --registry="$NPM_REGISTRY" --omit=dev --no-audit --no-fund

if [[ ! -f "$APP_DIR/.env" ]]; then
  SECRET=$(openssl rand -hex 32)
  if [[ -n "$DOMAIN" && "$HTTP_ONLY" -eq 0 ]]; then ORIGIN="https://$DOMAIN"; SECURE=true; else ORIGIN=""; SECURE=false; fi
  cat > "$APP_DIR/.env" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=3100
PUBLIC_ORIGIN=$ORIGIN
SESSION_SECRET=$SECRET
COOKIE_SECURE=$SECURE
DATABASE_PATH=$APP_DIR/data/rabbit-home.db
HOME_MAX_PLAYERS=8
ALLOW_REGISTRATION=$ALLOW_REGISTRATION
REGISTRATION_CODE=$REGISTRATION_CODE
BACKUP_DIR=$APP_DIR/backups
BACKUP_RETENTION_DAYS=14
ENV
  chmod 600 "$APP_DIR/.env"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR/data" "$APP_DIR/backups"

cat > /etc/systemd/system/rabbit-home.service <<UNIT
[Unit]
Description=Rabbit Home multiplayer pixel game
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$NODE_BIN $APP_DIR/src/server/index.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/data $APP_DIR/backups
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/rabbit-home-backup.service <<UNIT
[Unit]
Description=Backup Rabbit Home SQLite database
After=rabbit-home.service

[Service]
Type=oneshot
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$NODE_BIN $APP_DIR/src/server/backup.js
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/data $APP_DIR/backups
UNIT
cat > /etc/systemd/system/rabbit-home-backup.timer <<'UNIT'
[Unit]
Description=Daily Rabbit Home database backup

[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
UNIT

SERVER_NAME=${DOMAIN:-_}
cat > /etc/nginx/sites-available/rabbit-home <<NGINX
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}
server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAME;
    client_max_body_size 64k;
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }
}
NGINX
ln -sfn /etc/nginx/sites-available/rabbit-home /etc/nginx/sites-enabled/rabbit-home
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl daemon-reload
systemctl enable --now rabbit-home.service rabbit-home-backup.timer
systemctl restart nginx
sleep 1
verify_runtime http://127.0.0.1:3100
verify_runtime http://127.0.0.1

if [[ -n "$DOMAIN" && "$HTTP_ONLY" -eq 0 ]]; then
  certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$DOMAIN"
fi
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then ufw allow 'Nginx Full' >/dev/null; fi

echo
echo "安装完成。"
if [[ -n "${ORIGIN:-}" ]]; then echo "访问地址：$ORIGIN"; else echo "访问地址：http://服务器公网IP（应用自动校验同源，不需要手工填写 PUBLIC_ORIGIN）"; fi
echo "服务状态：systemctl status rabbit-home"
echo "实时日志：journalctl -u rabbit-home -f"
