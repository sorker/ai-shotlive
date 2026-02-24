/**
 * 视频剪辑器 - 类型定义
 */

export enum ItemType {
  VIDEO,
  IMAGE,
  TEXT,
  MUSIC,
}

export enum PlayStatus {
  PEDDING,
  PLAYING,
  PAUSE,
}

/** 存储时的 URL 引用（替代完整 URL，降低网络与存储压力） */
export interface UrlRef {
  shotId: string;
  intervalId: string;
}

export interface EditorItem {
  id: string;
  type: ItemType;
  start: number;
  duration: number;
  x: number;
  y: number;
  scale: number;
  title: string;
  url: string;
  content: string;
  playStart: number;
  volume: number;
  /** 来源镜头ID，用于关联AI生成的视频 */
  sourceShotId?: string;
  /** 存储时的 URL 引用（保存到后端时使用，加载时解析为 url） */
  urlRef?: UrlRef;
  /** 是否为音轨（从视频分离出的音频） */
  isAudioTrack?: boolean;
  keyFrames?: { x: number; y: number; scale: number; pos: number; id: string }[];
  transition?: { duration: number };
}

export type LayerType = 'video' | 'audio' | 'text' | 'image';

export interface EditorLayer {
  id: string;
  items: EditorItem[];
  type: LayerType;
  name: string;
  /** 轨道序号，用于显示 */
  order?: number;
}

export function createId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export function createItem(
  duration: number,
  title: string,
  type: ItemType,
  options: Partial<EditorItem> = {}
): EditorItem {
  return {
    id: createId(),
    type,
    start: 0,
    duration,
    title,
    url: '',
    content: '',
    playStart: 0,
    x: 0,
    y: 0,
    scale: 1,
    volume: 1,
    ...options,
  };
}

export function createLayer(type: LayerType, name: string, order?: number): EditorLayer {
  return {
    id: createId(),
    items: [],
    type,
    name,
    order,
  };
}

/** 资源库项：剧本/角色/场景/视频/上传/AI生成 */
export type ResourceCategory = 'script' | 'characters' | 'scenes' | 'videos' | 'uploaded' | 'ai_subtitles' | 'ai_audio';

export interface ResourceItem {
  id: string;
  category: ResourceCategory;
  type: ItemType;
  title: string;
  url?: string;
  content?: string;
  /** 来源ID（角色ID、场景ID、镜头ID等） */
  sourceId?: string;
  duration?: number; // ms，视频/音频时长
}
