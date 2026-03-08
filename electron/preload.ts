/**
 * Electron 预加载脚本
 *
 * 在 renderer 进程加载前运行，可通过 contextBridge 暴露有限的 Node API。
 * 当前仅暴露平台信息；后续可扩展文件拖放、原生对话框等能力。
 */

import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
});
