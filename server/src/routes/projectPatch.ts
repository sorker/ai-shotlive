/**
 * 项目增量更新路由（PATCH / POST / DELETE）
 *
 * 替代原有的 PUT 全量保存方式：
 * - 每个实体（角色、场景、镜头…）都有独立的增量接口
 * - 只更新前端传来的字段，不做 DELETE + INSERT
 * - 仅在用户主动编辑时调用，任务结果由 TaskRunner 直接写 DB
 */

import { Router, Response } from 'express';
import { getPool } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// ============================================
// Helper: 动态构建 UPDATE SET 子句
// ============================================

interface FieldMap {
  [camelCase: string]: string | {
    column: string;
    transform: (v: any) => any;
  };
}

function buildPatchSets(body: Record<string, any>, fieldMap: FieldMap): { sets: string[]; values: any[] } {
  const sets: string[] = [];
  const values: any[] = [];
  for (const [camel, mapping] of Object.entries(fieldMap)) {
    if (body[camel] !== undefined) {
      if (typeof mapping === 'string') {
        sets.push(`\`${mapping}\` = ?`);
        values.push(body[camel]);
      } else {
        sets.push(`\`${mapping.column}\` = ?`);
        values.push(mapping.transform(body[camel]));
      }
    }
  }
  return { sets, values };
}

// ============================================
// PATCH /:id — 项目元数据
// ============================================

const PROJECT_FIELDS: FieldMap = {
  title: 'title',
  stage: 'stage',
  targetDuration: 'target_duration',
  language: 'language',
  visualStyle: 'visual_style',
  shotGenerationModel: 'shot_generation_model',
  rawScript: 'raw_script',
  selectedEpisodeId: 'selected_episode_id',
  isParsingScript: { column: 'is_parsing_script', transform: (v: boolean) => v ? 1 : 0 },
};

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const projectId = req.params.id;
  const userId = req.userId!;

  try {
    const { sets, values } = buildPatchSets(req.body, PROJECT_FIELDS);

    // scriptData 顶层字段
    if (req.body.scriptData !== undefined) {
      const sd = req.body.scriptData;
      if (sd === null) {
        sets.push('has_script_data = ?', 'script_title = ?', 'script_genre = ?', 'script_logline = ?', 'art_direction = ?');
        values.push(0, null, null, null, null);
      } else {
        if (sd.title !== undefined) { sets.push('script_title = ?'); values.push(sd.title); }
        if (sd.genre !== undefined) { sets.push('script_genre = ?'); values.push(sd.genre); }
        if (sd.logline !== undefined) { sets.push('script_logline = ?'); values.push(sd.logline); }
        if (sd.artDirection !== undefined) { sets.push('art_direction = ?'); values.push(JSON.stringify(sd.artDirection)); }
        sets.push('has_script_data = ?'); values.push(1);
      }
    }

    if (sets.length === 0) {
      res.status(400).json({ error: '没有提供可更新的字段' });
      return;
    }

    sets.push('last_modified_ms = ?', 'updated_at = CURRENT_TIMESTAMP');
    values.push(Date.now());
    values.push(projectId, userId);

    await pool.execute(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('PATCH project failed:', err.message);
    res.status(500).json({ error: '更新项目失败' });
  }
});

// ============================================
// 角色 CRUD
// ============================================

const CHARACTER_FIELDS: FieldMap = {
  name: 'name',
  gender: 'gender',
  age: 'age',
  personality: 'personality',
  visualPrompt: 'visual_prompt',
  negativePrompt: 'negative_prompt',
  coreFeatures: 'core_features',
  referenceImage: 'reference_image',
  referenceImageUrl: 'reference_image_url',
  status: 'status',
};

