/**
 * CutOS AI Agent API - 支持 dashscope、豆包等 OpenAI 兼容接口
 */
import { Router, Request, Response } from 'express';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { Readable } from 'stream';
import { videoEditingTools } from '../lib/cutos/agent/tools.js';
import { buildSystemPrompt, type TimelineState } from '../lib/cutos/agent/system-prompt.js';

const router = Router();

// 从 UIMessage parts 提取文本
function getTextFromParts(parts: Array<{ type: string; text?: string }> | undefined): string {
  if (!parts) return '';
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

export interface CutOSAgentModelConfig {
  apiBase: string;
  apiKey: string;
  endpoint?: string;
  model: string;
}

/**
 * POST /api/cutos/agent
 * Body: { messages: UIMessage[], timelineState: TimelineState, modelConfig: CutOSAgentModelConfig }
 */
router.post('/agent', async (req: Request, res: Response) => {
  try {
    const { messages, timelineState, modelConfig } = req.body as {
      messages?: Array<{ role: string; parts?: Array<{ type: string; text?: string }>; content?: string }>;
      timelineState?: TimelineState;
      modelConfig?: CutOSAgentModelConfig;
    };

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: '缺少 messages 参数' });
      return;
    }

    if (!modelConfig?.apiKey || !modelConfig?.model) {
      res.status(400).json({ error: '缺少 modelConfig（apiKey、model）' });
      return;
    }

    const apiBase = (modelConfig.apiBase || 'https://api.openai.com').replace(/\/+$/, '');
    const endpoint = modelConfig.endpoint || '/v1/chat/completions';
    // createOpenAI baseURL = apiBase + path before /chat/completions
    const baseURL = endpoint.includes('/chat/completions')
      ? `${apiBase}${endpoint.replace(/\/chat\/completions$/, '')}`
      : `${apiBase}${endpoint.replace(/\/+$/, '')}`;

    const openai = createOpenAI({
      baseURL,
      apiKey: modelConfig.apiKey,
    });

    const systemPrompt = buildSystemPrompt(timelineState || {
      clips: [],
      media: [],
      currentTimeSeconds: 0,
      selectedClipId: null,
    });

    const formattedMessages = messages
      .map((msg) => {
        let content = '';
        if (msg.parts && Array.isArray(msg.parts)) {
          content = getTextFromParts(msg.parts);
        } else if (typeof (msg as { content?: string }).content === 'string') {
          content = (msg as { content: string }).content;
        }
        return { role: msg.role as 'user' | 'assistant', content };
      })
      .filter((m) => m.content.trim() !== '');

    if (formattedMessages.length === 0) {
      res.status(400).json({ error: '没有有效的消息内容' });
      return;
    }

    const result = streamText({
      model: openai(modelConfig.model),
      system: systemPrompt,
      messages: formattedMessages,
      tools: videoEditingTools,
      toolChoice: 'auto',
    });

    const response = await result.toUIMessageStreamResponse();
    const headers = Object.fromEntries(response.headers.entries());
    ['content-type', 'cache-control', 'x-vercel-ai-data-stream'].forEach((k) => {
      if (headers[k]) res.setHeader(k, headers[k]);
    });
    res.setHeader('Transfer-Encoding', 'chunked');

    const webStream = response.body;
    if (!webStream) {
      res.status(500).json({ error: 'Stream body is null' });
      return;
    }

    const nodeStream = Readable.fromWeb(webStream as any);
    nodeStream.pipe(res);
  } catch (err: any) {
    console.error('[CutOS Agent] Error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Agent 请求失败' });
  }
});

/**
 * POST /api/cutos/transcribe
 * 语音转字幕 - 使用 qwen3-livetranslate-flash（通义音视频翻译）
 * Body: { audioDataUrl: string, apiKey: string, targetLang?: string }
 * - audioDataUrl: data:audio/webm;base64,... 或 data:audio/wav;base64,...
 * - apiKey: DashScope API Key（来自 qwen 提供商）
 * - targetLang: 目标语言，如 zh/en，默认 zh
 */
