/**
 * 服务端 AI API 代理
 *
 * 在 Node.js 服务端直接调用各 AI 提供商的 API，
 * 不经过浏览器，因此没有 CORS 限制。
 * 支持所有视频/图片/文本模型提供商。
 */

// ============================================
// 通用工具
// ============================================

/**
 * 将 URL 视频/图片下载为 base64 data URL（服务端版本）
 */
export const downloadAsBase64 = async (
  url: string,
  mimePrefix: string = 'video/mp4'
): Promise<string> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || mimePrefix;
  const buffer = Buffer.from(await response.arrayBuffer());
  const base64 = buffer.toString('base64');

  // 推断 MIME 类型
  let mime = mimePrefix;
  if (contentType.includes('video/')) mime = contentType.split(';')[0].trim();
  else if (contentType.includes('image/')) mime = contentType.split(';')[0].trim();

  return `data:${mime};base64,${base64}`;
};

/**
 * 解析 HTTP 错误响应
 */
const parseError = async (response: Response): Promise<string> => {
  let errorMessage = `HTTP ${response.status}`;
  try {
    const data = await response.json();
    errorMessage = (data as any).error?.message || (data as any).message || (data as any).code || errorMessage;
  } catch {
    try {
      const text = await response.text();
      if (text) errorMessage = text.substring(0, 500);
    } catch { /* ignore */ }
  }
  return errorMessage;
};

/**
 * 带重试的操作
 */
const retryOp = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 2000
): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (e: any) {
      lastError = e;
      const isRetryable =
        e.status === 429 || e.status >= 500 ||
        e.message?.includes('429') || e.message?.includes('timeout') ||
        e.message?.includes('ECONNRESET') || e.message?.includes('ETIMEDOUT');
      if (isRetryable && i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.log(`  ⏳ 重试 ${i + 1}/${maxRetries}，${delay}ms 后...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
};

// ============================================
// 视频生成 - 通用异步模式 (Sora, Veo-fast, Kling, Vidu)
// ============================================

export interface GenericAsyncVideoParams {
  apiBase: string;
  apiKey: string;
  modelName: string;
  prompt: string;
  startImage?: string;   // base64 data URL
  endImage?: string;     // base64 data URL
  aspectRatio: string;
  duration: number;
}

interface GenericAsyncVideoResult {
  taskId: string;
}

const getSoraVideoSize = (aspectRatio: string): string => {
  const map: Record<string, string> = {
    '16:9': '1280x720',
    '9:16': '720x1280',
    '1:1': '720x720',
  };
  return map[aspectRatio] || '1280x720';
};

/**
 * 创建通用异步视频任务
 */
export const createGenericAsyncVideoTask = async (
  params: GenericAsyncVideoParams
): Promise<GenericAsyncVideoResult> => {
  const { apiBase, apiKey, modelName, prompt, startImage, endImage, aspectRatio, duration } = params;
  const videoSize = getSoraVideoSize(aspectRatio);
  const useReferenceArray = modelName.toLowerCase().startsWith('veo_3_1-fast');

  console.log(`  🎬 [Server] 创建异步视频任务 (${modelName}, ${aspectRatio}, ${duration}s)...`);

  const formData = new FormData();
  formData.append('model', modelName);
  formData.append('prompt', prompt);
  formData.append('seconds', String(duration));
  formData.append('size', videoSize);

  // 添加参考图片
  const references = [startImage, endImage].filter(Boolean) as string[];
  if (useReferenceArray && references.length >= 2) {
    for (let i = 0; i < Math.min(references.length, 2); i++) {
      const imgBlob = base64ToBlob(references[i]);
      const fieldName = 'input_reference[]';
      const fileName = i === 0 ? 'reference-start.png' : 'reference-end.png';
      formData.append(fieldName, imgBlob, fileName);
    }
  } else if (references.length >= 1) {
    const imgBlob = base64ToBlob(references[0]);
    formData.append('input_reference', imgBlob, 'reference.png');
  }

  const response = await fetch(`${apiBase}/v1/videos`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const errMsg = await parseError(response);
    throw new Error(`创建视频任务失败: ${errMsg}`);
  }

  const data = await response.json() as any;
  const taskId = data.id || data.task_id;
  if (!taskId) throw new Error('创建视频任务失败：未返回任务ID');

  console.log(`  📋 [Server] 任务已创建，taskId: ${taskId}`);
  return { taskId };
};

/**
 * 轮询通用异步视频任务
 */
export const pollGenericAsyncVideoTask = async (
  apiBase: string,
  apiKey: string,
  taskId: string,
  modelName: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  const maxPollingTime = 1200000; // 20 分钟
  const pollingInterval = 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxPollingTime) {
    await new Promise(r => setTimeout(r, pollingInterval));

    try {
      const statusResponse = await fetch(`${apiBase}/v1/videos/${taskId}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!statusResponse.ok) {
        console.log(`  ⚠️ [Server] 查询状态失败 HTTP ${statusResponse.status}，继续重试...`);
        continue;
      }

      const statusData = await statusResponse.json() as any;
      const status = statusData.status;
      const progress = statusData.progress || 0;

      console.log(`  🔄 [Server] ${modelName} 状态: ${status}, 进度: ${progress}`);
      onProgress?.(typeof progress === 'number' ? progress : 0);

      if (status === 'completed' || status === 'succeeded') {
        // 尝试从状态中获取视频 URL
        const videoUrl = statusData.video_url || statusData.videoUrl;
        if (videoUrl) {
          const videoBase64 = await downloadAsBase64(videoUrl, 'video/mp4');
          return videoBase64;
        }

        // 从 download endpoint 获取
        const videoId = statusData.id?.startsWith('video_') ? statusData.id
          : statusData.output_video || statusData.video_id
          || statusData.outputs?.[0]?.id || statusData.outputs?.[0] || statusData.id;

        if (videoId) {
          return await downloadGenericVideo(apiBase, apiKey, videoId);
        }

        throw new Error('任务完成但未返回视频ID或URL');
      }

      if (status === 'failed' || status === 'error') {
        const errMsg = statusData?.error?.message || statusData?.error?.code || statusData?.message || '未知错误';
        throw new Error(`视频生成失败: ${errMsg}`);
      }
    } catch (e: any) {
      if (e.message?.includes('视频生成失败')) throw e;
      console.log(`  ⚠️ [Server] 轮询异常: ${e.message}，继续...`);
    }
  }

  throw new Error('视频生成超时 (20分钟)');
};

