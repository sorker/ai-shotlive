/**
 * 图片模型适配器
 * 支持 Gemini generateContent 和 OpenAI/火山引擎 images/generations 两种协议
 */

import { ImageModelDefinition, ImageGenerateOptions, AspectRatio, ImageApiFormat } from '../../types/model';
import { getApiKeyForModel, getApiBaseUrlForModel, getActiveImageModel } from '../modelRegistry';
import { ApiKeyError } from './chatAdapter';

/**
 * 重试操作
 */
const retryOperation = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 2000
): Promise<T> => {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      if (error.message?.includes('400') || 
          error.message?.includes('401') || 
          error.message?.includes('403')) {
        throw error;
      }
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }
  
  throw lastError;
};

/**
 * 确保参考图为带 data:image/... 前缀的完整 data URL 数组
 */
const ensureDataUrlArray = (images: string[]): string[] => {
  return images
    .filter(img => img && img.length > 0)
    .map(img => {
      if (img.startsWith('data:image/')) return img;
      if (img.startsWith('/9j/')) return `data:image/jpeg;base64,${img}`;
      if (img.startsWith('iVBORw')) return `data:image/png;base64,${img}`;
      if (img.startsWith('R0lGOD')) return `data:image/gif;base64,${img}`;
      if (img.startsWith('UklGR')) return `data:image/webp;base64,${img}`;
      return `data:image/png;base64,${img}`;
    });
};

/**
 * 清理 API Key，避免 "Bearer Bearer xxx" 的双重前缀问题
 */
const sanitizeBearerToken = (apiKey: string): string => {
  return 'Bearer ' + apiKey.replace(/Bearer\s+/gi, '').trim();
};

/**
 * 通用 HTTP 错误处理
 */
const handleHttpError = async (res: Response): Promise<never> => {
  if (res.status === 400) {
    throw new Error('提示词可能包含不安全或违规内容，未能处理。请修改后重试。');
  }
  if (res.status === 500) {
    throw new Error('当前请求较多，暂时未能处理成功，请稍后重试。');
  }
  let errorMessage = `HTTP 错误: ${res.status}`;
  try {
    const errorData = await res.json();
    errorMessage = errorData.error?.message || errorMessage;
  } catch (e) {
    try {
      const errorText = await res.text();
      if (errorText) errorMessage = errorText;
    } catch { /* ignore */ }
  }
  throw new Error(errorMessage);
};

/**
 * OpenAI / 火山引擎兼容的 /images/generations 格式
 */
const callOpenAIImageApi = async (
  options: ImageGenerateOptions,
  activeModel: ImageModelDefinition,
  apiKey: string,
  apiBase: string
): Promise<string> => {
  const apiModel = activeModel.apiModel || activeModel.id;
  const endpoint = activeModel.endpoint || '/api/v3/images/generations';

  const requestBody: Record<string, any> = {
    model: apiModel,
    prompt: options.prompt,
    size: '2K',
    response_format: 'url',
    sequential_image_generation: 'disabled',
    stream: false,
    watermark: false,
  };

  if (options.referenceImages && options.referenceImages.length > 0) {
    requestBody.image = ensureDataUrlArray(options.referenceImages);
  }

  const response = await retryOperation(async () => {
    const res = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': sanitizeBearerToken(apiKey),
      },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) await handleHttpError(res);
    return await res.json();
  });

  const items = response?.data;
  if (Array.isArray(items) && items.length > 0) {
    if (items[0].b64_json) {
      return `data:image/png;base64,${items[0].b64_json}`;
    }
    if (items[0].url) {
      try {
        const imgRes = await fetch(items[0].url);
        if (imgRes.ok) {
          const blob = await imgRes.blob();
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('图片转码失败'));
            reader.readAsDataURL(blob);
          });
        }
      } catch (e) {
        console.warn('URL 图片转 base64 失败，直接使用 URL:', e);
      }
      return items[0].url;
    }
  }

  throw new Error('图片生成失败：未能从响应中提取图片数据');
};