router.post('/:id/characters', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId } = req.params;
  const userId = req.userId!;
  const ch = req.body;

  try {
    // 获取当前最大 sort_order
    const [maxRows] = await pool.execute<any[]>(
      'SELECT COALESCE(MAX(sort_order), -1) AS mx FROM script_characters WHERE project_id = ? AND user_id = ?',
      [projectId, userId]
    );
    const sortOrder = (maxRows[0]?.mx ?? -1) + 1;

    const turnaroundData = ch.turnaround
      ? JSON.stringify({ panels: ch.turnaround.panels || [], prompt: ch.turnaround.prompt || '', status: ch.turnaround.status || 'pending' })
      : null;
    const turnaroundImage = ch.turnaround?.imageUrl || null;

    await pool.execute(
      `INSERT INTO script_characters
       (id, project_id, user_id, name, gender, age, personality, visual_prompt, negative_prompt, core_features,
        reference_image, reference_image_url, turnaround_data, turnaround_image, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ch.id, projectId, userId,
        ch.name || '', ch.gender || '', ch.age || '', ch.personality || '',
        ch.visualPrompt || '', ch.negativePrompt || null, ch.coreFeatures || null,
        ch.referenceImage || null, ch.referenceImageUrl || null,
        turnaroundData, turnaroundImage,
        ch.status || 'pending', sortOrder,
      ]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('POST character failed:', err.message);
    res.status(500).json({ error: '添加角色失败' });
  }
});

router.patch('/:id/characters/:charId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, charId } = req.params;
  const userId = req.userId!;

  try {
    const { sets, values } = buildPatchSets(req.body, CHARACTER_FIELDS);

    // turnaround 特殊处理
    if (req.body.turnaround !== undefined) {
      const t = req.body.turnaround;
      if (t === null) {
        sets.push('turnaround_data = ?', 'turnaround_image = ?');
        values.push(null, null);
      } else {
        if (t.panels !== undefined || t.prompt !== undefined || t.status !== undefined) {
          sets.push('turnaround_data = ?');
          // 需要 merge 现有数据
          const [existing] = await pool.execute<any[]>(
            'SELECT turnaround_data FROM script_characters WHERE id = ? AND project_id = ? AND user_id = ?',
            [charId, projectId, userId]
          );
          let current: any = {};
          if (existing[0]?.turnaround_data) {
            try { current = JSON.parse(existing[0].turnaround_data); } catch {}
          }
          const merged = {
            panels: t.panels !== undefined ? t.panels : (current.panels || []),
            prompt: t.prompt !== undefined ? t.prompt : (current.prompt || ''),
            status: t.status !== undefined ? t.status : (current.status || 'pending'),
          };
          values.push(JSON.stringify(merged));
        }
        if (t.imageUrl !== undefined) {
          sets.push('turnaround_image = ?');
          values.push(t.imageUrl);
        }
      }
    }

    if (sets.length === 0) {
      res.status(400).json({ error: '没有提供可更新的字段' });
      return;
    }

    values.push(charId, projectId, userId);
    await pool.execute(
      `UPDATE script_characters SET ${sets.join(', ')} WHERE id = ? AND project_id = ? AND user_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('PATCH character failed:', err.message);
    res.status(500).json({ error: '更新角色失败' });
  }
});

router.delete('/:id/characters/:charId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, charId } = req.params;
  const userId = req.userId!;

  try {
    // 级联删除 variations
    await pool.execute(
      'DELETE FROM character_variations WHERE character_id = ? AND project_id = ? AND user_id = ?',
      [charId, projectId, userId]
    );
    await pool.execute(
      'DELETE FROM script_characters WHERE id = ? AND project_id = ? AND user_id = ?',
      [charId, projectId, userId]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('DELETE character failed:', err.message);
    res.status(500).json({ error: '删除角色失败' });
  }
});

// ============================================
// 角色变体 CRUD
// ============================================

const VARIATION_FIELDS: FieldMap = {
  name: 'name',
  visualPrompt: 'visual_prompt',
  negativePrompt: 'negative_prompt',
  referenceImage: 'reference_image',
  referenceImageUrl: 'reference_image_url',
  status: 'status',
};

router.post('/:id/characters/:charId/variations', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, charId } = req.params;
  const userId = req.userId!;
  const v = req.body;

  try {
    const [maxRows] = await pool.execute<any[]>(
      'SELECT COALESCE(MAX(sort_order), -1) AS mx FROM character_variations WHERE character_id = ? AND project_id = ? AND user_id = ?',
      [charId, projectId, userId]
    );
    const sortOrder = (maxRows[0]?.mx ?? -1) + 1;

    await pool.execute(
      `INSERT INTO character_variations
       (id, character_id, project_id, user_id, name, visual_prompt, negative_prompt,
        reference_image, reference_image_url, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        v.id, charId, projectId, userId,
        v.name || '', v.visualPrompt || '', v.negativePrompt || null,
        v.referenceImage || null, v.referenceImageUrl || null,
        v.status || 'pending', sortOrder,
      ]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('POST variation failed:', err.message);
    res.status(500).json({ error: '添加变体失败' });
  }
});

router.patch('/:id/characters/:charId/variations/:varId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, charId, varId } = req.params;
  const userId = req.userId!;

  try {
    const { sets, values } = buildPatchSets(req.body, VARIATION_FIELDS);
    if (sets.length === 0) {
      res.status(400).json({ error: '没有提供可更新的字段' });
      return;
    }
    values.push(varId, charId, projectId, userId);
    await pool.execute(
      `UPDATE character_variations SET ${sets.join(', ')} WHERE id = ? AND character_id = ? AND project_id = ? AND user_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('PATCH variation failed:', err.message);
    res.status(500).json({ error: '更新变体失败' });
  }
});

router.delete('/:id/characters/:charId/variations/:varId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, charId, varId } = req.params;
  const userId = req.userId!;

  try {
    await pool.execute(
      'DELETE FROM character_variations WHERE id = ? AND character_id = ? AND project_id = ? AND user_id = ?',
      [varId, charId, projectId, userId]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('DELETE variation failed:', err.message);
    res.status(500).json({ error: '删除变体失败' });
  }
});

// ============================================
// 场景 CRUD
// ============================================

const SCENE_FIELDS: FieldMap = {
  location: 'location',
  timePeriod: 'time_period',
  time: 'time_period',
  atmosphere: 'atmosphere',
  visualPrompt: 'visual_prompt',
  negativePrompt: 'negative_prompt',
  referenceImage: 'reference_image',
  referenceImageUrl: 'reference_image_url',
  status: 'status',
};