/**
 * 下载通用异步视频
 */
const downloadGenericVideo = async (
  apiBase: string,
  apiKey: string,
  videoId: string
): Promise<string> => {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      console.log(`  📥 [Server] 下载视频 (${attempt}/5)...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600000);

      const response = await fetch(`${apiBase}/v1/videos/${videoId}/content`, {
        method: 'GET',
        headers: { 'Accept': '*/*', 'Authorization': `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status >= 500 && attempt < 5) {
          await new Promise(r => setTimeout(r, 5000 * attempt));
          continue;
        }
        throw new Error(`下载视频失败: HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('video')) {
        const buffer = Buffer.from(await response.arrayBuffer());
        return `data:${contentType.split(';')[0]};base64,${buffer.toString('base64')}`;
      }

      // JSON 响应包含 URL
      const data = await response.json() as any;
      const videoUrl = data.url || data.video_url || data.download_url;
      if (videoUrl) {
        return await downloadAsBase64(videoUrl, 'video/mp4');
      }

      throw new Error('未获取到视频下载地址');
    } catch (e: any) {
      if (e.name === 'AbortError') {
        if (attempt < 5) { await new Promise(r => setTimeout(r, 5000 * attempt)); continue; }
        throw new Error('下载视频超时');
      }
      if (attempt === 5) throw e;
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }
  throw new Error('下载视频失败：已达最大重试次数');
};

// ============================================
// 视频生成 - Veo 同步模式
// ============================================

export interface VeoSyncVideoParams {
  apiBase: string;
  apiKey: string;
  modelName: string;
  prompt: string;
  startImage?: string;
  endImage?: string;
  aspectRatio: string;
}

const getVeoModelName = (hasReferenceImage: boolean, aspectRatio: string): string => {
  const orientation = aspectRatio === '9:16' ? 'portrait' : 'landscape';
  return hasReferenceImage
    ? `veo_3_1_i2v_s_fast_fl_${orientation}`
    : `veo_3_1_t2v_fast_${orientation}`;
};

export const generateVeoSyncVideo = async (params: VeoSyncVideoParams): Promise<string> => {
  const { apiBase, apiKey, prompt, startImage, endImage, aspectRatio } = params;

  let actualModel = getVeoModelName(!!startImage, aspectRatio);
  if (aspectRatio === '1:1') {
    actualModel = getVeoModelName(!!startImage, '16:9');
  }

  console.log(`  🎬 [Server] Veo 同步模式: ${actualModel}`);

  const messages: any[] = [{ role: 'user', content: prompt }];
  const cleanStart = startImage?.replace(/^data:image\/(png|jpeg|jpg);base64,/, '') || '';
  const cleanEnd = endImage?.replace(/^data:image\/(png|jpeg|jpg);base64,/, '') || '';

  if (cleanStart) {
    messages[0].content = [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${cleanStart}` } },
    ];
  }
  if (cleanEnd && Array.isArray(messages[0].content)) {
    messages[0].content.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${cleanEnd}` },
    });
  }

  const response = await retryOp(async () => {
    const res = await fetch(`${apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: actualModel,
        messages,
        stream: false,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(1200000),
    });
    if (!res.ok) {
      const errMsg = await parseError(res);
      const err: any = new Error(errMsg);
      err.status = res.status;
      throw err;
    }
    return res;
  });

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content || '';
  const urlMatch = content.match(/(https?:\/\/[^\s]+\.mp4)/);
  if (!urlMatch) throw new Error('视频生成失败 (No video URL returned)');

  return await downloadAsBase64(urlMatch[1], 'video/mp4');
};

