/**
 * 视频剪辑器 - 状态管理
 * 参考 lz-movie-edit：使用 requestAnimationFrame 实现丝滑播放
 */
import { EditorItem, EditorLayer, ItemType, PlayStatus, createId, createItem, createLayer } from './types';
import type { Shot } from '../../../types';

const SCALE_DOM_SPACE = 10;

/** 基于 requestAnimationFrame 的计时器，播放更丝滑 */
class Timer {
  current = 0;
  lastTime = 0;
  firstRecordTime = false;
  lastTimeRange = 0;
  updateCallback?: (v: number) => void;
  private handler = 0;
  private running = false;

  setUpdateCallback(cb: (v: number) => void) {
    this.updateCallback = cb;
  }

  start() {
    this.running = true;
    this.handler = window.requestAnimationFrame(this.update);
  }

  private update = (num: number) => {
    if (!this.running) return;
    if (!this.firstRecordTime) {
      this.firstRecordTime = true;
      this.lastTime = num;
    }
    this.current = this.lastTimeRange + (num - this.lastTime);
    this.updateCallback?.(this.current);
    this.handler = window.requestAnimationFrame(this.update);
  };

  stop = () => {
    this.running = false;
    this.lastTimeRange = this.current;
    this.firstRecordTime = false;
    window.cancelAnimationFrame(this.handler);
  };

  resetCurrentTime(num: number) {
    this.lastTimeRange = num;
    this.current = num;
  }
}

export class VideoEditorStore {
  layers: EditorLayer[] = [];
  activeLayerIndex = 0;
  /** 上传的资源（图片/视频/音频） */
  uploadedResources: { id: string; type: number; url: string; title: string; duration?: number }[] = [];
  /** AI 生成的字幕资源 */
  aiSubtitleResources: { id: string; content: string; duration?: number }[] = [];
  /** AI 生成的音频资源 */
  aiAudioResources: { id: string; url: string; title: string; duration?: number }[] = [];
  activeItemId = '';
  playStatus: PlayStatus = PlayStatus.PAUSE;
  currentTime = 0;
  updateFlag = Symbol(1);
  timerScale = 10;
  size = { width: 9, height: 16 };
  private timer: Timer;
  private updateCallback: (() => void) | null = null;

  constructor() {
    this.timer = new Timer();
  }

  getActiveLayer(): EditorLayer | null {
    return this.layers[this.activeLayerIndex] ?? null;
  }

  getActiveItem(): EditorItem | null {
    const layer = this.getActiveLayer();
    if (!layer || !this.activeItemId) return null;
    return layer.items.find((it) => it.id === this.activeItemId) ?? null;
  }

  getTotalTime(): number {
    let result = 0;
    for (const layer of this.layers) {
      const last = layer.items[layer.items.length - 1];
      if (last) result = Math.max(result, last.start + last.duration);
    }
    return result;
  }

  /** 节流：避免每帧触发 UI 更新导致卡顿，30fps 兼顾流畅与性能 */
  private lastUiUpdate = 0;
  private readonly UI_UPDATE_INTERVAL = 1000 / 30;

  play(): void {
    this.playStatus = PlayStatus.PLAYING;
    this.timer.setUpdateCallback((time: number) => {
      this.currentTime = time;
      if (this.currentTime >= this.getTotalTime()) {
        this.pause();
      }
      const now = performance.now();
      if (now - this.lastUiUpdate >= this.UI_UPDATE_INTERVAL) {
        this.lastUiUpdate = now;
        this.updateCallback?.();
      }
    });
    this.timer.start();
  }

  pause(): void {
    this.playStatus = PlayStatus.PAUSE;
    this.timer.stop();
  }

  setCurrentTime(t: number): void {
    this.currentTime = Math.max(0, t);
    this.timer.resetCurrentTime(this.currentTime);
    this.updateFlag = Symbol(1);
    this.updateCallback?.();
  }

  setUpdateCallback(cb: () => void): void {
    this.updateCallback = cb;
  }

  setActiveItem(id: string): void {
    this.activeItemId = id;
    const idx = this.layers.findIndex((l) => l.items.some((i) => i.id === id));
    if (idx >= 0) this.activeLayerIndex = idx;
  }

  addLayer(type: import('./types').LayerType = 'video', name?: string): EditorLayer {
    const defaultNames: Record<string, string> = {
      video: '视频轨道',
      audio: '音频轨道',
      text: '字幕轨道',
      image: '图片轨道',
    };
    const layer = createLayer(type, name ?? defaultNames[type] ?? '轨道', this.layers.length + 1);
    this.layers.push(layer);
    this.activeLayerIndex = this.layers.length - 1;
    this.updateFlag = Symbol(1);
    return layer;
  }

  removeLayer(layerId: string): void {
    const idx = this.layers.findIndex((l) => l.id === layerId);
    if (idx < 0) return;
    this.layers.splice(idx, 1);
    if (this.activeLayerIndex >= this.layers.length) this.activeLayerIndex = Math.max(0, this.layers.length - 1);
    this.activeItemId = '';
    this.updateFlag = Symbol(1);
  }

