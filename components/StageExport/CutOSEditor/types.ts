/**
 * CutOS 编辑器类型定义 - 本地状态，无 Supabase
 */

export interface ClipTransform {
  positionX: number;
  positionY: number;
  scale: number;
  opacity: number;
}

export type EffectPreset =
  | 'none'
  | 'grayscale'
  | 'sepia'
  | 'invert'
  | 'glitch'
  | 'vhs'
  | 'ascii'
  | 'cyberpunk'
  | 'noir';

export interface ClipEffects {
  preset: EffectPreset;
  blur: number;
  brightness: number;
  contrast: number;
  saturate: number;
  hueRotate: number;
  chromakey?: {
    enabled: boolean;
    keyColor: string;
    similarity: number;
    smoothness: number;
    spill: number;
  };
}

export interface Caption {
  word: string;
  start: number;
  end: number;
}

export interface TimelineClipData {
  id: string;
  mediaId: string;
  trackId: string;
  startTime: number;
  duration: number;
  mediaOffset?: number;
  label: string;
  type: 'video' | 'audio';
  transform?: ClipTransform;
  effects?: ClipEffects;
}

export interface MediaFileData {
  id: string;
  name: string;
  duration: string;
  durationSeconds: number;
  type: string;
  storagePath?: string;
  storageUrl?: string;
  objectUrl?: string; // 本地/项目数据中的播放 URL
  thumbnail: string | null;
  captions?: Caption[];
}

export interface TimelineData {
  clips: TimelineClipData[];
  media: MediaFileData[];
}
