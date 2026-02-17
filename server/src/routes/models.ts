import { Router, Response } from 'express';
import { getPool } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { RowDataPacket } from 'mysql2';

const router = Router();

router.use(authMiddleware);

interface ModelRegistryRow extends RowDataPacket {
  data: string;
}

/**
 * GET /api/models/registry - 获取当前用户的模型注册表
 */
router.get('/registry', async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await getPool().execute<ModelRegistryRow[]>(
      'SELECT data FROM model_registry WHERE user_id = ?',
      [req.userId]
    );

    if (rows.length === 0) {
      // 返回 null 表示用户还没有保存过模型注册表，前端将使用默认值
      res.json(null);
      return;
    }

    const registry = JSON.parse(rows[0].data);
    res.json(registry);
  } catch (err) {
    console.error('获取模型注册表失败:', err);
    res.status(500).json({ error: '获取模型注册表失败' });
  }
});

/**
 * PUT /api/models/registry - 保存/更新模型注册表
 */
router.put('/registry', async (req: AuthRequest, res: Response) => {
  try {
    const data = JSON.stringify(req.body);

    await getPool().execute(
      `INSERT INTO model_registry (user_id, data)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP`,
      [req.userId, data]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('保存模型注册表失败:', err);
    res.status(500).json({ error: '保存模型注册表失败' });
  }
});

export default router;
