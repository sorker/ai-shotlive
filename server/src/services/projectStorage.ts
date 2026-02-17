/**
 * 项目数据规范化存储服务
 *
 * 核心理念：将前端的 ProjectState 对象拆解到多张 MySQL 表中，
 * 每条记录只包含一个实体（一个角色、一个镜头、一张图片等），
 * 彻底避免「一个 JSON 存所有」导致的超大数据包问题。
 *
 * 存储时：ProjectState → 多张表（decompose）
 * 读取时：多张表 → ProjectState（assemble）
 */

import { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { resolveToFilePath, isFilePath, readFileAsBuffer, isBase64DataUri } from './fileStorage.js';

/**
 * 安全清洗图片字段：处理 DB 中可能存在的脏数据
 *
 * 历史问题：executeImageTask 曾将 OpenAI-image 结果存为 JSON {"base64":"...","url":"..."}
 * 如果这种 JSON 被当作 <img src> 使用，浏览器会把它当相对 URL 导致 431 错误。
 *
 * 此函数统一处理：
 * - JSON 格式 → 提取 url（优先）或 base64
 * - 正常 base64 / URL → 原样返回
 * - null/undefined → undefined
 */
/**
 * @param value       数据库中的图片值（可能是 URL、base64、JSON 脏数据）
 * @param fallbackUrl 当值为 base64 时使用的服务端回退 URL（避免传输大体积 base64）
 */
const sanitizeImageField = (
  value: string | null | undefined,
  fallbackUrl?: string
): { display: string | undefined; url: string | undefined } => {
  if (!value) return { display: undefined, url: undefined };

  // 文件路径（data/...）→ 使用服务端 API URL 提供访问
  if (isFilePath(value) && fallbackUrl) {
    return { display: fallbackUrl, url: fallbackUrl };
  }

  // 检测 JSON 格式的脏数据：{"base64":"...","url":"..."}
  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      const url = parsed.url || undefined;
      if (url) return { display: url, url };
      if (fallbackUrl) return { display: fallbackUrl, url: fallbackUrl };
      return { display: parsed.base64 || undefined, url: undefined };
    } catch {
      // 非合法 JSON，当普通字符串处理
    }
  }

  // 正常 URL
  if (/^https?:\/\//i.test(value)) {
    return { display: value, url: value };
  }

  // 已经是 API 回退 URL（/api/...）
  if (value.startsWith('/api/')) {
    return { display: value, url: value };
  }

  // base64 数据 —— 使用 fallbackUrl 代替，避免传输大数据
  if (fallbackUrl) {
    return { display: fallbackUrl, url: fallbackUrl };
  }

  // 最终回退（不应到达）
  return { display: value, url: undefined };
};

// ─── Type Helpers（与前端 types.ts 保持一致）───────────────────────

interface ProjectState {
  id: string;
  title: string;
  createdAt: number;
  lastModified: number;
  stage: string;
  novelChapters: any[];
  novelEpisodes: any[];
  selectedEpisodeId: string | null;
  rawScript: string;
  targetDuration: string;
  language: string;
  visualStyle: string;
  shotGenerationModel: string;
  scriptData: any | null;
  shots: any[];
  isParsingScript: boolean;
  renderLogs: any[];
}

// ─── SAVE：将 ProjectState 拆解存入各表 ──────────────────────────

/**
 * 在事务外预读图片备份数据（文件路径或 URL）。
 * 这些 SELECT 不需要事务保护，提前执行可以缩短事务持锁时间。
 */
export interface ImageBackup {
  charImg: Map<string, string | null>;
  varImg: Map<string, string | null>;
  sceneImg: Map<string, string | null>;
  propImg: Map<string, string | null>;
  kfImg: Map<string, string | null>;
}

export async function fetchImageBackup(
  pool: Pool,
  userId: number,
  projectId: string
): Promise<ImageBackup> {
  const [
    [prevChars],
    [prevVars],
    [prevScenes],
    [prevProps],
    [prevKeyframes],
  ] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      'SELECT id, reference_image FROM script_characters WHERE project_id = ? AND user_id = ?', [projectId, userId]
    ),
    pool.execute<RowDataPacket[]>(
      'SELECT id, character_id, reference_image FROM character_variations WHERE project_id = ? AND user_id = ?', [projectId, userId]
    ),
    pool.execute<RowDataPacket[]>(
      'SELECT id, reference_image FROM script_scenes WHERE project_id = ? AND user_id = ?', [projectId, userId]
    ),
    pool.execute<RowDataPacket[]>(
      'SELECT id, reference_image FROM script_props WHERE project_id = ? AND user_id = ?', [projectId, userId]
    ),
    pool.execute<RowDataPacket[]>(
      'SELECT id, shot_id, image_url FROM shot_keyframes WHERE project_id = ? AND user_id = ?', [projectId, userId]
    ),
  ]);

  return {
    charImg: new Map(prevChars.map(r => [r.id, r.reference_image || null])),
    varImg: new Map(prevVars.map(r => [`${r.character_id}:${r.id}`, r.reference_image || null])),
    sceneImg: new Map(prevScenes.map(r => [r.id, r.reference_image || null])),
    propImg: new Map(prevProps.map(r => [r.id, r.reference_image || null])),
    kfImg: new Map(prevKeyframes.map(r => [`${r.shot_id}:${r.id}`, r.image_url || null])),
  };
}