router.post('/:id/scenes', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId } = req.params;
  const userId = req.userId!;
  const s = req.body;

  try {
    const [maxRows] = await pool.execute<any[]>(
      'SELECT COALESCE(MAX(sort_order), -1) AS mx FROM script_scenes WHERE project_id = ? AND user_id = ?',
      [projectId, userId]
    );
    const sortOrder = (maxRows[0]?.mx ?? -1) + 1;

    await pool.execute(
      `INSERT INTO script_scenes
       (id, project_id, user_id, location, time_period, atmosphere, visual_prompt, negative_prompt,
        reference_image, reference_image_url, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.id, projectId, userId,
        s.location || '', s.time || s.timePeriod || '', s.atmosphere || '',
        s.visualPrompt || '', s.negativePrompt || null,
        s.referenceImage || null, s.referenceImageUrl || null,
        s.status || 'pending', sortOrder,
      ]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('POST scene failed:', err.message);
    res.status(500).json({ error: '添加场景失败' });
  }
});

router.patch('/:id/scenes/:sceneId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, sceneId } = req.params;
  const userId = req.userId!;

  try {
    const { sets, values } = buildPatchSets(req.body, SCENE_FIELDS);
    if (sets.length === 0) {
      res.status(400).json({ error: '没有提供可更新的字段' });
      return;
    }
    values.push(sceneId, projectId, userId);
    await pool.execute(
      `UPDATE script_scenes SET ${sets.join(', ')} WHERE id = ? AND project_id = ? AND user_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('PATCH scene failed:', err.message);
    res.status(500).json({ error: '更新场景失败' });
  }
});

router.delete('/:id/scenes/:sceneId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, sceneId } = req.params;
  const userId = req.userId!;

  try {
    await pool.execute(
      'DELETE FROM script_scenes WHERE id = ? AND project_id = ? AND user_id = ?',
      [sceneId, projectId, userId]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('DELETE scene failed:', err.message);
    res.status(500).json({ error: '删除场景失败' });
  }
});

// ============================================
// 道具 CRUD
// ============================================

const PROP_FIELDS: FieldMap = {
  name: 'name',
  category: 'category',
  description: 'description',
  visualPrompt: 'visual_prompt',
  negativePrompt: 'negative_prompt',
  referenceImage: 'reference_image',
  referenceImageUrl: 'reference_image_url',
  status: 'status',
};

router.post('/:id/props', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId } = req.params;
  const userId = req.userId!;
  const p = req.body;

  try {
    const [maxRows] = await pool.execute<any[]>(
      'SELECT COALESCE(MAX(sort_order), -1) AS mx FROM script_props WHERE project_id = ? AND user_id = ?',
      [projectId, userId]
    );
    const sortOrder = (maxRows[0]?.mx ?? -1) + 1;

    await pool.execute(
      `INSERT INTO script_props
       (id, project_id, user_id, name, category, description, visual_prompt, negative_prompt,
        reference_image, reference_image_url, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.id, projectId, userId,
        p.name || '', p.category || '', p.description || '',
        p.visualPrompt || '', p.negativePrompt || null,
        p.referenceImage || null, p.referenceImageUrl || null,
        p.status || 'pending', sortOrder,
      ]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('POST prop failed:', err.message);
    res.status(500).json({ error: '添加道具失败' });
  }
});

router.patch('/:id/props/:propId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, propId } = req.params;
  const userId = req.userId!;

  try {
    const { sets, values } = buildPatchSets(req.body, PROP_FIELDS);
    if (sets.length === 0) {
      res.status(400).json({ error: '没有提供可更新的字段' });
      return;
    }
    values.push(propId, projectId, userId);
    await pool.execute(
      `UPDATE script_props SET ${sets.join(', ')} WHERE id = ? AND project_id = ? AND user_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('PATCH prop failed:', err.message);
    res.status(500).json({ error: '更新道具失败' });
  }
});

router.delete('/:id/props/:propId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, propId } = req.params;
  const userId = req.userId!;

  try {
    await pool.execute(
      'DELETE FROM script_props WHERE id = ? AND project_id = ? AND user_id = ?',
      [propId, projectId, userId]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('DELETE prop failed:', err.message);
    res.status(500).json({ error: '删除道具失败' });
  }
});

// ============================================
// 镜头 CRUD
// ============================================

const SHOT_FIELDS: FieldMap = {
  sceneId: 'scene_id',
  actionSummary: 'action_summary',
  dialogue: 'dialogue',
  cameraMovement: 'camera_movement',
  shotSize: 'shot_size',
  characters: { column: 'characters_json', transform: (v: any) => JSON.stringify(v) },
  characterVariations: { column: 'character_variations_json', transform: (v: any) => JSON.stringify(v) },
  props: { column: 'props_json', transform: (v: any) => JSON.stringify(v) },
  videoModel: 'video_model',
};

