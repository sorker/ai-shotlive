import { Router, Response } from 'express';
import { getPool } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

const router = Router();

router.use(authMiddleware);

interface VisualStyleRow extends RowDataPacket {
  id: number;
  user_id: number;
  value: string;
  label: string;
  desc: string;
  prompt: string | null;
  prompt_cn: string | null;
  negative_prompt: string | null;
  scene_negative_prompt: string | null;
  sort_order: number;
  is_default: number;
}

const DEFAULT_STYLES = [
  {
    value: 'anime', label: '🌟 日式动漫', desc: '日本动漫风格，线条感强', sort_order: 0,
    prompt: 'Japanese anime style, cel-shaded, vibrant saturated colors, large expressive eyes with detailed iris highlights, dynamic action poses, clean sharp outlines, consistent line weight throughout, Studio Ghibli/Makoto Shinkai quality, painted sky backgrounds, soft ambient lighting with dramatic rim light',
    prompt_cn: '日本动漫风格，cel-shaded，鲜艳色彩，Studio Ghibli品质',
    negative_prompt: 'photorealistic, 3d render, western cartoon, ugly, bad anatomy, extra limbs, deformed limbs, blurry, watermark, text, logo, poorly drawn face, mutated hands, extra fingers, missing fingers, bad proportions, grotesque',
    scene_negative_prompt: 'person, people, human, character, figure, silhouette, crowd, portrait, face, body, hands, photorealistic, 3d render, western cartoon, ugly, bad anatomy, extra limbs, deformed limbs, blurry, watermark, text, logo, poorly drawn face, mutated hands, extra fingers, missing fingers, bad proportions, grotesque',
  },
  {
    value: '2d-animation', label: '🎨 2D动画', desc: '经典卓别林/迪士尼风格', sort_order: 1,
    prompt: 'classic 2D animation, hand-drawn style, Disney/Pixar quality, smooth clean lines with consistent weight, expressive characters with squash-and-stretch principles, painterly watercolor backgrounds, soft gradient shading, warm color palette, round friendly character proportions',
    prompt_cn: '经典2D动画风格，手绘风格，Disney/Pixar品质',
    negative_prompt: 'photorealistic, 3d, low quality, pixelated, blurry, watermark, text, bad anatomy, deformed, ugly, amateur drawing, inconsistent style, rough sketch',
    scene_negative_prompt: 'person, people, human, character, figure, silhouette, crowd, portrait, face, body, photorealistic, 3d, low quality, pixelated, blurry, watermark, text, bad anatomy, deformed, ugly, amateur drawing, inconsistent style, rough sketch',
  },
  {
    value: '3d-animation', label: '👾 3D动画', desc: '皮克斯/梦工厂风格', sort_order: 2,
    prompt: 'high-quality 3D CGI animation, Pixar/DreamWorks style, subsurface scattering on skin, detailed PBR textures, stylized character proportions, volumetric lighting, ambient occlusion, soft shadows, physically-based rendering, motion blur',
    prompt_cn: '3D CGI动画，Pixar/DreamWorks风格，精细材质',
    negative_prompt: 'photorealistic, 2d, flat, hand-drawn, low poly, bad topology, texture artifacts, z-fighting, clipping, low quality, blurry, watermark, text, bad rigging, unnatural movement',
    scene_negative_prompt: 'person, people, human, character, figure, silhouette, crowd, portrait, face, body, photorealistic, 2d, flat, hand-drawn, low poly, bad topology, texture artifacts, z-fighting, clipping, low quality, blurry, watermark, text, bad rigging, unnatural movement',
  },
  {
    value: 'cyberpunk', label: '🌌 赛博朋克', desc: '高科技赛博朋克风', sort_order: 3,
    prompt: 'cyberpunk aesthetic, neon-lit urban environment, rain-soaked reflective streets, holographic UI displays, high-tech low-life contrast, Blade Runner style, volumetric fog with neon color bleeding, chromatic aberration, cool blue-purple palette with hot pink and cyan accents, gritty detailed textures',
    prompt_cn: '赛博朋克美学，霓虹灯光，未来科技感',
    negative_prompt: 'bright daylight, pastoral, medieval, fantasy, cartoon, low tech, rural, natural, watermark, text, logo, low quality, blurry, amateur',
    scene_negative_prompt: 'person, people, human, figure, silhouette, crowd, pedestrian, portrait, face, body, bright daylight, pastoral, medieval, fantasy, cartoon, low tech, rural, natural, watermark, text, logo, low quality, blurry, amateur',
  },
  {
    value: 'chinese-ancient-fantasy', label: '🏯 中国古代奇幻', desc: '中国古代奇幻2D动漫风格', sort_order: 4,
    prompt: 'Chinese ancient fantasy 2D anime style, xianxia wuxia aesthetic, traditional Chinese ink wash influence with vibrant anime coloring, flowing silk robes and ancient Chinese armor, mystical qi energy effects with glowing auras, celestial palace and mountain temple backgrounds, cloud sea and floating peaks, traditional Chinese architectural details with curved eaves and red pillars, delicate character features with expressive anime eyes, elegant flowing hair and ribbon accessories, soft cel-shading with ink brush outlines, muted jade green and gold palette with crimson accents, ethereal atmospheric fog, dynamic martial arts poses, sacred beast motifs like dragons and phoenixes',
    prompt_cn: '中国古代奇幻2D动漫风格，仙侠武侠美学，水墨画韵味融合动漫色彩，飘逸丝绸古装',
    negative_prompt: 'photorealistic, 3d render, western cartoon, modern clothing, contemporary architecture, sci-fi elements, mechanical parts, low quality, blurry, watermark, text, logo, bad anatomy, extra limbs, deformed, ugly, poorly drawn, amateur, pixel art, chibi style',
    scene_negative_prompt: 'person, people, human, character, figure, silhouette, crowd, portrait, face, body, photorealistic, 3d render, western cartoon, modern clothing, contemporary architecture, sci-fi elements, mechanical parts, low quality, blurry, watermark, text, logo, bad anatomy, extra limbs, deformed, ugly, poorly drawn, amateur, pixel art, chibi style',
  },
  {
    value: 'oil-painting', label: '🖼️ 油画风格', desc: '油画质感艺术风', sort_order: 5,
    prompt: 'oil painting style, visible impasto brushstrokes, rich layered textures, classical art composition with golden ratio, museum quality fine art, warm undertones, Rembrandt lighting, chiaroscuro contrast, canvas texture visible, glazing technique color depth',
    prompt_cn: '油画风格，可见笔触，古典艺术构图',
    negative_prompt: 'digital art, photorealistic, 3d render, cartoon, anime, low quality, blurry, watermark, text, amateur, poorly painted, muddy colors, overworked canvas',
    scene_negative_prompt: 'person, people, human, figure, silhouette, crowd, portrait, face, body, digital art, photorealistic, 3d render, cartoon, anime, low quality, blurry, watermark, text, amateur, poorly painted, muddy colors, overworked canvas',
  },
  {
    value: 'live-action', label: '🎬 真人影视', desc: '超写实电影/电视剧风格', sort_order: 6,
    prompt: 'photorealistic, cinematic film quality, real human actors, professional cinematography, natural lighting, 8K resolution, shallow depth of field, film grain texture, color graded, anamorphic lens flare, three-point lighting setup',
    prompt_cn: '真人实拍电影风格，photorealistic，8K高清，专业摄影',
    negative_prompt: 'cartoon, anime, illustration, painting, drawing, 3d render, cgi, low quality, blurry, grainy, watermark, text, logo, signature, distorted face, bad anatomy, extra limbs, mutated hands, deformed, ugly, disfigured, poorly drawn, amateur',
    scene_negative_prompt: 'person, people, human, man, woman, child, figure, silhouette, crowd, pedestrian, portrait, face, body, hands, feet, cartoon, anime, illustration, painting, drawing, 3d render, cgi, low quality, blurry, grainy, watermark, text, logo, signature, distorted face, bad anatomy, extra limbs, mutated hands, deformed, ugly, disfigured, poorly drawn, amateur',
  },
];

