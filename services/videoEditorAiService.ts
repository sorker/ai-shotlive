/**
 * 视频剪辑器 AI 服务
 * AI 字幕、AI 音频生成，使用模型配置中的模型
 */

import { chatCompletion } from './ai/apiCore';
import { getActiveChatModel } from './modelRegistry';
import { ApiKeyError } from './ai/apiCore';

/**
 * AI 生成/优化字幕文本
 * 使用对话模型整理文本为适合字幕的格式
 */
export async function generateSubtitleText(text: string): Promise<string> {
  const model = getActiveChatModel();
  if (!model) {
    throw new Error('请先在模型配置中配置对话模型');
  }
  const result = await chatCompletion(
    `将以下文本整理为适合作为视频字幕的格式。要求：保持原意，简洁通顺，每句不宜过长。直接返回整理后的文本，不要其他解释或标号。\n\n原文：\n${text}`,
    model.id,
    0.5,
    500,
    'text'
  );
  return result?.trim() || text;
}

/**
 * AI 生成音频（TTS）
 * 当前通过后端 API 实现，需配置音频模型
 */
export async function generateAudioFromText(
  text: string
): Promise<{ url: string; duration: number } | null> {
  const { apiPost } = await import('./apiClient');
  const res = await apiPost<{ url?: string; duration?: number; error?: string }>(
    '/api/ai/tts',
    { text }
  );
  if (res?.url) {
    return { url: res.url, duration: res.duration ?? 5000 };
  }
  if (res?.error) {
    throw new Error(res.error);
  }
  return null;
}
