/**
 * Electron 主进程
 *
 * 启动内嵌 Express 服务器（SQLite），然后创建 BrowserWindow 加载前端。
 * 所有数据存储在 app.getPath('userData') 下，与系统其他文件隔离。
 */

import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import fs from 'fs';

// ─── 环境变量（必须在导入 server 前设置） ────────────────────────

const userData = app.getPath('userData');

process.env.ELECTRON = '1';
process.env.DB_TYPE = 'sqlite';
process.env.NODE_ENV = 'production';
process.env.SQLITE_DB_PATH = path.join(userData, 'local.db');
process.env.DATA_DIR = path.join(userData, 'data');
process.env.UPLOADS_DIR = path.join(userData, 'uploads');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'electron_local_jwt_secret';

// .env 文件加载（可选，用户可在 userData 下放 .env 覆盖默认配置）
const userEnvPath = path.join(userData, '.env');
if (fs.existsSync(userEnvPath)) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: userEnvPath });
}

// 确保数据目录存在
for (const dir of [process.env.DATA_DIR!, process.env.UPLOADS_DIR!]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── 启动 Express 服务器 ───────────────────────────────────────

// app 根目录：打包后为 app.asar 所在目录，开发时为项目根
const appRoot = app.isPackaged
  ? path.join(path.dirname(app.getAppPath()))
  : path.resolve(import.meta.dirname, '..');

// 设置 dist 和 server 路径供 Express 使用
process.env.DIST_PATH = app.isPackaged
  ? path.join(appRoot, 'app.asar', 'dist')
  : path.join(appRoot, 'dist');

process.env.SERVER_ROOT = app.isPackaged
  ? path.join(appRoot, 'app.asar', 'server', 'dist')
  : path.join(appRoot, 'server', 'dist');

const { startServer } = await import(
  app.isPackaged
    ? path.join(appRoot, 'app.asar', 'server', 'dist', 'index.js')
    : path.join(appRoot, 'server', 'dist', 'index.js')
);

let serverPort: number;
try {
  serverPort = await startServer(0);
} catch (err) {
  console.error('Express 服务启动失败:', err);
  app.quit();
  process.exit(1);
}

// ─── 窗口管理 ──────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'AI-ShotLive',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  // 外部链接在系统浏览器中打开
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (url.startsWith('http') && !url.includes('127.0.0.1')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App 生命周期 ──────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
