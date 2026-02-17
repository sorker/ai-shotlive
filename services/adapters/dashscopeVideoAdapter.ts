/**
 * DashScope (阿里百炼) 万象视频原生适配器
 *
 * 使用 DashScope 官方 API 格式，根据模型类型选择不同端点：
 *   - 文生视频 / 图生视频 (t2v / i2v):
 *       POST /api/v1/services/aigc/video-generation/video-synthesis
 *       图片字段: img_url
 *   - 首尾帧生视频 (kf2v):
 *       POST /api/v1/services/aigc/image2video/video-synthesis
 *       图片字段: first_frame_url / last_frame_url
 *
 * 图片支持公网 URL 和 Base64 编码（data:image/...;base64,...）。
 * 所有请求通过本地代理 /api/proxy/dashscope 转发，绕过浏览器 CORS 限制。
 */

import { AspectRatio, VideoDuration } from '../../types/model';

const PROXY_PREFIX = '/api/proxy/dashscope';

/**
 * 判断模型是否为首尾帧 (kf2v) 模型
 */
const isKf2vModel = (modelId: string): boolean => {
  return modelId.includes('kf2v');
};

/**
 * 将分辨率标识映射到 DashScope 格式
 */
const mapResolution = (aspectRatio: AspectRatio): string => {
  return '720P';
};

/**
 * 根据模型 ID 和参考图片数，判断是 文生视频(t2v) 还是 图生视频(i2v)
 */
const isTextToVideo = (modelId: string, hasImage: boolean): boolean => {
  if (modelId.includes('t2v')) return true;
  if (modelId.includes('i2v')) return false;
  // kf2v = 关键帧，需要图片
  if (modelId.includes('kf2v')) return false;
  return !hasImage;
};

/**
 * 确保图片数据是 DashScope img_url 可接受的格式
 * 支持：URL 直接传入 / base64 data URL / 纯 base64 补全前缀
 */
const normalizeImageForDashScope = (imageData: string): string => {
  if (/^https?:\/\//i.test(imageData)) {
    return imageData;
  }
  if (imageData.startsWith('data:image/')) {
    return imageData;
  }
  // 纯 base64 → 补 data URL 前缀
  return `data:image/png;base64,${imageData}`;
};

// ============================================
// DashScope 万象视频生成
// ============================================

export interface DashScopeVideoOptions {
  prompt: string;
  startImage?: string;
  endImage?: string;
  modelId: string;
  apiKey: string;
  aspectRatio?: AspectRatio;
  duration?: VideoDuration;
}

/**
 * 创建万象视频生成任务
 *
 * 根据模型类型使用不同的 API 端点和参数结构：
 * - kf2v (首尾帧): /api/v1/services/aigc/image2video/video-synthesis
 *   使用 first_frame_url / last_frame_url，duration 固定为 5 秒
 * - t2v/i2v (文生/图生): /api/v1/services/aigc/video-generation/video-synthesis
 *   使用 img_url
 */
const createTask = async (options: DashScopeVideoOptions): Promise<string> => {
  const {
    prompt,
    startImage,
    endImage,
    modelId,
    apiKey,
    duration = 4,
  } = options;

  const kf2v = isKf2vModel(modelId);
  const hasImage = !!startImage;
  const t2v = isTextToVideo(modelId, hasImage);

  // 构建请求体
  const input: Record<string, any> = { prompt };

  if (kf2v) {
    // 首尾帧模型使用 first_frame_url / last_frame_url
    if (startImage) {
      input.first_frame_url = normalizeImageForDashScope(startImage);
    }
    if (endImage) {
      input.last_frame_url = normalizeImageForDashScope(endImage);
    }
  } else {
    // i2v / t2v 模型使用 img_url
    if (!t2v && startImage) {
      input.img_url = normalizeImageForDashScope(startImage);
    }
  }

  const parameters: Record<string, any> = {
    resolution: mapResolution(options.aspectRatio || '16:9'),
    prompt_extend: true,
  };

  // kf2v 模型 duration 固定为 5 秒（API 不支持修改），不传 duration 参数
  if (!kf2v && duration) {
    parameters.duration = duration;
  }

  const requestBody = {
    model: modelId,
    input,
    parameters,
  };

  // 选择正确的 API 端点
  const apiPath = kf2v
    ? '/api/v1/services/aigc/image2video/video-synthesis'
    : '/api/v1/services/aigc/video-generation/video-synthesis';

  console.log(`🎬 [DashScope] 创建万象视频任务 (${modelId})，端点: ${kf2v ? 'kf2v 首尾帧' : 't2v/i2v'}...`);

  const response = await fetch(
    `${PROXY_PREFIX}${apiPath}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    let errorMessage = `DashScope 创建任务失败: HTTP ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorData.code || errorMessage;
    } catch {
      const text = await response.text();
      if (text) errorMessage = text;
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  const taskId = data.output?.task_id;

  if (!taskId) {
    throw new Error('DashScope 创建任务失败：未返回 task_id');
  }

  console.log(`📋 [DashScope] 任务已创建，task_id: ${taskId}`);
  return taskId;
};

/**
 * 轮询任务状态直到完成
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
      `${PROXY_PREFIX}/api/v1/tasks/${taskId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      }
    );

    if (!statusResponse.ok) {
      console.warn(`⚠️ [DashScope] 查询任务状态失败 HTTP ${statusResponse.status}，继续重试...`);
      continue;
    }

    const data = await statusResponse.json();
    const status = data.output?.task_status;

    console.log(`🔄 [DashScope] 任务状态: ${status}`);

    if (status === 'SUCCEEDED') {
      const videoUrl = data.output?.video_url;
      if (!videoUrl) {
        throw new Error('DashScope 任务完成但未返回 video_url');
      }
      console.log(`✅ [DashScope] 视频生成完成`);
      return videoUrl;
    }

    if (status === 'FAILED') {
      const errMsg = data.output?.message || data.output?.code || '未知错误';
      throw new Error(`DashScope 视频生成失败: ${errMsg}`);
    }

    if (status === 'UNKNOWN') {
      throw new Error('DashScope 任务不存在或已过期');
    }
  }

  throw new Error('DashScope 视频生成超时 (20分钟)');
};

/**
 * 下载视频 URL 并转换为 base64 data URL
 * DashScope 返回的 video_url 是 OSS 签名链接，需要通过代理下载
 */
const downloadVideoAsBase64 = async (videoUrl: string): Promise<string> => {
  console.log(`📥 [DashScope] 正在下载视频...`);

  // 尝试直接 fetch（DashScope OSS 链接可能支持 CORS）
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
    console.warn('⚠️ [DashScope] 直接下载视频失败，尝试其他方式...');
  }

  // 返回原始 URL 作为降级
  console.warn('⚠️ [DashScope] 无法将视频转为 base64，返回原始 URL');
  return videoUrl;
};

// ============================================
// 导出主入口
// ============================================

/**
 * 使用 DashScope 原生 API 生成万象视频
 *
 * 优势：
 *  - img_url 支持直接传 URL，无需客户端下载转 base64
 *  - 使用 DashScope 原生异步任务格式
 *  - 通过本地代理解决 CORS
 */
export const generateDashScopeVideo = async (
  options: DashScopeVideoOptions
): Promise<string> => {
  // 1. 创建任务
  const taskId = await createTask(options);

  // 2. 轮询等待完成
  const videoUrl = await pollTask(taskId, options.apiKey);

  // 3. 下载视频转 base64
  const videoBase64 = await downloadVideoAsBase64(videoUrl);

  console.log(`✅ [DashScope] 万象视频生成完成`);
  return videoBase64;
};
