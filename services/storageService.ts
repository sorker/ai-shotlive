import { ProjectState, AssetLibraryItem, NovelChapter, NovelEpisode } from '../types';
import { apiGet, apiPut, apiDelete, apiPost, apiFetch, getToken } from './apiClient';

/**
 * 清洗图片字段：如果是 JSON 脏数据 {"base64":"...","url":"..."}，提取出有效值
 * 防止 JSON 字符串被直接用作 <img src> 导致 431 错误
 */
const sanitizeImg = (val: string | undefined): string | undefined => {
  if (!val || !val.startsWith('{')) return val;
  try {
    const p = JSON.parse(val);
    return p.url || p.base64 || undefined;
  } catch {
    return val;
  }
};

/**
 * 给服务端 API 回退 URL 追加 JWT token，使 <img src> / <video src> 能通过认证
 */
const appendAuthToken = (url: string | undefined): string | undefined => {
  if (!url || !url.startsWith('/api/')) return url;
  const token = getToken();
  if (!token) return url;
  const [path, qs] = url.split('?');
  const params = new URLSearchParams(qs || '');
  params.set('token', token);
  return `${path}?${params.toString()}`;
};

/**
 * 遍历项目数据，清洗所有图片/视频字段
 * - 清理 JSON 脏数据
 * - 给服务端 API URL 追加认证 token
 */
const sanitizeProjectImages = (project: ProjectState): void => {
  if (project.scriptData) {
    for (const ch of project.scriptData.characters || []) {
      ch.referenceImage = appendAuthToken(sanitizeImg(ch.referenceImage));
      for (const v of ch.variations || []) {
        v.referenceImage = appendAuthToken(sanitizeImg(v.referenceImage));
      }
    }
    for (const s of project.scriptData.scenes || []) {
      s.referenceImage = appendAuthToken(sanitizeImg(s.referenceImage));
    }
    for (const p of project.scriptData.props || []) {
      p.referenceImage = appendAuthToken(sanitizeImg(p.referenceImage));
    }
  }
  for (const shot of project.shots || []) {
    for (const kf of shot.keyframes || []) {
      kf.imageUrl = appendAuthToken(sanitizeImg(kf.imageUrl));
    }
    if (shot.interval?.videoUrl) {
      shot.interval.videoUrl = appendAuthToken(shot.interval.videoUrl);
    }
  }
};

const EXPORT_SCHEMA_VERSION = 1;

export interface IndexedDBExportPayload {
  schemaVersion: number;
  exportedAt: number;
  scope?: 'all' | 'project';
  dbName: string;
  dbVersion: number;
  stores: {
    projects: ProjectState[];
    assetLibrary: AssetLibraryItem[];
  };
}

const isValidExportPayload = (data: unknown): data is IndexedDBExportPayload => {
  const payload = data as IndexedDBExportPayload;
  return !!(
    payload &&
    payload.stores &&
    Array.isArray(payload.stores.projects) &&
    Array.isArray(payload.stores.assetLibrary)
  );
};

/**
 * 导出当前用户所有数据
 */
export const exportIndexedDBData = async (): Promise<IndexedDBExportPayload> => {
  return apiPost('/api/projects/export');
};

/**
 * 导出单个项目数据
 */
export const exportProjectData = async (project: ProjectState): Promise<IndexedDBExportPayload> => {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    scope: 'project',
    dbName: 'AiShotliveDB',
    dbVersion: 2,
    stores: {
      projects: [project],
      assetLibrary: []
    }
  };
};

/**
 * 导入数据
 */
export const importIndexedDBData = async (
  payload: unknown,
  options?: { mode?: 'merge' | 'replace' }
): Promise<{ projects: number; assets: number }> => {
  if (!isValidExportPayload(payload)) {
    throw new Error('导入文件格式不正确');
  }

  return apiPost('/api/projects/import', {
    ...payload,
    mode: options?.mode || 'merge',
  });
};

// ─── 数据库级导出/导入（ZIP 归档）─────────────────────────────────

/**
 * 导出当前用户全部数据（数据库 + data 文件夹）为 ZIP 下载
 */
