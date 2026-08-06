#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "请使用 sudo 运行" >&2; exit 1; }
APP_DIR=${APP_DIR:-/opt/rabbit-home}
systemctl disable --now rabbit-home.service rabbit-home-backup.timer 2>/dev/null || true
rm -f /etc/systemd/system/rabbit-home.service /etc/systemd/system/rabbit-home-backup.service /etc/systemd/system/rabbit-home-backup.timer
rm -f /etc/nginx/sites-enabled/rabbit-home /etc/nginx/sites-available/rabbit-home
systemctl daemon-reload
systemctl restart nginx 2>/dev/null || true
echo "服务与 Nginx 配置已移除。数据仍保留在 $APP_DIR；确认备份后可手动删除。"