/**
 * 为用户播种默认视觉风格（如果该用户还没有任何风格记录）
 */
const seedDefaultStyles = async (userId: number): Promise<void> => {
  const [existing] = await getPool().execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS cnt FROM visual_styles WHERE user_id = ?',
    [userId]
  );
  if (existing[0]?.cnt > 0) return;

  const sql = `INSERT INTO visual_styles (user_id, value, label, \`desc\`, prompt, prompt_cn, negative_prompt, scene_negative_prompt, sort_order, is_default)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`;
  for (const s of DEFAULT_STYLES) {
    await getPool().execute(sql, [
      userId, s.value, s.label, s.desc, s.prompt, s.prompt_cn,
      s.negative_prompt, s.scene_negative_prompt, s.sort_order,
    ]);
  }
  console.log(`🎨 [VisualStyles] 已为用户 ${userId} 播种 ${DEFAULT_STYLES.length} 个默认视觉风格`);
};

/**
 * GET /api/visual-styles - 获取当前用户所有视觉风格
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    await seedDefaultStyles(req.userId!);

    const [rows] = await getPool().execute<VisualStyleRow[]>(
      'SELECT * FROM visual_styles WHERE user_id = ? ORDER BY sort_order ASC, id ASC',
      [req.userId]
    );

    const styles = rows.map(r => ({
      id: r.id,
      value: r.value,
      label: r.label,
      desc: r.desc,
      prompt: r.prompt || '',
      promptCn: r.prompt_cn || '',
      negativePrompt: r.negative_prompt || '',
      sceneNegativePrompt: r.scene_negative_prompt || '',
      sortOrder: r.sort_order,
      isDefault: r.is_default === 1,
    }));

    res.json(styles);
  } catch (err) {
    console.error('❌ [VisualStyles] 获取视觉风格失败:', err);
    res.status(500).json({ error: '获取视觉风格失败' });
  }
});

/**
 * POST /api/visual-styles - 创建新视觉风格
 */
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { value, label, desc, prompt, promptCn, negativePrompt, sceneNegativePrompt, sortOrder } = req.body;

    if (!value || !label) {
      res.status(400).json({ error: '风格键值(value)和标签(label)为必填项' });
      return;
    }

    const [result] = await getPool().execute<ResultSetHeader>(
      `INSERT INTO visual_styles (user_id, value, label, \`desc\`, prompt, prompt_cn, negative_prompt, scene_negative_prompt, sort_order, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [req.userId, value, label, desc || '', prompt || '', promptCn || '', negativePrompt || '', sceneNegativePrompt || '', sortOrder ?? 99]
    );

    console.log(`🎨 [VisualStyles] 创建视觉风格: ${value} (${label}), id=${result.insertId}`);
    res.json({ success: true, id: result.insertId });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: '该风格键值已存在，请使用不同的键值' });
      return;
    }
    console.error('❌ [VisualStyles] 创建视觉风格失败:', err);
    res.status(500).json({ error: '创建视觉风格失败' });
  }
});

/**
 * PATCH /api/visual-styles/:id - 更新视觉风格
 */
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const styleId = parseInt(String(req.params.id), 10);
    const fields: string[] = [];
    const values: any[] = [];

    const allowedFields: Record<string, string> = {
      value: 'value',
      label: 'label',
      desc: '`desc`',
      prompt: 'prompt',
      promptCn: 'prompt_cn',
      negativePrompt: 'negative_prompt',
      sceneNegativePrompt: 'scene_negative_prompt',
      sortOrder: 'sort_order',
    };

    for (const [key, col] of Object.entries(allowedFields)) {
      if (req.body[key] !== undefined) {
        fields.push(`${col} = ?`);
        values.push(req.body[key]);
      }
    }

    if (fields.length === 0) {
      res.status(400).json({ error: '没有需要更新的字段' });
      return;
    }

    values.push(styleId, req.userId);

    const [result] = await getPool().execute<ResultSetHeader>(
      `UPDATE visual_styles SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ error: '视觉风格不存在' });
      return;
    }

    console.log(`🎨 [VisualStyles] 更新视觉风格 id=${styleId}`);
    res.json({ success: true });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: '该风格键值已存在' });
      return;
    }
    console.error('❌ [VisualStyles] 更新视觉风格失败:', err);
    res.status(500).json({ error: '更新视觉风格失败' });
  }
});

/**
 * DELETE /api/visual-styles/:id - 删除视觉风格
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const styleId = parseInt(String(req.params.id), 10);

    const [result] = await getPool().execute<ResultSetHeader>(
      'DELETE FROM visual_styles WHERE id = ? AND user_id = ?',
      [styleId, req.userId]
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ error: '视觉风格不存在' });
      return;
    }

    console.log(`🎨 [VisualStyles] 删除视觉风格 id=${styleId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ [VisualStyles] 删除视觉风格失败:', err);
    res.status(500).json({ error: '删除视觉风格失败' });
  }
});

export default router;
