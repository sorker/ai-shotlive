/**
 * 视频剪辑器 - 导出视频
 * 将轨道中的视频/图片片段打包为 ZIP 下载
 */

import { VideoEditorStore } from './VideoEditorStore';
import { ItemType } from './types';

async function downloadFile(url: string): Promise<Blob> {
  if (url.startsWith('data:video/') || url.startsWith('data:image/') || url.startsWith('data:audio/')) {
    const base64Data = url.split(',')[1];
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const mime = url.match(/data:([^;]+);/)?.[1] || 'video/mp4';
    return new Blob([bytes], { type: mime });
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败: ${res.statusText}`);
  return res.blob();
}

/**
 * 导出剪辑中的视频片段为 ZIP
 */
export async function exportEditedVideos(
  store: VideoEditorStore,
  projectTitle: string,
  onProgress?: (phase: string, progress: number) => void
): Promise<void> {
  const items: { url: string; name: string; ext: string }[] = [];
  for (const layer of store.layers) {
    if (layer.type !== 'video' && layer.type !== 'image') continue;
    for (const item of layer.items) {
      if (!item.url) continue;
      const ext = item.type === ItemType.VIDEO ? 'mp4' : 'jpg';
      items.push({ url: item.url, name: `${layer.name}_${item.id.slice(0, 6)}`, ext });
    }
  }

  if (items.length === 0) {
    throw new Error('没有可导出的视频或图片片段');
  }

  onProgress?.('正在加载...', 0);
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const blob = await downloadFile(it.url);
    zip.file(`${it.name}.${it.ext}`, blob);
    onProgress?.(`下载中 (${i + 1}/${items.length})`, Math.round(((i + 1) / items.length) * 90));
  }

  onProgress?.('正在压缩...', 95);
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  onProgress?.('完成', 100);

  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectTitle || 'clip'}_export.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
