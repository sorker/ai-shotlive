/**
 * 视频剪辑状态 API
 * 按 project_id + episode_id 隔离，支持多设备同步
 * 存储时使用 urlRef 引用（不含完整 URL），降低网络与存储压力
 */

import { Router, Response } from 'express';
import { getPool } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import type { RowDataPacket } from 'mysql2';

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/projects/:id/video-editor?episode=xxx
 * 获取当前剧本的剪辑状态（懒加载，仅返回 layers 的 JSON）
 */
router.get('/:id/video-editor', async (req: AuthRequest, res: Response) => {
  try {
    const pool = getPool();
    const projectId = req.params.id as string;
    const userId = req.userId!;
    const episodeId = (typeof req.query.episode === 'string' ? req.query.episode : '') || '_default';

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT data, version, updated_at FROM video_editor_states
       WHERE project_id = ? AND user_id = ? AND episode_id = ?`,
      [projectId, userId, episodeId]
    );

    if (rows.length === 0) {
      return res.json({ success: true, data: null, version: 0 });
    }

    const row = rows[0];
    let data: unknown = null;
    try {
      data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    } catch {
      // 解析失败时返回 null
    }

    res.json({
      success: true,
      data,
      version: row.version || 1,
      updatedAt: row.updated_at,
    });
  } catch (err: any) {
    console.error('GET video-editor failed:', err.message);
    res.status(500).json({ error: '获取剪辑状态失败' });
  }
});

/**
 * PUT /api/projects/:id/video-editor?episode=xxx
 * 保存剪辑状态（防抖后调用，全量替换）
 * Body: { layers: EditorLayer[], version?: number }
 * 使用 version 乐观锁，避免并发覆盖
 */
router.put('/:id/video-editor', async (req: AuthRequest, res: Response) => {
  try {
    const pool = getPool();
    const projectId = req.params.id as string;
    const userId = req.userId!;
    const episodeId = (typeof req.query.episode === 'string' ? req.query.episode : '') || '_default';
    const { layers, version: clientVersion } = req.body as { layers: unknown[]; version?: number };

    if (!Array.isArray(layers)) {
      return res.status(400).json({ error: 'layers 必须为数组' });
    }

    const data = JSON.stringify(layers);

    const conn = await pool.getConnection();
    try {
      const [existing] = await conn.execute<RowDataPacket[]>(
        `SELECT version FROM video_editor_states WHERE project_id = ? AND user_id = ? AND episode_id = ?`,
        [projectId, userId, episodeId]
      );

      if (existing.length === 0) {
        await conn.execute(
          `INSERT INTO video_editor_states (project_id, user_id, episode_id, data, version)
           VALUES (?, ?, ?, ?, 1)`,
          [projectId, userId, episodeId, data]
        );
        return res.json({ success: true, version: 1 });
      }

      const currentVersion = existing[0].version || 1;
      if (clientVersion != null && clientVersion !== currentVersion) {
        return res.status(409).json({
          error: '版本冲突，请刷新后重试',
          serverVersion: currentVersion,
        });
      }

      const newVersion = currentVersion + 1;
      await conn.execute(
        `UPDATE video_editor_states SET data = ?, version = ? WHERE project_id = ? AND user_id = ? AND episode_id = ?`,
        [data, newVersion, projectId, userId, episodeId]
      );

      res.json({ success: true, version: newVersion });
    } finally {
      conn.release();
    }
  } catch (err: any) {
    console.error('PUT video-editor failed:', err.message);
    res.status(500).json({ error: '保存剪辑状态失败' });
  }
});

export default router;
