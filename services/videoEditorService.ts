/**
 * 视频剪辑状态服务
 * 与后端 API 交互，支持项目+剧本隔离、多设备同步
 */

import { apiGet, apiPut } from './apiClient';
import type { EditorLayer } from '../components/StageExport/VideoEditor/types';
import type { Shot } from '../types';

export interface VideoEditorStateResponse {
  success: boolean;
  data: EditorLayer[] | null;
  version: number;
  updatedAt?: string;
}

export interface VideoEditorSaveResponse {
  success: true;
  version: number;
}

/**
 * 获取剪辑状态（懒加载）
 */
export async function getVideoEditorState(
  projectId: string,
  episodeId: string
): Promise<VideoEditorStateResponse> {
  const ep = episodeId === '' ? '_default' : episodeId;
  const res = await apiGet<VideoEditorStateResponse>(
    `/api/projects/${projectId}/video-editor?episode=${encodeURIComponent(ep)}`
  );
  return res;
}

/**
 * 保存剪辑状态（防抖后调用）
 */
export async function saveVideoEditorState(
  projectId: string,
  episodeId: string,
  layers: EditorLayer[],
  version?: number
): Promise<VideoEditorSaveResponse> {
  const ep = episodeId === '' ? '_default' : episodeId;
  const res = await apiPut<VideoEditorSaveResponse>(
    `/api/projects/${projectId}/video-editor?episode=${encodeURIComponent(ep)}`,
    { layers, version }
  );
  return res;
}

/**
 * 将 layers 中的 url 转为 urlRef（用于保存，减小体积，避免存储完整 base64）
 */
export function layersToStorageFormat(
  layers: EditorLayer[],
  shots: Shot[]
): EditorLayer[] {
  const shotMap = new Map<string, Shot>();
  for (const s of shots) {
    shotMap.set(s.id, s);
  }

  return layers.map((layer) => ({
    ...layer,
    items: layer.items.map((item) => {
      const { url, sourceShotId, urlRef: _ur, ...rest } = item;
      if (sourceShotId && item.type !== 2) {
        // 非 TEXT 类型且有 sourceShotId，用 urlRef 替代 url
        const shot = shotMap.get(sourceShotId);
        const intervalId = shot?.interval?.id;
        if (intervalId) {
          return { ...rest, urlRef: { shotId: sourceShotId, intervalId }, sourceShotId };
        }
      }
      return item;
    }),
  }));
}

/**
 * 从存储格式解析 layers，将 urlRef 解析为 url
 */
/**
 * 从存储格式解析 layers，将 urlRef 解析为 url（需传入当前 project.shots）
 */
export function layersFromStorageFormat(
  layers: EditorLayer[],
  shots: Shot[]
): EditorLayer[] {
  const shotMap = new Map<string, Shot>();
  for (const s of shots) {
    shotMap.set(s.id, s);
  }

  return layers.map((layer) => ({
    ...layer,
    items: layer.items.map((item) => {
      const { urlRef, ...rest } = item;
      if (urlRef) {
        const shot = shotMap.get(urlRef.shotId);
        const interval = shot?.interval;
        const url =
          interval?.id === urlRef.intervalId ? interval.videoUrl : undefined;
        return { ...rest, url: url || '', sourceShotId: urlRef.shotId };
      }
      return item;
    }),
  }));
}