export async function saveProjectNormalized(
  conn: PoolConnection,
  userId: number,
  project: ProjectState,
  backup?: ImageBackup
): Promise<void> {
  const pid = project.id;

  // ① 写入项目元数据（projects 表）
  const hasScriptData = project.scriptData != null ? 1 : 0;
  const sd = project.scriptData;

  await conn.execute(
    `INSERT INTO projects (
       id, user_id, title, data,
       stage, target_duration, language, visual_style, shot_generation_model,
       raw_script, selected_episode_id, is_parsing_script,
       has_script_data, script_title, script_genre, script_logline, art_direction,
       created_at_ms, last_modified_ms, is_normalized
     ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       data = NULL,
       stage = VALUES(stage),
       target_duration = VALUES(target_duration),
       language = VALUES(language),
       visual_style = VALUES(visual_style),
       shot_generation_model = VALUES(shot_generation_model),
       raw_script = VALUES(raw_script),
       selected_episode_id = VALUES(selected_episode_id),
       is_parsing_script = VALUES(is_parsing_script),
       has_script_data = VALUES(has_script_data),
       script_title = VALUES(script_title),
       script_genre = VALUES(script_genre),
       script_logline = VALUES(script_logline),
       art_direction = VALUES(art_direction),
       created_at_ms = VALUES(created_at_ms),
       last_modified_ms = VALUES(last_modified_ms),
       is_normalized = 1,
       updated_at = CURRENT_TIMESTAMP`,
    [
      pid, userId, project.title || '未命名项目',
      project.stage || 'script',
      project.targetDuration || '60s',
      project.language || '中文',
      project.visualStyle || 'live-action',
      project.shotGenerationModel || null,
      project.rawScript || '',
      project.selectedEpisodeId || null,
      project.isParsingScript ? 1 : 0,
      hasScriptData,
      sd?.title || null,
      sd?.genre || null,
      sd?.logline || null,
      sd?.artDirection ? JSON.stringify(sd.artDirection) : null,
      project.createdAt || Date.now(),
      project.lastModified || Date.now(),
    ]
  );

  // ②a 使用预读的图片备份（如果没有传入则在事务内读取作为 fallback）
  let prevCharImg: Map<string, string | null>;
  let prevVarImg: Map<string, string | null>;
  let prevSceneImg: Map<string, string | null>;
  let prevPropImg: Map<string, string | null>;
  let prevKfImg: Map<string, string | null>;

  if (backup) {
    prevCharImg = backup.charImg;
    prevVarImg = backup.varImg;
    prevSceneImg = backup.sceneImg;
    prevPropImg = backup.propImg;
    prevKfImg = backup.kfImg;
  } else {
    // Fallback: 事务内读取（向后兼容 import 等场景）
    const [prevChars] = await conn.execute<RowDataPacket[]>(
      'SELECT id, reference_image FROM script_characters WHERE project_id = ? AND user_id = ?', [pid, userId]
    );
    const [prevVars] = await conn.execute<RowDataPacket[]>(
      'SELECT id, character_id, reference_image FROM character_variations WHERE project_id = ? AND user_id = ?', [pid, userId]
    );
    const [prevScenes] = await conn.execute<RowDataPacket[]>(
      'SELECT id, reference_image FROM script_scenes WHERE project_id = ? AND user_id = ?', [pid, userId]
    );
    const [prevProps] = await conn.execute<RowDataPacket[]>(
      'SELECT id, reference_image FROM script_props WHERE project_id = ? AND user_id = ?', [pid, userId]
    );
    const [prevKeyframes] = await conn.execute<RowDataPacket[]>(
      'SELECT id, shot_id, image_url FROM shot_keyframes WHERE project_id = ? AND user_id = ?', [pid, userId]
    );

    prevCharImg = new Map(prevChars.map(r => [r.id, r.reference_image || null]));
    prevVarImg = new Map(prevVars.map(r => [`${r.character_id}:${r.id}`, r.reference_image || null]));
    prevSceneImg = new Map(prevScenes.map(r => [r.id, r.reference_image || null]));
    prevPropImg = new Map(prevProps.map(r => [r.id, r.reference_image || null]));
    prevKfImg = new Map(prevKeyframes.map(r => [`${r.shot_id}:${r.id}`, r.image_url || null]));
  }

  // ② 清空旧的子表数据（事务内，失败会回滚）
  const childTables = [
    'novel_chapters', 'novel_episodes',
    'script_characters', 'character_variations',
    'script_scenes', 'script_props', 'story_paragraphs',
    'shots', 'shot_keyframes', 'shot_video_intervals',
    'render_logs',
  ];
  for (const table of childTables) {
    await conn.execute(`DELETE FROM \`${table}\` WHERE project_id = ? AND user_id = ?`, [pid, userId]);
  }

  // ③ 写入小说章节
  for (const ch of project.novelChapters || []) {
    await conn.execute(
      `INSERT INTO novel_chapters (id, project_id, user_id, chapter_index, reel, title, content)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ch.id, pid, userId, ch.index ?? 0, ch.reel || '', ch.title || '', ch.content || '']
    );
  }

  // ④ 写入小说剧集
  for (const ep of project.novelEpisodes || []) {
    await conn.execute(
      `INSERT INTO novel_episodes (id, project_id, user_id, name, chapter_ids, chapter_range, script, status, episode_created_at, episode_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ep.id, pid, userId, ep.name || '',
        JSON.stringify(ep.chapterIds || []),
        ep.chapterRange || '',
        ep.script || '',
        ep.status || 'pending',
        ep.createdAt || null,
        ep.updatedAt || null,
      ]
    );
  }

  // 辅助：解析图片/视频值，base64 保存为文件，返回文件路径或 URL
  // - 前端发来 base64 → 保存为文件，返回文件路径
  // - 前端发来 URL → 原样返回
  // - 前端发来 null/空 → 使用 DB 中原有值（可能是文件路径或 URL）
  const resolveImageValue = (
    frontendVal: string | undefined | null,
    cachedVal: string | undefined | null,
    entityType: string,
    entityId: string,
  ): string | null => {
    // 前端传了 base64，保存为文件
    if (frontendVal && isBase64DataUri(frontendVal)) {
      return resolveToFilePath(pid, entityType, entityId, frontendVal);
    }
    // 前端传了有效值（URL 或文件路径），直接用
    if (frontendVal && (frontendVal.startsWith('http') || isFilePath(frontendVal))) {
      return frontendVal;
    }
    // 前端无值，使用 DB 缓存值
    if (cachedVal) {
      // 如果缓存值是 base64（旧数据），趁机迁移为文件
      if (isBase64DataUri(cachedVal)) {
        return resolveToFilePath(pid, entityType, entityId, cachedVal);
      }
      return cachedVal;
    }
    return null;
  };

  // 剧本级数据隔离：使用当前选中的 episodeId
  const episodeId = project.selectedEpisodeId || '';

  // ⑤ 写入角色 + 角色变体
  const chars = sd?.characters || [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const turnaroundMeta = ch.turnaround
      ? { panels: ch.turnaround.panels, status: ch.turnaround.status, prompt: ch.turnaround.prompt }
      : null;

    await conn.execute(
      `INSERT INTO script_characters
       (id, project_id, user_id, episode_id, name, gender, age, personality,
        visual_prompt, negative_prompt, core_features,
        reference_image, reference_image_url, turnaround_data, turnaround_image, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ch.id, pid, userId, episodeId, ch.name || '', ch.gender || '', ch.age || '',
        ch.personality || '',
        ch.visualPrompt || null, ch.negativePrompt || null, ch.coreFeatures || null,
        resolveImageValue(ch.referenceImage, prevCharImg.get(ch.id), 'character', ch.id),
        ch.referenceImageUrl || null,
        turnaroundMeta ? JSON.stringify(turnaroundMeta) : null,
        resolveToFilePath(pid, 'turnaround', ch.id, ch.turnaround?.imageUrl) || null,
        ch.status || null,
        i,
      ]
    );

    // 角色变体
    for (let j = 0; j < (ch.variations || []).length; j++) {
      const v = ch.variations[j];
      await conn.execute(
        `INSERT INTO character_variations
         (id, character_id, project_id, user_id, episode_id, name, visual_prompt, negative_prompt, reference_image, reference_image_url, status, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.id, ch.id, pid, userId, episodeId, v.name || '', v.visualPrompt || null, v.negativePrompt || null,
         resolveImageValue(v.referenceImage, prevVarImg.get(`${ch.id}:${v.id}`), 'variation', v.id),
         v.referenceImageUrl || null, v.status || null, j]
      );
    }
  }

  // ⑥ 写入场景
  const scenes = sd?.scenes || [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    await conn.execute(
      `INSERT INTO script_scenes
       (id, project_id, user_id, episode_id, location, time_period, atmosphere,
        visual_prompt, negative_prompt, reference_image, reference_image_url, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.id, pid, userId, episodeId, s.location || '', s.time || '', s.atmosphere || '',
       s.visualPrompt || null, s.negativePrompt || null,
       resolveImageValue(s.referenceImage, prevSceneImg.get(s.id), 'scene', s.id),
       s.referenceImageUrl || null, s.status || null, i]
    );
  }

  // ⑦ 写入道具
  const props = sd?.props || [];
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    await conn.execute(
      `INSERT INTO script_props
       (id, project_id, user_id, episode_id, name, category, description,
        visual_prompt, negative_prompt, reference_image, reference_image_url, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, pid, userId, episodeId, p.name || '', p.category || '', p.description || '', p.visualPrompt || null, p.negativePrompt || null,
       resolveImageValue(p.referenceImage, prevPropImg.get(p.id), 'prop', p.id),
       p.referenceImageUrl || null, p.status || null, i]
    );
  }

  // ⑧ 写入故事段落
  const paragraphs = sd?.storyParagraphs || [];
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    await conn.execute(
      `INSERT INTO story_paragraphs (paragraph_id, project_id, user_id, episode_id, text, scene_ref_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [p.id, pid, userId, episodeId, p.text || '', p.sceneRefId || '', i]
    );
  }

  // ⑨ 写入镜头 + 关键帧 + 视频片段
  const shots = project.shots || [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const ng = shot.nineGrid;

    await conn.execute(
      `INSERT INTO shots
       (id, project_id, user_id, episode_id, scene_id, action_summary, dialogue,
        camera_movement, shot_size, characters_json, character_variations_json, props_json,
        video_model, nine_grid_panels, nine_grid_image, nine_grid_prompt, nine_grid_status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shot.id, pid, userId, episodeId,
        shot.sceneId || '', shot.actionSummary || '', shot.dialogue || null,
        shot.cameraMovement || '', shot.shotSize || null,
        JSON.stringify(shot.characters || []),
        JSON.stringify(shot.characterVariations || {}),
        JSON.stringify(shot.props || []),
        shot.videoModel || null,
        ng?.panels ? JSON.stringify(ng.panels) : null,
        resolveToFilePath(pid, 'ninegrid', shot.id, ng?.imageUrl) || null,
        ng?.prompt || null,
        ng?.status || null,
        i,
      ]
    );

    // 关键帧
    for (const kf of shot.keyframes || []) {
      const kfImgVal = resolveImageValue(kf.imageUrl, prevKfImg.get(`${shot.id}:${kf.id}`), 'keyframe', kf.id);
      await conn.execute(
        `INSERT INTO shot_keyframes (id, shot_id, project_id, user_id, episode_id, type, visual_prompt, image_url, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [kf.id, shot.id, pid, userId, episodeId, kf.type || 'start', kf.visualPrompt || '', kfImgVal, kf.status || 'pending']
      );
    }

    // 视频片段
    if (shot.interval) {
      const iv = shot.interval;
      const videoVal = resolveToFilePath(pid, 'video', iv.id, iv.videoUrl);
      await conn.execute(
        `INSERT INTO shot_video_intervals
         (id, shot_id, project_id, user_id, episode_id, start_keyframe_id, end_keyframe_id,
          duration, motion_strength, video_url, video_prompt, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          iv.id, shot.id, pid, userId, episodeId,
          iv.startKeyframeId || '', iv.endKeyframeId || '',
          iv.duration || 0, iv.motionStrength || 5,
          videoVal, iv.videoPrompt || null, iv.status || 'pending',
        ]
      );
    }
  }

  // ⑩ 写入渲染日志
  for (const log of project.renderLogs || []) {
    await conn.execute(
      `INSERT INTO render_logs
       (id, project_id, user_id, episode_id, timestamp_ms, type, resource_id, resource_name,
        status, model, prompt, error, input_tokens, output_tokens, total_tokens, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        log.id, pid, userId, episodeId,
        log.timestamp || null,
        log.type || '', log.resourceId || '', log.resourceName || '',
        log.status || '', log.model || '', log.prompt || null, log.error || null,
        log.inputTokens || null, log.outputTokens || null, log.totalTokens || null,
        log.duration || null,
      ]
    );
  }
}

// ─── LOAD：从各表组装回 ProjectState ──────────────────────────────

interface ProjectMetaRow extends RowDataPacket {
  id: string;
  user_id: number;
  title: string;
  data: string | null;
  stage: string;
  target_duration: string;
  language: string;
  visual_style: string;
  shot_generation_model: string;
  raw_script: string;
  selected_episode_id: string | null;
  is_parsing_script: number;
  has_script_data: number;
  script_title: string | null;
  script_genre: string | null;
  script_logline: string | null;
  art_direction: any;
  created_at_ms: number | null;
  last_modified_ms: number | null;
  is_normalized: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * 加载单个项目完整数据
 */
export async function loadProjectNormalized(
  pool: Pool,
  userId: number,
  projectId: string,
  options?: { includeFullContent?: boolean }
): Promise<ProjectState | null> {
  const includeFullContent = options?.includeFullContent ?? false;
  // 加载项目元数据
  const [metaRows] = await pool.execute<ProjectMetaRow[]>(
    `SELECT * FROM projects WHERE id = ? AND user_id = ?`,
    [projectId, userId]
  );
  if (metaRows.length === 0) return null;

  const meta = metaRows[0];

  // 如果尚未规范化（旧数据），从 JSON 列读取
  if (!meta.is_normalized && meta.data) {
    try {
      return JSON.parse(meta.data);
    } catch {
      return null;
    }
  }

  // 从规范化表并行加载所有子数据
  // 优化：默认 novel_chapters 只加载元数据（不含 content），novel_episodes 只加载元数据（不含 script）
  // 章节内容和剧集剧本在用户打开对应页面时按需加载
  // 导出时 includeFullContent=true 以获取完整数据
  const chapterQuery = includeFullContent
    ? 'SELECT * FROM novel_chapters WHERE project_id = ? AND user_id = ? ORDER BY chapter_index'
    : 'SELECT id, chapter_index, reel, title, CHAR_LENGTH(content) AS word_count FROM novel_chapters WHERE project_id = ? AND user_id = ? ORDER BY chapter_index';
  const episodeQuery = includeFullContent
    ? 'SELECT * FROM novel_episodes WHERE project_id = ? AND user_id = ?'
    : 'SELECT id, name, chapter_ids, chapter_range, status, episode_created_at, episode_updated_at, CHAR_LENGTH(script) AS script_length FROM novel_episodes WHERE project_id = ? AND user_id = ?';

  // 剧本级数据隔离：如果有选中的剧集，下游数据只加载该剧集的数据
  // 导出时（includeFullContent）加载全部数据
  const activeEpisodeId = meta.selected_episode_id || '';
  const hasActiveEpisode = !!meta.selected_episode_id;
  const episodeFilter = !includeFullContent && hasActiveEpisode ? ' AND episode_id = ?' : '';
  const episodeParams = !includeFullContent && hasActiveEpisode ? [activeEpisodeId] : [];

  const [
    [chapterRows],
    [episodeRows],
    [charRows],
    [variationRows],
    [sceneRows],
    [propRows],
    [paragraphRows],
    [shotRows],
    [keyframeRows],
    [intervalRows],
    [logRows],
  ] = await Promise.all([
    pool.execute<RowDataPacket[]>(chapterQuery, [projectId, userId]),
    pool.execute<RowDataPacket[]>(episodeQuery, [projectId, userId]),
    pool.execute<RowDataPacket[]>(`SELECT * FROM script_characters WHERE project_id = ? AND user_id = ?${episodeFilter} ORDER BY sort_order`, [projectId, userId, ...episodeParams]),
    pool.execute<RowDataPacket[]>(`SELECT * FROM character_variations WHERE project_id = ? AND user_id = ?${episodeFilter} ORDER BY sort_order`, [projectId, userId, ...episodeParams]),
    pool.execute<RowDataPacket[]>(`SELECT * FROM script_scenes WHERE project_id = ? AND user_id = ?${episodeFilter} ORDER BY sort_order`, [projectId, userId, ...episodeParams]),
    pool.execute<RowDataPacket[]>(`SELECT * FROM script_props WHERE project_id = ? AND user_id = ?${episodeFilter} ORDER BY sort_order`, [projectId, userId, ...episodeParams]),
    pool.execute<RowDataPacket[]>(`SELECT * FROM story_paragraphs WHERE project_id = ? AND user_id = ?${episodeFilter} ORDER BY sort_order`, [projectId, userId, ...episodeParams]),
    pool.execute<RowDataPacket[]>(`SELECT * FROM shots WHERE project_id = ? AND user_id = ?${episodeFilter} ORDER BY sort_order`, [projectId, userId, ...episodeParams]),
    pool.execute<RowDataPacket[]>(`SELECT * FROM shot_keyframes WHERE project_id = ? AND user_id = ?${episodeFilter}`, [projectId, userId, ...episodeParams]),
    pool.execute<RowDataPacket[]>(`SELECT * FROM shot_video_intervals WHERE project_id = ? AND user_id = ?${episodeFilter}`, [projectId, userId, ...episodeParams]),
    pool.execute<RowDataPacket[]>(`SELECT * FROM render_logs WHERE project_id = ? AND user_id = ?${episodeFilter} ORDER BY timestamp_ms`, [projectId, userId, ...episodeParams]),
  ]);

  // ── 组装小说章节 ──
  const novelChapters = chapterRows.map(r => includeFullContent
    ? {
        id: r.id,
        index: r.chapter_index,
        reel: r.reel || '',
        title: r.title || '',
        content: r.content || '',
      }
    : {
        id: r.id,
        index: r.chapter_index,
        reel: r.reel || '',
        title: r.title || '',
        content: '',
        wordCount: r.word_count || 0,
      }
  );

  // ── 组装小说剧集 ──
  const novelEpisodes = episodeRows.map(r => includeFullContent
    ? {
        id: r.id,
        name: r.name || '',
        chapterIds: safeJsonParse(r.chapter_ids, []),
        chapterRange: r.chapter_range || '',
        script: r.script || '',
        status: r.status || 'pending',
        createdAt: r.episode_created_at || 0,
        updatedAt: r.episode_updated_at || 0,
      }
    : {
        id: r.id,
        name: r.name || '',
        chapterIds: safeJsonParse(r.chapter_ids, []),
        chapterRange: r.chapter_range || '',
        script: '',
        status: r.status || 'pending',
        createdAt: r.episode_created_at || 0,
        updatedAt: r.episode_updated_at || 0,
      }
  );

  // 构建图片回退 URL 前缀（用于将 base64 替换为服务端 API URL）
  const imgBase = `/api/projects/${projectId}/image`;

  // ── 组装角色变体（按角色分组）──
  // 优化：有 URL 时只发 URL 给前端，base64 替换为服务端回退 URL
  const variationsByChar = new Map<string, any[]>();
  for (const v of variationRows) {
    const cid = v.character_id;
    if (!variationsByChar.has(cid)) variationsByChar.set(cid, []);
    const fallback = (v.reference_image || v.reference_image_url) ? `${imgBase}/variation/${v.id}` : undefined;
    const imgSafe = sanitizeImageField(v.reference_image_url || v.reference_image, fallback);
    variationsByChar.get(cid)!.push({
      id: v.id,
      name: v.name || '',
      visualPrompt: v.visual_prompt || '',
      negativePrompt: v.negative_prompt || undefined,
      referenceImage: imgSafe.display,
      referenceImageUrl: imgSafe.url,
      status: v.status || undefined,
    });
  }

  // ── 组装角色 ──
  const characters = charRows.map(r => {
    const turnaroundMeta = safeJsonParse(r.turnaround_data, null);
    let turnaroundImageUrl = r.turnaround_image || undefined;
    if (turnaroundImageUrl && (isBase64DataUri(turnaroundImageUrl) || isFilePath(turnaroundImageUrl))) {
      turnaroundImageUrl = `${imgBase}/turnaround/${r.id}`;
    }
    const turnaround = turnaroundMeta
      ? { ...turnaroundMeta, imageUrl: turnaroundImageUrl }
      : undefined;

    const fallback = (r.reference_image || r.reference_image_url) ? `${imgBase}/character/${r.id}` : undefined;
    const imgSafe = sanitizeImageField(r.reference_image_url || r.reference_image, fallback);
    return {
      id: r.id,
      name: r.name || '',
      gender: r.gender || '',
      age: r.age || '',
      personality: r.personality || '',
      visualPrompt: r.visual_prompt || undefined,
      negativePrompt: r.negative_prompt || undefined,
      coreFeatures: r.core_features || undefined,
      referenceImage: imgSafe.display,
      referenceImageUrl: imgSafe.url,
      turnaround,
      variations: variationsByChar.get(r.id) || [],
      status: r.status || undefined,
    };
  });

  // ── 组装场景 ──
  const scenes = sceneRows.map(r => {
    const fallback = (r.reference_image || r.reference_image_url) ? `${imgBase}/scene/${r.id}` : undefined;
    const imgSafe = sanitizeImageField(r.reference_image_url || r.reference_image, fallback);
    return {
      id: r.id,
      location: r.location || '',
      time: r.time_period || '',
      atmosphere: r.atmosphere || '',
      visualPrompt: r.visual_prompt || undefined,
      negativePrompt: r.negative_prompt || undefined,
      referenceImage: imgSafe.display,
      referenceImageUrl: imgSafe.url,
      status: r.status || undefined,
    };
  });

  // ── 组装道具 ──
  const props = propRows.map(r => {
    const fallback = (r.reference_image || r.reference_image_url) ? `${imgBase}/prop/${r.id}` : undefined;
    const imgSafe = sanitizeImageField(r.reference_image_url || r.reference_image, fallback);
    return {
      id: r.id,
      name: r.name || '',
      category: r.category || '',
      description: r.description || '',
      visualPrompt: r.visual_prompt || undefined,
      negativePrompt: r.negative_prompt || undefined,
      referenceImage: imgSafe.display,
      referenceImageUrl: imgSafe.url,
      status: r.status || undefined,
    };
  });

  // ── 组装故事段落 ──
  const storyParagraphs = paragraphRows.map(r => ({
    id: r.paragraph_id,
    text: r.text || '',
    sceneRefId: r.scene_ref_id || '',
  }));

  // ── 组装关键帧（按镜头分组）──
  const keyframesByShot = new Map<string, any[]>();
  for (const kf of keyframeRows) {
    const sid = kf.shot_id;
    if (!keyframesByShot.has(sid)) keyframesByShot.set(sid, []);
    // 关键帧图片：base64 替换为服务端回退 URL，避免传输大数据
    const fallback = kf.image_url ? `${imgBase}/keyframe/${kf.id}` : undefined;
    const kfImgSafe = sanitizeImageField(kf.image_url, fallback);
    keyframesByShot.get(sid)!.push({
      id: kf.id,
      type: kf.type || 'start',
      visualPrompt: kf.visual_prompt || '',
      imageUrl: kfImgSafe.display,
      status: kf.status || 'pending',
    });
  }

  // ── 组装视频片段（按镜头分组）──
  const intervalsByShot = new Map<string, any>();
  for (const iv of intervalRows) {
    // 视频：文件路径或 base64 都替换为服务端 API URL
    let videoUrl = iv.video_url || undefined;
    if (videoUrl && (videoUrl.startsWith('data:') || isFilePath(videoUrl))) {
      videoUrl = `/api/projects/${projectId}/video/${iv.id}`;
    }
    intervalsByShot.set(iv.shot_id, {
      id: iv.id,
      startKeyframeId: iv.start_keyframe_id || '',
      endKeyframeId: iv.end_keyframe_id || '',
      duration: iv.duration || 0,
      motionStrength: iv.motion_strength || 5,
      videoUrl,
      videoPrompt: iv.video_prompt || undefined,
      status: iv.status || 'pending',
    });
  }

  // ── 组装镜头 ──
  const shots = shotRows.map(r => {
    const ngPanels = safeJsonParse(r.nine_grid_panels, null);
    let ngImageUrl = r.nine_grid_image || undefined;
    // 九宫格图片：文件路径或 base64 → API URL
    if (ngImageUrl && (isBase64DataUri(ngImageUrl) || isFilePath(ngImageUrl))) {
      ngImageUrl = `${imgBase}/ninegrid/${r.id}`;
    }
    const nineGrid = ngPanels
      ? {
          panels: ngPanels,
          imageUrl: ngImageUrl,
          prompt: r.nine_grid_prompt || undefined,
          status: r.nine_grid_status || 'pending',
        }
      : undefined;

    return {
      id: r.id,
      sceneId: r.scene_id || '',
      actionSummary: r.action_summary || '',
      dialogue: r.dialogue || undefined,
      cameraMovement: r.camera_movement || '',
      shotSize: r.shot_size || undefined,
      characters: safeJsonParse(r.characters_json, []),
      characterVariations: safeJsonParse(r.character_variations_json, {}),
      props: safeJsonParse(r.props_json, []),
      keyframes: keyframesByShot.get(r.id) || [],
      interval: intervalsByShot.get(r.id) || undefined,
      videoModel: r.video_model || undefined,
      nineGrid,
    };
  });

  // ── 组装渲染日志 ──
  const renderLogs = logRows.map(r => ({
    id: r.id,
    timestamp: r.timestamp_ms || 0,
    type: r.type || '',
    resourceId: r.resource_id || '',
    resourceName: r.resource_name || '',
    status: r.status || '',
    model: r.model || '',
    prompt: r.prompt || undefined,
    error: r.error || undefined,
    inputTokens: r.input_tokens || undefined,
    outputTokens: r.output_tokens || undefined,
    totalTokens: r.total_tokens || undefined,
    duration: r.duration_ms || undefined,
  }));

  // ── 组装 scriptData ──
  let scriptData = null;
  if (meta.has_script_data) {
    scriptData = {
      title: meta.script_title || '',
      genre: meta.script_genre || '',
      logline: meta.script_logline || '',
      targetDuration: meta.target_duration || undefined,
      language: meta.language || undefined,
      visualStyle: meta.visual_style || undefined,
      shotGenerationModel: meta.shot_generation_model || undefined,
      artDirection: safeJsonParse(meta.art_direction, undefined),
      characters,
      scenes,
      props,
      storyParagraphs,
    };
  }

  // ── 组装最终 ProjectState ──
  return {
    id: meta.id,
    title: meta.title || '未命名项目',
    createdAt: meta.created_at_ms || new Date(meta.created_at).getTime(),
    lastModified: meta.last_modified_ms || new Date(meta.updated_at).getTime(),
    stage: (meta.stage || 'script') as any,
    novelChapters,
    novelEpisodes,
    selectedEpisodeId: meta.selected_episode_id || null,
    rawScript: meta.raw_script || '',
    targetDuration: meta.target_duration || '60s',
    language: meta.language || '中文',
    visualStyle: meta.visual_style || 'live-action',
    shotGenerationModel: meta.shot_generation_model || '',
    scriptData,
    shots,
    isParsingScript: !!meta.is_parsing_script,
    renderLogs,
  };
}

// ─── 加载项目列表（仅元数据，不加载子表数据）──────────────────────

export async function loadProjectList(
  pool: Pool,
  userId: number
): Promise<any[]> {
  const [rows] = await pool.execute<ProjectMetaRow[]>(
    `SELECT id, title, data, stage, target_duration, language, visual_style,
            shot_generation_model, created_at_ms, last_modified_ms, is_normalized,
            created_at, updated_at, is_parsing_script, has_script_data,
            selected_episode_id
     FROM projects WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId]
  );

  return rows.map(meta => {
    // 对于尚未规范化的旧项目，从 JSON 中提取元数据
    if (!meta.is_normalized && meta.data) {
      try {
        return JSON.parse(meta.data);
      } catch {
        return { id: meta.id, title: meta.title };
      }
    }

    // 规范化项目：从结构化列构建轻量元数据
    return {
      id: meta.id,
      title: meta.title || '未命名项目',
      createdAt: meta.created_at_ms || new Date(meta.created_at).getTime(),
      lastModified: meta.last_modified_ms || new Date(meta.updated_at).getTime(),
      stage: meta.stage || 'script',
      targetDuration: meta.target_duration || '60s',
      language: meta.language || '中文',
      visualStyle: meta.visual_style || 'live-action',
      shotGenerationModel: meta.shot_generation_model || '',
      selectedEpisodeId: meta.selected_episode_id || null,
      isParsingScript: !!meta.is_parsing_script,
      // 列表视图不需要的重字段，给默认空值
      rawScript: '',
      novelChapters: [],
      novelEpisodes: [],
      scriptData: null,
      shots: [],
      renderLogs: [],
    };
  });
}

// ─── 导出单个项目的完整数据 ──────────────────────────────────────

export async function exportProjectFull(
  pool: Pool,
  userId: number,
  projectId: string
): Promise<any | null> {
  return loadProjectNormalized(pool, userId, projectId, { includeFullContent: true });
}

// ─── 导出当前用户所有项目的完整数据 ──────────────────────────────

export async function exportAllProjects(
  pool: Pool,
  userId: number
): Promise<any[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM projects WHERE user_id = ?',
    [userId]
  );

  const projects: any[] = [];
  for (const row of rows) {
    const p = await loadProjectNormalized(pool, userId, row.id, { includeFullContent: true });
    if (p) projects.push(p);
  }
  return projects;
}

// ─── 工具函数 ──────────────────────────────────────────────────

function safeJsonParse(val: any, fallback: any): any {
  if (val == null) return fallback;
  if (typeof val === 'object') return val; // 已经是对象（MySQL JSON 列自动解析）
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}
