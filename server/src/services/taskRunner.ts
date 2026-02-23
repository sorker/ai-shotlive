/**
 * 后台任务运行器
 *
 * 管理生成任务的完整生命周期：
 * 1. 创建任务 → 写入 DB（status=pending）
 * 2. 执行任务 → 调用 AI API（status=running/polling）
 * 3. 完成任务 → 存储结果，自动回写到项目数据（status=completed）
 * 4. 恢复任务 → 服务器重启后恢复正在轮询的异步任务
 */

import { Pool, PoolConnection } from 'mysql2/promise';
import { RowDataPacket } from 'mysql2';
import { resolveToFilePath, resolveApiUrlToBase64, isFilePath, readFileAsBuffer } from './fileStorage.js';
import {
  createGenericAsyncVideoTask,
  pollGenericAsyncVideoTask,
  generateVeoSyncVideo,
  createDashScopeVideoTask,
  pollDashScopeVideoTask,
  createSeedanceVideoTask,
  pollSeedanceVideoTask,
  generateGeminiImage,
  generateOpenAIImage,
  serverChatCompletion,
} from './aiProxy.js';
import { parseScriptFull, ScriptParseResult } from './scriptParser.js';

// ============================================
// 类型定义
// ============================================

export interface TaskCreateParams {
  type: 'video' | 'image' | 'chat' | 'script_parse';
  projectId: string;
  modelId: string;
  prompt: string;

  // 视频参数
  startImage?: string;
  endImage?: string;
  aspectRatio?: string;
  duration?: number;

  // 图片参数
  referenceImages?: string[];
  isVariation?: boolean;
  hasTurnaround?: boolean;

  // 文本参数
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json_object';

  // 剧本解析参数
  scriptParseParams?: {
    language: string;
    visualStyle: string;
    targetDuration: string;
    title?: string;
  };

  // 结果写入目标
  target?: {
    type: string;         // 'keyframe' | 'video_interval' | 'character_image' | 'scene_image' | 'prop_image' | etc.
    shotId?: string;
    entityId?: string;    // keyframe ID, interval ID, character ID, etc.
  };
}

