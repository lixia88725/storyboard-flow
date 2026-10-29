#!/bin/bash
# 兼容旧引用：真正的脚本在仓库根目录的「启动测试.command」。
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/启动测试.command" "$@"
