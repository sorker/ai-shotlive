import { Router, Response } from 'express';
import { getPool } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { RowDataPacket } from 'mysql2';

const router = Router();

router.use(authMiddleware);

interface AssetRow extends RowDataPacket {
  id: string;
  data: string;
  type?: string;
  project_id?: string | null;
  project_name?: string | null;
}

interface ProjectOptionRow extends RowDataPacket {
  project_id: string | null;
  project_name: string | null;
}

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/assets - 获取资产库
 * - 无分页参数：返回当前用户全部资产（兼容旧用法，如 Dashboard/导出）
 * - 有分页参数：分页、按类型与项目筛选，返回 { items, total, page, pageSize, projectOptions }
 * 数据库中 type 区分角色/场景/道具，project_id/project_name 用于项目隔离与筛选
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const page = req.query.page != null ? Math.max(1, parseInt(String(req.query.page), 10) || 1) : null;
    const pageSize = req.query.pageSize != null ? Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(req.query.pageSize), 10) || DEFAULT_PAGE_SIZE)) : DEFAULT_PAGE_SIZE;
    const typeFilter = (req.query.type as string) || 'all';
    const projectIdFilter = (req.query.projectId as string) || 'all';

    // 分页模式：传入 page 或显式传入 pageSize 时启用
    const usePagination = page != null || (req.query.pageSize != null && req.query.pageSize !== '');

    if (!usePagination) {
      const [rows] = await getPool().execute<AssetRow[]>(
        'SELECT data FROM asset_library WHERE user_id = ? ORDER BY updated_at DESC',
        [req.userId]
      );
      const items = rows.map(r => JSON.parse(r.data));
      console.log(`📦 [Assets] GET /api/assets → userId=${req.userId}, 返回全部 ${items.length} 个资产`);
      return res.json(items);
    }

    const currentPage = page ?? 1;
    const offset = (currentPage - 1) * pageSize;

    let where = 'user_id = ?';
    const params: (string | number)[] = [req.userId!];

    if (typeFilter !== 'all') {
      where += ' AND type = ?';
      params.push(typeFilter);
    }
    if (projectIdFilter !== 'all') {
      where += ' AND project_id = ?';
      params.push(projectIdFilter);
    }

    const [countRows] = await getPool().execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM asset_library WHERE ${where}`,
      params
    );
    const total = Number((countRows as any)[0]?.total ?? 0);

    const [rows] = await getPool().execute<AssetRow[]>(
      `SELECT data FROM asset_library WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const items = rows.map(r => JSON.parse(r.data));

    let projectOptions: { id: string; name: string }[] = [];
    try {
      const [optRows] = await getPool().execute<ProjectOptionRow[]>(
        `SELECT DISTINCT project_id, project_name FROM asset_library WHERE user_id = ? AND project_id IS NOT NULL AND TRIM(COALESCE(project_id,'')) != '' ORDER BY project_name`,
        [req.userId]
      );
      projectOptions = (optRows as ProjectOptionRow[]).map(r => ({
        id: r.project_id ?? '',
        name: (r.project_name && r.project_name.trim()) ? r.project_name.trim() : '未知项目',
      })).filter(o => o.id);
    } catch { /* 忽略 */ }

    console.log(`📦 [Assets] GET /api/assets → userId=${req.userId}, 分页 page=${currentPage} pageSize=${pageSize} type=${typeFilter} projectId=${projectIdFilter}, 返回 ${items.length}/${total}`);
    return res.json({ items, total, page: currentPage, pageSize, projectOptions });
  } catch (err) {
    console.error('❌ [Assets] 获取资产库失败:', err);
    res.status(500).json({ error: '获取资产库失败' });
  }
});

/**
 * PUT /api/assets/:id - 保存/更新资产
 * 写入 name、type、data，以及 project_id/project_name（项目隔离与筛选）
 */
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const item = req.body;
    const data = JSON.stringify(item);
    const projectId = item.projectId != null && String(item.projectId).trim() !== '' ? String(item.projectId).trim() : null;
    const projectName = item.projectName != null && String(item.projectName).trim() !== '' ? String(item.projectName).trim() : null;

    console.log(`📦 [Assets] PUT /api/assets/${req.params.id} → userId=${req.userId}, type=${item.type}, name=${item.name}, projectId=${projectId ?? 'null'}, dataSize=${(data.length / 1024).toFixed(1)}KB`);

    await getPool().execute(
      `INSERT INTO asset_library (id, user_id, name, type, project_id, project_name, data)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), project_id = VALUES(project_id), project_name = VALUES(project_name), data = VALUES(data), updated_at = CURRENT_TIMESTAMP`,
      [req.params.id, req.userId, item.name || '', item.type || '', projectId, projectName, data]
    );

    console.log(`✅ [Assets] 资产保存成功: ${req.params.id} (${item.name})`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ [Assets] 保存资产失败:', err);
    res.status(500).json({ error: '保存资产失败' });
  }
});

/**
 * DELETE /api/assets/:id - 删除资产
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    console.log(`📦 [Assets] DELETE /api/assets/${req.params.id} → userId=${req.userId}`);
    const [result] = await getPool().execute(
      'DELETE FROM asset_library WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );

    if ((result as any).affectedRows === 0) {
      console.log(`⚠️ [Assets] 资产不存在: ${req.params.id}`);
      res.status(404).json({ error: '资产不存在' });
      return;
    }

    console.log(`✅ [Assets] 资产已删除: ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ [Assets] 删除资产失败:', err);
    res.status(500).json({ error: '删除资产失败' });
  }
});

export default router;