router.post('/:id/shots', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId } = req.params;
  const userId = req.userId!;
  const shot = req.body;
  const insertAfterSortOrder = req.body._insertAfterSortOrder; // 可选: 插入位置

  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      let sortOrder: number;
      if (insertAfterSortOrder !== undefined && insertAfterSortOrder !== null) {
        // 把后续的 sort_order 都 +1
        await conn.execute(
          'UPDATE shots SET sort_order = sort_order + 1 WHERE project_id = ? AND user_id = ? AND sort_order > ?',
          [projectId, userId, insertAfterSortOrder]
        );
        sortOrder = insertAfterSortOrder + 1;
      } else {
        const [maxRows] = await conn.execute<any[]>(
          'SELECT COALESCE(MAX(sort_order), -1) AS mx FROM shots WHERE project_id = ? AND user_id = ?',
          [projectId, userId]
        );
        sortOrder = (maxRows[0]?.mx ?? -1) + 1;
      }

      const ng = shot.nineGrid;
      await conn.execute(
        `INSERT INTO shots
         (id, project_id, user_id, scene_id, action_summary, dialogue,
          camera_movement, shot_size, characters_json, character_variations_json, props_json,
          video_model, nine_grid_panels, nine_grid_image, nine_grid_prompt, nine_grid_status, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          shot.id, projectId, userId,
          shot.sceneId || '', shot.actionSummary || '', shot.dialogue || null,
          shot.cameraMovement || '', shot.shotSize || null,
          JSON.stringify(shot.characters || []),
          JSON.stringify(shot.characterVariations || {}),
          JSON.stringify(shot.props || []),
          shot.videoModel || null,
          ng?.panels ? JSON.stringify(ng.panels) : null,
          ng?.imageUrl || null, ng?.prompt || null, ng?.status || null,
          sortOrder,
        ]
      );

      // 插入关键帧
      for (const kf of shot.keyframes || []) {
        await conn.execute(
          `INSERT INTO shot_keyframes (id, shot_id, project_id, user_id, type, visual_prompt, image_url, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [kf.id, shot.id, projectId, userId, kf.type || 'start', kf.visualPrompt || '', kf.imageUrl || null, kf.status || 'pending']
        );
      }

      // 插入视频片段
      if (shot.interval) {
        const iv = shot.interval;
        await conn.execute(
          `INSERT INTO shot_video_intervals
           (id, shot_id, project_id, user_id, start_keyframe_id, end_keyframe_id,
            duration, motion_strength, video_url, video_prompt, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            iv.id, shot.id, projectId, userId,
            iv.startKeyframeId || '', iv.endKeyframeId || '',
            iv.duration || 0, iv.motionStrength || 5,
            iv.videoUrl || null, iv.videoPrompt || null, iv.status || 'pending',
          ]
        );
      }

      await conn.commit();
      res.json({ success: true });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    console.error('POST shot failed:', err.message);
    res.status(500).json({ error: '添加镜头失败' });
  }
});

router.patch('/:id/shots/:shotId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, shotId } = req.params;
  const userId = req.userId!;

  try {
    const { sets, values } = buildPatchSets(req.body, SHOT_FIELDS);

    // nineGrid 特殊处理
    if (req.body.nineGrid !== undefined) {
      const ng = req.body.nineGrid;
      if (ng === null) {
        sets.push('nine_grid_panels = ?', 'nine_grid_image = ?', 'nine_grid_prompt = ?', 'nine_grid_status = ?');
        values.push(null, null, null, null);
      } else {
        if (ng.panels !== undefined) { sets.push('nine_grid_panels = ?'); values.push(JSON.stringify(ng.panels)); }
        if (ng.imageUrl !== undefined) { sets.push('nine_grid_image = ?'); values.push(ng.imageUrl); }
        if (ng.prompt !== undefined) { sets.push('nine_grid_prompt = ?'); values.push(ng.prompt); }
        if (ng.status !== undefined) { sets.push('nine_grid_status = ?'); values.push(ng.status); }
      }
    }

    if (sets.length === 0) {
      res.status(400).json({ error: '没有提供可更新的字段' });
      return;
    }

    values.push(shotId, projectId, userId);
    await pool.execute(
      `UPDATE shots SET ${sets.join(', ')} WHERE id = ? AND project_id = ? AND user_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('PATCH shot failed:', err.message);
    res.status(500).json({ error: '更新镜头失败' });
  }
});

router.delete('/:id/shots/:shotId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, shotId } = req.params;
  const userId = req.userId!;

  try {
    // 级联删除 keyframes 和 video intervals
    await pool.execute('DELETE FROM shot_keyframes WHERE shot_id = ? AND project_id = ? AND user_id = ?', [shotId, projectId, userId]);
    await pool.execute('DELETE FROM shot_video_intervals WHERE shot_id = ? AND project_id = ? AND user_id = ?', [shotId, projectId, userId]);
    await pool.execute('DELETE FROM shots WHERE id = ? AND project_id = ? AND user_id = ?', [shotId, projectId, userId]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('DELETE shot failed:', err.message);
    res.status(500).json({ error: '删除镜头失败' });
  }
});

// ============================================
// 关键帧 PATCH
// ============================================

const KEYFRAME_FIELDS: FieldMap = {
  type: 'type',
  visualPrompt: 'visual_prompt',
  imageUrl: 'image_url',
  status: 'status',
};

