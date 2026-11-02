#!/bin/bash
# 双击：正常退出同一份试画项目，重新构建，再用原来的项目和配置启动。
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
run="$PWD/.hermes/studio-preview"
binary="node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
args="$PWD/scripts/studio-preview.cjs $run"
fail() { echo "$*" >&2; exit 1; }
case "${1:-}" in ''|--check) ;; *) fail '用法：重启双面板试画.command [--check]' ;; esac
[[ $# -le 1 ]] || fail '参数过多'
bash 启动测试.command --check
link="$run/userData/SingletonLock"
pid=''
if [[ -L "$link" ]]; then
  owner=$(readlink "$link")
  pid=${owner##*-}
  [[ "$pid" =~ ^[1-9][0-9]*$ && "${owner%-*}" == "$(hostname)" ]] || fail '无法确认试画实例的锁归属，已停止。'
  line=$(/bin/ps -ww -p "$pid" -o command=) || fail '无法确认该锁对应的进程，已停止；未清理锁。'
  [[ "$line" == "$binary $args" || "$line" == "$PWD/$binary $args" ]] || fail '进程与当前工作区的试画启动命令不一致，已停止。'
elif [[ -e "$link" ]]; then
  fail '试画实例锁类型异常，已停止。'
fi
if [[ -n "$pid" ]]; then echo "找到当前工作区的双面板试画实例：PID $pid"; else echo '当前试画配置没有活动实例锁。'; fi
[[ "${1:-}" != --check ]] || exit 0

mkdir -p "$run"
guard="$run/restart-in-progress"
mkdir "$guard" 2>/dev/null || fail "重启已在进行，或上次重启中断。请检查 $guard"
trap 'rmdir "$guard"' EXIT
if [[ -n "$pid" ]]; then
  echo '正在请求正常退出。如有保存提示，请在试画窗口中处理。'
  /usr/bin/osascript -l JavaScript - "$pid" "$PWD/$binary" <<'JXA'
ObjC.import('AppKit')
function run(args) {
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(args[0]))
  if (!app || !app.executableURL) throw Error('找不到原试画实例')
  const path = ObjC.unwrap(app.executableURL.URLByResolvingSymlinksInPath.path)
  const expected = ObjC.unwrap($.NSURL.fileURLWithPath(args[1]).URLByResolvingSymlinksInPath.path)
  if (path !== expected || !app.terminate) throw Error('无法请求此试画实例正常退出')
}
JXA
  for ((i=0; i<120; i++)); do
    if ! kill -0 "$pid" 2>/dev/null && [[ ! -L "$link" ]]; then break; fi
    sleep 0.5
  done
  if kill -0 "$pid" 2>/dev/null || [[ -L "$link" ]]; then fail '应用仍未正常退出，已取消重启。'; fi
fi
echo '正在构建当前工作区的最新源码…'
npm run build
[[ ! -L "$link" ]] || fail '构建期间已有试画实例打开，请稍后重试。'
rmdir "$guard"
trap - EXIT
exec /bin/bash 打开双面板试画.command
