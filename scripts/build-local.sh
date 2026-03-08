#!/usr/bin/env bash
#
# 本地客户端编译脚本 —— 使用 SQLite，无需 MySQL
#
# 用法:
#   bash scripts/build-local.sh          # 编译
#   npm run start:local                  # 运行编译后的本地版本
#
# 参考 Dockerfile 的多阶段构建流程，但使用 SQLite 作为数据库后端。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

echo "╔══════════════════════════════════════════════════╗"
echo "║   AI-ShotLive 本地客户端编译 (SQLite 模式)      ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ─── 1. 检查 Node.js ─────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "❌ 未找到 Node.js，请先安装 Node.js >= 18"
  exit 1
fi

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js 版本过低 ($(node -v))，需要 >= 18"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# ─── 2. 安装依赖 ─────────────────────────────────────────────────
echo ""
echo "📦 安装依赖..."
npm install --legacy-peer-deps

# ─── 3. 编译前端 ─────────────────────────────────────────────────
echo ""
echo "🔨 编译前端 (Vite)..."
npm run build:client

# ─── 4. 编译后端 ─────────────────────────────────────────────────
echo ""
echo "🔨 编译后端 (TypeScript)..."
npm run build:server

# ─── 5. 创建必要目录 ─────────────────────────────────────────────
mkdir -p data uploads

# ─── 6. 生成本地 .env（如果不存在） ──────────────────────────────
LOCAL_ENV="$ROOT_DIR/.env.local"
if [ ! -f "$LOCAL_ENV" ]; then
  cat > "$LOCAL_ENV" <<'ENVEOF'
# AI-ShotLive 本地模式配置（SQLite）
DB_TYPE=sqlite
SQLITE_DB_PATH=./data/local.db

# JWT 密钥
JWT_SECRET=aishotlive_local_jwt_secret

# 服务端口
SERVER_PORT=3001

# Node 环境
NODE_ENV=production
ENVEOF
  echo "✅ 已生成 $LOCAL_ENV"
else
  echo "ℹ️  $LOCAL_ENV 已存在，跳过生成"
fi

# ─── 完成 ─────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║              ✅ 编译完成！                       ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  启动方式:                                       ║"
echo "║    npm run start:local                           ║"
echo "║                                                  ║"
echo "║  或手动:                                         ║"
echo "║    DB_TYPE=sqlite NODE_ENV=production \\          ║"
echo "║      node server/dist/index.js                   ║"
echo "║                                                  ║"
echo "║  开发模式:                                       ║"
echo "║    npm run dev:local                             ║"
echo "║                                                  ║"
echo "║  数据存储在: data/local.db                       ║"
echo "║  访问地址:   http://localhost:3001               ║"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
