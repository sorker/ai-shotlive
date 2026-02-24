/**
 * 视频剪辑器 - 属性面板
 */
import React from 'react';
import { EditorItem, ItemType } from './types';
import { VideoEditorStore } from './VideoEditorStore';

interface PropertyPanelProps {
  store: VideoEditorStore;
  item: EditorItem | null;
  onRefresh: () => void;
}

const PropertyPanel: React.FC<PropertyPanelProps> = ({ store, item, onRefresh }) => {
  if (!item) {
    return (
      <div className="w-56 flex-shrink-0 p-4 bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl">
        <p className="text-xs text-[var(--text-muted)]">选择片段以编辑属性</p>
      </div>
    );
  }

  const update = (key: keyof EditorItem, value: unknown) => {
    (item as Record<string, unknown>)[key] = value;
    store.updateFlag = Symbol(1);
    onRefresh();
  };

  return (
    <div className="w-56 flex-shrink-0 p-4 bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl space-y-3">
      <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">属性</h4>
      <div>
        <label className="text-[10px] text-[var(--text-muted)] block mb-1">时长 (ms)</label>
        <input
          type="number"
          value={item.duration}
          onChange={(e) => update('duration', Number(e.target.value))}
          className="w-full px-2 py-1.5 text-xs bg-[var(--bg-base)] border border-[var(--border-secondary)] rounded"
        />
      </div>
      {(item.type === ItemType.VIDEO || item.type === ItemType.MUSIC) && (
        <div>
          <label className="text-[10px] text-[var(--text-muted)] block mb-1">音量 (0-1)</label>
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={item.volume}
            onChange={(e) => update('volume', Number(e.target.value))}
            className="w-full px-2 py-1.5 text-xs bg-[var(--bg-base)] border border-[var(--border-secondary)] rounded"
          />
        </div>
      )}
      {item.type === ItemType.TEXT && (
        <div>
          <label className="text-[10px] text-[var(--text-muted)] block mb-1">内容</label>
          <textarea
            value={item.content}
            onChange={(e) => update('content', e.target.value)}
            rows={3}
            className="w-full px-2 py-1.5 text-xs bg-[var(--bg-base)] border border-[var(--border-secondary)] rounded resize-none"
          />
        </div>
      )}
    </div>
  );
};

export default PropertyPanel;
