#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REMOTE=${GIT_REMOTE:-origin}
BRANCH=${GIT_BRANCH:-}
APP_DIR=${APP_DIR:-/opt/rabbit-home}
NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmjs.org/}

command -v git >/dev/null 2>&1 || {
  echo "未找到 git，请先安装：sudo apt-get install -y git" >&2
  exit 1
}

cd "$SOURCE_DIR"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "$SOURCE_DIR 不是 Git 仓库。请从 GitHub clone 后再执行。" >&2
  exit 1
}

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Git 工作区存在未提交修改，已停止更新：" >&2
  git status --short >&2
  echo "请先提交、暂存或还原这些修改。" >&2
  exit 1
fi

if [[ -z "$BRANCH" ]]; then
  BRANCH=$(git branch --show-current)
fi

if [[ -z "$BRANCH" ]]; then
  echo "当前处于 detached HEAD。请设置 GIT_BRANCH，或手工执行 deploy/update.sh。" >&2
  exit 1
fi

printf '准备从 %s/%s 更新源码\n' "$REMOTE" "$BRANCH"
git fetch --prune "$REMOTE"
git pull --ff-only "$REMOTE" "$BRANCH"

sudo env \
  APP_DIR="$APP_DIR" \
  NPM_REGISTRY="$NPM_REGISTRY" \
  bash "$SOURCE_DIR/deploy/update.sh"
