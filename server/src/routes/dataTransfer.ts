/**
 * 数据导出/导入路由
 *
 * 导出：将当前用户的全部数据库数据 + data/ 文件夹打包为 ZIP 下载
 * 导入：上传 ZIP 包，自动创建新用户并导入全部数据
 */

import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import JSZip from 'jszip';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { getPool } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { RowDataPacket } from 'mysql2';
import {
  exportAllProjects,
  saveProjectNormalized,
} from '../services/projectStorage.js';

const router = Router();
router.use(authMiddleware);

const DATA_ROOT = path.resolve(process.cwd(), 'data');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
});

// ─── 辅助：递归将目录加入 ZIP ────────────────────────────────────

function addDirectoryToZip(zip: JSZip, dirPath: string, zipPath: string): void {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const entryZipPath = `${zipPath}/${entry.name}`;
    if (entry.isDirectory()) {
      addDirectoryToZip(zip, fullPath, entryZipPath);
    } else if (entry.isFile()) {
      zip.file(entryZipPath, fs.readFileSync(fullPath));
    }
  }
}

// ─── GET /api/data-transfer/export ─ 导出当前用户数据 ─────────────

router.get('/export', async (req: AuthRequest, res: Response) => {
  try {
    const pool = getPool();
    const userId = req.userId!;
    const username = req.username || 'unknown';

    // 1. 导出全部项目（含完整子表数据）
    const projects = await exportAllProjects(pool, userId);

    // 2. 导出资产库
    const [assetRows] = await pool.execute<RowDataPacket[]>(
      'SELECT data FROM asset_library WHERE user_id = ?',
      [userId]
    );
    const assetLibrary = assetRows
      .map((r) => { try { return JSON.parse(r.data); } catch { return null; } })
      .filter(Boolean);

    // 3. 导出视觉风格
    const [styleRows] = await pool.execute<RowDataPacket[]>(
      `SELECT value, label, \`desc\`, prompt, prompt_cn,
              negative_prompt, scene_negative_prompt, sort_order, is_default
       FROM visual_styles WHERE user_id = ?`,
      [userId]
    );

    // 4. 导出模型配置
    const [modelRows] = await pool.execute<RowDataPacket[]>(
      'SELECT data FROM model_registry WHERE user_id = ?',
      [userId]
    );
    const modelRegistry = modelRows.length > 0
      ? (() => { try { return JSON.parse(modelRows[0].data); } catch { return null; } })()
      : null;

    // 5. 导出用户偏好
    const [prefRows] = await pool.execute<RowDataPacket[]>(
      'SELECT theme, onboarding_completed FROM user_preferences WHERE user_id = ?',
      [userId]
    );
    const preferences = prefRows.length > 0
      ? { theme: prefRows[0].theme, onboarding_completed: !!prefRows[0].onboarding_completed }
      : null;

    // 组装 db.json
    const dbPayload = {
      version: 1,
      exportedAt: Date.now(),
      username,
      projects,
      assetLibrary,
      visualStyles: styleRows,
      modelRegistry,
      preferences,
    };

    // 创建 ZIP
    const zip = new JSZip();
    zip.file('db.json', JSON.stringify(dbPayload, null, 2));

    // 6. 收集当前用户所有项目的 data/ 文件
    const projectIds = projects.map((p: any) => p.id);
    for (const pid of projectIds) {
      const projDir = path.join(DATA_ROOT, pid);
      if (fs.existsSync(projDir)) {
        addDirectoryToZip(zip, projDir, `data/${pid}`);
      }
    }

    // 生成 ZIP 并返回
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="aishotlive_backup_${username}_${timestamp}.zip"`,
      'Content-Length': String(zipBuffer.length),
    });
    res.send(zipBuffer);
  } catch (err) {
    console.error('导出数据失败:', err);
    res.status(500).json({ error: '导出数据失败' });
  }
});

// ─── POST /api/data-transfer/import ─ 导入数据（新建用户）─────────

router.post('/import', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: '请上传 ZIP 备份文件' });
      return;
    }

    // 1. 解析 ZIP
    const zip = await JSZip.loadAsync(file.buffer);
    const dbJsonFile = zip.file('db.json');
    if (!dbJsonFile) {
      res.status(400).json({ error: '备份文件格式不正确：缺少 db.json' });
      return;
    }

    const dbPayload = JSON.parse(await dbJsonFile.async('string'));
    if (!dbPayload.projects || !Array.isArray(dbPayload.projects)) {
      res.status(400).json({ error: '备份文件格式不正确：projects 数据异常' });
      return;
    }

    // 2. 生成新用户名和默认密码
    const originalUsername = dbPayload.username || 'unknown';
    const suffix = Date.now().toString(36);
    let newUsername = `${originalUsername}_imported_${suffix}`;

    // 确保用户名唯一
    const pool = getPool();
    const [existingUsers] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM users WHERE username = ?',
      [newUsername]
    );
    if (existingUsers.length > 0) {
      newUsername = `${originalUsername}_imported_${suffix}_${Math.random().toString(36).slice(2, 6)}`;
    }

    const defaultPassword = '123456';
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(defaultPassword, salt);

    // 3. 创建新用户
    const [userResult] = await pool.execute(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [newUsername, passwordHash]
    );
    const newUserId = (userResult as any).insertId as number;
    console.log(`📦 导入数据：创建新用户 ${newUsername} (ID: ${newUserId})`);

    // 4. 导入项目数据
    const conn = await pool.getConnection();
    let projectsWritten = 0;
    let assetsWritten = 0;

    try {
      await conn.beginTransaction();

      for (const project of dbPayload.projects) {
        await saveProjectNormalized(conn, newUserId, project);
        projectsWritten++;
      }

      // 5. 导入资产库
      for (const item of dbPayload.assetLibrary || []) {
        const data = JSON.stringify(item);
        await conn.execute(
          `INSERT INTO asset_library (id, user_id, name, type, data)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), data = VALUES(data)`,
          [item.id, newUserId, item.name || '', item.type || '', data]
        );
        assetsWritten++;
      }

      // 6. 导入视觉风格
      for (const style of dbPayload.visualStyles || []) {
        await conn.execute(
          `INSERT INTO visual_styles
           (user_id, value, label, \`desc\`, prompt, prompt_cn, negative_prompt, scene_negative_prompt, sort_order, is_default)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             label = VALUES(label), \`desc\` = VALUES(\`desc\`),
             prompt = VALUES(prompt), prompt_cn = VALUES(prompt_cn),
             negative_prompt = VALUES(negative_prompt),
             scene_negative_prompt = VALUES(scene_negative_prompt),
             sort_order = VALUES(sort_order)`,
          [
            newUserId, style.value || '', style.label || '', style.desc || '',
            style.prompt || null, style.prompt_cn || null,
            style.negative_prompt || null, style.scene_negative_prompt || null,
            style.sort_order || 0, style.is_default ? 1 : 0,
          ]
        );
      }

      // 7. 导入模型配置
      if (dbPayload.modelRegistry) {
        await conn.execute(
          `INSERT INTO model_registry (user_id, data) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE data = VALUES(data)`,
          [newUserId, JSON.stringify(dbPayload.modelRegistry)]
        );
      }

      // 8. 导入用户偏好
      if (dbPayload.preferences) {
        await conn.execute(
          `INSERT INTO user_preferences (user_id, theme, onboarding_completed) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE theme = VALUES(theme), onboarding_completed = VALUES(onboarding_completed)`,
          [
            newUserId,
            dbPayload.preferences.theme || 'dark',
            dbPayload.preferences.onboarding_completed ? 1 : 0,
          ]
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      // 清理已创建的用户
      await pool.execute('DELETE FROM users WHERE id = ?', [newUserId]);
      throw err;
    } finally {
      conn.release();
    }

    // 9. 解压 data/ 文件夹到磁盘
    let filesExtracted = 0;
    const dataFiles = Object.keys(zip.files).filter(
      (name) => name.startsWith('data/') && !zip.files[name].dir
    );
    for (const filePath of dataFiles) {
      const content = await zip.files[filePath].async('nodebuffer');
      const absPath = path.resolve(process.cwd(), filePath);
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(absPath, content);
      filesExtracted++;
    }

    console.log(
      `✅ 导入完成：用户 ${newUsername}，${projectsWritten} 个项目，${assetsWritten} 个资产，${filesExtracted} 个文件`
    );

    res.json({
      success: true,
      newUser: {
        username: newUsername,
        defaultPassword,
      },
      stats: {
        projects: projectsWritten,
        assets: assetsWritten,
        files: filesExtracted,
      },
    });
  } catch (err) {
    console.error('导入数据失败:', err);
    res.status(500).json({ error: '导入数据失败' });
  }
});

export default router;
