import { Router, Response } from 'express';
import { getPool } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { RowDataPacket } from 'mysql2';
import {
  saveProjectNormalized,
  fetchBase64Backup,
  loadProjectNormalized,
  loadProjectList,
  exportAllProjects,
} from '../services/projectStorage.js';
import { withProjectLock } from '../utils/projectMutex.js';

const router = Router();

router.use(authMiddleware);

/**
 * GET /api/projects - 获取当前用户所有项目（轻量元数据）
 *
 * 规范化后：只查 projects 表的结构化列，不再加载子表数据，
 * 列表页响应速度大幅提升。
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const projects = await loadProjectList(getPool(), req.userId!);
    res.json(projects);
  } catch (err) {
    console.error('获取项目列表失败:', err);
    res.status(500).json({ error: '获取项目列表失败' });
  }
});

/**
 * GET /api/projects/:id - 获取单个项目完整数据
 *
 * 规范化后：从 12 张表并行查询，组装为 ProjectState 返回。
 * 每张表的单行数据量合理（单张图片 / 单个章节），无超大包问题。
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const project = await loadProjectNormalized(getPool(), req.userId!, req.params.id as string);
    if (!project) {
      res.status(404).json({ error: '项目不存在' });
      return;
    }
    res.json(project);
  } catch (err) {
    console.error('获取项目失败:', err);
    res.status(500).json({ error: '获取项目失败' });
  }
});

/**
 * PUT /api/projects/:id - 保存/更新项目（规范化存储）
 *
 * 核心改动：不再把整个 ProjectState 序列化成一个 JSON 塞进一条记录，
 * 而是在事务中将数据拆解存入各子表，每条 INSERT 只包含一个实体。
 *
 * 并发保护：使用 per-project mutex 串行化同一项目的保存请求，
 * 避免 MySQL Lock wait timeout。加 retry 应对偶发锁冲突。
 */
router.put('/:id', async (req: AuthRequest, res: Response) => {
  const projectId = req.params.id as string;
  const userId = req.userId!;

  try {
    await withProjectLock(userId, projectId, async () => {
      await saveProjectWithRetry(userId, { ...req.body, id: projectId });
    });

    res.json({ success: true });
  } catch (err) {
    console.error('保存项目失败:', err);
    res.status(500).json({ error: '保存项目失败' });
  }
});

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

async function saveProjectWithRetry(
  userId: number,
  project: any,
): Promise<void> {
  const pool = getPool();

  // Pre-fetch base64 backup OUTSIDE the transaction to reduce lock duration.
  // These are read-only SELECTs that don't need transactional isolation.
  const backup = await fetchBase64Backup(pool, userId, project.id);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await saveProjectNormalized(conn, userId, project, backup);
      await conn.commit();
      return;
    } catch (err: any) {
      try { await conn.rollback(); } catch { /* ignore */ }

      const isLockTimeout =
        err.code === 'ER_LOCK_WAIT_TIMEOUT' ||
        err.code === 'ER_LOCK_DEADLOCK' ||
        err.errno === 1205 ||
        err.errno === 1213;

      if (isLockTimeout && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(
          `⚠️ 保存项目 ${project.id} 锁冲突 (attempt ${attempt}/${MAX_RETRIES})，${delay}ms 后重试...`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw err;
    } finally {
      conn.release();
    }
  }
}

/**
 * DELETE /api/projects/:id - 删除项目
 *
 * 所有子表都设置了 ON DELETE CASCADE，
 * 删除 projects 行会自动级联删除所有关联数据。
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const [result] = await getPool().execute(
      'DELETE FROM projects WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );

    if ((result as any).affectedRows === 0) {
      res.status(404).json({ error: '项目不存在' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('删除项目失败:', err);
    res.status(500).json({ error: '删除项目失败' });
  }
});

/**
 * GET /api/projects/:id/image/:entityType/:entityId - 按需获取图片 base64
 *
 * 当 referenceImageUrl (CDN URL) 过期无法显示时，
 * 前端通过此端点从 DB 获取 base64 作为回退。
 * entityType: character | scene | prop | variation
 */
