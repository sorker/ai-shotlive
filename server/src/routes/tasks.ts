/**
 * 后台生成任务 REST API
 *
 * POST   /api/tasks          - 创建任务（自动后台执行）
 * GET    /api/tasks/:id      - 查询任务状态
 * GET    /api/tasks          - 查询活跃任务列表
 * DELETE /api/tasks/:id      - 取消任务
 * GET    /api/tasks/:id/result - 获取任务结果（大数据单独获取）
 */

import { Router, Response } from 'express';
import { getPool } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import {
  createTask,
  getTask,
  getActiveTasks,
  getProjectTasks,
  cancelTask,
  TaskCreateParams,
} from '../services/taskRunner.js';

const router = Router();

router.use(authMiddleware);

/**
 * POST /api/tasks - 创建并启动后台生成任务
 *
 * Body: TaskCreateParams
 * Response: { task: TaskRecord }
 */
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const params = req.body as TaskCreateParams;

    // 参数验证
    if (!params.type || !['video', 'image', 'chat'].includes(params.type)) {
      res.status(400).json({ error: '无效的任务类型，支持: video, image, chat' });
      return;
    }
    if (!params.projectId) {
      res.status(400).json({ error: '缺少 projectId' });
      return;
    }
    if (!params.prompt) {
      res.status(400).json({ error: '缺少 prompt' });
      return;
    }

    const task = await createTask(getPool(), req.userId!, params);

    // 返回任务信息（不含大数据字段）
    res.json({
      task: {
        id: task.id,
        type: task.type,
        status: task.status,
        modelId: task.model_id,
        progress: task.progress,
        targetType: task.target_type,
        targetShotId: task.target_shot_id,
        targetEntityId: task.target_entity_id,
        createdAt: task.created_at,
      },
    });
  } catch (err: any) {
    console.error('创建任务失败:', err.message);
    res.status(500).json({ error: err.message || '创建任务失败' });
  }
});

/**
 * GET /api/tasks - 查询活跃任务列表
 *
 * Query: ?project_id=xxx - 按项目筛选
 *        ?all=true      - 包含已完成任务（最近50条）
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const projectId = req.query.project_id as string | undefined;
    const includeAll = req.query.all === 'true';

    let tasks;
    if (includeAll && projectId) {
      tasks = await getProjectTasks(getPool(), req.userId!, projectId);
    } else {
      tasks = await getActiveTasks(getPool(), req.userId!, projectId);
    }

    // 精简返回数据（不含 params 和 result 大字段）
    const simplified = tasks.map(t => ({
      id: t.id,
      projectId: t.project_id,
      type: t.type,
      status: t.status,
      modelId: t.model_id,
      progress: t.progress,
      error: t.error,
      providerTaskId: t.provider_task_id,
      provider: t.provider,
      targetType: t.target_type,
      targetShotId: t.target_shot_id,
      targetEntityId: t.target_entity_id,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      completedAt: t.completed_at,
    }));

    res.json({ tasks: simplified });
  } catch (err: any) {
    console.error('获取任务列表失败:', err.message);
    res.status(500).json({ error: '获取任务列表失败' });
  }
});

/**
 * GET /api/tasks/:id - 查询单个任务状态
 *
 * Query: ?include_result=true - 包含结果数据
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const task = await getTask(getPool(), req.userId!, req.params.id as string);
    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    const includeResult = req.query.include_result === 'true';

    const response: any = {
      id: task.id,
      projectId: task.project_id,
      type: task.type,
      status: task.status,
      modelId: task.model_id,
      progress: task.progress,
      error: task.error,
      providerTaskId: task.provider_task_id,
      provider: task.provider,
      targetType: task.target_type,
      targetShotId: task.target_shot_id,
      targetEntityId: task.target_entity_id,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      completedAt: task.completed_at,
    };

    if (includeResult && task.status === 'completed' && task.result) {
      response.result = task.result;
    }

    res.json({ task: response });
  } catch (err: any) {
    console.error('获取任务失败:', err.message);
    res.status(500).json({ error: '获取任务失败' });
  }
});

/**
 * GET /api/tasks/:id/result - 单独获取任务结果
 *
 * 大数据（base64图片/视频）通过此接口单独获取
 */
router.get('/:id/result', async (req: AuthRequest, res: Response) => {
  try {
    const task = await getTask(getPool(), req.userId!, req.params.id as string);
    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    if (task.status !== 'completed') {
      res.status(400).json({ error: '任务未完成', status: task.status });
      return;
    }

    if (!task.result) {
      res.status(404).json({ error: '任务结果为空' });
      return;
    }

    // OpenAI-image 任务结果为 JSON {"base64":"...","url":"..."}
    // 优先返回 URL（体积小），前端用 URL 显示图片
    let result = task.result;
    let resultUrl: string | undefined;
    if (result.startsWith('{')) {
      try {
        const parsed = JSON.parse(result);
        if (parsed.url) resultUrl = parsed.url;
        if (parsed.base64) result = parsed.base64;
      } catch { /* 非 JSON，忽略 */ }
    }

    res.json({ result: resultUrl || result, resultUrl });
  } catch (err: any) {
    console.error('获取任务结果失败:', err.message);
    res.status(500).json({ error: '获取任务结果失败' });
  }
});

/**
 * DELETE /api/tasks/:id - 取消任务
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const success = await cancelTask(getPool(), req.userId!, req.params.id as string);
    if (!success) {
      res.status(400).json({ error: '无法取消该任务（可能已完成或不存在）' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('取消任务失败:', err.message);
    res.status(500).json({ error: '取消任务失败' });
  }
});

export default router;