// ============================================
// 视频生成 - DashScope (阿里百炼 万象)
// ============================================

export interface DashScopeVideoParams {
  apiKey: string;
  modelId: string;
  prompt: string;
  startImage?: string;
  endImage?: string;
  aspectRatio: string;
  duration: number;
}

interface DashScopeCreateResult {
  taskId: string;
}

const isKf2vModel = (modelId: string): boolean => modelId.includes('kf2v');
const isDashScopeT2V = (modelId: string, hasImage: boolean): boolean => {
  if (modelId.includes('t2v')) return true;
  if (modelId.includes('i2v') || modelId.includes('kf2v')) return false;
  return !hasImage;
};

const normalizeDashScopeImage = (img: string): string => {
  if (/^https?:\/\//i.test(img)) return img;
  if (img.startsWith('data:image/')) return img;
  return `data:image/png;base64,${img}`;
};

export const createDashScopeVideoTask = async (
  params: DashScopeVideoParams
): Promise<DashScopeCreateResult> => {
  const { apiKey, modelId, prompt, startImage, endImage, duration } = params;

  const kf2v = isKf2vModel(modelId);
  const hasImage = !!startImage;
  const t2v = isDashScopeT2V(modelId, hasImage);

  const input: Record<string, any> = { prompt };
  if (kf2v) {
    if (startImage) input.first_frame_url = normalizeDashScopeImage(startImage);
    if (endImage) input.last_frame_url = normalizeDashScopeImage(endImage);
  } else if (!t2v && startImage) {
    input.img_url = normalizeDashScopeImage(startImage);
  }

  const parameters: Record<string, any> = { resolution: '720P', prompt_extend: true };
  if (!kf2v && duration) parameters.duration = duration;

  const apiPath = kf2v
    ? '/api/v1/services/aigc/image2video/video-synthesis'
    : '/api/v1/services/aigc/video-generation/video-synthesis';

  console.log(`  🎬 [Server][DashScope] 创建任务 (${modelId})...`);

  const response = await fetch(`https://dashscope.aliyuncs.com${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({ model: modelId, input, parameters }),
  });

  if (!response.ok) {
    const errMsg = await parseError(response);
    throw new Error(`DashScope 创建任务失败: ${errMsg}`);
  }

  const data = await response.json() as any;
  const taskId = data.output?.task_id;
  if (!taskId) throw new Error('DashScope 创建任务失败：未返回 task_id');

  console.log(`  📋 [Server][DashScope] task_id: ${taskId}`);
  return { taskId };
};

export const pollDashScopeVideoTask = async (
  apiKey: string,
  taskId: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  const maxPollingTime = 1200000;
  const pollingInterval = 10000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxPollingTime) {
    await new Promise(r => setTimeout(r, pollingInterval));

    try {
      const res = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!res.ok) {
        console.log(`  ⚠️ [Server][DashScope] 查询失败 HTTP ${res.status}，继续...`);
        continue;
      }

      const data = await res.json() as any;
      const status = data.output?.task_status;
      console.log(`  🔄 [Server][DashScope] 状态: ${status}`);

      const elapsed = Date.now() - startTime;
      onProgress?.(Math.min(Math.round(elapsed / maxPollingTime * 90), 90));

      if (status === 'SUCCEEDED') {
        const videoUrl = data.output?.video_url;
        if (!videoUrl) throw new Error('DashScope 任务完成但未返回 video_url');
        return await downloadAsBase64(videoUrl, 'video/mp4');
      }
      if (status === 'FAILED') {
        throw new Error(`DashScope 视频生成失败: ${data.output?.message || '未知错误'}`);
      }
      if (status === 'UNKNOWN') {
        throw new Error('DashScope 任务不存在或已过期');
      }
    } catch (e: any) {
      if (e.message?.includes('生成失败') || e.message?.includes('不存在')) throw e;
      console.log(`  ⚠️ [Server][DashScope] 轮询异常: ${e.message}`);
    }
  }

  throw new Error('DashScope 视频生成超时 (20分钟)');
};

// ============================================
// 视频生成 - 火山引擎 Seedance
// ============================================

export interface SeedanceVideoParams {
  apiKey: string;
  modelId: string;
  prompt: string;
  startImage?: string;
  endImage?: string;
  aspectRatio: string;
  duration: number;
}

export const createSeedanceVideoTask = async (
  params: SeedanceVideoParams
): Promise<{ taskId: string }> => {
  const { apiKey, modelId, prompt, startImage, endImage, aspectRatio, duration } = params;

  const images: string[] = [];
  if (startImage) {
    images.push(startImage.startsWith('data:') ? startImage : `data:image/png;base64,${startImage}`);
  }
  if (endImage) {
    images.push(endImage.startsWith('data:') ? endImage : `data:image/png;base64,${endImage}`);
  }

  const requestBody: Record<string, any> = {
    model: modelId,
    prompt,
    duration,
    resolution: '720p',
    ratio: aspectRatio || '16:9',
  };
  if (images.length > 0) requestBody.images = images;

  console.log(`  🎬 [Server][Seedance] 创建任务 (${modelId})...`);

  const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errMsg = await parseError(response);
    throw new Error(`Seedance 创建任务失败: ${errMsg}`);
  }

  const data = await response.json() as any;
  const taskId = data.id || data.task_id;
  if (!taskId) throw new Error('Seedance 创建任务失败：未返回 task_id');

  console.log(`  📋 [Server][Seedance] task_id: ${taskId}`);
  return { taskId };
};

export const pollSeedanceVideoTask = async (
  apiKey: string,
  taskId: string,
  onProgress?: (progress: number) => void
): Promise<string> => {
  const maxPollingTime = 1200000;
  const pollingInterval = 10000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxPollingTime) {
    await new Promise(r => setTimeout(r, pollingInterval));

    try {
      const res = await fetch(
        `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`,
        { method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` } }
      );

      if (!res.ok) {
        console.log(`  ⚠️ [Server][Seedance] 查询失败 HTTP ${res.status}，继续...`);
        continue;
      }

      const data = await res.json() as any;
      const status = data.status;
      console.log(`  🔄 [Server][Seedance] 状态: ${status}`);

      const elapsed = Date.now() - startTime;
      onProgress?.(Math.min(Math.round(elapsed / maxPollingTime * 90), 90));

      if (status === 'succeeded' || status === 'completed') {
        const videoUrl = data.content?.[0]?.video_url || data.content?.[0]?.url
          || data.video_url || data.output?.video_url;
        if (!videoUrl) throw new Error('Seedance 任务完成但未返回视频 URL');
        return await downloadAsBase64(videoUrl, 'video/mp4');
      }
      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        throw new Error(`Seedance 视频生成失败: ${data.error?.message || '未知错误'}`);
      }
    } catch (e: any) {
      if (e.message?.includes('生成失败')) throw e;
      console.log(`  ⚠️ [Server][Seedance] 轮询异常: ${e.message}`);
    }
  }

  throw new Error('Seedance 视频生成超时 (20分钟)');
};

