/**
 * 视频剪辑器 - 预览播放器
 */
import React, { useEffect, useRef } from 'react';
import { EditorItem, EditorLayer, ItemType, PlayStatus } from './types';
import { VideoEditorStore } from './VideoEditorStore';

interface PlayerProps {
  store: VideoEditorStore;
  layers: EditorLayer[];
  refresh: symbol;
}

const ItemVideo: React.FC<{ item: EditorItem; store: VideoEditorStore; hasSeparateAudio: boolean }> = ({
  item,
  store,
  hasSeparateAudio,
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.currentTime = (store.currentTime - item.start + item.playStart) / 1000;
  }, [store.currentTime, item.start, item.playStart, store.updateFlag]);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.volume = hasSeparateAudio ? 0 : item.volume;
    if (store.playStatus === PlayStatus.PLAYING) ref.current.play().catch(() => {});
    else ref.current.pause();
  }, [store.playStatus, item.volume, hasSeparateAudio]);
  if (!item.url) return null;
  return (
    <video
      ref={ref}
      src={item.url}
      className="max-w-full max-h-full object-contain"
      muted={hasSeparateAudio}
      playsInline
    />
  );
};

const ItemImage: React.FC<{ item: EditorItem; store?: VideoEditorStore; hasSeparateAudio?: boolean }> = ({ item }) => {
  if (!item.url) return null;
  return <img src={item.url} alt="" className="max-w-full max-h-full object-contain" />;
};

const ItemText: React.FC<{ item: EditorItem; store?: VideoEditorStore; hasSeparateAudio?: boolean }> = ({ item }) => (
  <div className="text-white text-lg font-bold drop-shadow-lg px-4 py-2">{item.content || '字幕'}</div>
);

const ItemMusic: React.FC<{ item: EditorItem; store: VideoEditorStore; hasSeparateAudio?: boolean }> = ({ item, store }) => {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.currentTime = (store.currentTime - item.start + item.playStart) / 1000;
  }, [store.currentTime, item.start, item.playStart, store.updateFlag]);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.volume = item.volume;
    if (store.playStatus === PlayStatus.PLAYING) ref.current.play().catch(() => {});
    else ref.current.pause();
  }, [store.playStatus, item.volume]);
  if (!item.url) return null;
  return <audio ref={ref} src={item.url} />;
};

const Player: React.FC<PlayerProps> = ({ store, layers }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const w = rect.width - 32;
    const h = rect.height - 32;
    if (w / h > 9 / 16) setSize({ w: h * (9 / 16), h });
    else setSize({ w, h: w * (16 / 9) });
  }, []);

  const hasAudioLayer = layers.some((l) => l.type === 'audio' && l.items.length > 0);

  const renderMap: Record<number, React.FC<{ item: EditorItem; store: VideoEditorStore; hasSeparateAudio?: boolean }>> = {
    [ItemType.VIDEO]: ItemVideo,
    [ItemType.IMAGE]: ItemImage,
    [ItemType.TEXT]: ItemText,
    [ItemType.MUSIC]: ItemMusic,
  };

  const currentItems: EditorItem[] = [];
  for (const layer of layers) {
    for (const item of layer.items) {
      if (store.currentTime >= item.start && store.currentTime < item.start + item.duration) {
        currentItems.push(item);
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center bg-[var(--bg-base)] rounded-xl border border-[var(--border-primary)] overflow-hidden min-h-[200px]"
    >
      <div style={{ width: size.w, height: size.h }} className="relative bg-black">
        {currentItems.map((item) => {
          const Comp = renderMap[item.type];
          if (!Comp) return null;
          const hasSeparateAudio =
            item.type === ItemType.VIDEO && item.sourceShotId && hasAudioLayer;
          return (
            <div
              key={item.id}
              className="absolute inset-0 flex items-center justify-center"
              style={{
                left: item.x,
                top: item.y,
                width: item.scale * 100 + '%',
                height: item.scale * 100 + '%',
              }}
            >
              <Comp
                item={item}
                store={store}
                hasSeparateAudio={hasSeparateAudio}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Player;
