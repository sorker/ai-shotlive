import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import type { AddressInfo } from 'net';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载环境变量（非 Electron 模式下从项目根目录加载）
if (!process.env.ELECTRON) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

// 初始化 Sentry
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  release: process.env.npm_package_version || '0.0.1',

  // 性能监控
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),

  // 性能分析
  profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '0.1'),

  // 集成
  integrations: [
    nodeProfilingIntegration(),
    Sentry.httpIntegration({ requestHook: (event) => {
      // 过滤健康检查请求
      if (event.request?.url?.includes('/api/health')) {
        return null;
      }
      return event;
    }}),
    Sentry.expressIntegration(),
  ],
});

import { initDatabase, getPool, isSqlite } from './config/database.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import projectPatchRoutes from './routes/projectPatch.js';
import assetRoutes from './routes/assets.js';
import modelRoutes from './routes/models.js';
import uploadRoutes from './routes/uploads.js';
import preferencesRoutes from './routes/preferences.js';
import taskRoutes from './routes/tasks.js';
import visualStyleRoutes from './routes/visualStyles.js';
import dataTransferRoutes from './routes/dataTransfer.js';
import aiRoutes from './routes/ai.js';
import cutosAgentRoutes from './routes/cutosAgent.js';
import { recoverTasks } from './services/taskRunner.js';
import { mountProxy } from './proxy.js';

const expressApp = express();
const PORT = parseInt(process.env.SERVER_PORT || '3001', 10);

// 确保 uploads 目录存在
const uploadsDir = process.env.UPLOADS_DIR || path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 已创建 uploads 目录');
}

// 第三方 API 代理（放在 body 解析前，生产环境与 Vite/nginx 行为一致）
mountProxy(expressApp);

// 中间件
expressApp.use(cors());
expressApp.use(express.json({ limit: '500mb' }));
expressApp.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Sentry 请求处理（必须在路由之前）
expressApp.use(Sentry.requestHandler());

// API 路由
expressApp.use('/api/auth', authRoutes);
expressApp.use('/api/projects', projectRoutes);
expressApp.use('/api/projects', projectPatchRoutes);
expressApp.use('/api/assets', assetRoutes);
expressApp.use('/api/models', modelRoutes);
expressApp.use('/api/uploads', uploadRoutes);
expressApp.use('/api/preferences', preferencesRoutes);
expressApp.use('/api/tasks', taskRoutes);
expressApp.use('/api/visual-styles', visualStyleRoutes);
expressApp.use('/api/data-transfer', dataTransferRoutes);
expressApp.use('/api/ai', aiRoutes);
expressApp.use('/api/cutos', cutosAgentRoutes);

// 健康检查（放在错误处理中间件之前）
expressApp.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Sentry 错误处理中间件（必须在所有路由之后）
expressApp.use(Sentry.errorHandler());

// 生产环境：提供静态文件
if (process.env.NODE_ENV === 'production') {
  const distPath = process.env.DIST_PATH || path.resolve(__dirname, '../../dist');
  if (fs.existsSync(distPath)) {
    expressApp.use(express.static(distPath));

    // SPA 回退 - 所有非 API 路由返回 index.html
    expressApp.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(distPath, 'index.html'));
      }
    });
  }
}

/**
 * 启动服务器并返回实际监听的端口号。
 * @param preferPort 期望端口，传 0 使用随机可用端口（Electron 模式推荐）
 */
export async function startServer(preferPort?: number): Promise<number> {
  await initDatabase();

  const listenPort = preferPort ?? PORT;
  const host = process.env.ELECTRON ? '127.0.0.1' : '0.0.0.0';

  return new Promise((resolve, reject) => {
    const server = expressApp.listen(listenPort, host, async () => {
      const addr = server.address() as AddressInfo;
      const actualPort = addr.port;

      console.log(`🚀 AiShotlive API Server 运行在 http://${host}:${actualPort}`);
      console.log(`📦 环境: ${process.env.NODE_ENV || 'development'}`);
      if (isSqlite()) {
        console.log(`🗄️  数据库: SQLite (${process.env.SQLITE_DB_PATH || 'data/local.db'})`);
      } else {
        console.log(`🗄️  数据库: MySQL ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
      }

      // 恢复未完成的后台任务
      try {
        await recoverTasks(getPool());
      } catch (err) {
        console.error('⚠️ 任务恢复失败:', err);
      }

      resolve(actualPort);
    });

    server.on('error', reject);
  });
}

// 非 Electron 环境直接启动
if (!process.env.ELECTRON) {
  startServer().catch((err) => {
    console.error('❌ 服务器启动失败:', err);
    process.exit(1);
  });
}
