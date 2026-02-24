/**
 * 图片解析服务
 *
 * 将 /api/projects/:id/image/:type/:eid 解析为实际图片数据。
 * 当文件系统中不存在对应文件时，从数据库读取（base64 或文件路径）。
 */

import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { saveBase64ToFile, isBase64DataUri, isFilePath, readFileAsBuffer } from './fileStorage.js';

const IMG_NOT_NULL = (col: string) => ` AND ${col} IS NOT NULL AND ${col} != ''`;

/**
 * 从数据库获取图片原始值（必须按 episode_id 匹配）
 */
async function getImageFromDb(
  pool: Pool,
  projectId: string,
  entityType: string,
  entityId: string,
  userId: number,
  episodeId: string
): Promise<string | null> {
  const tableMap: Record<string, { table: string; column: string }> = {
    character: { table: 'script_characters', column: 'reference_image' },
    scene: { table: 'script_scenes', column: 'reference_image' },
    prop: { table: 'script_props', column: 'reference_image' },
    variation: { table: 'character_variations', column: 'reference_image' },
    keyframe: { table: 'shot_keyframes', column: 'image_url' },
    turnaround: { table: 'script_characters', column: 'turnaround_image' },
    ninegrid: { table: 'shots', column: 'nine_grid_image' },
  };

  const meta = tableMap[entityType];
  if (!meta) return null;

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${meta.column} AS img FROM \`${meta.table}\` WHERE id = ? AND project_id = ? AND user_id = ? AND episode_id = ?${IMG_NOT_NULL(meta.column)} LIMIT 1`,
    [entityId, projectId, userId, episodeId]
  );
  if (rows.length === 0 || !rows[0].img) return null;

  let val = rows[0].img as string;
  if (val.startsWith('{')) {
    try {
      const parsed = JSON.parse(val);
      val = parsed.base64 || parsed.url || val;
    } catch { /* ignore */ }
  }
  return val;
}

/**
 * 将 API URL 解析为 base64（从文件或数据库）
 */
export async function resolveApiUrlToBase64FromDb(
  pool: Pool,
  userId: number,
  url: string,
  episodeId: string
): Promise<string | null> {
  const match = url.match(/^\/api\/projects\/([^/]+)\/image\/([^/]+)\/([^/]+)$/);
  if (!match) return null;

  const [, projectId, entityType, entityId] = match;
  const fromDb = await getImageFromDb(pool, projectId, entityType, entityId, userId, episodeId);
  if (!fromDb) return null;

  if (isBase64DataUri(fromDb)) return fromDb;
  if (isFilePath(fromDb)) {
    const fileData = readFileAsBuffer(fromDb);
    if (fileData) {
      return `data:${fileData.mime};base64,${fileData.buffer.toString('base64')}`;
    }
  }
  return null;
}

/**
 * 将 API URL 解析并保存到目标实体路径（用于资产库替换等跨项目/剧本导入）
 */
export async function resolveApiUrlToFilePath(
  pool: Pool,
  userId: number,
  targetProjectId: string,
  targetEntityType: string,
  targetEntityId: string,
  apiUrl: string,
  targetEpisodeId: string
): Promise<string | null> {
  const [cleanPath, queryStr] = apiUrl.split('?');
  const srcEpisode = new URLSearchParams(queryStr || '').get('episode') || '_default';

  const b64 = await resolveApiUrlToBase64FromDb(pool, userId, cleanPath, srcEpisode);
  if (!b64) return null;

  return saveBase64ToFile(targetProjectId, targetEntityType, targetEntityId, b64, targetEpisodeId);
}
