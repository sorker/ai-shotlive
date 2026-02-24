/**
 * AI 辅助 API（字幕优化、TTS 等）
 */

import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

/**
 * POST /api/ai/tts - 文本转语音
 * Body: { text: string }
 * 需要配置音频模型，当前为占位实现
 */
router.post('/tts', async (req: AuthRequest, res: Response) => {
  try {
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: '缺少 text 参数' });
      return;
    }
    // TODO: 集成 TTS API（OpenAI / 豆包 / 通义等）
    // 当前返回提示，引导用户配置
    res.status(501).json({
      error: 'AI 音频生成功能开发中，请先在模型配置中配置音频生成模型',
    });
  } catch (err: any) {
    console.error('TTS failed:', err.message);
    res.status(500).json({ error: err.message || 'TTS 失败' });
  }
});

export default router;
