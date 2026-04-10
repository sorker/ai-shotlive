/**
 * Electron 预加载脚本
 *
 * 在 renderer 进程加载前运行，可通过 contextBridge 暴露有限的 Node API。
 * 当前仅暴露平台信息；后续可扩展文件拖放、原生对话框等能力。
 */

import { contextBridge } from 'electron';
import * as Sentry from '@sentry/electron/preload';

// 初始化 Sentry（渲染进程错误监控）
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || 'production',
  release: process.env.npm_package_version || '0.0.1',
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
});

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
});