router.post('/transcribe', async (req: Request, res: Response) => {
  try {
    const { audioDataUrl, apiKey, targetLang = 'zh' } = req.body as {
      audioDataUrl?: string;
      apiKey?: string;
      targetLang?: string;
    };

    if (!audioDataUrl || !apiKey) {
      res.status(400).json({ error: '缺少 audioDataUrl 或 apiKey' });
      return;
    }

    const formatMatch = audioDataUrl.match(/^data:audio\/(\w+);base64,/);
    const format = formatMatch ? formatMatch[1] : 'webm';

    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'qwen3-livetranslate-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: audioDataUrl,
                  format,
                },
              },
            ],
          },
        ],
        modalities: ['text'],
        stream: true,
        stream_options: { include_usage: true },
        translation_options: {
          target_lang: targetLang,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let errMsg = `语音识别失败: HTTP ${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.error?.message || errJson.message || errMsg;
      } catch {
        if (errText) errMsg = errText.slice(0, 200);
      }
      res.status(response.status).json({ error: errMsg });
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      res.status(500).json({ error: '无法读取响应流' });
      return;
    }

    const decoder = new TextDecoder();
    let text = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]');
      for (const line of lines) {
        try {
          const json = JSON.parse(line.slice(6));
          const content = json.choices?.[0]?.delta?.content;
          if (typeof content === 'string') text += content;
        } catch {
          /* ignore parse errors */
        }
      }
    }

    res.json({ text: text.trim() });
  } catch (err: any) {
    console.error('[CutOS Transcribe] Error:', err?.message || err);
    res.status(500).json({ error: err?.message || '语音识别失败' });
  }
});

/**
 * POST /api/cutos/captions
 * 视频/音频字幕生成 - 对应 CutOS /api/transcribe
 * Body: { mediaId: string, storageUrl: string, apiKey?: string, language?: string }
 * - 使用 DashScope paraformer 或 qwen-audio 生成带时间戳的字幕
 * - apiKey 可选，不传则需服务端配置
 */
router.post('/captions', async (req: Request, res: Response) => {
  try {
    const { mediaId, storageUrl, apiKey, language } = req.body as {
      mediaId?: string;
      storageUrl?: string;
      apiKey?: string;
      language?: string;
    };

    if (!mediaId || !storageUrl) {
      res.status(400).json({ error: '缺少 mediaId 或 storageUrl' });
      return;
    }

    const key = apiKey || process.env.DASHSCOPE_API_KEY;
    if (!key) {
      res.status(400).json({ error: '缺少 apiKey，请在请求体传入或配置 DASHSCOPE_API_KEY' });
      return;
    }

    const mediaRes = await fetch(storageUrl);
    if (!mediaRes.ok) {
      res.status(400).json({ error: '无法获取媒体文件' });
      return;
    }

    const blob = await mediaRes.blob();
    const buf = Buffer.from(await blob.arrayBuffer());
    const base64 = buf.toString('base64');
    const contentType = mediaRes.headers.get('content-type') || '';
    const format = contentType.includes('webm') ? 'webm' : contentType.includes('mp3') ? 'mp3' : 'mp4';

    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'qwen3-livetranslate-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: { data: `data:audio/${format};base64,${base64}`, format },
              },
            ],
          },
        ],
        modalities: ['text'],
        stream: false,
        translation_options: { target_lang: language || 'zh' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(response.status).json({ error: errText?.slice(0, 200) || '字幕生成失败' });
      return;
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    const duration = 0;
    const captions = text
      ? [{ word: text, start: 0, end: duration || 10 }]
      : [];

    res.json({ mediaId, captions, fullText: text, duration, language: language || 'zh' });
  } catch (err: any) {
    console.error('[CutOS Captions] Error:', err?.message || err);
    res.status(500).json({ error: err?.message || '字幕生成失败' });
  }
});

export default router;