// ============================================
// 参考图归一化（服务端版本）
// ============================================

/**
 * 将参考图片统一归一化为 base64 data URL
 *
 * 前端 getRefImagesForShot 返回的参考图可能是以下任一格式：
 *   - data:image/...;base64,... (base64 data URL)
 *   - https://... (HTTP URL，如火山引擎 TOS 签名 URL)
 *   - 纯 base64 字符串（无 data: 前缀）
 *
 * 原前端 visualService.normalizeReferenceImages 在浏览器端做了归一化，
 * 迁移到服务端后需要在这里完成同样的工作。
 */
const normalizeReferenceImages = async (referenceImages: string[]): Promise<string[]> => {
  const normalized: string[] = [];

  for (const img of referenceImages) {
    if (!img || img.length === 0) continue;

    // 已经是 data URL → 直接使用
    if (img.startsWith('data:image/')) {
      normalized.push(img);
      continue;
    }

    // HTTP(S) URL → 下载转 base64
    if (/^https?:\/\//i.test(img)) {
      try {
        console.log(`  📥 [aiProxy] 下载参考图: ${img.substring(0, 80)}...`);
        const dataUrl = await downloadAsBase64(img, 'image/png');
        normalized.push(dataUrl);
      } catch (e: any) {
        console.warn(`  ⚠️ [aiProxy] 参考图下载失败，已跳过: ${e.message}`);
      }
      continue;
    }

    // 纯 base64 字符串 → 推断 MIME 并补全 data URL 前缀
    if (img.startsWith('/9j/')) {
      normalized.push(`data:image/jpeg;base64,${img}`);
    } else if (img.startsWith('iVBORw')) {
      normalized.push(`data:image/png;base64,${img}`);
    } else if (img.startsWith('R0lGOD')) {
      normalized.push(`data:image/gif;base64,${img}`);
    } else if (img.startsWith('UklGR')) {
      normalized.push(`data:image/webp;base64,${img}`);
    } else {
      normalized.push(`data:image/png;base64,${img}`);
    }
  }

  return normalized;
};

