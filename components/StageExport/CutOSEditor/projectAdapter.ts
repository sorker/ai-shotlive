/**
 * 将 ai-shotlive 项目数据适配为 CutOS 编辑器格式
 */
import type { ProjectState, Shot } from '../../types';
import { getCompletedShots } from '../utils';

const PIXELS_PER_SECOND = 10;

export interface CutOSMediaFile {
  id: string;
  name: string;
  duration: string;
  durationSeconds: number;
  thumbnail: string | null;
  type: string;
  objectUrl: string;
  storageUrl?: string;
}

export interface CutOSClip {
  id: string;
  mediaId: string;
  trackId: string;
  startTime: number;
  duration: number;
  mediaOffset: number;
  label: string;
  type: 'video' | 'audio';
  transform: { positionX: number; positionY: number; scale: number; opacity: number };
  effects: {
    preset: string;
    blur: number;
    brightness: number;
    contrast: number;
    saturate: number;
    hueRotate: number;
    chromakey?: { enabled: boolean; keyColor: string; similarity: number; smoothness: number; spill: number };
  };
}

export interface CutOSTimelineData {
  media: CutOSMediaFile[];
  clips: CutOSClip[];
}

const DEFAULT_TRANSFORM = { positionX: 0, positionY: 0, scale: 100, opacity: 100 };
const DEFAULT_EFFECTS = {
  preset: 'none',
  blur: 0,
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hueRotate: 0,
  chromakey: { enabled: false, keyColor: '#00FF00', similarity: 0.4, smoothness: 0.1, spill: 0.3 },
};

/**
 * 将 Shot 转为 CutOS MediaFile
 */
function shotToMedia(shot: Shot, index: number): CutOSMediaFile | null {
  const videoUrl = shot.interval?.videoUrl;
  if (!videoUrl) return null;

  const durationNum = shot.interval?.duration ?? 10;

  return {
    id: `media-${shot.id}`,
    name: `镜头 ${index + 1}`,
    duration: `${Math.floor(durationNum / 60)}:${String(Math.floor(durationNum % 60)).padStart(2, '0')}`,
    durationSeconds: durationNum,
    thumbnail: shot.keyframes?.[0]?.imageUrl ?? null,
    type: 'video/mp4',
    objectUrl: videoUrl,
    storageUrl: videoUrl.startsWith('http') ? videoUrl : undefined,
  };
}

/**
 * 将 Shot 转为 CutOS TimelineClip
 */
function shotToClip(shot: Shot, index: number, startTimePixels: number): CutOSClip | null {
  if (!shot.interval?.videoUrl) return null;

  const durationNum = shot.interval?.duration ?? 10;
  const durationPixels = durationNum * PIXELS_PER_SECOND;

  return {
    id: `clip-${shot.id}`,
    mediaId: `media-${shot.id}`,
    trackId: 'V1',
    startTime: startTimePixels,
    duration: durationPixels,
    mediaOffset: 0,
    label: `镜头 ${index + 1}`,
    type: 'video',
    transform: { ...DEFAULT_TRANSFORM },
    effects: { ...DEFAULT_EFFECTS },
  };
}

/**
 * 将 ProjectState 转为 CutOS 时间轴数据
 */
export function projectToCutOSTimeline(project: ProjectState): CutOSTimelineData {
  const completedShots = getCompletedShots(project);
  const media: CutOSMediaFile[] = [];
  const clips: CutOSClip[] = [];
  let currentStartPixels = 0;

  completedShots.forEach((shot, index) => {
    const m = shotToMedia(shot, index);
    const c = shotToClip(shot, index, currentStartPixels);
    if (m && c) {
      media.push(m);
      clips.push(c);
      currentStartPixels += c.duration;
    }
  });

  return { media, clips };
}
