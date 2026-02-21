/**
 * 文件存储服务
 *
 * 将 base64 图片/视频数据保存为磁盘文件，数据库中只存储文件路径。
 * 路径格式：data/{projectId}/{entityType}/{filename}
 *
 * entityType:
 *   - character   → 角色参考图
 *   - variation   → 角色变体参考图
 *   - scene       → 场景参考图
 *   - prop        → 道具参考图
 *   - keyframe    → 关键帧图片
 *   - video       → 视频片段
 *   - turnaround  → 角色转面图
 *   - ninegrid    → 九宫格图
 */

import fs from 'fs';
import path from 'path';

const DATA_ROOT = path.resolve(process.cwd(), 'data');

/**
 * MIME → 文件扩展名映射
 */
const MIME_EXT_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
};

/**
 * 判断值是否为 base64 data URI
 */
export function isBase64DataUri(val: string | null | undefined): boolean {
  return !!val && val.startsWith('data:');
}

/**
 * 判断值是否为磁盘文件路径（data/ 开头）
 */
export function isFilePath(val: string | null | undefined): boolean {
  return !!val && val.startsWith('data/');
}

/**
 * 从 base64 data URI 中提取 MIME 类型和原始数据
 */
function parseDataUri(dataUri: string): { mime: string; data: Buffer } | null {
  const match = dataUri.match(/^data:([\w+/.-]+);base64,(.+)$/s);
  if (!match) return null;
  return {
    mime: match[1],
    data: Buffer.from(match[2], 'base64'),
  };
}

/**
 * 确保目录存在
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 将 base64 data URI 保存为文件，返回相对路径
 *
 * @param projectId  项目 ID
 * @param entityType 实体类型（character / scene / keyframe / video 等）
 * @param entityId   实体 ID（用作文件名）
 * @param dataUri    base64 data URI（data:image/png;base64,xxx）
 * @returns 相对路径，如 "data/proj_xxx/character/char-001.png"，失败返回 null
 */
export function saveBase64ToFile(
  projectId: string,
  entityType: string,
  entityId: string,
  dataUri: string
): string | null {
  const parsed = parseDataUri(dataUri);
  if (!parsed) return null;

  const ext = MIME_EXT_MAP[parsed.mime] || '.bin';
  const safeEntityId = entityId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `${safeEntityId}${ext}`;
  const relDir = path.join('data', projectId, entityType);
  const absDir = path.join(DATA_ROOT, '..', relDir);

  ensureDir(absDir);

  const relPath = path.join(relDir, fileName);
  const absPath = path.join(DATA_ROOT, '..', relPath);

  fs.writeFileSync(absPath, parsed.data);

  return relPath.replace(/\\/g, '/');
}

/**
 * 从 JSON 脏数据中提取 base64
 * 处理 {"base64":"data:...","url":"..."} 格式
 */
export function extractBase64FromValue(val: string | null | undefined): string | null {
  if (!val) return null;
  if (val.startsWith('data:')) return val;
  if (val.startsWith('{')) {
    try {
      const parsed = JSON.parse(val);
      if (parsed.base64 && parsed.base64.startsWith('data:')) return parsed.base64;
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * 处理图片/视频值：
 * - 如果是 base64 → 保存为文件，返回文件路径
 * - 如果是 JSON 脏数据 → 提取 base64 保存为文件
 * - 如果是 URL 或已有文件路径 → 原样返回
 * - null/undefined → 返回 null
 */
export function resolveToFilePath(
  projectId: string | string[],
  entityType: string,
  entityId: string | string[],
  value: string | string[] | null | undefined
): string | null {
  const pid = Array.isArray(projectId) ? projectId[0] : projectId;
  const eid = Array.isArray(entityId) ? entityId[0] : entityId;
  const val = Array.isArray(value) ? value[0] : value;
  if (!val) return null;

  // 已是文件路径
  if (isFilePath(val)) return val;

  // 正常 URL（HTTP / HTTPS）→ 原样保留
  if (/^https?:\/\//i.test(val)) return val;

  // API 回退 URL → 原样保留（不应出现在写入路径，但兜底）
  if (val.startsWith('/api/')) return val;

  // base64 data URI → 保存为文件
  if (isBase64DataUri(val)) {
    return saveBase64ToFile(pid, entityType, eid, val) || null;
  }

  // JSON 脏数据 {"base64":"...","url":"..."}
  if (val.startsWith('{')) {
    try {
      const parsed = JSON.parse(val);
      // 优先保存 base64 为文件（永久可用），避免依赖可能过期的 TOS 签名 URL
      const b64 = parsed.base64;
      if (b64 && isBase64DataUri(b64)) {
        return saveBase64ToFile(pid, entityType, eid, b64) || parsed.url || null;
      }
      if (parsed.url && /^https?:\/\//i.test(parsed.url)) return parsed.url;
      return parsed.url || null;
    } catch { /* ignore */ }
  }

  // 其他原样返回
  return val;
}

/**
 * 读取文件并返回 Buffer + MIME 类型
 */
export function readFileAsBuffer(filePath: string): { buffer: Buffer; mime: string } | null {
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) return null;

  const ext = path.extname(absPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.bin': 'application/octet-stream',
  };

  return {
    buffer: fs.readFileSync(absPath),
    mime: mimeMap[ext] || 'application/octet-stream',
  };
}

/**
 * 将内部 API URL（/api/projects/:id/image/:type/:eid）解析为 base64 data URI。
 * 通过文件系统直接读取本地存储的图片，无需 HTTP 请求或数据库查询。
 */
export function resolveApiUrlToBase64(url: string): string | null {
  const match = url.match(/^\/api\/projects\/([^/]+)\/image\/([^/]+)\/([^/]+)$/);
  if (!match) return null;

  const [, projectId, entityType, entityId] = match;
  const safeEntityId = entityId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join('data', projectId, entityType);
  const exts = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

  for (const ext of exts) {
    const filePath = `${dir}/${safeEntityId}${ext}`;
    const fileData = readFileAsBuffer(filePath);
    if (fileData) {
      return `data:${fileData.mime};base64,${fileData.buffer.toString('base64')}`;
    }
  }
  return null;
}

/**
 * 删除项目的所有媒体文件
 */
export function deleteProjectFiles(projectId: string): void {
  const dirPath = path.join(DATA_ROOT, '..', 'data', projectId);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}
