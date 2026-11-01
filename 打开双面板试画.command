#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
run="$PWD/.hermes/studio-preview"
mkdir -p "$run/userData"
if [[ ! -f dist/index.html || ! -f dist-electron/main/flowEditorEntry.js ]]; then npm run build; fi
node scripts/workbench-sample.mjs "$run/project"
exec env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/Electron.app/Contents/MacOS/Electron "$PWD/scripts/studio-preview.cjs" "$run"
