#!/bin/bash
# Compatibility shortcut: the accepted version now lives on main.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$REPO/启动 Storyboard Flow.command" "$@"
