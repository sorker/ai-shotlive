/**
 * 火山引擎 Seedance 视频原生适配器
 *
 * 使用火山方舟官方 API 格式：
 *   POST /api/v3/contents/generations/tasks    (新版)
 *   POST /v2/videos/generations                (统一格式)
 * 参考图片通过 images 数组传入，直接支持 URL。
 *
 * 所有请求通过本地代理 /api/proxy/volcengine 转发，
 * 绕过浏览器 CORS 限制。
 */

import { AspectRatio, VideoDuration } from '../../types/model';

const PROXY_PREFIX = '/api/proxy/volcengine';

/**
 * 将宽高比转为 Seedance 接受的 ratio 格式
 */
const mapRatio = (aspectRatio: AspectRatio): string => {
  const ratioMap: Record<AspectRatio, string> = {
    '16:9': '16:9',
    '9:16': '9:16',
    '1:1': '1:1',
  };
  return ratioMap[aspectRatio] || '16:9';
};

/**
 * 将分辨率映射到 Seedance 的 resolution 值
 */
const mapResolution = (): string => {
  return '720p';
};

/**
 * 确保图片数据是 Seedance API 可接受的格式
 * images 数组直接支持 URL 和 base64 data URL
 */
const normalizeImageForSeedance = (imageData: string): string => {
  if (/^https?:\/\//i.test(imageData)) {
    return imageData;
  }
  if (imageData.startsWith('data:image/')) {
    return imageData;
  }
  return `data:image/png;base64,${imageData}`;
};

// ============================================
// Volcengine Seedance 视频生成
// ============================================

export interface SeedanceVideoOptions {
  prompt: string;
  startImage?: string;
  endImage?: string;
  modelId: string;
  apiKey: string;
  aspectRatio?: AspectRatio;
  duration?: VideoDuration;
}

/**
 * 创建 Seedance 视频生成任务
 */
const createTask = async (options: SeedanceVideoOptions): Promise<string> => {
  const {
    prompt,
    startImage,
    endImage,
    modelId,
    apiKey,
    aspectRatio = '16:9',
    duration = 5,
  } = options;

  // 构建 images 数组
  const images: string[] = [];
  if (startImage) {
    images.push(normalizeImageForSeedance(startImage));
  }
  if (endImage) {
    images.push(normalizeImageForSeedance(endImage));
  }

  const requestBody: Record<string, any> = {
    model: modelId,
    prompt,
    duration,
    resolution: mapResolution(),
    ratio: mapRatio(aspectRatio),
  };

  if (images.length > 0) {
    requestBody.images = images;
  }

  console.log(`🎬 [Seedance] 创建视频任务 (${modelId})...`);

  // 使用 /api/v3/contents/generations/tasks（方舟标准异步任务端点）
  const response = await fetch(
    `${PROXY_PREFIX}/api/v3/contents/generations/tasks`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    let errorMessage = `Seedance 创建任务失败: HTTP ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error?.message || errorData.message || errorMessage;
    } catch {
      const text = await response.text();
      if (text) errorMessage = text;
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  const taskId = data.id || data.task_id;

  if (!taskId) {
    throw new Error('Seedance 创建任务失败：未返回 task_id');
  }

  console.log(`📋 [Seedance] 任务已创建，task_id: ${taskId}`);
  return taskId;
};

/**
 * 轮询 Seedance 任务状态
 */
const pollTask = async (
  taskId: string,
  apiKey: string,
  maxPollingTime: number = 1200000,
  pollingInterval: number = 10000
): Promise<string> => {
  const startTime = Date.now();

  while (Date.now() - startTime < maxPollingTime) {
    await new Promise(resolve => setTimeout(resolve, pollingInterval));

    const statusResponse = await fetch(
      `${PROXY_PREFIX}/api/v3/contents/generations/tasks/${taskId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      }
    );

    if (!statusResponse.ok) {
      console.warn(`⚠️ [Seedance] 查询任务状态失败 HTTP ${statusResponse.status}，继续重试...`);
      continue;
    }

    const data = await statusResponse.json();
    const status = data.status;

    console.log(`🔄 [Seedance] 任务状态: ${status}`);

    if (status === 'succeeded' || status === 'completed') {
      // 从 content 中提取视频 URL
      const videoUrl =
        data.content?.[0]?.video_url ||
        data.content?.[0]?.url ||
        data.video_url ||
        data.output?.video_url;

      if (!videoUrl) {
        throw new Error('Seedance 任务完成但未返回视频 URL');
      }
      console.log(`✅ [Seedance] 视频生成完成`);
      return videoUrl;
    }

    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      const errMsg = data.error?.message || data.message || '未知错误';
      throw new Error(`Seedance 视频生成失败: ${errMsg}`);
    }
  }

  throw new Error('Seedance 视频生成超时 (20分钟)');
};

/**
 * 下载视频并转换为 base64
 */
const downloadVideoAsBase64 = async (videoUrl: string): Promise<string> => {
  console.log(`📥 [Seedance] 正在下载视频...`);

  try {
    const response = await fetch(videoUrl);
    if (response.ok) {
      const blob = await response.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('视频转码失败'));
        reader.readAsDataURL(blob);
      });
    }
  } catch {
    console.warn('⚠️ [Seedance] 直接下载视频失败');
  }

  // 降级：尝试通过代理下载
  try {
    const proxyUrl = videoUrl.replace(
      /^https:\/\/[^/]+/,
      PROXY_PREFIX
    );
    const response = await fetch(proxyUrl);
    if (response.ok) {
      const blob = await response.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('视频转码失败'));
        reader.readAsDataURL(blob);
      });
    }
  } catch {
    console.warn('⚠️ [Seedance] 代理下载视频也失败');
  }

  console.warn('⚠️ [Seedance] 无法将视频转为 base64，返回原始 URL');
  return videoUrl;
};

// ============================================
// 导出主入口
// ============================================

/**
 * 使用火山引擎原生 API 生成 Seedance 视频
 *
 * 优势：
 *  - images 数组直接传 URL，无需 base64 转换
 *  - 使用方舟原生异步任务格式
 *  - 通过本地代理解决 CORS
 */
export const generateSeedanceVideo = async (
  options: SeedanceVideoOptions
): Promise<string> => {
  // 1. 创建任务
  const taskId = await createTask(options);

  // 2. 轮询等待完成
  const videoUrl = await pollTask(taskId, options.apiKey);

  // 3. 下载视频转 base64
  const videoBase64 = await downloadVideoAsBase64(videoUrl);

  console.log(`✅ [Seedance] 视频生成完成`);
  return videoBase64;
};