  /** 修改片段时长（拖拽右边缘），会挤压或腾出后续片段 */
  setItemDuration(layerId: string, itemId: string, newDuration: number): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    const idx = layer.items.findIndex((i) => i.id === itemId);
    if (idx < 0) return false;
    const minDuration = 1000;
    const item = layer.items[idx];
    const delta = newDuration - item.duration;
    if (delta === 0) return true;
    if (newDuration < minDuration) return false;
    item.duration = newDuration;
    let prevEnd = item.start + newDuration;
    for (let i = idx + 1; i < layer.items.length; i++) {
      layer.items[i].start = Math.max(prevEnd, layer.items[i].start + delta);
      prevEnd = layer.items[i].start + layer.items[i].duration;
    }
    this.updateFlag = Symbol(1);
    return true;
  }

  addItemAtTime(layerId: string, item: EditorItem, startTime: number): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return;
    item.start = startTime;
    layer.items.push(item);
    layer.items.sort((a, b) => a.start - b.start);
    this.activeItemId = item.id;
    this.updateFlag = Symbol(1);
  }

  addItemToLayer(layerId: string, item: EditorItem): void {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const last = layer.items[layer.items.length - 1];
    item.start = last ? last.start + last.duration : 0;
    layer.items.push(item);
    this.activeItemId = item.id;
    this.updateFlag = Symbol(1);
  }

  removeItem(): void {
    const layer = this.getActiveLayer();
    if (!layer) return;
    const idx = layer.items.findIndex((it) => it.id === this.activeItemId);
    if (idx >= 0) {
      layer.items.splice(idx, 1);
      if (layer.items.length === 0) {
        this.layers.splice(this.layers.indexOf(layer), 1);
        this.activeLayerIndex = Math.max(0, this.layers.length - 1);
      }
      this.activeItemId = '';
      this.updateFlag = Symbol(1);
    }
  }

  splitItem(): boolean {
    const layer = this.getActiveLayer();
    const item = this.getActiveItem();
    if (!layer || !item) return false;
    const minDuration = 1000;
    const { start, duration } = item;
    if (this.currentTime < start) return false;
    const beforeDuration = this.currentTime - start;
    if (duration < minDuration || beforeDuration < minDuration || duration - beforeDuration < minDuration) return false;

    item.duration = beforeDuration;
    const nextItem: EditorItem = { ...item, id: createId(), duration: duration - beforeDuration, start: this.currentTime };
    if (item.type === ItemType.VIDEO || item.type === ItemType.MUSIC) {
      nextItem.playStart = item.playStart + beforeDuration;
    }
    layer.items.splice(layer.items.indexOf(item) + 1, 0, nextItem);
    this.updateFlag = Symbol(1);
    return true;
  }

  clear(): void {
    this.layers = [];
    this.pause();
    this.currentTime = 0;
    this.activeItemId = '';
    this.addLayer('video');
    this.updateFlag = Symbol(1);
  }

  /** 从 AI 短剧项目导入镜头视频，自动分离视频轨和音频轨 */
  importFromProject(shots: Shot[]): void {
    this.clear();
    const completedShots = shots.filter((s) => s.interval?.videoUrl);
    if (completedShots.length === 0) return;

    const videoLayer = this.layers[0];
    const audioLayer = this.addLayer('audio', '原声音频');

    let currentStart = 0;
    for (const shot of completedShots) {
      const url = shot.interval!.videoUrl!;
      const duration = (shot.interval!.duration || 10) * 1000;

      const videoItem = createItem(duration, `镜头 ${shot.id.slice(0, 6)}`, ItemType.VIDEO, {
        url,
        sourceShotId: shot.id,
        isAudioTrack: false,
      });
      videoItem.start = currentStart;
      videoLayer.items.push(videoItem);

      const audioItem = createItem(duration, `音频 ${shot.id.slice(0, 6)}`, ItemType.MUSIC, {
        url,
        sourceShotId: shot.id,
        isAudioTrack: true,
      });
      audioItem.start = currentStart;
      audioLayer.items.push(audioItem);

      currentStart += duration;
    }
    this.updateFlag = Symbol(1);
  }

  /** 导出为可序列化的 JSON（用于保存/恢复） */
  serialize(): string {
    return JSON.stringify(this.layers);
  }

  /** 同轨道或跨轨道交换/移动元素顺序（支持拖拽调换） */
  exchangeItems(
    sourceLayerId: string,
    sourceIndex: number,
    destLayerId: string,
    destIndex: number
  ): void {
    const srcLayer = this.layers.find((l) => l.id === sourceLayerId);
    const destLayer = this.layers.find((l) => l.id === destLayerId);
    if (!srcLayer || !destLayer) return;
    const [item] = srcLayer.items.splice(sourceIndex, 1);
    if (!item) return;

    if (srcLayer.id === destLayer.id) {
      if (sourceIndex === destIndex) return;
      const insertIdx = sourceIndex < destIndex ? destIndex - 1 : destIndex;
      srcLayer.items.splice(insertIdx, 0, item);
    } else {
      destLayer.items.splice(destIndex, 0, item);
    }

    const reflowStarts = (layer: EditorLayer) => {
      let start = 0;
      for (const i of layer.items) {
        i.start = start;
        start += i.duration;
      }
    };
    reflowStarts(srcLayer);
    if (srcLayer.id !== destLayer.id) reflowStarts(destLayer);
    this.updateFlag = Symbol(1);
  }

  /** 从 JSON 恢复 */
  deserialize(json: string): void {
    try {
      const data = JSON.parse(json) as EditorLayer[];
      this.layers = data;
      this.activeLayerIndex = 0;
      this.activeItemId = '';
      this.updateFlag = Symbol(1);
    } catch {
      // ignore
    }
  }
}

export const SCALE_DOM_SPACE_EXPORT = SCALE_DOM_SPACE;
