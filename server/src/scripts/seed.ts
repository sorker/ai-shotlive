/**
 * 种子脚本：创建默认用户并导入浏览器导出的数据（规范化存储）
 * 用法: npx tsx server/src/scripts/seed.ts [json文件路径]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getPool, initDatabase } from '../config/database.js';
import { saveProjectNormalized } from '../services/projectStorage.js';
import { RowDataPacket } from 'mysql2';

interface UserRow extends RowDataPacket {
  id: number;
}

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin123';

async function seed() {
  console.log('🔧 开始初始化数据（规范化存储模式）...\n');

  // 1. 初始化数据库表（包括所有新的规范化子表）
  await initDatabase();

  const pool = getPool();

  // 2. 创建默认用户
  const [existing] = await pool.execute<UserRow[]>(
    'SELECT id FROM users WHERE username = ?',
    [DEFAULT_USERNAME]
  );

  let userId: number;

  if (existing.length > 0) {
    userId = existing[0].id;
    console.log(`👤 用户 "${DEFAULT_USERNAME}" 已存在 (ID: ${userId})，跳过创建`);
  } else {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, salt);
    const [result] = await pool.execute(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [DEFAULT_USERNAME, passwordHash]
    );
    userId = (result as any).insertId;
    console.log(`✅ 已创建默认用户: ${DEFAULT_USERNAME} / ${DEFAULT_PASSWORD} (ID: ${userId})`);
  }

  // 3. 导入 JSON 数据（如果提供了文件路径）
  const jsonPath = process.argv[2];
  if (jsonPath) {
    const fullPath = path.resolve(jsonPath);
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ 文件不存在: ${fullPath}`);
      process.exit(1);
    }

    console.log(`\n📂 正在读取: ${fullPath}`);
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const payload = JSON.parse(raw);

    if (!payload.stores) {
      console.error('❌ JSON 格式不正确，缺少 stores 字段');
      process.exit(1);
    }

    // ── 导入项目（规范化存储） ──
    const projects = payload.stores.projects || [];
    let projectCount = 0;

    for (const project of projects) {
      const conn = await pool.getConnection();
      try {
        console.log(`\n📋 正在导入项目: ${project.title || project.id}`);

        // 统计数据量
        const chapterCount = (project.novelChapters || []).length;
        const episodeCount = (project.novelEpisodes || []).length;
        const charCount = (project.scriptData?.characters || []).length;
        const sceneCount = (project.scriptData?.scenes || []).length;
        const propCount = (project.scriptData?.props || []).length;
        const shotCount = (project.shots || []).length;
        const logCount = (project.renderLogs || []).length;

        console.log(`   📖 小说章节: ${chapterCount}`);
        console.log(`   🎬 剧集: ${episodeCount}`);
        console.log(`   👤 角色: ${charCount}`);
        console.log(`   🏠 场景: ${sceneCount}`);
        console.log(`   🎭 道具: ${propCount}`);
        console.log(`   🎥 镜头: ${shotCount}`);
        console.log(`   📊 渲染日志: ${logCount}`);

        await conn.beginTransaction();
        await saveProjectNormalized(conn, userId, project);
        await conn.commit();

        projectCount++;
        console.log(`   ✅ 项目导入成功！数据已分散到 ${11} 张规范化表中`);
      } catch (err) {
        try { await conn.rollback(); } catch { /* ignore */ }
        console.error(`   ❌ 项目导入失败:`, err);
        throw err;
      } finally {
        conn.release();
      }
    }

    // ── 导入资产库 ──
    const assets = payload.stores.assetLibrary || [];
    let assetCount = 0;
    if (assets.length > 0) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const item of assets) {
          const data = JSON.stringify(item);
          await conn.execute(
            `INSERT INTO asset_library (id, user_id, name, type, data)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), data = VALUES(data)`,
            [item.id, userId, item.name || '', item.type || '', data]
          );
          assetCount++;
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }

    console.log(`\n✅ 导入完成: ${projectCount} 个项目, ${assetCount} 个资产`);
  } else {
    console.log('\n💡 提示: 可以传入 JSON 文件路径来导入浏览器导出的数据');
    console.log('   例如: npx tsx server/src/scripts/seed.ts ./backup.json');
  }

  // 4. 验证规范化数据
  if (process.argv[2]) {
    console.log('\n🔍 验证规范化数据...');
    const tables = [
      'projects', 'novel_chapters', 'novel_episodes',
      'script_characters', 'character_variations',
      'script_scenes', 'script_props', 'story_paragraphs',
      'shots', 'shot_keyframes', 'shot_video_intervals', 'render_logs',
    ];
    for (const table of tables) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) as cnt FROM \`${table}\` WHERE user_id = ?`,
        [userId]
      );
      const cnt = rows[0]?.cnt || 0;
      console.log(`   ${table}: ${cnt} 行`);
    }
  }

  console.log('\n🎉 初始化完成！');
  console.log(`   用户名: ${DEFAULT_USERNAME}`);
  console.log(`   密码: ${DEFAULT_PASSWORD}`);

  await pool.end();
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ 初始化失败:', err);
  process.exit(1);
});