router.patch('/:id/shots/:shotId/keyframes/:kfId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, shotId, kfId } = req.params;
  const userId = req.userId!;

  try {
    const { sets, values } = buildPatchSets(req.body, KEYFRAME_FIELDS);
    if (sets.length === 0) {
      res.status(400).json({ error: '没有提供可更新的字段' });
      return;
    }
    values.push(kfId, shotId, projectId, userId);
    await pool.execute(
      `UPDATE shot_keyframes SET ${sets.join(', ')} WHERE id = ? AND shot_id = ? AND project_id = ? AND user_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('PATCH keyframe failed:', err.message);
    res.status(500).json({ error: '更新关键帧失败' });
  }
});

// ============================================
// 视频片段 PATCH
// ============================================

const VIDEO_INTERVAL_FIELDS: FieldMap = {
  startKeyframeId: 'start_keyframe_id',
  endKeyframeId: 'end_keyframe_id',
  duration: 'duration',
  motionStrength: 'motion_strength',
  videoUrl: 'video_url',
  videoPrompt: 'video_prompt',
  status: 'status',
};

router.patch('/:id/shots/:shotId/videos/:videoId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, shotId, videoId } = req.params;
  const userId = req.userId!;

  try {
    const { sets, values } = buildPatchSets(req.body, VIDEO_INTERVAL_FIELDS);
    if (sets.length === 0) {
      res.status(400).json({ error: '没有提供可更新的字段' });
      return;
    }
    values.push(videoId, shotId, projectId, userId);
    await pool.execute(
      `UPDATE shot_video_intervals SET ${sets.join(', ')} WHERE id = ? AND shot_id = ? AND project_id = ? AND user_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('PATCH video interval failed:', err.message);
    res.status(500).json({ error: '更新视频片段失败' });
  }
});

// ============================================
// 小说章节 —— 按需加载
// ============================================

/**
 * GET /:id/chapters — 分页获取章节列表（仅元数据，不含 content）
 * Query: page=1, pageSize=20
 */
router.get('/:id/chapters', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId } = req.params;
  const userId = req.userId!;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const offset = (page - 1) * pageSize;

  try {
    const [[countRow]] = await pool.execute<any[]>(
      'SELECT COUNT(*) AS total FROM novel_chapters WHERE project_id = ? AND user_id = ?',
      [projectId, userId]
    );
    const total = countRow.total;

    const [rows] = await pool.execute<any[]>(
      `SELECT id, chapter_index, reel, title, CHAR_LENGTH(content) AS word_count
       FROM novel_chapters WHERE project_id = ? AND user_id = ?
       ORDER BY chapter_index LIMIT ? OFFSET ?`,
      [projectId, userId, pageSize, offset]
    );

    const chapters = rows.map((r: any) => ({
      id: r.id,
      index: r.chapter_index,
      reel: r.reel || '',
      title: r.title || '',
      content: '',
      wordCount: r.word_count || 0,
    }));

    res.json({ chapters, total, page, pageSize });
  } catch (err: any) {
    console.error('GET chapters failed:', err.message);
    res.status(500).json({ error: '获取章节列表失败' });
  }
});

/**
 * GET /:id/chapters/:chapterId/content — 按需获取单个章节的完整内容
 */
router.get('/:id/chapters/:chapterId/content', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, chapterId } = req.params;
  const userId = req.userId!;

  try {
    const [rows] = await pool.execute<any[]>(
      'SELECT id, chapter_index, reel, title, content FROM novel_chapters WHERE id = ? AND project_id = ? AND user_id = ?',
      [chapterId, projectId, userId]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: '章节不存在' });
      return;
    }
    const r = rows[0];
    res.json({
      id: r.id,
      index: r.chapter_index,
      reel: r.reel || '',
      title: r.title || '',
      content: r.content || '',
    });
  } catch (err: any) {
    console.error('GET chapter content failed:', err.message);
    res.status(500).json({ error: '获取章节内容失败' });
  }
});

/**
 * GET /:id/episodes — 分页获取剧集列表（不含 script 内容）
 * Query: page=1, pageSize=20
 */
router.get('/:id/episodes', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId } = req.params;
  const userId = req.userId!;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const offset = (page - 1) * pageSize;

  try {
    const [[countRow]] = await pool.execute<any[]>(
      'SELECT COUNT(*) AS total FROM novel_episodes WHERE project_id = ? AND user_id = ?',
      [projectId, userId]
    );
    const total = countRow.total;

    const [rows] = await pool.execute<any[]>(
      `SELECT id, name, chapter_ids, chapter_range, status, episode_created_at, episode_updated_at, CHAR_LENGTH(script) AS script_length
       FROM novel_episodes WHERE project_id = ? AND user_id = ?
       ORDER BY episode_created_at LIMIT ? OFFSET ?`,
      [projectId, userId, pageSize, offset]
    );

    const episodes = rows.map((r: any) => ({
      id: r.id,
      name: r.name || '',
      chapterIds: (() => { try { return JSON.parse(r.chapter_ids); } catch { return []; } })(),
      chapterRange: r.chapter_range || '',
      script: '',
      status: r.status || 'pending',
      createdAt: r.episode_created_at || 0,
      updatedAt: r.episode_updated_at || 0,
      scriptLength: r.script_length || 0,
    }));

    res.json({ episodes, total, page, pageSize });
  } catch (err: any) {
    console.error('GET episodes failed:', err.message);
    res.status(500).json({ error: '获取剧集列表失败' });
  }
});

/**
 * GET /:id/episodes/:episodeId/content — 按需获取单个剧集的完整剧本
 */
