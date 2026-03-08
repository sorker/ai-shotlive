#!/usr/bin/env bash
#
# Electron 桌面客户端编译打包脚本
#
# 用法:
#   bash scripts/build-electron.sh          # 编译 + 打包（当前平台）
#   bash scripts/build-electron.sh mac      # 仅打包 macOS
#   bash scripts/build-electron.sh win      # 仅打包 Windows
#   bash scripts/build-electron.sh all      # 打包 macOS + Windows
#
# 产物输出到 release/ 目录

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="${1:-}"

cd "$ROOT_DIR"

echo "╔══════════════════════════════════════════════════╗"
echo "║   AI-ShotLive Electron 桌面客户端编译            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ─── 1. 检查环境 ─────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "ERROR: 未找到 Node.js，请先安装 Node.js >= 18"
  exit 1
fi

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "ERROR: Node.js 版本过低 ($(node -v))，需要 >= 18"
  exit 1
fi
echo "[OK] Node.js $(node -v)"

# ─── 2. 安装依赖 ─────────────────────────────────────────────────
echo ""
echo "[1/5] 安装依赖..."
npm install --legacy-peer-deps

# ─── 3. 编译前端 ─────────────────────────────────────────────────
echo ""
echo "[2/5] 编译前端 (Vite)..."
npm run build:client

# ─── 4. 编译后端 ─────────────────────────────────────────────────
echo ""
echo "[3/5] 编译后端 (TypeScript)..."
npm run build:server

# ─── 5. 编译 Electron 主进程 ─────────────────────────────────────
echo ""
echo "[4/5] 编译 Electron 主进程..."
npm run build:electron-main

# ─── 6. 重编译 native 模块 ───────────────────────────────────────
echo ""
echo "[5/5] 打包 Electron 应用..."

# 构建平台参数
PLATFORM_ARGS=""
case "$TARGET" in
  mac|macos)
    PLATFORM_ARGS="--mac"
    ;;
  win|windows)
    PLATFORM_ARGS="--win"
    ;;
  all)
    PLATFORM_ARGS="--mac --win"
    ;;
  "")
    # 默认：当前平台
    ;;
  *)
    echo "ERROR: 未知平台参数 '$TARGET'，支持: mac, win, all"
    exit 1
    ;;
esac

npx electron-builder $PLATFORM_ARGS

# ─── 完成 ─────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║              编译打包完成！                       ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  产物目录: release/                              ║"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
ls -lh release/ 2>/dev/null || echo "(release/ 目录为空或不存在)"
