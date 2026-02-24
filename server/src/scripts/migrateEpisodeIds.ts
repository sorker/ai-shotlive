/**
 * 一次性迁移脚本：将 episode_id = '' 的记录关联到项目当前选中的 selected_episode_id
 *
 * 运行方式：npx tsx server/src/scripts/migrateEpisodeIds.ts
 *
 * 用于修复：引入 episode 隔离后，旧数据的 episode_id 为空导致图片/视频 404 的问题
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const TABLES = [
  'script_characters',
  'character_variations',
  'script_scenes',
  'script_props',
  'story_paragraphs',
  'shots',
  'shot_keyframes',
  'shot_video_intervals',
  'render_logs',
];

async function migrate() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT) || 3306,
    user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'aishotlive',
  });

  const conn = await pool.getConnection();
  try {
    console.log('🔄 开始迁移 episode_id...\n');

    for (const table of TABLES) {
      try {
        const [needMigration] = await conn.execute<any[]>(
          `SELECT COUNT(*) AS cnt FROM \`${table}\` WHERE episode_id = '' OR episode_id IS NULL`
        );
        const cnt = needMigration[0]?.cnt ?? 0;
        if (cnt > 0) {
          const [result] = await conn.execute(
            `UPDATE \`${table}\` t
             INNER JOIN projects p ON t.project_id = p.id AND t.user_id = p.user_id
             SET t.episode_id = COALESCE(NULLIF(TRIM(p.selected_episode_id), ''), '_default')
             WHERE t.episode_id = '' OR t.episode_id IS NULL`
          );
          const affected = (result as any).affectedRows ?? 0;
          console.log(`  ✅ ${table}: 已迁移 ${affected} 条记录`);
        } else {
          console.log(`  ⏭️  ${table}: 无需迁移`);
        }
      } catch (err: any) {
        console.warn(`  ⚠️  ${table}: 迁移失败 - ${err.message}`);
      }
    }

    console.log('\n✅ episode_id 迁移完成');
  } finally {
    conn.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('迁移失败:', err);
  process.exit(1);
});
