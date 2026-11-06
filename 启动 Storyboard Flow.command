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
CHOOSE=0
if [ "$#" -gt 0 ]; then
  case "$1" in
    --help|-h)
      printf '用法：双击「启动 Storyboard Flow.command」，或 bash "启动 Storyboard Flow.command" [--check|--choose]\n'
      printf '默认：正常关闭对应实例、完整编译，继续已有试画项目；没有试画项目则选择项目。\n'
      printf '%s\n' '--check：仅检查本地运行依赖，不编译、不启动。'
      printf '%s\n' '--choose：打开项目选择器，不自动进入试画项目。'
      printf '可用 FLOW_USER_DATA_DIR 指定独立测试配置目录。\n'
      exit 0 ;;
    --check) MODE=check; shift ;;
    --choose) CHOOSE=1; shift ;;
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

# Existing trial data stays where it is; never create or reseed a project here.
TRIAL="$REPO/.hermes/studio-preview"
TARGET=choose
PROFILE="${FLOW_USER_DATA_DIR:-$HOME/Library/Application Support/Storyboard Flow Workbench}"
if [ "$CHOOSE" -eq 0 ] && [ -z "${FLOW_USER_DATA_DIR:-}" ] && [ -f "$TRIAL/project/.storyboard-flow/checkpoints/project.json" ]; then
  TARGET=trial
  PROFILE="$TRIAL/userData"
fi
[[ "$PROFILE" == /* ]] || fail 'FLOW_USER_DATA_DIR 必须是绝对路径。'
LOG_DIR="$REPO/.hermes/launch"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date '+%Y%m%d-%H%M%S')-$$.log"
# Log before any lock inspection, including all failure diagnostics.
touch "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1
GUARD="$LOG_DIR/start-in-progress"
LOCK_HELPER="$REPO/scripts/launch-locks.mjs"
node "$LOCK_HELPER" acquire "$GUARD" "$$" "$LOG_DIR" || fail '启动流程未取得互斥锁。'
# Keep failure status while releasing only this invocation's guard.
finish() { local result=$?; node "$LOCK_HELPER" release "$GUARD" "$$" || true; trap - EXIT; if [ "$result" -ne 0 ]; then printf '\n启动未完成，日志：%s\n' "$LOG_FILE" >&2; fi; exit "$result"; }
trap finish EXIT

node "$LOCK_HELPER" profile "$PROFILE" "$LOG_DIR" || fail '实例锁无法安全恢复；详细原因见上方及日志。'
LOCK="$PROFILE/SingletonLock"
PID=''
if [[ -L "$LOCK" ]]; then
  OWNER=$(readlink "$LOCK"); PID=${OWNER##*-}
  [[ "$PID" =~ ^[1-9][0-9]*$ && "${OWNER%-*}" == "$(hostname)" ]] || fail '无法确认实例锁归属，未清理锁。'
  COMMAND=$(/bin/ps -ww -p "$PID" -o command=) || fail '实例锁对应进程无法确认，未清理锁。'
  if [ "$TARGET" = trial ]; then
    EXPECTED="$REPO/scripts/studio-preview.cjs $TRIAL"
  else
    EXPECTED="$REPO"
  fi
  [[ "$COMMAND" == "$ELECTRON $EXPECTED" || "$COMMAND" == "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron $EXPECTED" ]] || fail '此配置正被其他启动方式占用；未终止该进程。'
elif [[ -e "$LOCK" ]]; then
  fail '实例锁类型异常，未修改。'
fi
if [ -n "$PID" ]; then
  printf '正在请求对应实例正常保存并关闭（PID %s）…\n' "$PID"
  /usr/bin/osascript -l JavaScript - "$PID" "$ELECTRON" <<'JXA'
ObjC.import('AppKit')
function run(args) {
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(args[0]))
  if (!app || !app.executableURL) throw Error('原实例已不可确认')
  const actual = ObjC.unwrap(app.executableURL.URLByResolvingSymlinksInPath.path)
  const expected = ObjC.unwrap($.NSURL.fileURLWithPath(args[1]).URLByResolvingSymlinksInPath.path)
  if (actual !== expected || !app.terminate) throw Error('无法请求该实例正常退出')
}
JXA
  for ((i=0; i<120; i++)); do
    if ! kill -0 "$PID" 2>/dev/null && [[ ! -L "$LOCK" ]]; then break; fi
    sleep 0.5
  done
  node "$LOCK_HELPER" profile "$PROFILE" "$LOG_DIR" || fail '关闭后的实例锁无法安全恢复。'
  if kill -0 "$PID" 2>/dev/null || [[ -L "$LOCK" ]]; then fail '应用尚未正常关闭，已取消启动；请先完成画笔或台词输入。'; fi
fi
printf '日志：%s\n正在编译当前源码…\n' "$LOG_FILE"
npm run build
[[ ! -L "$LOCK" && ! -e "$LOCK" ]] || fail '构建期间已有实例占用此配置，已停止。'
printf '\n正在启动；关闭应用后本脚本退出。\n'
# Keep the guard until this exact child acquires Electron's profile lock.
if [ "$TARGET" = trial ]; then
  env -u ELECTRON_RUN_AS_NODE "$ELECTRON" "$REPO/scripts/studio-preview.cjs" "$TRIAL" >> "$LOG_FILE" 2>&1 &
else
  env -u ELECTRON_RUN_AS_NODE "$ELECTRON" "$REPO" >> "$LOG_FILE" 2>&1 &
fi
CHILD=$!
# The child owns the guard while acquiring its profile lock, even if Terminal exits.
node "$LOCK_HELPER" transfer "$GUARD" "$$" "$CHILD"
READY=0
for ((i=0; i<300; i++)); do
  if ! kill -0 "$CHILD" 2>/dev/null; then
    node "$LOCK_HELPER" release "$GUARD" "$CHILD"
    wait "$CHILD"
    printf 'Storyboard Flow 已退出。\n'
    exit 0
  fi
  if [[ -L "$LOCK" ]] && [ "$(readlink "$LOCK")" = "$(hostname)-$CHILD" ]; then
    READY=1
    break
  fi
  sleep 0.1
done
[ "$READY" -eq 1 ] || fail "新实例尚未取得可确认的配置锁；进程 $CHILD 尚在启动，未强制退出；请查看日志。"
node "$LOCK_HELPER" release "$GUARD" "$CHILD"
trap on_exit EXIT
wait "$CHILD"
printf 'Storyboard Flow 已退出。\n'
