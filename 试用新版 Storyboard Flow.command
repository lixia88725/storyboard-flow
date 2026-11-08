#!/bin/bash
# New image-engine trial. Keep its recent projects and layout separate from the normal app.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export FLOW_NATIVE_WORKSPACE=1
export FLOW_USER_DATA_DIR="${FLOW_USER_DATA_DIR:-$REPO/.hermes/native-trial/userData}"
if [ "$#" -eq 0 ]; then set -- --choose; fi
exec bash "$REPO/启动 Storyboard Flow.command" "$@"
