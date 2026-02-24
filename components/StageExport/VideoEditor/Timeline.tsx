/**
 * 视频剪辑器 - 时间轴
 */
import React, { useCallback, useEffect } from 'react';
import { DragDropContext, Draggable, Droppable, DropResult } from 'react-beautiful-dnd';
import { Play, Pause, Scissors, Trash2, Plus, Layers } from 'lucide-react';
import { VideoEditorStore } from './VideoEditorStore';
import { formatTime } from './utils';
import TrackFragment from './TrackFragment';
import { SCALE_DOM_SPACE_EXPORT } from './VideoEditorStore';
import { useAlert } from '../../GlobalAlert';

interface TimelineProps {
  store: VideoEditorStore;
  refresh: symbol;
  onRefresh: () => void;
}

const Timeline: React.FC<TimelineProps> = ({ store, refresh, onRefresh }) => {
  const { showAlert } = useAlert();
  const total = store.getTotalTime();
  const lines = new Array(Math.ceil(total / 1000 * store.timerScale) + 10).fill(1);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const lastX = React.useRef({ x: 0, moving: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const width = lines.length * SCALE_DOM_SPACE_EXPORT;
    canvas.style.width = `${width}px`;
    canvas.style.height = '48px';
    canvas.width = width * ratio;
    canvas.height = 48 * ratio;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    lines.forEach((_, i) => {
      const x = i * SCALE_DOM_SPACE_EXPORT * ratio;
      const h = i % 5 === 0 ? 12 : 6;
      ctx.strokeStyle = 'var(--border-secondary)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h * ratio);
      ctx.stroke();
      if (i % 10 === 0 && i > 0) {
        ctx.fillStyle = 'var(--text-muted)';
        ctx.font = `${10 * ratio}px monospace`;
        ctx.fillText(`${(i / store.timerScale / 10).toFixed(1)}s`, x + 2, 24 * ratio);
      }
    });
  }, [total, store.timerScale, refresh]);

  const onIndicatorMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const time = (x / SCALE_DOM_SPACE_EXPORT) * (1000 / store.timerScale);
      store.setCurrentTime(time);
      store.pause();
      lastX.current = { x: e.clientX, moving: true };
      onRefresh();
    },
    [store, onRefresh]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!lastX.current.moving) return;
      const dx = e.clientX - lastX.current.x;
      const dTime = (dx / SCALE_DOM_SPACE_EXPORT) * (1000 / store.timerScale);
      store.setCurrentTime(store.currentTime + dTime);
      lastX.current.x = e.clientX;
      onRefresh();
    };
    const onMouseUp = () => {
      lastX.current.moving = false;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [store, onRefresh]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        store.removeItem();
        onRefresh();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store, onRefresh]);

  const onDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return;
      if (result.source.droppableId === result.destination.droppableId) {
        store.exchangeItems(result.source.droppableId, result.source.index, result.destination.index);
      }
      onRefresh();
    },
    [store, onRefresh]
  );

  const indicatorLeft = (store.currentTime / 1000) * store.timerScale * SCALE_DOM_SPACE_EXPORT;

  return (
    <div className="flex flex-col bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl overflow-hidden">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-elevated)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (store.playStatus === 1) store.pause();
              else store.play();
              onRefresh();
            }}
            className="p-2 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            {store.playStatus === 1 ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <span className="text-sm font-mono text-[var(--text-secondary)]">
            {formatTime(store.currentTime)} / {formatTime(total)}
          </span>
          <button
            onClick={() => {
              const ok = store.splitItem();
              if (!ok) showAlert('片段时间不得小于 1 秒', { type: 'warning' });
              else onRefresh();
            }}
            className="p-2 rounded-lg bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border-secondary)] transition-colors"
            title="分割"
          >
            <Scissors className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              store.removeItem();
              onRefresh();
            }}
            className="p-2 rounded-lg bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border-secondary)] transition-colors"
            title="删除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                store.addLayer('video');
                onRefresh();
              }}
              className="px-2 py-1 rounded text-[10px] bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)]"
              title="添加视频轨道"
            >
              视频
            </button>
            <button
              onClick={() => {
                store.addLayer('audio');
                onRefresh();
              }}
              className="px-2 py-1 rounded text-[10px] bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)]"
              title="添加音频轨道"
            >
              音频
            </button>
            <button
              onClick={() => {
                store.addLayer('text');
                onRefresh();
              }}
              className="px-2 py-1 rounded text-[10px] bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)]"
              title="添加字幕轨道"
            >
              字幕
            </button>
            <button
              onClick={() => {
                store.addLayer('image');
                onRefresh();
              }}
              className="px-2 py-1 rounded text-[10px] bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)]"
              title="添加图片轨道"
            >
              图片
            </button>
          </div>
          <input
            type="range"
            min={4}
            max={20}
            value={store.timerScale}
            onChange={(e) => {
              store.timerScale = Number(e.target.value);
              onRefresh();
            }}
            className="w-24"
          />
          <span className="text-[10px] text-[var(--text-muted)]">缩放</span>
        </div>
      </div>

      {/* 时间刻度 + 轨道 */}
      <DragDropContext onDragEnd={onDragEnd}>
      <div className="overflow-x-auto overflow-y-auto max-h-[240px]">
        <div className="min-w-max">
          <div
            className="relative h-12 cursor-ew-resize"
            onMouseDown={onIndicatorMouseDown}
          >
            <canvas ref={canvasRef} className="block" />
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-[var(--accent)] pointer-events-none"
              style={{ left: indicatorLeft }}
            />
          </div>
          {store.layers.map((layer) => (
            <div
              key={layer.id}
              className="flex items-center gap-2 py-1.5 px-2 border-t border-[var(--border-subtle)] min-h-[52px] group"
            >
              <div className="w-24 flex-shrink-0 flex items-center gap-1">
                <span className="text-[10px] text-[var(--text-muted)] font-medium truncate">{layer.name}</span>
                <button
                  onClick={() => {
                    if (layer.items.length > 0 && !confirm(`确定删除轨道「${layer.name}」？将同时删除其中 ${layer.items.length} 个片段。`)) return;
                    store.removeLayer(layer.id);
                    onRefresh();
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--error-bg)] text-[var(--error-text)] transition-opacity"
                  title="删除轨道"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <Droppable droppableId={layer.id} direction="horizontal">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="flex items-center gap-1 flex-1 min-h-[44px] bg-[var(--bg-sunken)]/50 rounded-lg px-2"
                  >
                    {layer.items.map((item, idx) => (
                      <Draggable key={item.id} draggableId={item.id} index={idx}>
                        {(p) => (
                          <TrackFragment
                            item={item}
                            store={store}
                            onSelect={() => {
                              store.setActiveItem(item.id);
                              onRefresh();
                            }}
                            draggableProps={p.draggableProps}
                            dragHandleProps={p.dragHandleProps}
                            innerRef={p.innerRef}
                          />
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </div>
      </DragDropContext>
    </div>
  );
};

export default Timeline;
