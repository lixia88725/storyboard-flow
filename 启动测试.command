#!/bin/bash
# Storyboard Flow — 双击编译当前源码并启动。不会安装依赖或清理用户数据。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

fail() { printf '\n启动失败：%s\n' "$*" >&2; exit 1; }
on_exit() {
  local result=$?
  if [ "$result" -ne 0 ]; then
    printf '\nStoryboard Flow 未正常启动或退出。\n' >&2
    if [ -n "${LOG_FILE:-}" ]; then printf '完整日志：%s\n' "$LOG_FILE" >&2; fi
    if [ -t 0 ]; then read -r -p '按回车关闭此窗口…' _ || true; fi
  fi
}
trap on_exit EXIT

MODE=launch
if [ "$#" -gt 0 ]; then
  case "$1" in
    --help|-h)
      printf '用法：双击「启动测试.command」，或 bash 启动测试.command [--check]\n'
      printf '默认：完整编译当前源码，然后启动 Storyboard Flow。\n'
      printf '%s\n' '--check：仅检查本地运行依赖，不编译、不启动。'
      printf '可用 FLOW_USER_DATA_DIR 指定独立测试配置目录。\n'
      exit 0 ;;
    --check) MODE=check; shift ;;
    *) fail "不支持参数 $1；使用 --help 查看用法。" ;;
  esac
fi
[ "$#" -eq 0 ] || fail '参数过多。'
command -v node >/dev/null 2>&1 || fail '未找到 Node.js；请先配置 Node.js，再重新启动。'
command -v npm >/dev/null 2>&1 || fail '未找到 npm。'
node -e 'const [m,n]=process.versions.node.split(".").map(Number); process.exit((m===20&&n>=19)||(m===22&&n>=12)||m>22?0:1)' || fail "Node.js $(node -v) 版本不满足依赖要求；请使用 20.19+、22.12+ 或更新的稳定版本。"
[ -f package.json ] || fail '脚本必须放在 Storyboard Flow 项目根目录。'
[ -f node_modules/typescript/bin/tsc ] || fail '缺少本地依赖；请先完成项目依赖安装。'
[ -f node_modules/vite/bin/vite.js ] || fail '缺少本地 Vite 依赖。'
ELECTRON="$REPO/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
[ -x "$ELECTRON" ] || fail '未找到可执行的 macOS Electron；请检查本地依赖。'
printf 'Storyboard Flow\n项目：%s\nNode.js：%s\n' "$REPO" "$(node -v)"
if [ "$MODE" = check ]; then
  printf '本地启动依赖检查通过（未编译、未启动）。\n'
  exit 0
fi

LOG_DIR="$REPO/.hermes/launch"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date '+%Y%m%d-%H%M%S')-$$.log"
printf '日志：%s\n正在编译当前源码…\n' "$LOG_FILE"
npm run build 2>&1 | tee "$LOG_FILE"
printf '\n正在启动；关闭应用后本脚本退出。\n运行日志：%s\n' "$LOG_FILE"
# Direct binary avoids the Node launcher pipe closing while Electron still writes logs.
# Keep the process attached; do not background it or terminate other app instances.
env -u ELECTRON_RUN_AS_NODE "$ELECTRON" "$REPO" >> "$LOG_FILE" 2>&1
printf 'Storyboard Flow 已退出。\n'