export interface TaskRecord {
  id: string;
  user_id: number;
  project_id: string;
  type: string;
  status: string;
  params: string;        // JSON string
  provider_task_id: string | null;
  provider: string | null;
  model_id: string | null;
  result: string | null;
  error: string | null;
  progress: number;
  target_type: string | null;
  target_shot_id: string | null;
  target_entity_id: string | null;
  target_episode_id: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

interface ModelRegistryState {
  providers: Array<{
    id: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
  }>;
  models: Array<{
    id: string;
    apiModel?: string;
    type: string;
    providerId: string;
    endpoint?: string;
    params?: any;
  }>;
  activeModels: { chat: string; image: string; video: string };
}

// 内存中的运行任务追踪
const runningTasks = new Map<string, { abort?: AbortController }>();

// ============================================
// 任务 CRUD
// ============================================

/**
 * 创建新任务
 */
export const createTask = async (
  pool: Pool,
  userId: number,
  params: TaskCreateParams
): Promise<TaskRecord> => {
  const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

  // 获取项目当前激活的 episode_id
  const [projRows] = await pool.execute<any[]>(
    'SELECT selected_episode_id FROM projects WHERE id = ? AND user_id = ?',
    [params.projectId, userId]
  );
  const episodeId = projRows[0]?.selected_episode_id || '';

  await pool.execute(
    `INSERT INTO generation_tasks
      (id, user_id, project_id, type, status, params, model_id, target_type, target_shot_id, target_entity_id, target_episode_id)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    [
      taskId,
      userId,
      params.projectId,
      params.type,
      JSON.stringify(params),
      params.modelId,
      params.target?.type || null,
      params.target?.shotId || null,
      params.target?.entityId || null,
      episodeId,
    ]
  );

  console.log(`📋 [TaskRunner] 任务已创建: ${taskId} (${params.type}/${params.modelId})`);

  // 立即启动任务执行
  executeTask(pool, userId, taskId).catch(err => {
    console.error(`❌ [TaskRunner] 任务执行失败: ${taskId}`, err.message);
  });

  return await getTask(pool, userId, taskId) as TaskRecord;
};

/**
 * 获取任务详情
 */
export const getTask = async (
  pool: Pool,
  userId: number,
  taskId: string
): Promise<TaskRecord | null> => {
  const [rows] = await pool.execute<(TaskRecord & RowDataPacket)[]>(
    'SELECT * FROM generation_tasks WHERE id = ? AND user_id = ?',
    [taskId, userId]
  );
  return rows.length > 0 ? rows[0] : null;
};

/**
 * 获取用户的活跃任务列表
 */
export const getActiveTasks = async (
  pool: Pool,
  userId: number,
  projectId?: string
): Promise<TaskRecord[]> => {
  if (projectId) {
    const [rows] = await pool.execute<(TaskRecord & RowDataPacket)[]>(
      `SELECT * FROM generation_tasks
       WHERE user_id = ? AND project_id = ? AND status IN ('pending', 'running', 'polling')
       ORDER BY created_at DESC`,
      [userId, projectId]
    );
    return rows;
  }

  const [rows] = await pool.execute<(TaskRecord & RowDataPacket)[]>(
    `SELECT * FROM generation_tasks
     WHERE user_id = ? AND status IN ('pending', 'running', 'polling')
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
};

/**
 * 获取项目的所有任务（包含已完成）
 */
export const getProjectTasks = async (
  pool: Pool,
  userId: number,
  projectId: string,
  limit: number = 50
): Promise<TaskRecord[]> => {
  const [rows] = await pool.execute<(TaskRecord & RowDataPacket)[]>(
    `SELECT * FROM generation_tasks
     WHERE user_id = ? AND project_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, projectId, limit]
  );
  return rows;
};

/**
 * 取消任务
 */
export const cancelTask = async (
  pool: Pool,
  userId: number,
  taskId: string
): Promise<boolean> => {
  const task = await getTask(pool, userId, taskId);
  if (!task || !['pending', 'running', 'polling'].includes(task.status)) {
    return false;
  }

  // 中止内存中的运行任务
  const running = runningTasks.get(taskId);
  if (running?.abort) {
    running.abort.abort();
  }
  runningTasks.delete(taskId);

  await pool.execute(
    `UPDATE generation_tasks SET status = 'cancelled', updated_at = NOW() WHERE id = ? AND user_id = ?`,
    [taskId, userId]
  );

  console.log(`🚫 [TaskRunner] 任务已取消: ${taskId}`);
  return true;
};

// ============================================
// 参考图提示词包装
// ============================================

/**
 * 当存在参考图片时，为提示词添加参考图使用指引
 *
 * 参考图的顺序约定（与前端 getRefImagesForShot 一致）：
 *   1. 场景参考图（环境/氛围）
 *   2. 角色参考图（外观，可能有九宫格造型图）
 *   3. 道具参考图
 *
 * 这段包装告知图像生成 AI 每张图片的角色，确保模型正确使用场景和角色参考。
 * 与前端 visualService.generateImage 中的包装逻辑保持同步。
 */
const wrapPromptWithReferenceGuide = (
  prompt: string,
  referenceImages: string[],
  isVariation?: boolean,
  hasTurnaround?: boolean
): string => {
  if (!referenceImages || referenceImages.length === 0) {
    return prompt;
  }

  if (isVariation) {
    return `⚠️⚠️⚠️ CRITICAL REQUIREMENTS - CHARACTER OUTFIT VARIATION ⚠️⚠️⚠️

Reference Images Information:
- The provided image shows the CHARACTER's BASE APPEARANCE that you MUST use as reference for FACE ONLY.

Task:
Generate a character image with a NEW OUTFIT/COSTUME based on this description: "${prompt}".

⚠️ ABSOLUTE REQUIREMENTS (NON-NEGOTIABLE):

1. FACE & IDENTITY - MUST BE 100% IDENTICAL TO REFERENCE:
   • Facial Features: Eyes (color, shape, size), nose structure, mouth shape, facial contours must be EXACTLY the same
   • Hairstyle & Hair Color: Length, color, texture, and style must be PERFECTLY matched (unless prompt specifies hair change)
   • Skin tone and facial structure: MUST remain identical
   • Expression can vary based on prompt

2. OUTFIT/CLOTHING - MUST BE COMPLETELY DIFFERENT FROM REFERENCE:
   • Generate NEW clothing/outfit as described in the prompt
   • DO NOT copy the clothing from the reference image
   • The outfit should match the description provided: "${prompt}"
   • Include all accessories, props, or costume details mentioned in the prompt

3. Body proportions should remain consistent with the reference.

⚠️ This is an OUTFIT VARIATION task - The face MUST match the reference, but the CLOTHES MUST be NEW as described!
⚠️ If the new outfit is not clearly visible and different from the reference, the task has FAILED!`;
  }

  const turnaroundGuide = hasTurnaround ? `
4. CHARACTER TURNAROUND SHEET - MULTI-ANGLE REFERENCE:
   Some character reference images are provided as a 3x3 TURNAROUND SHEET (9-panel grid showing the SAME character from different angles: front, side, back, 3/4 view, close-up, etc.).
   ⚠️ This turnaround sheet is your MOST IMPORTANT reference for character consistency!
   • Use the panel that best matches the CAMERA ANGLE of this shot (e.g., if the shot is from behind, refer to the back-view panel)
   • The character's face, hair, clothing, and body proportions must match ALL panels in the turnaround sheet
   • The turnaround sheet takes priority over single character reference images for angle-specific details
` : '';

  return `⚠️⚠️⚠️ CRITICAL REQUIREMENTS - CHARACTER CONSISTENCY ⚠️⚠️⚠️

Reference Images Information:
- The FIRST image is the Scene/Environment reference.
- Subsequent images are Character references (Base Look or Variation).${hasTurnaround ? '\n- Some character images are 3x3 TURNAROUND SHEETS showing the character from 9 different angles (front, side, back, close-up, etc.).' : ''}
- Any remaining images after characters are Prop/Item references (objects that must appear consistently).

Task:
Generate a cinematic shot matching this prompt: "${prompt}".

⚠️ ABSOLUTE REQUIREMENTS (NON-NEGOTIABLE):
1. Scene Consistency:
   - STRICTLY maintain the visual style, lighting, and environment from the scene reference.

2. Character Consistency - HIGHEST PRIORITY:
   If characters are present in the prompt, they MUST be IDENTICAL to the character reference images:
   • Facial Features: Eyes (color, shape, size), nose structure, mouth shape, facial contours must be EXACTLY the same
   • Hairstyle & Hair Color: Length, color, texture, and style must be PERFECTLY matched
   • Clothing & Outfit: Style, color, material, and accessories must be IDENTICAL
   • Body Type: Height, build, proportions must remain consistent

3. Prop/Item Consistency:
   If prop reference images are provided, the objects/items in the shot MUST match the reference:
   • Shape & Form: The prop's shape, size, and proportions must be identical to the reference
   • Color & Material: Colors, textures, and materials must be consistent
   • Details: Patterns, text, decorations, and distinguishing features must match exactly
${turnaroundGuide}
⚠️ DO NOT create variations or interpretations of the character - STRICT REPLICATION ONLY!
⚠️ Character appearance consistency is THE MOST IMPORTANT requirement!
⚠️ Props/items must also maintain visual consistency with their reference images!`;
};

// ============================================
// 任务执行引擎
// ============================================

/**
 * 执行任务（主入口）
 */
const executeTask = async (
  pool: Pool,
  userId: number,
  taskId: string
): Promise<void> => {
  const task = await getTask(pool, userId, taskId);
  if (!task || task.status !== 'pending') return;

  const params: TaskCreateParams = JSON.parse(task.params);

  // 标记为 running
  await updateTaskStatus(pool, taskId, 'running');

  // 获取用户的模型配置
  const registry = await getUserModelRegistry(pool, userId);
  if (!registry) {
    await failTask(pool, taskId, '未找到模型配置，请先在模型配置页面设置 API Key');
    return;
  }

  try {
    let result: string;

    switch (params.type) {
      case 'video':
        result = await executeVideoTask(pool, taskId, params, registry);
        break;
      case 'image':
        result = await executeImageTask(pool, taskId, params, registry, userId);
        break;
      case 'chat':
        result = await executeChatTask(pool, taskId, params, registry);
        break;
      case 'script_parse':
        result = await executeScriptParseTask(pool, taskId, params, registry, userId);
        break;
      default:
        throw new Error(`未知任务类型: ${params.type}`);
    }

    // 任务完成
    await completeTask(pool, taskId, result);

    // 自动回写结果到项目
    if (params.target) {
      await applyResultToProject(pool, userId, task.project_id, params.target, result, task.target_episode_id);
    }

    console.log(`✅ [TaskRunner] 任务完成: ${taskId}`);
  } catch (err: any) {
    // 检查是否被取消
    const current = await getTask(pool, userId, taskId);
    if (current?.status === 'cancelled') return;

    await failTask(pool, taskId, err.message || '未知错误');
    console.error(`❌ [TaskRunner] 任务失败: ${taskId}`, err.message);
  } finally {
    runningTasks.delete(taskId);
  }
};

/**
 * 执行视频生成任务
 */
const executeVideoTask = async (
  pool: Pool,
  taskId: string,
  params: TaskCreateParams,
  registry: ModelRegistryState
): Promise<string> => {
  const { modelId, prompt, startImage, endImage, aspectRatio = '16:9', duration = 8 } = params;
  const { apiBase, apiKey, model, provider } = resolveModelConfig(registry, 'video', modelId);

  const actualModelName = model.apiModel || model.id || modelId;
  const providerBaseUrl = provider?.baseUrl || '';

  // DashScope (阿里百炼 万象)
  if (
    model.providerId === 'qwen' ||
    providerBaseUrl.includes('dashscope.aliyuncs.com')
  ) {
    console.log(`  🔄 [TaskRunner] 使用 DashScope 适配器`);
    const { taskId: providerTaskId } = await createDashScopeVideoTask({
      apiKey, modelId: actualModelName, prompt,
      startImage, endImage, aspectRatio, duration,
    });
    await updateProviderTaskId(pool, taskId, providerTaskId, 'dashscope');
    await updateTaskStatus(pool, taskId, 'polling');

    return await pollDashScopeVideoTask(apiKey, providerTaskId, (progress) => {
      updateTaskProgress(pool, taskId, progress).catch(() => {});
    });
  }

  // 火山引擎 Seedance（直连）
  if (
    model.providerId === 'doubao' &&
    providerBaseUrl.includes('ark.cn-beijing.volces.com') &&
    actualModelName.includes('seedance')
  ) {
    console.log(`  🔄 [TaskRunner] 使用 Seedance 适配器`);
    const { taskId: providerTaskId } = await createSeedanceVideoTask({
      apiKey, modelId: actualModelName, prompt,
      startImage, endImage, aspectRatio, duration,
    });
    await updateProviderTaskId(pool, taskId, providerTaskId, 'seedance');
    await updateTaskStatus(pool, taskId, 'polling');

    return await pollSeedanceVideoTask(apiKey, providerTaskId, (progress) => {
      updateTaskProgress(pool, taskId, progress).catch(() => {});
    });
  }

  // 通用异步模式 (Sora, Veo-fast, Kling, Vidu, Seedance via proxy)
  const isAsync =
    (model.params as any)?.mode === 'async' ||
    actualModelName === 'sora-2' ||
    actualModelName.toLowerCase().startsWith('veo_3_1-fast') ||
    actualModelName.includes('seedance');

  if (isAsync) {
    console.log(`  🔄 [TaskRunner] 使用通用异步模式`);
    const { taskId: providerTaskId } = await createGenericAsyncVideoTask({
      apiBase, apiKey, modelName: actualModelName, prompt,
      startImage, endImage, aspectRatio, duration,
    });
    await updateProviderTaskId(pool, taskId, providerTaskId, 'generic-async');
    await updateTaskStatus(pool, taskId, 'polling');

    return await pollGenericAsyncVideoTask(
      apiBase, apiKey, providerTaskId, actualModelName,
      (progress) => { updateTaskProgress(pool, taskId, progress).catch(() => {}); }
    );
  }

  // Veo 同步模式
  console.log(`  🔄 [TaskRunner] 使用 Veo 同步模式`);
  return await generateVeoSyncVideo({
    apiBase, apiKey, modelName: actualModelName, prompt,
    startImage, endImage, aspectRatio,
  });
};

/**
 * 解析参考图数组：将 /api/ 内部 URL 转为可用的 base64 data URI
 *
 * 解析策略（按优先级）：
 * 1. 本地磁盘文件（通过 resolveApiUrlToBase64）
 * 2. 数据库中的 reference_image（可能是文件路径、base64 或 URL）
 * 3. 如果都失败，跳过该参考图（不阻断任务）
 */
const resolveReferenceImages = async (
  pool: Pool,
  rawImages: string[],
  userId?: number
): Promise<string[]> => {
  const resolved: string[] = [];

  for (const img of rawImages) {
    if (!img) continue;

    // 已经是 data URL 或 HTTP URL → 直接使用
    if (img.startsWith('data:') || /^https?:\/\//i.test(img)) {
      resolved.push(img);
      continue;
    }

    // 内部 API URL → 先尝试文件系统，再查 DB
    const apiMatch = img.match(/^\/api\/projects\/([^/]+)\/image\/([^/]+)\/([^/]+)$/);
    if (apiMatch) {
      // 策略 1：从本地文件读取
      const fromFile = resolveApiUrlToBase64(img);
      if (fromFile) {
        console.log(`  📂 [TaskRunner] 参考图已从本地文件解析: ${img}`);
        resolved.push(fromFile);
        continue;
      }

      // 策略 2：从数据库读取
      if (userId != null) {
        const fromDb = await resolveRefImageFromDb(pool, apiMatch[1], apiMatch[2], apiMatch[3], userId);
        if (fromDb) {
          console.log(`  📂 [TaskRunner] 参考图已从数据库解析: ${img}`);
          resolved.push(fromDb);
          continue;
        }
      }

      console.warn(`  ⚠️ [TaskRunner] 无法解析参考图，已跳过: ${img}`);
      continue;
    }

    // 其他格式原样保留
    resolved.push(img);
  }

  return resolved;
};

/**
 * 从数据库查找参考图并转为 base64 data URI
 */
const resolveRefImageFromDb = async (
  pool: Pool,
  projectId: string,
  entityType: string,
  entityId: string,
  userId: number
): Promise<string | null> => {
  try {
    let query: string;
    let imageColumn = 'reference_image';
    switch (entityType) {
      case 'character':
        query = 'SELECT reference_image FROM script_characters WHERE id = ? AND project_id = ? AND user_id = ?';
        break;
      case 'scene':
        query = 'SELECT reference_image FROM script_scenes WHERE id = ? AND project_id = ? AND user_id = ?';
        break;
      case 'prop':
        query = 'SELECT reference_image FROM script_props WHERE id = ? AND project_id = ? AND user_id = ?';
        break;
      case 'variation':
        query = 'SELECT reference_image FROM character_variations WHERE id = ? AND project_id = ? AND user_id = ?';
        break;
      case 'turnaround':
        query = 'SELECT turnaround_image FROM script_characters WHERE id = ? AND project_id = ? AND user_id = ?';
        imageColumn = 'turnaround_image';
        break;
      case 'ninegrid':
        query = 'SELECT nine_grid_image FROM shots WHERE id = ? AND project_id = ? AND user_id = ?';
        imageColumn = 'nine_grid_image';
        break;
      default:
        return null;
    }

    const [rows] = await pool.execute<RowDataPacket[]>(query!, [entityId, projectId, userId]);
    if (rows.length === 0 || !rows[0][imageColumn]) return null;

    let value = rows[0][imageColumn] as string;

    // JSON 脏数据 {"base64":"...","url":"..."}
    if (value.startsWith('{')) {
      try {
        const parsed = JSON.parse(value);
        value = parsed.base64 || parsed.url || value;
      } catch { /* ignore */ }
    }

    // 文件路径 → 读文件转 base64
    if (isFilePath(value)) {
      const fileData = readFileAsBuffer(value);
      if (fileData) {
        return `data:${fileData.mime};base64,${fileData.buffer.toString('base64')}`;
      }
    }

    // base64 data URI → 直接使用
    if (value.startsWith('data:')) return value;

    // HTTP URL → 原样返回（可能是过期 TOS URL，但让 AI API 自行尝试）
    if (/^https?:\/\//i.test(value)) return value;

    return null;
  } catch (e: any) {
    console.warn(`  ⚠️ [TaskRunner] DB 参考图查找失败 (${entityType}/${entityId}): ${e.message}`);
    return null;
  }
};

/**
 * 执行图片生成任务
 */
const executeImageTask = async (
  pool: Pool,
  taskId: string,
  params: TaskCreateParams,
  registry: ModelRegistryState,
  userId?: number
): Promise<string> => {
  const { modelId, prompt, referenceImages: rawRefImages = [], aspectRatio = '16:9', isVariation, hasTurnaround } = params;
  const { apiBase, apiKey, model } = resolveModelConfig(registry, 'image', modelId);

  const actualModelId = model.apiModel || model.id || modelId;
  const endpoint = model.endpoint || `/v1beta/models/${actualModelId}:generateContent`;
  const apiFormat = (model.params as any)?.apiFormat || 'gemini';

  // 解析参考图：将内部 API URL 转为 base64，避免依赖已过期的 TOS 签名 URL
  const referenceImages = await resolveReferenceImages(pool, rawRefImages, userId);

  // 诊断日志：参考图信息
  const refImgSummary = referenceImages.map((img, i) => {
    if (!img) return `  [${i}] (空)`;
    if (img.startsWith('data:image/')) return `  [${i}] base64 data URL (${Math.round(img.length / 1024)}KB)`;
    if (/^https?:\/\//i.test(img)) return `  [${i}] HTTP URL: ${img.substring(0, 80)}...`;
    return `  [${i}] 未知格式 (${img.substring(0, 30)}...)`;
  });
  console.log(`  🖼️ [TaskRunner] 图片任务 ${taskId}: ${referenceImages.length} 张参考图, apiFormat=${apiFormat}, hasTurnaround=${!!hasTurnaround}`);
  if (refImgSummary.length > 0) {
    console.log(`  📋 参考图详情:\n${refImgSummary.join('\n')}`);
  }

  const finalPrompt = wrapPromptWithReferenceGuide(prompt, referenceImages, isVariation, hasTurnaround);

  if (apiFormat === 'openai-image') {
    const result = await generateOpenAIImage({
      apiBase, apiKey, endpoint, modelId: actualModelId,
      prompt: finalPrompt, referenceImages, aspectRatio,
    });
    if (result.originalUrl) {
      return JSON.stringify({ base64: result.base64, url: result.originalUrl });
    }
    return result.base64;
  }

  // Gemini generateContent 格式（默认）
  return await generateGeminiImage({
    apiBase, apiKey, endpoint, modelId: actualModelId,
    prompt: finalPrompt, referenceImages, aspectRatio,
  });
};

/**
 * 执行文本生成任务
 */
const executeChatTask = async (
  pool: Pool,
  taskId: string,
  params: TaskCreateParams,
  registry: ModelRegistryState
): Promise<string> => {
  const { modelId, prompt, temperature, responseFormat } = params;
  const { apiBase, apiKey, model } = resolveModelConfig(registry, 'chat', modelId);

  const actualModel = model.apiModel || model.id || modelId;
  const endpoint = model.endpoint || '/v1/chat/completions';

  return await serverChatCompletion({
    apiBase, apiKey, endpoint, model: actualModel,
    prompt, temperature, responseFormat,
  });
};

/**
 * 执行剧本解析任务（多步骤编排）
 */
const executeScriptParseTask = async (
  pool: Pool,
  taskId: string,
  params: TaskCreateParams,
  registry: ModelRegistryState,
  userId: number
): Promise<string> => {
  const { modelId, prompt: rawText } = params;
  const spParams = params.scriptParseParams;
  if (!spParams) throw new Error('缺少 scriptParseParams');

  const { apiBase, apiKey, model } = resolveModelConfig(registry, 'chat', modelId);
  const actualModel = model.apiModel || model.id || modelId;
  const endpoint = model.endpoint || '/v1/chat/completions';

  const config = { apiBase, apiKey, endpoint, model: actualModel };

  const result = await parseScriptFull(
    pool, userId, config,
    {
      rawText,
      language: spParams.language,
      visualStyle: spParams.visualStyle,
      targetDuration: spParams.targetDuration,
      title: spParams.title,
    },
    (progress, message) => {
      updateTaskProgress(pool, taskId, progress).catch(() => {});
      console.log(`  📊 [ScriptParser] ${taskId}: ${progress}% - ${message}`);
    }
  );

  // 将解析结果写入项目表（复用 parse-result 端点的逻辑）
  await applyScriptParseToProject(pool, userId, params.projectId, result, spParams);

  return JSON.stringify(result);
};

/**
 * 将剧本解析结果写入项目数据库
 */
const applyScriptParseToProject = async (
  pool: Pool,
  userId: number,
  projectId: string,
  result: ScriptParseResult,
  spParams: NonNullable<TaskCreateParams['scriptParseParams']>
): Promise<void> => {
  const { scriptData, shots } = result;

  // 获取项目当前激活的 episode_id
  const [projRows] = await pool.execute<any[]>(
    'SELECT selected_episode_id FROM projects WHERE id = ? AND user_id = ?',
    [projectId, userId]
  );
  const episodeId = projRows[0]?.selected_episode_id || '';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 更新项目元数据
    await conn.execute(
      `UPDATE projects SET
        has_script_data = 1, script_title = ?, script_genre = ?, script_logline = ?,
        art_direction = ?, visual_style = ?, language = ?, target_duration = ?,
        shot_generation_model = ?, is_parsing_script = 0,
        last_modified_ms = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [
        scriptData.title, scriptData.genre, scriptData.logline,
        scriptData.artDirection ? JSON.stringify(scriptData.artDirection) : null,
        spParams.visualStyle, spParams.language, spParams.targetDuration,
        scriptData.shotGenerationModel || null,
        Date.now(), projectId, userId,
      ]
    );

    // 清空当前剧本的数据
    const scriptTables = ['script_characters', 'character_variations', 'script_scenes', 'script_props', 'story_paragraphs'];
    for (const table of scriptTables) {
      await conn.execute(`DELETE FROM \`${table}\` WHERE project_id = ? AND user_id = ? AND episode_id = ?`, [projectId, userId, episodeId]);
    }
    await conn.execute('DELETE FROM shot_keyframes WHERE project_id = ? AND user_id = ? AND episode_id = ?', [projectId, userId, episodeId]);
    await conn.execute('DELETE FROM shot_video_intervals WHERE project_id = ? AND user_id = ? AND episode_id = ?', [projectId, userId, episodeId]);
    await conn.execute('DELETE FROM shots WHERE project_id = ? AND user_id = ? AND episode_id = ?', [projectId, userId, episodeId]);

    // 写入角色
    for (let i = 0; i < scriptData.characters.length; i++) {
      const ch = scriptData.characters[i];
      await conn.execute(
        `INSERT INTO script_characters
         (id, project_id, user_id, episode_id, name, gender, age, personality, visual_prompt, negative_prompt, status, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ch.id, projectId, userId, episodeId, ch.name || '', ch.gender || '', ch.age || '', ch.personality || '',
         ch.visualPrompt || '', ch.negativePrompt || null, 'pending', i]
      );
    }

    // 写入场景
    for (let i = 0; i < scriptData.scenes.length; i++) {
      const s = scriptData.scenes[i];
      await conn.execute(
        `INSERT INTO script_scenes
         (id, project_id, user_id, episode_id, location, time_period, atmosphere, visual_prompt, negative_prompt, status, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.id, projectId, userId, episodeId, s.location || '', s.time || '', s.atmosphere || '',
         s.visualPrompt || '', s.negativePrompt || null, 'pending', i]
      );
    }

    // 写入段落
    for (let i = 0; i < scriptData.storyParagraphs.length; i++) {
      const p = scriptData.storyParagraphs[i];
      await conn.execute(
        `INSERT INTO story_paragraphs (paragraph_id, project_id, user_id, episode_id, text, scene_ref_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [p.id, projectId, userId, episodeId, p.text || '', p.sceneRefId || '', i]
      );
    }

    // 写入镜头
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      await conn.execute(
        `INSERT INTO shots
         (id, project_id, user_id, episode_id, scene_id, action_summary, dialogue,
          camera_movement, shot_size, characters_json, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [shot.id, projectId, userId, episodeId, shot.sceneId || '', shot.actionSummary || '', shot.dialogue || null,
         shot.cameraMovement || '', shot.shotSize || null,
         JSON.stringify(shot.characters || []), i]
      );

      for (const kf of shot.keyframes || []) {
        await conn.execute(
          `INSERT INTO shot_keyframes (id, shot_id, project_id, user_id, episode_id, type, visual_prompt, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [kf.id, shot.id, projectId, userId, episodeId, kf.type || 'start', kf.visualPrompt || '', 'pending']
        );
      }
    }

    await conn.commit();
    console.log(`  📝 [ScriptParser] 解析结果已写入数据库: ${scriptData.characters.length} 角色, ${scriptData.scenes.length} 场景, ${shots.length} 分镜`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// ============================================
// 结果回写到项目
// ============================================

/**
 * 将生成结果自动写入项目对应的位置
 */
const applyResultToProject = async (
  pool: Pool,
  userId: number,
  projectId: string,
  target: NonNullable<TaskCreateParams['target']>,
  result: string,
  episodeId?: string
): Promise<void> => {
  // 解析结构化结果（OpenAI-image 返回 JSON 含 base64 + url）
  let base64Result = result;
  let urlResult: string | null = null;
  if (result.startsWith('{')) {
    try {
      const parsed = JSON.parse(result);
      if (parsed.base64) {
        base64Result = parsed.base64;
        urlResult = parsed.url || null;
      }
    } catch { /* 非 JSON，当作普通 base64 */ }
  }

  // episode_id 用于精准定位数据（剧本级隔离）
  const epId = episodeId || '';
  const epFilter = epId ? ' AND episode_id = ?' : '';
  const epParam = epId ? [epId] : [];

  try {
    switch (target.type) {
      case 'keyframe':
        if (target.entityId && target.shotId) {
          const filePath = resolveToFilePath(projectId, 'keyframe', target.entityId, base64Result, epId || undefined);
          await pool.execute(
            `UPDATE shot_keyframes SET image_url = ?, status = 'completed'
             WHERE id = ? AND shot_id = ? AND project_id = ? AND user_id = ?${epFilter}`,
            [filePath, target.entityId, target.shotId, projectId, userId, ...epParam]
          );
          console.log(`  📝 [TaskRunner] 关键帧已回写: ${target.entityId} → ${filePath ? '文件' : 'null'}`);
        }
        break;

      case 'video_interval':
        if (target.entityId && target.shotId) {
          const filePath = resolveToFilePath(projectId, 'video', target.entityId, base64Result, epId || undefined);
          await pool.execute(
            `UPDATE shot_video_intervals SET video_url = ?, status = 'completed'
             WHERE id = ? AND shot_id = ? AND project_id = ? AND user_id = ?${epFilter}`,
            [filePath, target.entityId, target.shotId, projectId, userId, ...epParam]
          );
          console.log(`  📝 [TaskRunner] 视频片段已回写: ${target.entityId} → ${filePath ? '文件' : 'null'}`);
        }
        break;

      case 'character_image':
        if (target.entityId) {
          const filePath = resolveToFilePath(projectId, 'character', target.entityId, base64Result, epId || undefined);
          await pool.execute(
            `UPDATE script_characters SET reference_image = ?, reference_image_url = ?, status = 'completed'
             WHERE id = ? AND project_id = ? AND user_id = ?${epFilter}`,
            [filePath, urlResult, target.entityId, projectId, userId, ...epParam]
          );
          console.log(`  📝 [TaskRunner] 角色图片已回写: ${target.entityId} → ${filePath ? '文件' : 'null'}${urlResult ? ' (含原始URL)' : ''}`);
        }
        break;

      case 'scene_image':
        if (target.entityId) {
          const filePath = resolveToFilePath(projectId, 'scene', target.entityId, base64Result, epId || undefined);
          await pool.execute(
            `UPDATE script_scenes SET reference_image = ?, reference_image_url = ?, status = 'completed'
             WHERE id = ? AND project_id = ? AND user_id = ?${epFilter}`,
            [filePath, urlResult, target.entityId, projectId, userId, ...epParam]
          );
          console.log(`  📝 [TaskRunner] 场景图片已回写: ${target.entityId} → ${filePath ? '文件' : 'null'}${urlResult ? ' (含原始URL)' : ''}`);
        }
        break;

      case 'prop_image':
        if (target.entityId) {
          const propFilePath = resolveToFilePath(projectId, 'prop', target.entityId, base64Result, epId || undefined);
          await pool.execute(
            `UPDATE script_props SET reference_image = ?, reference_image_url = ?, status = 'completed'
             WHERE id = ? AND project_id = ? AND user_id = ?${epFilter}`,
            [propFilePath, urlResult, target.entityId, projectId, userId, ...epParam]
          );
          console.log(`  📝 [TaskRunner] 道具图片已回写: ${target.entityId} → ${propFilePath ? '文件' : 'null'}${urlResult ? ' (含原始URL)' : ''}`);
        }
        break;

      case 'turnaround':
        if (target.entityId) {
          const filePath = resolveToFilePath(projectId, 'ninegrid', target.entityId, result, epId || undefined);
          await pool.execute(
            `UPDATE shots SET nine_grid_image = ?, nine_grid_status = 'completed'
             WHERE id = ? AND project_id = ? AND user_id = ?${epFilter}`,
            [filePath, target.entityId, projectId, userId, ...epParam]
          );
          console.log(`  📝 [TaskRunner] 九宫格已回写: ${target.entityId} → ${filePath ? '文件' : 'null'}`);
        }
        break;

      default:
        console.log(`  ℹ️ [TaskRunner] 未知 target.type: ${target.type}，跳过回写`);
    }
  } catch (err: any) {
    console.error(`  ⚠️ [TaskRunner] 结果回写失败:`, err.message);
  }
};

// ============================================
// 任务恢复（服务器重启后）
// ============================================

/**
 * 恢复未完成的轮询任务
 * 在服务器启动时调用，恢复所有 status='polling' 的任务
 */
export const recoverTasks = async (pool: Pool): Promise<void> => {
  const [rows] = await pool.execute<(TaskRecord & RowDataPacket)[]>(
    `SELECT * FROM generation_tasks WHERE status IN ('polling', 'running') ORDER BY created_at ASC`
  );

  if (rows.length === 0) {
    console.log('🔄 [TaskRunner] 无需恢复的任务');
    return;
  }

  console.log(`🔄 [TaskRunner] 发现 ${rows.length} 个需要恢复的任务`);

  for (const task of rows) {
    // 对于 'running' 状态的非轮询任务（同步 API 调用），标记为失败
    if (task.status === 'running' && !task.provider_task_id) {
      await failTask(pool, task.id, '服务器重启，同步任务已中断');
      console.log(`  ❌ 同步任务 ${task.id} 已标记失败（不可恢复）`);
      continue;
    }

    // 对于有 provider_task_id 的轮询任务，恢复轮询
    if (task.provider_task_id) {
      console.log(`  🔄 恢复轮询任务: ${task.id} (provider: ${task.provider}, taskId: ${task.provider_task_id})`);
      recoverPollingTask(pool, task).catch(err => {
        console.error(`  ❌ 恢复任务 ${task.id} 失败:`, err.message);
      });
    }
  }
};

/**
 * 恢复单个轮询任务
 */
const recoverPollingTask = async (
  pool: Pool,
  task: TaskRecord
): Promise<void> => {
  const params: TaskCreateParams = JSON.parse(task.params);
  const registry = await getUserModelRegistry(pool, task.user_id);
  if (!registry) {
    await failTask(pool, task.id, '恢复失败：未找到模型配置');
    return;
  }

  try {
    const { apiKey, apiBase } = resolveModelConfig(registry, params.type as any, params.modelId);
    let result: string;

    switch (task.provider) {
      case 'dashscope':
        result = await pollDashScopeVideoTask(apiKey, task.provider_task_id!, (progress) => {
          updateTaskProgress(pool, task.id, progress).catch(() => {});
        });
        break;

      case 'seedance':
        result = await pollSeedanceVideoTask(apiKey, task.provider_task_id!, (progress) => {
          updateTaskProgress(pool, task.id, progress).catch(() => {});
        });
        break;

      case 'generic-async':
        result = await pollGenericAsyncVideoTask(
          apiBase, apiKey, task.provider_task_id!, params.modelId,
          (progress) => { updateTaskProgress(pool, task.id, progress).catch(() => {}); }
        );
        break;

      default:
        await failTask(pool, task.id, `恢复失败：未知 provider: ${task.provider}`);
        return;
    }

    await completeTask(pool, task.id, result);

    if (params.target) {
      await applyResultToProject(pool, task.user_id, task.project_id, params.target, result, task.target_episode_id);
    }

    console.log(`  ✅ 恢复任务完成: ${task.id}`);
  } catch (err: any) {
    await failTask(pool, task.id, `恢复后执行失败: ${err.message}`);
  }
};

// ============================================
// DB 操作辅助
// ============================================

const updateTaskStatus = async (pool: Pool, taskId: string, status: string): Promise<void> => {
  await pool.execute(
    'UPDATE generation_tasks SET status = ?, updated_at = NOW() WHERE id = ?',
    [status, taskId]
  );
};

const updateProviderTaskId = async (
  pool: Pool, taskId: string, providerTaskId: string, provider: string
): Promise<void> => {
  await pool.execute(
    'UPDATE generation_tasks SET provider_task_id = ?, provider = ?, updated_at = NOW() WHERE id = ?',
    [providerTaskId, provider, taskId]
  );
};

const updateTaskProgress = async (pool: Pool, taskId: string, progress: number): Promise<void> => {
  await pool.execute(
    'UPDATE generation_tasks SET progress = ?, updated_at = NOW() WHERE id = ?',
    [progress, taskId]
  );
};

const completeTask = async (pool: Pool, taskId: string, result: string): Promise<void> => {
  await pool.execute(
    `UPDATE generation_tasks SET status = 'completed', result = ?, progress = 100,
     completed_at = NOW(), updated_at = NOW() WHERE id = ?`,
    [result, taskId]
  );
};

const failTask = async (pool: Pool, taskId: string, error: string): Promise<void> => {
  await pool.execute(
    `UPDATE generation_tasks SET status = 'failed', error = ?, updated_at = NOW() WHERE id = ?`,
    [error.substring(0, 2000), taskId]
  );
};

// ============================================
// 模型配置解析
// ============================================

/**
 * 从用户的模型注册表中获取配置
 */
const getUserModelRegistry = async (
  pool: Pool,
  userId: number
): Promise<ModelRegistryState | null> => {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT data FROM model_registry WHERE user_id = ?',
    [userId]
  );
  if (rows.length === 0) return null;
  try {
    return JSON.parse(rows[0].data);
  } catch {
    return null;
  }
};

/**
 * 解析模型配置：获取 apiBase, apiKey, model 定义
 */
const resolveModelConfig = (
  registry: ModelRegistryState,
  type: 'chat' | 'image' | 'video',
  modelId: string
): {
  apiBase: string;
  apiKey: string;
  model: ModelRegistryState['models'][0];
  provider: ModelRegistryState['providers'][0] | undefined;
} => {
  // 查找模型
  let model = registry.models.find(m => m.id === modelId && m.type === type);
  if (!model) {
    // 尝试按 apiModel 匹配
    model = registry.models.find(m => m.apiModel === modelId && m.type === type);
  }
  if (!model) {
    // 使用激活模型
    const activeId = registry.activeModels[type];
    model = registry.models.find(m => m.id === activeId);
  }
  if (!model) {
    throw new Error(`未找到模型: ${modelId} (${type})`);
  }

  // 查找提供商
  const provider = registry.providers.find(p => p.id === model!.providerId);
  const apiKey = provider?.apiKey;
  if (!apiKey) {
    throw new Error(`模型 ${model.id} 的提供商 ${model.providerId} 未设置 API Key`);
  }

  const apiBase = (provider?.baseUrl || 'https://api.antsk.cn').replace(/\/+$/, '');

  return { apiBase, apiKey, model, provider };
};
