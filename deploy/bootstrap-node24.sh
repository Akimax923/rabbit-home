#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "请使用 sudo 运行本脚本" >&2; exit 1; fi
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "不支持的 CPU 架构：$(uname -m)" >&2; exit 1 ;;
esac
apt-get update
apt-get install -y ca-certificates curl xz-utils
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
cd "$TMP_DIR"
curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt
FILE=$(awk -v arch="$ARCH" '$2 ~ ("linux-" arch "\\.tar\\.xz$") {print $2; exit}' SHASUMS256.txt)
[[ -n "$FILE" ]] || { echo "无法解析 Node.js 24 下载文件" >&2; exit 1; }
curl -fsSLO "https://nodejs.org/dist/latest-v24.x/$FILE"
grep "  $FILE$" SHASUMS256.txt | sha256sum -c -
VERSION_DIR=${FILE%.tar.xz}
mkdir -p /usr/local/lib/nodejs
tar -xJf "$FILE" -C /usr/local/lib/nodejs
ln -sfn "/usr/local/lib/nodejs/$VERSION_DIR/bin/node" /usr/local/bin/node
ln -sfn "/usr/local/lib/nodejs/$VERSION_DIR/bin/npm" /usr/local/bin/npm
ln -sfn "/usr/local/lib/nodejs/$VERSION_DIR/bin/npx" /usr/local/bin/npx
ln -sfn "/usr/local/lib/nodejs/$VERSION_DIR/bin/corepack" /usr/local/bin/corepack
node --version
npm --version
