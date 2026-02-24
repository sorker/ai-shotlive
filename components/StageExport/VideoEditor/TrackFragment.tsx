/**
 * 视频剪辑器 - 时间轴片段
 * 视频/图片显示缩略图，音轨显示波形
 * 支持拖拽右边缘调整时长
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { EditorItem, ItemType } from './types';
import { VideoEditorStore } from './VideoEditorStore';
import { SCALE_DOM_SPACE_EXPORT } from './VideoEditorStore';
import { getVideoThumbnails, getAudioWaveform } from './utils';

interface TrackFragmentProps {
  item: EditorItem;
  layerId: string;
  store: VideoEditorStore;
  onSelect: () => void;
  onRefresh: () => void;
  draggableProps?: Record<string, unknown>;
  dragHandleProps?: Record<string, unknown>;
  innerRef?: React.Ref<HTMLDivElement>;
  isDragging?: boolean;
}

const TrackFragment: React.FC<TrackFragmentProps> = ({ item, layerId, store, onSelect, onRefresh, draggableProps, dragHandleProps, innerRef, isDragging }) => {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [waveform, setWaveform] = useState<number[]>([]);
  const len = (item.duration / 1000) * store.timerScale * SCALE_DOM_SPACE_EXPORT;
  const imgCount = Math.max(1, Math.ceil(item.duration / 1000));

  useEffect(() => {
    if (item.type === ItemType.IMAGE && item.url) {
      setThumbnails(Array(imgCount).fill(item.url));
      setWaveform([]);
    } else if (item.type === ItemType.VIDEO && item.url) {
      getVideoThumbnails(item.url, Math.min(imgCount, 8), 60, 34)
        .then(setThumbnails)
        .catch(() => setThumbnails([]));
      setWaveform([]);
    } else if (item.type === ItemType.MUSIC && item.url) {
      setThumbnails([]);
      getAudioWaveform(item.url, Math.max(8, Math.min(32, Math.floor(len / 8))))
        .then(setWaveform)
        .catch(() => setWaveform([]));
    } else {
      setThumbnails([]);
      setWaveform([]);
    }
  }, [item.url, item.duration, item.type, imgCount, len]);

  const isActive = store.activeItemId === item.id;
  const resizeStartX = useRef(0);
  const resizeStartDuration = useRef(0);

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      resizeStartX.current = e.clientX;
      resizeStartDuration.current = item.duration;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - resizeStartX.current;
        const dMs = (dx / SCALE_DOM_SPACE_EXPORT) * (1000 / store.timerScale);
        const newDur = Math.max(1000, resizeStartDuration.current + dMs);
        store.setItemDuration(layerId, item.id, newDur);
        onRefresh();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [item.id, item.duration, layerId, store, onRefresh]
  );

  return (
    <div
      ref={innerRef}
      {...(draggableProps || {})}
      {...(dragHandleProps || {})}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={`
        flex-shrink-0 h-11 rounded cursor-grab active:cursor-grabbing overflow-hidden border transition-all relative group/frag
        ${isActive ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/30' : 'border-[var(--border-secondary)] hover:border-[var(--border-primary)]'}
        ${isDragging ? 'opacity-95 ring-2 ring-[var(--accent)] z-[100] shadow-[0_12px_40px_rgba(0,0,0,0.4)]' : ''}
      `}
      style={{
        width: Math.max(len, 40),
        minWidth: 40,
        ...(isDragging ? { boxShadow: '0 12px 40px rgba(0,0,0,0.4), 0 0 0 2px var(--accent)' } : {}),
      }}
    >
      <div className="flex h-full w-full">
      <div className="flex h-full bg-[var(--bg-elevated)] flex-1 min-w-0">
        {item.type === ItemType.MUSIC && waveform.length > 0 ? (
          <div className="flex items-center justify-center gap-0.5 h-full px-2 w-full">
            {waveform.map((h, i) => (
              <div
                key={i}
                className="w-0.5 rounded-full bg-[var(--accent)]/60 flex-shrink-0"
                style={{ height: `${Math.max(4, h * 24)}px` }}
              />
            ))}
          </div>
        ) : thumbnails.length > 0 ? (
          thumbnails.map((src, i) => (
            <div
              key={i}
              className="flex-1 bg-cover bg-center"
              style={{
                backgroundImage: `url(${src})`,
                minWidth: `${100 / thumbnails.length}%`,
              }}
            />
          ))
        ) : (
          <div className="flex-1 flex items-center justify-center text-[10px] text-[var(--text-muted)] px-2">
            {item.type === ItemType.MUSIC ? '🎵' : item.type === ItemType.TEXT ? 'T' : '—'}
          </div>
        )}
      </div>
      </div>
      {/* 右边缘拖拽调整时长 */}
      <div
        onMouseDown={onResizeMouseDown}
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-[var(--accent)]/20 transition-colors rounded-r"
        title="拖拽调整时长"
      />
    </div>
  );
};

export default TrackFragment;