export const exportUserDataArchive = async (): Promise<void> => {
  const res = await apiFetch('/api/data-transfer/export');
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '导出失败' }));
    throw new Error(err.error || `导出失败 (${res.status})`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
  const filename = filenameMatch?.[1] || `aishotlive_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export interface ImportArchiveResult {
  success: boolean;
  newUser: {
    username: string;
    defaultPassword: string;
  };
  stats: {
    projects: number;
    assets: number;
    files: number;
  };
}

/**
 * 导入 ZIP 归档数据，自动创建新用户
 */
export const importUserDataArchive = async (file: File): Promise<ImportArchiveResult> => {
  const formData = new FormData();
  formData.append('file', file);

  const res = await apiFetch('/api/data-transfer/import', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '导入失败' }));
    throw new Error(err.error || `导入失败 (${res.status})`);
  }

  return res.json();
};

/**
 * 保存项目到数据库
 */
export const saveProjectToDB = async (project: ProjectState): Promise<void> => {
  const p = { ...project, lastModified: Date.now() };
  await apiPut(`/api/projects/${project.id}`, p);
};

/**
 * 从数据库加载项目
 */
export const loadProjectFromDB = async (id: string): Promise<ProjectState> => {
  const project = await apiGet<ProjectState>(`/api/projects/${id}`);

  // 前端迁移逻辑（与原来一致）
  if (!project.renderLogs) {
    project.renderLogs = [];
  }
  if (project.scriptData && !project.scriptData.props) {
    project.scriptData.props = [];
  }
  if (!project.novelChapters) {
    project.novelChapters = [];
  }
  if (!project.novelEpisodes) {
    project.novelEpisodes = [];
  }
  if (project.selectedEpisodeId === undefined) {
    project.selectedEpisodeId = null;
  }

  // 安全清洗：处理 DB 中可能存在的 JSON 脏数据 {"base64":"...","url":"..."}
  // 防止这类数据被用作 <img src> 导致 431 错误
  sanitizeProjectImages(project);

  return project;
};

/**
 * 获取所有项目（列表页）
 */
export const getAllProjectsMetadata = async (): Promise<ProjectState[]> => {
  const projects = await apiGet<ProjectState[]>('/api/projects');
  projects.sort((a, b) => b.lastModified - a.lastModified);
  return projects;
};

// =========================
// Asset Library Operations
// =========================

export const saveAssetToLibrary = async (item: AssetLibraryItem): Promise<void> => {
  await apiPut(`/api/assets/${item.id}`, item);
};

export const getAllAssetLibraryItems = async (): Promise<AssetLibraryItem[]> => {
  const items = await apiGet<AssetLibraryItem[]>('/api/assets');
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
};

export const deleteAssetFromLibrary = async (id: string): Promise<void> => {
  await apiDelete(`/api/assets/${id}`);
};

/**
 * 从数据库中删除项目
 */
export const deleteProjectFromDB = async (id: string): Promise<void> => {
  console.log(`🗑️ 开始删除项目: ${id}`);
  await apiDelete(`/api/projects/${id}`);
  console.log(`✅ 项目已删除: ${id}`);
};

/**
 * Convert a File object (image) to Base64 data URL
 */
export const convertImageToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('只支持图片文件'));
      return;
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      reject(new Error('图片大小不能超过 10MB'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
};

// =========================
// 按需加载：章节与剧集
// =========================

export interface PaginatedChapters {
  chapters: NovelChapter[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaginatedEpisodes {
  episodes: (NovelEpisode & { scriptLength?: number })[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 分页获取章节列表（仅标题，不含 content）
 */
export const fetchChaptersPaginated = async (
  projectId: string,
  page: number = 1,
  pageSize: number = 20
): Promise<PaginatedChapters> => {
  return apiGet<PaginatedChapters>(`/api/projects/${projectId}/chapters?page=${page}&pageSize=${pageSize}`);
};

/**
 * 按需获取单个章节的完整内容
 */
export const fetchChapterContent = async (
  projectId: string,
  chapterId: string
): Promise<NovelChapter> => {
  return apiGet<NovelChapter>(`/api/projects/${projectId}/chapters/${chapterId}/content`);
};

/**
 * 分页获取剧集列表（不含 script 内容）
 */
export const fetchEpisodesPaginated = async (
  projectId: string,
  page: number = 1,
  pageSize: number = 20
): Promise<PaginatedEpisodes> => {
  return apiGet<PaginatedEpisodes>(`/api/projects/${projectId}/episodes?page=${page}&pageSize=${pageSize}`);
};

/**
 * 按需获取单个剧集的完整剧本
 */
export const fetchEpisodeContent = async (
  projectId: string,
  episodeId: string
): Promise<NovelEpisode> => {
  return apiGet<NovelEpisode>(`/api/projects/${projectId}/episodes/${episodeId}/content`);
};

// Initial template for new projects
export const createNewProjectState = (): ProjectState => {
  const id = 'proj_' + Date.now().toString(36);
  return {
    id,
    title: '未命名项目',
    createdAt: Date.now(),
    lastModified: Date.now(),
    stage: 'script',
    novelGenre: '',
    novelSynopsis: '',
    targetDuration: '60s',
    language: '中文',
    visualStyle: 'live-action',
    shotGenerationModel: 'gpt-5.1',
    novelChapters: [],
    novelEpisodes: [],
    selectedEpisodeId: null,

    rawScript: `标题：示例剧本

场景 1
外景。夜晚街道 - 雨夜
霓虹灯在水坑中反射出破碎的光芒。
侦探（30岁,穿着风衣）站在街角,点燃了一支烟。

侦探
这雨什么时候才会停？`,
    scriptData: null,
    shots: [],
    isParsingScript: false,
    renderLogs: [],
  };
};