router.get('/:id/episodes/:episodeId/content', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, episodeId } = req.params;
  const userId = req.userId!;

  try {
    const [rows] = await pool.execute<any[]>(
      'SELECT id, name, chapter_ids, chapter_range, script, status, episode_created_at, episode_updated_at FROM novel_episodes WHERE id = ? AND project_id = ? AND user_id = ?',
      [episodeId, projectId, userId]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: '剧集不存在' });
      return;
    }
    const r = rows[0];
    res.json({
      id: r.id,
      name: r.name || '',
      chapterIds: (() => { try { return JSON.parse(r.chapter_ids); } catch { return []; } })(),
      chapterRange: r.chapter_range || '',
      script: r.script || '',
      status: r.status || 'pending',
      createdAt: r.episode_created_at || 0,
      updatedAt: r.episode_updated_at || 0,
    });
  } catch (err: any) {
    console.error('GET episode content failed:', err.message);
    res.status(500).json({ error: '获取剧集内容失败' });
  }
});

// ============================================
// 小说章节 CRUD
// ============================================

router.post('/:id/chapters', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId } = req.params;
  const userId = req.userId!;
  const chapters: any[] = req.body.chapters || [req.body];

  try {
    for (const ch of chapters) {
      await pool.execute(
        `INSERT INTO novel_chapters (id, project_id, user_id, chapter_index, reel, title, content)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE chapter_index = VALUES(chapter_index), reel = VALUES(reel), title = VALUES(title), content = VALUES(content)`,
        [ch.id, projectId, userId, ch.index ?? 0, ch.reel || '', ch.title || '', ch.content || '']
      );
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('POST chapters failed:', err.message);
    res.status(500).json({ error: '添加章节失败' });
  }
});

router.patch('/:id/chapters/:chapterId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, chapterId } = req.params;
  const userId = req.userId!;
  const CHAPTER_FIELDS: FieldMap = {
    index: 'chapter_index',
    reel: 'reel',
    title: 'title',
    content: 'content',
  };

  try {
    const { sets, values } = buildPatchSets(req.body, CHAPTER_FIELDS);
    if (sets.length === 0) {
      res.status(400).json({ error: '没有提供可更新的字段' });
      return;
    }
    values.push(chapterId, projectId, userId);
    await pool.execute(
      `UPDATE novel_chapters SET ${sets.join(', ')} WHERE id = ? AND project_id = ? AND user_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('PATCH chapter failed:', err.message);
    res.status(500).json({ error: '更新章节失败' });
  }
});

router.delete('/:id/chapters/:chapterId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, chapterId } = req.params;
  const userId = req.userId!;

  try {
    await pool.execute(
      'DELETE FROM novel_chapters WHERE id = ? AND project_id = ? AND user_id = ?',
      [chapterId, projectId, userId]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('DELETE chapter failed:', err.message);
    res.status(500).json({ error: '删除章节失败' });
  }
});

// 删除所有章节
router.delete('/:id/chapters', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId } = req.params;
  const userId = req.userId!;

  try {
    await pool.execute('DELETE FROM novel_chapters WHERE project_id = ? AND user_id = ?', [projectId, userId]);
    await pool.execute('DELETE FROM novel_episodes WHERE project_id = ? AND user_id = ?', [projectId, userId]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('DELETE all chapters failed:', err.message);
    res.status(500).json({ error: '删除章节失败' });
  }
});

// ============================================
// 剧集 CRUD
// ============================================

const EPISODE_FIELDS: FieldMap = {
  name: 'name',
  chapterIds: { column: 'chapter_ids', transform: (v: any) => JSON.stringify(v) },
  chapterRange: 'chapter_range',
  script: 'script',
  status: 'status',
  createdAt: 'episode_created_at',
  updatedAt: 'episode_updated_at',
};

router.post('/:id/episodes', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId } = req.params;
  const userId = req.userId!;
  const ep = req.body;

  try {
    await pool.execute(
      `INSERT INTO novel_episodes
       (id, project_id, user_id, name, chapter_ids, chapter_range, script, status, episode_created_at, episode_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ep.id, projectId, userId,
        ep.name || '', JSON.stringify(ep.chapterIds || []), ep.chapterRange || '',
        ep.script || '', ep.status || 'pending',
        ep.createdAt || null, ep.updatedAt || null,
      ]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('POST episode failed:', err.message);
    res.status(500).json({ error: '添加剧集失败' });
  }
});

