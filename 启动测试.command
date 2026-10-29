#!/bin/bash
# Storyboard Flow — 双击即启动（测试用）。
#
# 双击这个文件：增量编译主进程 + 直接起应用。
# 需要完整的 typecheck + 渲染层 build 时，在终端里跑：
#
#   bash 启动测试.command --full
#   bash 启动测试.command --dev          # vite 热更新
#   bash 启动测试.command --reset-cache  # 先删指纹缓存（验证冷启动）
#   bash 启动测试.command --userdata     # 只打印 userData 路径
#
# 额外参数会原样传给 electron。
set -euo pipefail

# 本文件就在仓库根目录，所以根目录 = 本文件所在目录
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"
export PATH="/opt/homebrew/bin:$PATH"   # 默认 /usr/local/bin/node 是 v16，vite/electron 都要更新的

FULL=0
DEV=0
RESET_CACHE=0
JUST_PRINT=0
PASSTHROUGH=()
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    --dev) DEV=1 ;;
    --reset-cache) RESET_CACHE=1 ;;
    --userdata) JUST_PRINT=1 ;;
    *) PASSTHROUGH+=("$arg") ;;
  esac
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "node $(node -v) at $(command -v node) is too old; need >=18 (v25.9 is what this repo is tested with)" >&2
  exit 1
fi

# The app calls app.setName("Storyboard Flow"), so userData follows that name in dev too.
USER_DATA="$HOME/Library/Application Support/Storyboard Flow"
CACHE="$USER_DATA/pixel-fingerprint-cache.json"

if [ "$JUST_PRINT" -eq 1 ]; then
  echo "repo:     $REPO"
  echo "userData: $USER_DATA"
  echo "cache:    $CACHE ($([ -f "$CACHE" ] && echo "present, $(du -h "$CACHE" | cut -f1)" || echo "absent"))"
  exit 0
fi

if [ "$RESET_CACHE" -eq 1 ] && [ -f "$CACHE" ]; then
  rm -f "$CACHE"
  echo "removed $CACHE"
fi

if [ "$DEV" -eq 1 ]; then
  echo "== dev server + electron (hot reload) =="
  npm run build:electron
  exec npx concurrently -k \
    "npx vite" \
    "npx wait-on http://localhost:5173 && VITE_DEV_SERVER_URL=http://localhost:5173 ./node_modules/.bin/electron . ${PASSTHROUGH[*]:-}"
fi

if [ "$FULL" -eq 1 ]; then
  echo "== full: typecheck + renderer build + main compile =="
  node ./node_modules/typescript/bin/tsc --noEmit
  node ./node_modules/vite/bin/vite.js build
  node ./node_modules/typescript/bin/tsc -p tsconfig.electron.json
elif [ ! -f dist/index.html ] || [ ! -f dist-electron/main/main.js ]; then
  echo "== no build output yet: doing a full build =="
  node ./node_modules/vite/bin/vite.js build
  node ./node_modules/typescript/bin/tsc -p tsconfig.electron.json
else
  echo "== incremental: main process compile only (renderer changes need --full) =="
  node ./node_modules/typescript/bin/tsc -p tsconfig.electron.json
fi

echo "== launching (userData: $USER_DATA) =="
exec ./node_modules/.bin/electron . "${PASSTHROUGH[@]:-}"
