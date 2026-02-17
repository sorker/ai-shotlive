/**
 * 一次性迁移脚本：将数据库中的 base64 图片/视频数据提取为文件
 *
 * 运行方式：npx tsx server/src/scripts/migrateBase64ToFiles.ts
 *
 * 处理的表和字段：
 * - script_characters.reference_image → data/{projectId}/character/{charId}.ext
 * - script_characters.turnaround_image → data/{projectId}/turnaround/{charId}.ext
 * - character_variations.reference_image → data/{projectId}/variation/{varId}.ext
 * - script_scenes.reference_image → data/{projectId}/scene/{sceneId}.ext
 * - script_props.reference_image → data/{projectId}/prop/{propId}.ext
 * - shot_keyframes.image_url → data/{projectId}/keyframe/{kfId}.ext
 * - shot_video_intervals.video_url → data/{projectId}/video/{videoId}.ext
 * - shots.nine_grid_image → data/{projectId}/ninegrid/{shotId}.ext
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { resolveToFilePath, isBase64DataUri, extractBase64FromValue } from '../services/fileStorage.js';

interface MigrationTarget {
  table: string;
  idColumn: string;
  imageColumn: string;
  entityType: string;
  projectIdColumn: string;
}

const TARGETS: MigrationTarget[] = [
  { table: 'script_characters', idColumn: 'id', imageColumn: 'reference_image', entityType: 'character', projectIdColumn: 'project_id' },
  { table: 'script_characters', idColumn: 'id', imageColumn: 'turnaround_image', entityType: 'turnaround', projectIdColumn: 'project_id' },
  { table: 'character_variations', idColumn: 'id', imageColumn: 'reference_image', entityType: 'variation', projectIdColumn: 'project_id' },
  { table: 'script_scenes', idColumn: 'id', imageColumn: 'reference_image', entityType: 'scene', projectIdColumn: 'project_id' },
  { table: 'script_props', idColumn: 'id', imageColumn: 'reference_image', entityType: 'prop', projectIdColumn: 'project_id' },
  { table: 'shot_keyframes', idColumn: 'id', imageColumn: 'image_url', entityType: 'keyframe', projectIdColumn: 'project_id' },
  { table: 'shot_video_intervals', idColumn: 'id', imageColumn: 'video_url', entityType: 'video', projectIdColumn: 'project_id' },
  { table: 'shots', idColumn: 'id', imageColumn: 'nine_grid_image', entityType: 'ninegrid', projectIdColumn: 'project_id' },
];

async function migrate() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT) || 3306,
    user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'bigbanana',
    connectionLimit: 5,
  });

  console.log('🔄 开始迁移 base64 数据到文件...\n');

  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const target of TARGETS) {
    console.log(`── 处理 ${target.table}.${target.imageColumn} (${target.entityType}) ──`);

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT ${target.idColumn} AS entity_id, ${target.projectIdColumn} AS project_id, ${target.imageColumn} AS value
       FROM ${target.table}
       WHERE ${target.imageColumn} IS NOT NULL AND ${target.imageColumn} != ''`
    );

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of rows) {
      const { entity_id, project_id, value } = row;

      // 提取 base64（处理 JSON 脏数据）
      let base64Val = value;
      if (value.startsWith('{')) {
        const extracted = extractBase64FromValue(value);
        if (extracted) {
          base64Val = extracted;
        } else {
          skipped++;
          continue;
        }
      }

      if (!isBase64DataUri(base64Val)) {
        skipped++;
        continue;
      }

      try {
        const filePath = resolveToFilePath(project_id, target.entityType, entity_id, base64Val);
        if (filePath && filePath !== base64Val) {
          await pool.execute(
            `UPDATE ${target.table} SET ${target.imageColumn} = ? WHERE ${target.idColumn} = ? AND ${target.projectIdColumn} = ?`,
            [filePath, entity_id, project_id]
          );
          migrated++;
          if (migrated <= 3) {
            console.log(`  ✅ ${entity_id} → ${filePath}`);
          }
        } else {
          skipped++;
        }
      } catch (err: any) {
        errors++;
        console.error(`  ❌ ${entity_id}: ${err.message}`);
      }
    }

    if (migrated > 3) {
      console.log(`  ... 等 ${migrated} 条记录`);
    }
    console.log(`  总计: ${migrated} 迁移, ${skipped} 跳过, ${errors} 失败\n`);
    totalMigrated += migrated;
    totalSkipped += skipped;
    totalErrors += errors;
  }

  console.log('========================================');
  console.log(`✅ 迁移完成！`);
  console.log(`   迁移: ${totalMigrated}`);
  console.log(`   跳过: ${totalSkipped} (非 base64 或已迁移)`);
  console.log(`   失败: ${totalErrors}`);
  console.log('========================================');

  await pool.end();
  process.exit(0);
}

migrate().catch(err => {
  console.error('迁移失败:', err);
  process.exit(1);
});