/**
 * Gemini generateContent 格式
 */
const callGeminiImageApi = async (
  options: ImageGenerateOptions,
  activeModel: ImageModelDefinition,
  apiKey: string,
  apiBase: string
): Promise<string> => {
  const apiModel = activeModel.apiModel || activeModel.id;
  const endpoint = activeModel.endpoint || `/v1beta/models/${apiModel}:generateContent`;
  const aspectRatio = options.aspectRatio || activeModel.params.defaultAspectRatio;

  let finalPrompt = options.prompt;

  if (options.referenceImages && options.referenceImages.length > 0) {
    finalPrompt = `
      ⚠️⚠️⚠️ CRITICAL REQUIREMENTS - CHARACTER CONSISTENCY ⚠️⚠️⚠️
      
      Reference Images Information:
      - The FIRST image is the Scene/Environment reference.
      - Any subsequent images are Character references (Base Look or Variation).
      
      Task:
      Generate a cinematic shot matching this prompt: "${options.prompt}".
      
      ⚠️ ABSOLUTE REQUIREMENTS (NON-NEGOTIABLE):
      1. Scene Consistency:
         - STRICTLY maintain the visual style, lighting, and environment from the scene reference.
      
      2. Character Consistency - HIGHEST PRIORITY:
         If characters are present in the prompt, they MUST be IDENTICAL to the character reference images:
         • Facial Features: Eyes (color, shape, size), nose structure, mouth shape, facial contours must be EXACTLY the same
         • Hairstyle & Hair Color: Length, color, texture, and style must be PERFECTLY matched
         • Clothing & Outfit: Style, color, material, and accessories must be IDENTICAL
         • Body Type: Height, build, proportions must remain consistent
         
      ⚠️ DO NOT create variations or interpretations of the character - STRICT REPLICATION ONLY!
      ⚠️ Character appearance consistency is THE MOST IMPORTANT requirement!
    `;
  }

  const parts: any[] = [{ text: finalPrompt }];
  if (options.referenceImages) {
    options.referenceImages.forEach((imgUrl) => {
      const match = imgUrl.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
      if (match) {
        parts.push({
          inlineData: { mimeType: match[1], data: match[2] },
        });
      }
    });
  }

  const requestBody: any = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };

  if (aspectRatio !== '16:9') {
    requestBody.generationConfig.imageConfig = { aspectRatio };
  }

  const response = await retryOperation(async () => {
    const res = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': '*/*',
      },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) await handleHttpError(res);
    return await res.json();
  });

  const candidates = response.candidates || [];
  if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
    for (const part of candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  }

  throw new Error('图片生成失败：未能从响应中提取图片数据');
};

/**
 * 将 AspectRatio 映射到 DashScope Qwen-Image 支持的分辨率
 */
const mapAspectRatioToDashScopeSize = (aspectRatio: AspectRatio): string => {
  switch (aspectRatio) {
    case '16:9': return '1664*928';
    case '9:16': return '928*1664';
    case '1:1':  return '1328*1328';
    default:     return '1664*928';
  }
};

/**
 * DashScope (阿里百炼) 通义万相图片生成
 * 使用 DashScope 原生 API 格式，通过本地代理 /api/proxy/dashscope 转发
 */
const DASHSCOPE_PROXY = '/api/proxy/dashscope';

const callDashScopeImageApi = async (
  options: ImageGenerateOptions,
  activeModel: ImageModelDefinition,
  apiKey: string,
): Promise<string> => {
  const apiModel = activeModel.apiModel || activeModel.id;
  const endpoint = activeModel.endpoint || '/api/v1/services/aigc/text2image/image-synthesis';
  const aspectRatio = options.aspectRatio || activeModel.params.defaultAspectRatio;

  const requestBody: Record<string, any> = {
    model: apiModel,
    input: {
      prompt: options.prompt,
    },
    parameters: {
      size: mapAspectRatioToDashScopeSize(aspectRatio),
      n: 1,
      prompt_extend: true,
      watermark: false,
    },
  };

  if (options.referenceImages && options.referenceImages.length > 0) {
    requestBody.input.ref_img = ensureDataUrlArray(options.referenceImages)[0];
  }

  const response = await retryOperation(async () => {
    const res = await fetch(`${DASHSCOPE_PROXY}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': sanitizeBearerToken(apiKey),
      },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) await handleHttpError(res);
    return await res.json();
  });

  // DashScope 同步响应格式: { output: { results: [{ url: "..." }] } }
  const results = response?.output?.results;
  if (Array.isArray(results) && results.length > 0 && results[0].url) {
    try {
      const imgRes = await fetch(results[0].url);
      if (imgRes.ok) {
        const blob = await imgRes.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('图片转码失败'));
          reader.readAsDataURL(blob);
        });
      }
    } catch (e) {
      console.warn('DashScope URL 图片转 base64 失败，直接使用 URL:', e);
    }
    return results[0].url;
  }

  // 兼容异步响应: 如果返回 task_id，需轮询
  const taskId = response?.output?.task_id;
  if (taskId) {
    return await pollDashScopeImageTask(taskId, apiKey);
  }

  throw new Error('图片生成失败：未能从 DashScope 响应中提取图片数据');
};

/**
 * 轮询 DashScope 异步图片任务
 */
const pollDashScopeImageTask = async (taskId: string, apiKey: string): Promise<string> => {
  const maxAttempts = 60;
  const pollInterval = 3000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    const res = await fetch(`${DASHSCOPE_PROXY}/api/v1/tasks/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': sanitizeBearerToken(apiKey),
      },
    });

    if (!res.ok) await handleHttpError(res);
    const data = await res.json();

    if (data.output?.task_status === 'SUCCEEDED') {
      const results = data.output?.results;
      if (Array.isArray(results) && results.length > 0 && results[0].url) {
        try {
          const imgRes = await fetch(results[0].url);
          if (imgRes.ok) {
            const blob = await imgRes.blob();
            return await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = () => reject(new Error('图片转码失败'));
              reader.readAsDataURL(blob);
            });
          }
        } catch (e) {
          console.warn('DashScope URL 图片转 base64 失败，直接使用 URL:', e);
        }
        return results[0].url;
      }
      throw new Error('图片生成成功但未返回图片 URL');
    }

    if (data.output?.task_status === 'FAILED') {
      throw new Error(`图片生成失败: ${data.output?.message || '未知错误'}`);
    }
  }

  throw new Error('图片生成超时，请稍后重试');
};

