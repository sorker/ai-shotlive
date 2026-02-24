/**
 * 视频剪辑器 - 工具函数
 */
export function formatTime(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec - minutes * 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/** 从视频 URL 获取缩略图（通过 canvas 截帧） */
export async function getVideoThumbnails(
  url: string,
  count: number,
  width: number = 80,
  height: number = 45
): Promise<string[]> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('Video load failed')), { once: true });
    video.src = url;
    video.load();
  });

  const duration = video.duration;
  const results: string[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return results;

  for (let i = 0; i < count; i++) {
    const t = duration * ((i + 1) / (count + 1));
    video.currentTime = t;
    await new Promise<void>((r) => {
      video.addEventListener('seeked', () => r(), { once: true });
    });
    ctx.drawImage(video, 0, 0, width, height);
    results.push(canvas.toDataURL('image/jpeg', 0.6));
  }
  video.remove();
  return results;
}