// ============================================
// 图片生成 - Gemini generateContent 格式
// ============================================

export interface GeminiImageParams {
  apiBase: string;
  apiKey: string;
  endpoint: string;
  modelId: string;
  prompt: string;
  referenceImages: string[];  // 可以是 base64 data URL 或 HTTP URL
  aspectRatio: string;
}

export const generateGeminiImage = async (params: GeminiImageParams): Promise<string> => {
  const { apiBase, apiKey, endpoint, prompt, referenceImages, aspectRatio } = params;

  // 归一化参考图：将 HTTP URL 下载为 base64，确保 Gemini API 可以使用
  const normalizedImages = await normalizeReferenceImages(referenceImages);
  console.log(`  🖼️ [aiProxy] Gemini 图片生成: ${normalizedImages.length}/${referenceImages.length} 张参考图可用`);

  const parts: any[] = [{ text: prompt }];
  for (const img of normalizedImages) {
    const match = img.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (match) {
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }
  }

  const requestBody: any = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };
  if (aspectRatio !== '16:9') {
    requestBody.generationConfig.imageConfig = { aspectRatio };
  }

  const response = await retryOp(async () => {
    const res = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': '*/*',
      },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) {
      const errMsg = await parseError(res);
      const err: any = new Error(errMsg);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  });

  const candidates = (response as any).candidates || [];
  if (candidates.length > 0 && candidates[0].content?.parts) {
    for (const part of candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  }

  throw new Error('图片生成失败 (No image data returned)');
};

// ============================================
// 图片生成 - OpenAI / 火山引擎 images/generations 格式
// ============================================

export interface OpenAIImageParams {
  apiBase: string;
  apiKey: string;
  endpoint: string;
  modelId: string;
  prompt: string;
  referenceImages: string[];
  aspectRatio: string;
}

/**
 * 图片生成结果：包含 base64 数据和可选的原始 URL
 * 当 API 返回 URL 时（如 Seedream），同时保存 URL 以便后续作为参考图传给同类 API
 */
export interface ImageGenerationResult {
  base64: string;       // data:image/...;base64,... 用于显示和持久化存储
  originalUrl?: string; // API 返回的原始 URL（如 TOS 签名 URL），用于传给仅接受 URL 的 API
}

export const generateOpenAIImage = async (params: OpenAIImageParams): Promise<ImageGenerationResult> => {
  const { apiBase, apiKey, endpoint, modelId, prompt, referenceImages } = params;

  const requestBody: Record<string, any> = {
    model: modelId,
    prompt,
    size: '2K',
    response_format: 'url',
    sequential_image_generation: 'disabled',
    stream: false,
    watermark: false,
  };

  // Seedream API 的 image 参数同时支持 URL 和 base64 data URI
  // 格式: data:image/<format>;base64,<data>（format 必须小写，如 png、jpeg）
  const validImages: string[] = [];
  let skippedCount = 0;
  for (const img of referenceImages) {
    if (!img || img.length === 0) continue;
    if (/^https?:\/\//i.test(img)) {
      validImages.push(img);
    } else if (/^data:image\/[a-z]+;base64,/i.test(img)) {
      validImages.push(img);
    } else {
      skippedCount++;
      console.warn(`  ⚠️ [aiProxy] OpenAI-image: 跳过不支持的参考图格式 (${img.substring(0, 40)}...)`);
    }
  }
  if (validImages.length > 0) {
    requestBody.image = validImages;
    const urlCount = validImages.filter(i => /^https?:\/\//i.test(i)).length;
    const b64Count = validImages.length - urlCount;
    console.log(`  🖼️ [aiProxy] OpenAI-image: 使用 ${validImages.length} 张参考图 (${urlCount} URL + ${b64Count} base64)`);
  } else if (referenceImages.length > 0) {
    console.warn(`  ⚠️ [aiProxy] OpenAI-image: 没有可用的参考图（共 ${referenceImages.length} 张均不支持）`);
  }

  const response = await retryOp(async () => {
    const res = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.replace(/^Bearer\s+/i, '')}`.startsWith('Bearer ')
          ? `Bearer ${apiKey.replace(/^Bearer\s+/i, '')}`
          : `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) {
      const errMsg = await parseError(res);
      const err: any = new Error(errMsg);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  });

  const items = (response as any)?.data;
  if (Array.isArray(items) && items.length > 0) {
    if (items[0].b64_json) {
      return { base64: `data:image/png;base64,${items[0].b64_json}` };
    }
    if (items[0].url) {
      const originalUrl = items[0].url;
      const base64 = await downloadAsBase64(originalUrl, 'image/png');
      console.log(`  🔗 [aiProxy] OpenAI-image: 已保存原始 URL (${originalUrl.substring(0, 60)}...)`);
      return { base64, originalUrl };
    }
  }

  throw new Error('图片生成失败：未能从响应中提取图片数据');
};

// ============================================
// 文本生成 - Chat Completion
// ============================================

export interface ChatCompletionParams {
  apiBase: string;
  apiKey: string;
  endpoint: string;
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json_object';
}

export const serverChatCompletion = async (params: ChatCompletionParams): Promise<string> => {
  const { apiBase, apiKey, endpoint, model, prompt, temperature = 0.7, responseFormat } = params;

  const requestBody: any = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature,
  };
  if (responseFormat === 'json_object') {
    requestBody.response_format = { type: 'json_object' };
  }

  const response = await retryOp(async () => {
    const res = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(600000),
    });
    if (!res.ok) {
      const errMsg = await parseError(res);
      const err: any = new Error(errMsg);
      err.status = res.status;
      throw err;
    }
    return res;
  });

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || '';
};

// ============================================
// 工具函数
// ============================================

/**
 * 将 base64 data URL 转为 Blob（Node.js 环境）
 */
function base64ToBlob(dataUrl: string): Blob {
  let base64: string;
  let mimeType = 'image/png';

  if (dataUrl.startsWith('data:')) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      base64 = match[2];
    } else {
      base64 = dataUrl.replace(/^data:[^,]+,/, '');
    }
  } else {
    base64 = dataUrl;
  }

  const buffer = Buffer.from(base64!, 'base64');
  return new Blob([buffer], { type: mimeType });
}