router.patch('/:id/episodes/:episodeId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, episodeId } = req.params;
  const userId = req.userId!;

  try {
    const { sets, values } = buildPatchSets(req.body, EPISODE_FIELDS);
    if (sets.length === 0) {
      res.status(400).json({ error: '没有提供可更新的字段' });
      return;
    }
    values.push(episodeId, projectId, userId);
    await pool.execute(
      `UPDATE novel_episodes SET ${sets.join(', ')} WHERE id = ? AND project_id = ? AND user_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('PATCH episode failed:', err.message);
    res.status(500).json({ error: '更新剧集失败' });
  }
});

router.delete('/:id/episodes/:episodeId', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, episodeId } = req.params;
  const userId = req.userId!;

  try {
    await pool.execute(
      'DELETE FROM novel_episodes WHERE id = ? AND project_id = ? AND user_id = ?',
      [episodeId, projectId, userId]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('DELETE episode failed:', err.message);
    res.status(500).json({ error: '删除剧集失败' });
  }
});

// ============================================
// 批量操作: 剧本解析结果保存
// ============================================

/**
 * POST /:id/parse-result
 *
 * 剧本解析完成后，一次性写入 scriptData（角色/场景）和 shots。
 * 这是唯一使用 DELETE + INSERT 的场景，因为解析会完全重建数据。
 */
router.post('/:id/parse-result', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId } = req.params;
  const userId = req.userId!;
  const { scriptData, shots, projectUpdates } = req.body;

  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 更新项目元数据
      if (projectUpdates) {
        const { sets, values } = buildPatchSets(projectUpdates, PROJECT_FIELDS);
        if (scriptData) {
          sets.push('has_script_data = ?', 'script_title = ?', 'script_genre = ?', 'script_logline = ?', 'art_direction = ?');
          values.push(1, scriptData.title || null, scriptData.genre || null, scriptData.logline || null,
            scriptData.artDirection ? JSON.stringify(scriptData.artDirection) : null);
        }
        if (sets.length > 0) {
          sets.push('last_modified_ms = ?', 'updated_at = CURRENT_TIMESTAMP');
          values.push(Date.now());
          values.push(projectId, userId);
          await conn.execute(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, values);
        }
      }

      // 清空旧的脚本相关数据
      const scriptTables = ['script_characters', 'character_variations', 'script_scenes', 'script_props', 'story_paragraphs'];
      for (const table of scriptTables) {
        await conn.execute(`DELETE FROM \`${table}\` WHERE project_id = ? AND user_id = ?`, [projectId, userId]);
      }

      // 清空旧的镜头数据
      await conn.execute('DELETE FROM shot_keyframes WHERE project_id = ? AND user_id = ?', [projectId, userId]);
      await conn.execute('DELETE FROM shot_video_intervals WHERE project_id = ? AND user_id = ?', [projectId, userId]);
      await conn.execute('DELETE FROM shots WHERE project_id = ? AND user_id = ?', [projectId, userId]);

      // 写入角色
      const characters = scriptData?.characters || [];
      for (let i = 0; i < characters.length; i++) {
        const ch = characters[i];
        const turnaroundMeta = ch.turnaround
          ? JSON.stringify({ panels: ch.turnaround.panels || [], prompt: ch.turnaround.prompt || '', status: ch.turnaround.status || 'pending' })
          : null;

        await conn.execute(
          `INSERT INTO script_characters
           (id, project_id, user_id, name, gender, age, personality, visual_prompt, negative_prompt, core_features,
            reference_image, reference_image_url, turnaround_data, turnaround_image, status, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ch.id, projectId, userId, ch.name || '', ch.gender || '', ch.age || '', ch.personality || '',
            ch.visualPrompt || '', ch.negativePrompt || null, ch.coreFeatures || null,
            ch.referenceImage || null, ch.referenceImageUrl || null,
            turnaroundMeta, ch.turnaround?.imageUrl || null,
            ch.status || 'pending', i,
          ]
        );

        // 变体
        for (let j = 0; j < (ch.variations || []).length; j++) {
          const v = ch.variations[j];
          await conn.execute(
            `INSERT INTO character_variations
             (id, character_id, project_id, user_id, name, visual_prompt, negative_prompt,
              reference_image, reference_image_url, status, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [v.id, ch.id, projectId, userId, v.name || '', v.visualPrompt || '', v.negativePrompt || null,
             v.referenceImage || null, v.referenceImageUrl || null, v.status || 'pending', j]
          );
        }
      }

      // 写入场景
      const scenes = scriptData?.scenes || [];
      for (let i = 0; i < scenes.length; i++) {
        const s = scenes[i];
        await conn.execute(
          `INSERT INTO script_scenes
           (id, project_id, user_id, location, time_period, atmosphere, visual_prompt, negative_prompt,
            reference_image, reference_image_url, status, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [s.id, projectId, userId, s.location || '', s.time || '', s.atmosphere || '',
           s.visualPrompt || '', s.negativePrompt || null, s.referenceImage || null, s.referenceImageUrl || null,
           s.status || 'pending', i]
        );
      }

      // 写入道具
      const props = scriptData?.props || [];
      for (let i = 0; i < props.length; i++) {
        const p = props[i];
        await conn.execute(
          `INSERT INTO script_props
           (id, project_id, user_id, name, category, description, visual_prompt, negative_prompt,
            reference_image, reference_image_url, status, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [p.id, projectId, userId, p.name || '', p.category || '', p.description || '',
           p.visualPrompt || '', p.negativePrompt || null, p.referenceImage || null, p.referenceImageUrl || null,
           p.status || 'pending', i]
        );
      }

      // 写入段落
      const paragraphs = scriptData?.storyParagraphs || [];
      for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i];
        await conn.execute(
          `INSERT INTO story_paragraphs (paragraph_id, project_id, user_id, text, scene_ref_id, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [p.id, projectId, userId, p.text || '', p.sceneRefId || '', i]
        );
      }

      // 写入镜头
      for (let i = 0; i < (shots || []).length; i++) {
        const shot = shots[i];
        const ng = shot.nineGrid;
        await conn.execute(
          `INSERT INTO shots
           (id, project_id, user_id, scene_id, action_summary, dialogue,
            camera_movement, shot_size, characters_json, character_variations_json, props_json,
            video_model, nine_grid_panels, nine_grid_image, nine_grid_prompt, nine_grid_status, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            shot.id, projectId, userId, shot.sceneId || '', shot.actionSummary || '', shot.dialogue || null,
            shot.cameraMovement || '', shot.shotSize || null,
            JSON.stringify(shot.characters || []), JSON.stringify(shot.characterVariations || {}),
            JSON.stringify(shot.props || []), shot.videoModel || null,
            ng?.panels ? JSON.stringify(ng.panels) : null, ng?.imageUrl || null, ng?.prompt || null, ng?.status || null,
            i,
          ]
        );

        for (const kf of shot.keyframes || []) {
          await conn.execute(
            `INSERT INTO shot_keyframes (id, shot_id, project_id, user_id, type, visual_prompt, image_url, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [kf.id, shot.id, projectId, userId, kf.type || 'start', kf.visualPrompt || '', kf.imageUrl || null, kf.status || 'pending']
          );
        }

        if (shot.interval) {
          const iv = shot.interval;
          await conn.execute(
            `INSERT INTO shot_video_intervals
             (id, shot_id, project_id, user_id, start_keyframe_id, end_keyframe_id,
              duration, motion_strength, video_url, video_prompt, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [iv.id, shot.id, projectId, userId, iv.startKeyframeId || '', iv.endKeyframeId || '',
             iv.duration || 0, iv.motionStrength || 5, iv.videoUrl || null, iv.videoPrompt || null, iv.status || 'pending']
          );
        }
      }

      await conn.commit();
      res.json({ success: true });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    console.error('POST parse-result failed:', err.message);
    res.status(500).json({ error: '保存解析结果失败' });
  }
});