router.get('/:id/image/:entityType/:entityId', async (req: AuthRequest, res: Response) => {
  try {
    const pool = getPool();
    const { id: projectId, entityType, entityId } = req.params;
    const userId = req.userId!;

    let query: string;
    let params: any[];
    switch (entityType) {
      case 'character':
        query = 'SELECT reference_image FROM script_characters WHERE id = ? AND project_id = ? AND user_id = ?';
        params = [entityId, projectId, userId];
        break;
      case 'scene':
        query = 'SELECT reference_image FROM script_scenes WHERE id = ? AND project_id = ? AND user_id = ?';
        params = [entityId, projectId, userId];
        break;
      case 'prop':
        query = 'SELECT reference_image FROM script_props WHERE id = ? AND project_id = ? AND user_id = ?';
        params = [entityId, projectId, userId];
        break;
      case 'variation':
        query = 'SELECT reference_image FROM character_variations WHERE id = ? AND project_id = ? AND user_id = ?';
        params = [entityId, projectId, userId];
        break;
      default:
        res.status(400).json({ error: '不支持的 entityType' });
        return;
    }

    const [rows] = await pool.execute<RowDataPacket[]>(query, params);
    if (rows.length === 0 || !rows[0].reference_image) {
      res.status(404).json({ error: '图片不存在' });
      return;
    }

    const base64 = rows[0].reference_image as string;
    // 如果是 data URL，提取 MIME 和数据，直接返回二进制图片（更高效）
    const match = base64.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      const mimeType = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      res.set('Content-Type', mimeType);
      res.set('Cache-Control', 'public, max-age=86400'); // 缓存 24h
      res.send(buffer);
    } else {
      // 返回原始值（可能是非标准格式）
      res.json({ referenceImage: base64 });
    }
  } catch (err: any) {
    console.error('获取图片 fallback 失败:', err.message);
    res.status(500).json({ error: '获取图片失败' });
  }
});

/**
 * POST /api/projects/export - 导出当前用户所有数据
 *
 * 规范化后：逐个项目从子表组装完整数据后导出。
 */
router.post('/export', async (req: AuthRequest, res: Response) => {
  try {
    const projects = await exportAllProjects(getPool(), req.userId!);

    const [assetRows] = await getPool().execute<RowDataPacket[]>(
      'SELECT data FROM asset_library WHERE user_id = ?',
      [req.userId]
    );
    const assets = assetRows.map(r => {
      try { return JSON.parse(r.data); } catch { return null; }
    }).filter(Boolean);

    res.json({
      schemaVersion: 1,
      exportedAt: Date.now(),
      scope: 'all',
      dbName: 'BigBananaDB',
      dbVersion: 2,
      stores: {
        projects,
        assetLibrary: assets,
      },
    });
  } catch (err) {
    console.error('导出失败:', err);
    res.status(500).json({ error: '导出失败' });
  }
});

/**
 * POST /api/projects/import - 导入数据（规范化存储）
 *
 * 逐个项目通过 saveProjectNormalized 写入，
 * 每个项目的数据分散到各子表中。
 */
router.post('/import', async (req: AuthRequest, res: Response) => {
  try {
    const payload = req.body;
    const mode = payload.mode || 'merge';

    if (!payload.stores || !Array.isArray(payload.stores.projects) || !Array.isArray(payload.stores.assetLibrary)) {
      res.status(400).json({ error: '导入文件格式不正确' });
      return;
    }

    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();

      // replace 模式：先删除所有现有数据
      if (mode === 'replace') {
        await conn.execute('DELETE FROM projects WHERE user_id = ?', [req.userId]);
        await conn.execute('DELETE FROM asset_library WHERE user_id = ?', [req.userId]);
      }

      // 逐个项目写入（规范化）
      let projectsWritten = 0;
      for (const project of payload.stores.projects) {
        await saveProjectNormalized(conn, req.userId!, project);
        projectsWritten++;
      }

      // 写入资产库
      let assetsWritten = 0;
      for (const item of payload.stores.assetLibrary) {
        const data = JSON.stringify(item);
        await conn.execute(
          `INSERT INTO asset_library (id, user_id, name, type, data)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), data = VALUES(data)`,
          [item.id, req.userId, item.name || '', item.type || '', data]
        );
        assetsWritten++;
      }

      await conn.commit();
      res.json({ projects: projectsWritten, assets: assetsWritten });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('导入失败:', err);
    res.status(500).json({ error: '导入失败' });
  }
});

export default router;
