# AI-ShotLive 部署指南

本文档介绍 AI-ShotLive 的多种部署方式，包括 Docker 部署、本地部署和桌面客户端。

## 目录

- [部署方式对比](#部署方式对比)
- [Docker 部署（推荐）](#docker 部署推荐)
- [本地部署](#本地部署)
- [桌面客户端](#桌面客户端)
- [Sentry 错误监控配置](#sentry-错误监控配置)
- [常见问题](#常见问题)

---

## 部署方式对比

| 部署方式 | 适用场景 | 数据库 | 复杂度 |
|---------|---------|--------|--------|
| Docker + 宿主机 MySQL | 已有 MySQL 服务 | 外部 MySQL | ⭐⭐ |
| Docker + MySQL 容器 | 完整容器化部署 | MySQL 容器 | ⭐⭐ |
| 本地 SQLite | 快速测试、单机部署 | SQLite | ⭐ |
| 桌面客户端 | 个人使用、免配置 | SQLite | ⭐ |

---

## Docker 部署（推荐）

### 方式一：使用宿主机 MySQL

适合已有 MySQL 服务的场景。

**前置条件：**
- Docker 和 Docker Compose
- MySQL 8.0+ 已安装并运行

**步骤：**

1. **配置环境变量**

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置数据库连接：

```env
DB_TYPE=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=aishotlive
DB_PASSWORD=aishotlive
DB_NAME=aishotlive

JWT_SECRET=请修改为安全的随机字符串
SERVER_PORT=3001
```

2. **构建并启动**

```bash
docker compose up -d --build
```

3. **验证部署**

```bash
docker compose ps
curl http://localhost:3001/api/health
```

4. **查看日志**

```bash
docker compose logs -f ai-shotlive
```

### 方式二：应用 + MySQL 同栈

适合希望完整容器化、无需外部依赖的场景。

**步骤：**

1. **配置环境变量**

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
DB_TYPE=mysql
DB_NAME=banana
DB_USER=banana
DB_PASSWORD=banana

MYSQL_ROOT_PASSWORD=root

JWT_SECRET=请修改为安全的随机字符串
SERVER_PORT=3001
```

2. **构建并启动**

```bash
docker compose -f docker-compose.mysql.yaml up -d --build
```

3. **验证服务**

```bash
# 查看容器状态
docker compose ps

# 查看应用日志
docker compose logs -f ai-shotlive

# 查看 MySQL 日志
docker compose logs -f mysql

# 健康检查
curl http://localhost:3001/api/health
```

### Docker 健康检查

配置的健康检查会自动监控应用状态：

```bash
# 查看健康检查状态
docker inspect --format='{{.State.Health.Status}}' ai-shotlive-app

# 查看健康检查日志
docker inspect --format='{{json .State.Health.Logs}}' ai-shotlive-app | jq
```

### 数据持久化

- ** uploads 目录**：`./uploads` 映射到容器 `/app/uploads`
- **媒体文件**：`./data` 映射到容器 `/app/data`
- **MySQL 数据**：使用命名卷 `mysql_data` 持久化

### 停止和清理

```bash
# 停止服务
docker compose down

# 停止并删除 MySQL 数据卷（危险操作！）
docker compose -f docker-compose.mysql.yaml down -v
```

---

## 本地部署

### 环境要求

- Node.js >= 20
- npm >= 9
- MySQL 8.0+ 或 SQLite（内置）

### 步骤

1. **克隆项目**

```bash
git clone https://github.com/shamsharoon/ai-shotlive-Director.git
cd ai-shotlive-Director
```

2. **安装依赖**

```bash
npm install
```

3. **配置环境变量**

```bash
cp .env.example .env
```

4. **初始化数据库**

首次启动时会自动创建数据库表。

可选：创建默认管理员账号：

```bash
npx tsx server/src/scripts/seed.ts
# 默认账号：admin / admin123
```

5. **启动服务**

**开发模式（前端 + 后端）：**

```bash
npm run dev
```

**生产模式：**

```bash
npm run build
npm start
```

**SQLite 模式（无需 MySQL）：**

```bash
npm run build:local
npm run start:local
```

---

## 桌面客户端

桌面客户端基于 Electron，内嵌 SQLite 数据库，双击即用。

### 下载

- [macOS (Apple Silicon)](https://github.com/sorker/ai-shotlive/releases)
- [macOS (Intel)](https://github.com/sorker/ai-shotlive/releases)
- [Windows](https://github.com/sorker/ai-shotlive/releases)

### 数据存储位置

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/ai-shotlive-director/` |
| Windows | `%APPDATA%/ai-shotlive-director/` |

---

## Sentry 错误监控配置

Sentry 提供错误监控、性能追踪和会话回放功能。

### 1. 创建 Sentry 项目

1. 访问 [sentry.io](https://sentry.io)
2. 创建账号（或使用 GitHub/Google 登录）
3. 创建新项目，选择平台为 "JavaScript"
4. 获取 DSN 和 Auth Token

### 2. 配置环境变量

编辑 `.env` 文件：

```env
# =====================
# Sentry 错误监控配置
# =====================
SENTRY_DSN=https://your-dsn@sentry.io/your-project-id
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1
SENTRY_AUTH_TOKEN=your-auth-token

# 前端 Sentry 配置
VITE_SENTRY_DSN=https://your-dsn@sentry.io/your-project-id
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE=1.0
```

### 3. 配置说明

| 变量 | 说明 | 推荐值 |
|-----|------|--------|
| `SENTRY_DSN` | Sentry 数据源名称 | 必填 |
| `SENTRY_ENVIRONMENT` | 环境标识 | `production` / `development` |
| `SENTRY_TRACES_SAMPLE_RATE` | 性能追踪采样率 | `0.1` (10%) |
| `SENTRY_PROFILES_SAMPLE_RATE` | 性能分析采样率 | `0.1` (10%) |
| `SENTRY_AUTH_TOKEN` | 上传 Source Map 的令牌 | 必填（生产环境） |
| `VITE_SENTRY_DSN` | 前端 DSN | 同 `SENTRY_DSN` |
| `VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE` | 会话回放采样率 | `0.1` (10%) |
| `VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE` | 错误时回放采样率 | `1.0` (100%) |

### 4. 生产环境上传 Source Map

生产构建时会自动上传 Source Map 到 Sentry（需配置 `SENTRY_AUTH_TOKEN`）。

手动上传：

```bash
npx @sentry/cli releases new <version>
npx @sentry/cli releases files <version> upload-sourcemaps ./dist
npx @sentry/cli releases finalize <version>
```

---

## 常见问题

### 1. Docker 容器无法启动

**检查数据库连接：**

```bash
docker compose logs ai-shotlive
```

确保 `.env` 中的数据库配置正确，且宿主机 MySQL 允许远程连接。

### 2. Linux 下无法连接宿主机 MySQL

在 `docker-compose.yaml` 中添加：

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

或使用 MySQL 容器的部署方式。

### 3. 健康检查失败

等待 40 秒（start_period）后再检查：

```bash
docker inspect --format='{{.State.Health.Status}}' ai-shotlive-app
```

如果持续失败，检查应用日志：

```bash
docker compose logs ai-shotlive
```

### 4. 数据迁移

使用系统的导出/导入功能：

1. 在系统设置中点击「导出数据」
2. 下载 ZIP 备份文件
3. 在新环境中上传 ZIP 文件导入

### 5. 端口冲突

修改 `.env` 中的 `SERVER_PORT`：

```env
SERVER_PORT=3002
```

然后修改 `docker-compose.yaml` 中的端口映射：

```yaml
ports:
  - "3002:3001"
```

---

## 部署清单

- [ ] 复制 `.env.example` 为 `.env`
- [ ] 修改 `JWT_SECRET` 为安全随机字符串
- [ ] 配置数据库连接（MySQL 或 SQLite）
- [ ] （可选）配置 Sentry 错误监控
- [ ] 构建并启动服务
- [ ] 验证健康检查 `http://your-host:3001/api/health`
- [ ] 使用默认账号登录 `admin / admin123`
- [ ] 修改默认密码
- [ ] 配置模型 API Key

---

**Built for Creators, by AiShotlive.**
