import { Router, Response } from 'express';
import { getPool } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { RowDataPacket } from 'mysql2';

const router = Router();

router.use(authMiddleware);

interface PreferencesRow extends RowDataPacket {
  theme: string;
  onboarding_completed: number;
}

/**
 * 带自动重试的查询执行器
 * 处理 ECONNRESET 等瞬时连接错误，自动重试一次
 */
async function executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (err?.code === 'ECONNRESET' || err?.code === 'PROTOCOL_CONNECTION_LOST') {
      return await fn();
    }
    throw err;
  }
}

/**
 * GET /api/preferences - 获取当前用户偏好设置
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await executeWithRetry(() =>
      getPool().execute<PreferencesRow[]>(
        'SELECT theme, onboarding_completed FROM user_preferences WHERE user_id = ?',
        [req.userId]
      )
    );

    if (rows.length === 0) {
      res.json({ theme: 'dark', onboarding_completed: false });
      return;
    }

    res.json({
      theme: rows[0].theme,
      onboarding_completed: !!rows[0].onboarding_completed,
    });
  } catch (err) {
    console.error('获取用户偏好失败:', err);
    res.status(500).json({ error: '获取用户偏好失败' });
  }
});

/**
 * PUT /api/preferences - 更新用户偏好设置
 */
router.put('/', async (req: AuthRequest, res: Response) => {
  try {
    const { theme, onboarding_completed } = req.body;

    await executeWithRetry(() =>
      getPool().execute(
        `INSERT INTO user_preferences (user_id, theme, onboarding_completed)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           theme = COALESCE(VALUES(theme), theme),
           onboarding_completed = COALESCE(VALUES(onboarding_completed), onboarding_completed),
           updated_at = CURRENT_TIMESTAMP`,
        [
          req.userId,
          theme ?? 'dark',
          onboarding_completed ? 1 : 0,
        ]
      )
    );

    res.json({ success: true });
  } catch (err) {
    console.error('更新用户偏好失败:', err);
    res.status(500).json({ error: '更新用户偏好失败' });
  }
});

export default router;
