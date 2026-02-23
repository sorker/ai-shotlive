import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { initDatabase, getPool } from './config/database.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import projectPatchRoutes from './routes/projectPatch.js';
import assetRoutes from './routes/assets.js';
import modelRoutes from './routes/models.js';
import uploadRoutes from './routes/uploads.js';
import preferencesRoutes from './routes/preferences.js';
import taskRoutes from './routes/tasks.js';
import visualStyleRoutes from './routes/visualStyles.js';
import { recoverTasks } from './services/taskRunner.js';
import { mountProxy } from './proxy.js';

const app = express();
const PORT = parseInt(process.env.SERVER_PORT || '3001', 10);

// 确保 uploads 目录存在
const uploadsDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 已创建 uploads 目录');
}

// 第三方 API 代理（放在 body 解析前，生产环境与 Vite/nginx 行为一致）
mountProxy(app);

// 中间件
app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', projectPatchRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/models', modelRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/visual-styles', visualStyleRoutes);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 生产环境：提供静态文件
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../../dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));

    // SPA 回退 - 所有非 API 路由返回 index.html
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(distPath, 'index.html'));
      }
    });
  }
}

// 初始化数据库并启动服务器
const start = async () => {
  try {
    await initDatabase();
    app.listen(PORT, '0.0.0.0', async () => {
      console.log(`🚀 AiShotlive API Server 运行在 http://0.0.0.0:${PORT}`);
      console.log(`📦 环境: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🗄️  数据库: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);

      // 恢复未完成的后台任务
      try {
        await recoverTasks(getPool());
      } catch (err) {
        console.error('⚠️ 任务恢复失败:', err);
      }
    });
  } catch (err) {
    console.error('❌ 服务器启动失败:', err);
    process.exit(1);
  }
};

start();
