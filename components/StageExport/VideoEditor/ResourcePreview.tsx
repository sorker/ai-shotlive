/**
 * 视频剪辑器 - 资源预览
 * 点击资源库中的资源时，在右侧显示预览
 */
import React from 'react';
import { Plus } from 'lucide-react';

export interface ResourcePreviewItem {
  type: 'video' | 'image' | 'audio' | 'text';
  url?: string;
  content?: string;
  title: string;
  duration?: number;
}

interface ResourcePreviewProps {
  resource: ResourcePreviewItem;
  onAddToTrack: (layerType: 'video' | 'audio' | 'text' | 'image') => void;
}

const ResourcePreview: React.FC<ResourcePreviewProps> = ({ resource, onAddToTrack }) => {
  const layerType =
    resource.type === 'video' ? 'video' :
    resource.type === 'image' ? 'image' :
    resource.type === 'audio' ? 'audio' : 'text';

  return (
    <div className="flex flex-col bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl overflow-hidden">
      <div className="h-10 flex items-center px-3 border-b border-[var(--border-primary)]">
        <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">预览</span>
      </div>
      <div className="p-3 flex flex-col gap-3">
        <div className="aspect-video bg-[var(--bg-base)] rounded-lg overflow-hidden flex items-center justify-center">
          {resource.type === 'video' && resource.url && (
            <video src={resource.url} controls className="max-w-full max-h-full object-contain" muted />
          )}
          {resource.type === 'image' && resource.url && (
            <img src={resource.url} alt="" className="max-w-full max-h-full object-contain" />
          )}
          {resource.type === 'audio' && resource.url && (
            <div className="w-full p-4 flex items-center justify-center">
              <audio src={resource.url} controls className="max-w-full" />
            </div>
          )}
          {resource.type === 'text' && (
            <div className="p-4 text-sm text-[var(--text-secondary)] max-h-full overflow-auto">
              {resource.content || resource.title || '—'}
            </div>
          )}
        </div>
        <p className="text-xs text-[var(--text-muted)] truncate" title={resource.title}>{resource.title}</p>
        {resource.duration && (
          <p className="text-[10px] text-[var(--text-muted)]">
            {(resource.duration / 1000).toFixed(1)}s
          </p>
        )}
        <button
          onClick={() => onAddToTrack(layerType)}
          className="flex items-center justify-center gap-2 py-2 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] text-xs transition-colors"
        >
          <Plus className="w-4 h-4" />
          添加到轨道
        </button>
      </div>
    </div>
  );
};

export default ResourcePreview;
