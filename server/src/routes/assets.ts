import { Router, Response } from 'express';
import { getPool } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { RowDataPacket } from 'mysql2';

const router = Router();

router.use(authMiddleware);

interface AssetRow extends RowDataPacket {
  id: string;
  data: string;
}

/**
 * GET /api/assets - 获取当前用户所有资产库项目
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const [rows] = await getPool().execute<AssetRow[]>(
      'SELECT data FROM asset_library WHERE user_id = ? ORDER BY updated_at DESC',
      [req.userId]
    );

    const items = rows.map(r => JSON.parse(r.data));
    console.log(`📦 [Assets] GET /api/assets → userId=${req.userId}, 返回 ${items.length} 个资产`);
    res.json(items);
  } catch (err) {
    console.error('❌ [Assets] 获取资产库失败:', err);
    res.status(500).json({ error: '获取资产库失败' });
  }
});

/**
 * PUT /api/assets/:id - 保存/更新资产
 */
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const item = req.body;
    const data = JSON.stringify(item);

    console.log(`📦 [Assets] PUT /api/assets/${req.params.id} → userId=${req.userId}, type=${item.type}, name=${item.name}, dataSize=${(data.length / 1024).toFixed(1)}KB`);

    await getPool().execute(
      `INSERT INTO asset_library (id, user_id, name, type, data)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), data = VALUES(data), updated_at = CURRENT_TIMESTAMP`,
      [req.params.id, req.userId, item.name || '', item.type || '', data]
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
