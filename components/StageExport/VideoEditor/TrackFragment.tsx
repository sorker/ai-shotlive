/**
 * 视频剪辑器 - 时间轴片段
 */
import React, { useState, useEffect } from 'react';
import { EditorItem, ItemType } from './types';
import { VideoEditorStore } from './VideoEditorStore';
import { SCALE_DOM_SPACE_EXPORT } from './VideoEditorStore';
import { getVideoThumbnails } from './utils';

interface TrackFragmentProps {
  item: EditorItem;
  store: VideoEditorStore;
  onSelect: () => void;
  draggableProps?: Record<string, unknown>;
  dragHandleProps?: Record<string, unknown>;
  innerRef?: React.Ref<HTMLDivElement>;
}

const TrackFragment: React.FC<TrackFragmentProps> = ({ item, store, onSelect, draggableProps, dragHandleProps, innerRef }) => {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const len = (item.duration / 1000) * store.timerScale * SCALE_DOM_SPACE_EXPORT;
  const imgCount = Math.max(1, Math.ceil(item.duration / 1000));

  useEffect(() => {
    if (item.type === ItemType.IMAGE && item.url) {
      setThumbnails(Array(imgCount).fill(item.url));
    } else if (item.type === ItemType.VIDEO && item.url) {
      getVideoThumbnails(item.url, Math.min(imgCount, 8), 60, 34)
        .then(setThumbnails)
        .catch(() => setThumbnails([]));
    } else if (item.type === ItemType.MUSIC) {
      setThumbnails([]);
    }
  }, [item.url, item.duration, item.type, imgCount]);

  const isActive = store.activeItemId === item.id;

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
        flex-shrink-0 h-11 rounded cursor-pointer overflow-hidden border transition-all
        ${isActive ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/30' : 'border-[var(--border-secondary)] hover:border-[var(--border-primary)]'}
      `}
      style={{ width: Math.max(len, 40), minWidth: 40 }}
    >
      <div className="flex h-full bg-[var(--bg-elevated)]">
        {thumbnails.length > 0 ? (
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
  );
};

export default TrackFragment;