// ============================================
// 批量操作: 镜头拆分
// ============================================

/**
 * POST /:id/shots/:shotId/split
 *
 * 将一个镜头拆分为多个子镜头。
 * 删除原镜头，插入新的子镜头。
 */
router.post('/:id/shots/:shotId/split', async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const { id: projectId, shotId } = req.params;
  const userId = req.userId!;
  const { newShots } = req.body;

  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 获取原镜头的 sort_order
      const [origRows] = await conn.execute<any[]>(
        'SELECT sort_order FROM shots WHERE id = ? AND project_id = ? AND user_id = ?',
        [shotId, projectId, userId]
      );
      if (origRows.length === 0) {
        await conn.rollback();
        res.status(404).json({ error: '镜头不存在' });
        return;
      }
      const origSortOrder = origRows[0].sort_order;

      // 删除原镜头及其子数据
      await conn.execute('DELETE FROM shot_keyframes WHERE shot_id = ? AND project_id = ? AND user_id = ?', [shotId, projectId, userId]);
      await conn.execute('DELETE FROM shot_video_intervals WHERE shot_id = ? AND project_id = ? AND user_id = ?', [shotId, projectId, userId]);
      await conn.execute('DELETE FROM shots WHERE id = ? AND project_id = ? AND user_id = ?', [shotId, projectId, userId]);

      // 为新镜头腾出空间: 将后续 sort_order 增加 (newShots.length - 1)
      const shift = newShots.length - 1;
      if (shift > 0) {
        await conn.execute(
          'UPDATE shots SET sort_order = sort_order + ? WHERE project_id = ? AND user_id = ? AND sort_order > ?',
          [shift, projectId, userId, origSortOrder]
        );
      }

      // 插入新镜头
      for (let i = 0; i < newShots.length; i++) {
        const shot = newShots[i];
        const ng = shot.nineGrid;
        await conn.execute(
          `INSERT INTO shots
           (id, project_id, user_id, scene_id, action_summary, dialogue,
            camera_movement, shot_size, characters_json, character_variations_json, props_json,
            video_model, nine_grid_panels, nine_grid_image, nine_grid_prompt, nine_grid_status, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            shot.id, projectId, userId, shot.sceneId || '', shot.actionSummary || '', shot.dialogue || null,
            shot.cameraMovement || '', shot.shotSize || null,
            JSON.stringify(shot.characters || []), JSON.stringify(shot.characterVariations || {}),
            JSON.stringify(shot.props || []), shot.videoModel || null,
            ng?.panels ? JSON.stringify(ng.panels) : null, ng?.imageUrl || null, ng?.prompt || null, ng?.status || null,
            origSortOrder + i,
          ]
        );

        for (const kf of shot.keyframes || []) {
          await conn.execute(
            `INSERT INTO shot_keyframes (id, shot_id, project_id, user_id, type, visual_prompt, image_url, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [kf.id, shot.id, projectId, userId, kf.type || 'start', kf.visualPrompt || '', kf.imageUrl || null, kf.status || 'pending']
          );
        }

        if (shot.interval) {
          const iv = shot.interval;
          await conn.execute(
            `INSERT INTO shot_video_intervals
             (id, shot_id, project_id, user_id, start_keyframe_id, end_keyframe_id,
              duration, motion_strength, video_url, video_prompt, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [iv.id, shot.id, projectId, userId, iv.startKeyframeId || '', iv.endKeyframeId || '',
             iv.duration || 0, iv.motionStrength || 5, iv.videoUrl || null, iv.videoPrompt || null, iv.status || 'pending']
          );
        }
      }

      await conn.commit();
      res.json({ success: true });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err: any) {
    console.error('POST shot split failed:', err.message);
    res.status(500).json({ error: '镜头拆分失败' });
  }
});

export default router;
