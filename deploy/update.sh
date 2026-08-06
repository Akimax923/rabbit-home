#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID:-$(id -u)} -eq 0 ]] || {
  echo "请使用 sudo 运行" >&2
  exit 1
}

APP_DIR=${APP_DIR:-/opt/rabbit-home}
APP_USER=${APP_USER:-rabbit-home}
NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmjs.org/}
SOURCE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ROLLBACK_DIR=$(mktemp -d /tmp/rabbit-home-rollback.XXXXXX)
SERVICE_WAS_ACTIVE=0
UPDATE_SUCCEEDED=0

cleanup() {
  local exit_code=$?
  if [[ "$UPDATE_SUCCEEDED" -eq 0 ]]; then
    echo "更新失败，正在恢复更新前的应用文件……" >&2
    if [[ -d "$ROLLBACK_DIR/app" ]]; then
      rsync -a --delete \
        --exclude .env --exclude 'data/*' --exclude 'backups/*' \
        "$ROLLBACK_DIR/app/" "$APP_DIR/" || true
      chown -R "$APP_USER:$APP_USER" "$APP_DIR" || true
    fi
    if [[ "$SERVICE_WAS_ACTIVE" -eq 1 ]]; then
      systemctl restart rabbit-home || true
    fi
  fi
  rm -rf "$ROLLBACK_DIR"
  exit "$exit_code"
}
trap cleanup EXIT

[[ -f "$SOURCE_DIR/package.json" ]] || {
  echo "源码目录缺少 package.json：$SOURCE_DIR" >&2
  exit 1
}
[[ -d "$APP_DIR" ]] || {
  echo "运行目录不存在：$APP_DIR。请先执行 deploy/install.sh。" >&2
  exit 1
}
id "$APP_USER" >/dev/null 2>&1 || {
  echo "系统用户不存在：$APP_USER" >&2
  exit 1
}

if systemctl is-active --quiet rabbit-home; then
  SERVICE_WAS_ACTIVE=1
fi

# 先备份数据库；备份失败时不继续覆盖应用。
if [[ -f "$APP_DIR/src/server/backup.js" ]]; then
  sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm run backup"
fi

# 保存可执行应用副本，用于安装、测试或构建失败时恢复。
mkdir -p "$ROLLBACK_DIR/app"
rsync -a \
  --exclude .env --exclude 'data/*' --exclude 'backups/*' \
  "$APP_DIR/" "$ROLLBACK_DIR/app/"

systemctl stop rabbit-home

rsync -a --delete \
  --exclude .git --exclude .github \
  --exclude node_modules --exclude .env \
  --exclude 'data/*' --exclude 'backups/*' \
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

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
systemctl start rabbit-home
curl --retry 10 --retry-delay 1 --retry-connrefused \
  -fsS http://127.0.0.1:3100/api/health

echo
UPDATE_SUCCEEDED=1
echo "更新完成"
