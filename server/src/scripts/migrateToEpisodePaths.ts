/**
 * 一次性迁移脚本：将旧格式数据迁移到 episode 隔离格式
 *
 * 运行方式：npm run migrate:episode-paths
 *
 * 1. 数据库：将 episode_id = '' 更新为 selected_episode_id 或 '_default'
 * 2. 文件：将 data/{projectId}/{entityType}/ 下的文件移动到 data/{projectId}/{episodeId}/{entityType}/
 * 3. 数据库路径：将 reference_image 等字段中的旧路径更新为新路径
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DATA_ROOT = path.resolve(process.cwd(), 'data');

interface TableImageConfig {
  table: string;
  idColumn: string;
  imageColumn: string;
  entityType: string;
  projectIdColumn: string;
  episodeIdColumn: string;
}

const IMAGE_TABLES: TableImageConfig[] = [
  { table: 'script_characters', idColumn: 'id', imageColumn: 'reference_image', entityType: 'character', projectIdColumn: 'project_id', episodeIdColumn: 'episode_id' },
  { table: 'script_characters', idColumn: 'id', imageColumn: 'turnaround_image', entityType: 'turnaround', projectIdColumn: 'project_id', episodeIdColumn: 'episode_id' },
  { table: 'character_variations', idColumn: 'id', imageColumn: 'reference_image', entityType: 'variation', projectIdColumn: 'project_id', episodeIdColumn: 'episode_id' },
  { table: 'script_scenes', idColumn: 'id', imageColumn: 'reference_image', entityType: 'scene', projectIdColumn: 'project_id', episodeIdColumn: 'episode_id' },
  { table: 'script_props', idColumn: 'id', imageColumn: 'reference_image', entityType: 'prop', projectIdColumn: 'project_id', episodeIdColumn: 'episode_id' },
  { table: 'shot_keyframes', idColumn: 'id', imageColumn: 'image_url', entityType: 'keyframe', projectIdColumn: 'project_id', episodeIdColumn: 'episode_id' },
  { table: 'shot_video_intervals', idColumn: 'id', imageColumn: 'video_url', entityType: 'video', projectIdColumn: 'project_id', episodeIdColumn: 'episode_id' },
  { table: 'shots', idColumn: 'id', imageColumn: 'nine_grid_image', entityType: 'ninegrid', projectIdColumn: 'project_id', episodeIdColumn: 'episode_id' },
];

const TABLES_EPISODE_ONLY = [
  'story_paragraphs',
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
    console.log('🔄 开始迁移到 episode 隔离格式...\n');

    // === 步骤 1: 修复 episode_id ===
    console.log('── 步骤 1: 修复数据库 episode_id ──');
    const allTables = [...new Set([...IMAGE_TABLES.map(t => t.table), ...TABLES_EPISODE_ONLY])];
    let step1Total = 0;
    for (const t of allTables) {
      try {
        const [countRows] = await conn.execute<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt FROM \`${t}\` WHERE episode_id = '' OR episode_id IS NULL`
        );
        const needFix = countRows[0]?.cnt ?? 0;
        if (needFix > 0) {
          const [result] = await conn.execute(
            `UPDATE \`${t}\` tr
             INNER JOIN projects p ON tr.project_id = p.id AND tr.user_id = p.user_id
             SET tr.episode_id = COALESCE(NULLIF(TRIM(p.selected_episode_id), ''), '_default')
             WHERE tr.episode_id = '' OR tr.episode_id IS NULL`
          );
          const affected = (result as any).affectedRows ?? 0;
          console.log(`  ✅ ${t}: ${affected} 条`);
          step1Total += affected;
        } else {
          console.log(`  ⏭️  ${t}: 无需迁移`);
        }
      } catch (e: any) {
        console.warn(`  ⚠️  ${t}: ${e.message}`);
      }
    }
    if (step1Total === 0) {
      console.log('  （所有表的 episode_id 已正确设置，可能已在服务启动时完成迁移）');
    }

    // === 步骤 2: 移动文件并更新数据库路径 ===
    console.log('\n── 步骤 2: 移动文件并更新数据库路径 ──');

    for (const cfg of IMAGE_TABLES) {
      try {
        const [rows] = await conn.execute<mysql.RowDataPacket[]>(
          `SELECT ${cfg.idColumn} AS entity_id, ${cfg.projectIdColumn} AS project_id, ${cfg.episodeIdColumn} AS episode_id, ${cfg.imageColumn} AS file_path
           FROM \`${cfg.table}\`
           WHERE ${cfg.imageColumn} IS NOT NULL AND ${cfg.imageColumn} != ''
             AND ${cfg.imageColumn} LIKE 'data/%'
             AND ${cfg.imageColumn} LIKE 'data/%/%/%' AND ${cfg.imageColumn} NOT LIKE 'data/%/%/%/%'`
        );

        let moved = 0;
        if (rows.length > 0) {
          console.log(`  ${cfg.table}.${cfg.imageColumn}: ${rows.length} 条可能需迁移`);
        }

        for (const row of rows) {
          const { entity_id, project_id, episode_id, file_path } = row;
          const ep = (episode_id && String(episode_id).trim()) ? String(episode_id).trim() : '_default';

          // 旧路径: data/projectId/entityType/file.ext
          // 新路径: data/projectId/episodeId/entityType/file.ext
          const oldMatch = file_path.match(/^data\/([^/]+)\/([^/]+)\/([^/]+)$/);
          if (!oldMatch) continue;

          const [, projId, entityType, fileName] = oldMatch;
          if (entityType !== cfg.entityType) continue;

          const oldFullPath = path.join(DATA_ROOT, projId, entityType, fileName);
          const newDir = path.join(DATA_ROOT, projId, ep, entityType);
          const newFullPath = path.join(newDir, fileName);

          if (!fs.existsSync(oldFullPath)) continue;

          try {
            if (!fs.existsSync(newDir)) {
              fs.mkdirSync(newDir, { recursive: true });
            }
            fs.renameSync(oldFullPath, newFullPath);
            const newPath = `data/${projId}/${ep}/${entityType}/${fileName}`.replace(/\\/g, '/');
            await conn.execute(
              `UPDATE \`${cfg.table}\` SET ${cfg.imageColumn} = ? WHERE ${cfg.idColumn} = ? AND ${cfg.projectIdColumn} = ? AND ${cfg.episodeIdColumn} = ?`,
              [newPath, entity_id, project_id, ep]
            );
            moved++;
          } catch (e: any) {
            console.error(`    ❌ ${entity_id}: ${e.message}`);
          }
        }

        if (moved > 0) {
          console.log(`  ✅ ${cfg.table}.${cfg.imageColumn}: 已迁移 ${moved} 个文件`);
        }
      } catch (e: any) {
        console.warn(`  ⚠️  ${cfg.table}: ${e.message}`);
      }
    }

    // === 步骤 3: 移动根目录下无 episode 的旧文件 ===
    console.log('\n── 步骤 3: 移动根目录下无 episode 的旧文件 ──');

    const entityTypeDirs: Record<string, string> = {
      character: 'character',
      variation: 'variation',
      scene: 'scene',
      prop: 'prop',
      keyframe: 'keyframe',
      video: 'video',
      turnaround: 'turnaround',
      ninegrid: 'ninegrid',
    };

    if (fs.existsSync(DATA_ROOT)) {
      const projectDirs = fs.readdirSync(DATA_ROOT);
      for (const projId of projectDirs) {
        const projPath = path.join(DATA_ROOT, projId);
        if (!fs.statSync(projPath).isDirectory()) continue;

        // 获取项目默认 episode
        const [projRows] = await conn.execute<mysql.RowDataPacket[]>(
          'SELECT selected_episode_id FROM projects WHERE id = ?',
          [projId]
        );
        const ep = (projRows[0]?.selected_episode_id && String(projRows[0].selected_episode_id).trim())
          ? String(projRows[0].selected_episode_id).trim()
          : '_default';

        for (const [entityType, dirName] of Object.entries(entityTypeDirs)) {
          const oldDir = path.join(projPath, dirName);
          if (!fs.existsSync(oldDir)) continue;

          const newDir = path.join(projPath, ep, dirName);
          const files = fs.readdirSync(oldDir);
          if (files.length === 0) continue;

          if (!fs.existsSync(newDir)) {
            fs.mkdirSync(newDir, { recursive: true });
          }

          for (const file of files) {
            const oldPath = path.join(oldDir, file);
            const newPath = path.join(newDir, file);
            if (fs.statSync(oldPath).isFile()) {
              try {
                fs.renameSync(oldPath, newPath);
              } catch (e: any) {
                console.error(`    ❌ ${projId}/${dirName}/${file}: ${e.message}`);
              }
            }
          }

          try {
            if (fs.readdirSync(oldDir).length === 0) {
              fs.rmdirSync(oldDir);
            }
          } catch { /* ignore */ }
        }
      }
    }

    console.log('\n✅ 迁移完成！');
  } finally {
    conn.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('迁移失败:', err);
  process.exit(1);
});