/**
 * 调用图片生成 API（自动根据模型 apiFormat 分派协议）
 */
export const callImageApi = async (
  options: ImageGenerateOptions,
  model?: ImageModelDefinition
): Promise<string> => {
  const activeModel = model || getActiveImageModel();
  if (!activeModel) {
    throw new Error('没有可用的图片模型');
  }

  const apiKey = getApiKeyForModel(activeModel.id);
  if (!apiKey) {
    throw new ApiKeyError('API Key 缺失，请在设置中配置 API Key');
  }

  const apiBase = getApiBaseUrlForModel(activeModel.id);
  const apiFormat: ImageApiFormat = activeModel.params.apiFormat || 'gemini';

  if (apiFormat === 'dashscope-image') {
    return callDashScopeImageApi(options, activeModel, apiKey);
  }
  if (apiFormat === 'openai-image') {
    return callOpenAIImageApi(options, activeModel, apiKey, apiBase);
  }
  return callGeminiImageApi(options, activeModel, apiKey, apiBase);
};

/**
 * 检查宽高比是否支持
 */
export const isAspectRatioSupported = (
  aspectRatio: AspectRatio,
  model?: ImageModelDefinition
): boolean => {
  const activeModel = model || getActiveImageModel();
  if (!activeModel) return false;
  
  return activeModel.params.supportedAspectRatios.includes(aspectRatio);
};
