/**
 * 视频剪辑器 - 右侧资源库
 * 分类展示：剧本/镜头、角色、场景、视频、上传、AI字幕、AI音频
 */
import React, { useState } from 'react';
import {
  FileText,
  Users,
  MapPin,
  Video,
  Upload,
  Type,
  Music,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Plus,
} from 'lucide-react';
import { ProjectState } from '../../../types';
import { VideoEditorStore } from './VideoEditorStore';
import { createItem, ItemType } from './types';
import { useAlert } from '../../GlobalAlert';

export type ResourcePreviewItem = {
  type: 'video' | 'image' | 'audio' | 'text';
  url?: string;
  content?: string;
  title: string;
  duration?: number;
};

interface ResourcePanelProps {
  project: ProjectState;
  store: VideoEditorStore;
  onRefresh: () => void;
  onShowModelConfig: () => void;
  onAIGenerateSubtitle: (text: string) => Promise<string | null>;
  onAIGenerateAudio: (text: string) => Promise<{ url: string; duration: number } | null>;
  selectedResource: ResourcePreviewItem | null;
  onSelectResource: (r: ResourcePreviewItem | null) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

type ResourceTab = 'script' | 'characters' | 'scenes' | 'videos' | 'uploaded' | 'ai_subtitles' | 'ai_audio';

const ResourcePanel: React.FC<ResourcePanelProps> = ({
  project,
  store,
  onRefresh,
  onShowModelConfig,
  onAIGenerateSubtitle,
  onAIGenerateAudio,
  selectedResource,
  onSelectResource,
  collapsed = false,
  onToggleCollapse,
}) => {
  const { showAlert } = useAlert();
  const [activeTab, setActiveTab] = useState<ResourceTab>('videos');
  const [expandedTabs, setExpandedTabs] = useState<Set<ResourceTab>>(new Set(['videos']));
  const [isUploading, setIsUploading] = useState(false);
  const [isGenSubtitle, setIsGenSubtitle] = useState(false);
  const [isGenAudio, setIsGenAudio] = useState(false);
  const uploadInputRef = React.useRef<HTMLInputElement>(null);

  const toggleTab = (tab: ResourceTab) => {
    setExpandedTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tab)) next.delete(tab);
      else next.add(tab);
      return next;
    });
  };

  const addToTrack = (item: { type: ItemType; url?: string; content?: string; duration?: number; title: string }, layerType: 'video' | 'audio' | 'text' | 'image') => {
    const layer = store.layers.find((l) => l.type === layerType) ?? store.addLayer(layerType);
    const duration = item.duration ?? 3000;
    const editorItem = createItem(duration, item.title, item.type, {
      url: item.url,
      content: item.content,
    });
    const start = store.getTotalTime();
    store.addItemAtTime(layer.id, editorItem, start);
    onRefresh();
  };

  const selectForPreview = (r: ResourcePreviewItem) => {
    onSelectResource(r);
  };

  if (collapsed) {
    return (
      <div className="w-10 flex-shrink-0 flex flex-col bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl overflow-hidden">
        <button
          onClick={onToggleCollapse}
          className="flex-1 flex items-center justify-center hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
          title="展开资源库"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-56 flex-shrink-0 flex flex-col bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl overflow-hidden">
      <div className="h-10 flex items-center justify-between px-3 border-b border-[var(--border-primary)]">
        <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">资源库</span>
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
          title="收起资源库"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {[
          { id: 'script' as const, label: '剧本/镜头', icon: FileText },
          { id: 'characters' as const, label: '角色', icon: Users },
          { id: 'scenes' as const, label: '场景', icon: MapPin },
          { id: 'videos' as const, label: '视频', icon: Video },
          { id: 'uploaded' as const, label: '上传', icon: Upload },
          { id: 'ai_subtitles' as const, label: 'AI 字幕', icon: Type },
          { id: 'ai_audio' as const, label: 'AI 音频', icon: Music },
        ].map(({ id, label, icon: Icon }) => (
          <div key={id} className="border-b border-[var(--border-subtle)]">
            <button
              onClick={() => { setActiveTab(id); toggleTab(id); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
            >
              {expandedTabs.has(id) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <Icon className="w-4 h-4" />
              <span className="text-xs font-medium">{label}</span>
            </button>
            {expandedTabs.has(id) && (
              <div className="px-3 pb-3 space-y-1">
                {id === 'script' && (
                  <>
                    {project.shots?.map((shot, i) => {
                      const text = shot.dialogue || shot.actionSummary || '';
                      return (
                        <div
                          key={shot.id}
                          className="flex items-center gap-2 p-2 rounded bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] group/item"
                        >
                          <div
                            className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer text-[10px]"
                            onClick={() => text && selectForPreview({ type: 'text', content: text, title: `镜头${i + 1}`, duration: 4000 })}
                          >
                            <span className="text-[var(--text-muted)]">#{i + 1}</span>
                            <span className="truncate flex-1">{shot.actionSummary?.slice(0, 20)}</span>
                          </div>
                          {text && (
                            <button
                              onClick={() => addToTrack({ type: ItemType.TEXT, content: text, title: `镜头${i + 1}`, duration: 4000 }, 'text')}
                              className="opacity-0 group-hover/item:opacity-100 p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--accent-text)]"
                              title="添加到轨道"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {(!project.shots || project.shots.length === 0) && (
                      <p className="text-[10px] text-[var(--text-muted)]">暂无镜头</p>
                    )}
                  </>
                )}
                {id === 'characters' && (
                  <>
                    {project.scriptData?.characters?.map((ch) => {
                      const url = ch.referenceImage || ch.referenceImageUrl;
                      return (
                        <div key={ch.id} className="flex items-center gap-2 p-2 rounded bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] group/item">
                          <div
                            className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer"
                            onClick={() => url ? selectForPreview({ type: 'image', url, title: ch.name, duration: 5000 }) : showAlert('该角色暂无参考图', { type: 'warning' })}
                          >
                            {url ? (
                              <img src={url} alt="" className="w-8 h-8 rounded object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded bg-[var(--bg-sunken)] flex items-center justify-center text-[10px]">?</div>
                            )}
                            <span className="text-xs truncate">{ch.name}</span>
                          </div>
                          {url && (
                            <button
                              onClick={() => addToTrack({ type: ItemType.IMAGE, url, title: ch.name, duration: 5000 }, 'image')}
                              className="opacity-0 group-hover/item:opacity-100 p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--accent-text)]"
                              title="添加到轨道"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {(!project.scriptData?.characters || project.scriptData.characters.length === 0) && (
                      <p className="text-[10px] text-[var(--text-muted)]">暂无角色</p>
                    )}
                  </>
                )}
                {id === 'scenes' && (
                  <>
                    {project.scriptData?.scenes?.map((s) => {
                      const url = s.referenceImage || s.referenceImageUrl;
                      return (
                        <div key={s.id} className="flex items-center gap-2 p-2 rounded bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] group/item">
                          <div
                            className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer"
                            onClick={() => url ? selectForPreview({ type: 'image', url, title: s.location, duration: 5000 }) : showAlert('该场景暂无参考图', { type: 'warning' })}
                          >
                            {url ? (
                              <img src={url} alt="" className="w-8 h-8 rounded object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded bg-[var(--bg-sunken)] flex items-center justify-center text-[10px]">?</div>
                            )}
                            <span className="text-xs truncate">{s.location}</span>
                          </div>
                          {url && (
                            <button
                              onClick={() => addToTrack({ type: ItemType.IMAGE, url, title: s.location, duration: 5000 }, 'image')}
                              className="opacity-0 group-hover/item:opacity-100 p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--accent-text)]"
                              title="添加到轨道"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {(!project.scriptData?.scenes || project.scriptData.scenes.length === 0) && (
                      <p className="text-[10px] text-[var(--text-muted)]">暂无场景</p>
                    )}
                  </>
                )}
                {id === 'videos' && (
                  <>
                    {project.shots?.filter((s) => s.interval?.videoUrl).map((shot, i) => {
                      const url = shot.interval!.videoUrl!;
                      const dur = (shot.interval!.duration || 10) * 1000;
                      return (
                        <div key={shot.id} className="flex items-center gap-2 p-2 rounded bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] group/item">
                          <div
                            className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer"
                            onClick={() => selectForPreview({ type: 'video', url, title: `镜头${i + 1}`, duration: dur })}
                          >
                            <Video className="w-4 h-4 text-[var(--text-muted)]" />
                            <span className="text-xs truncate">镜头 {i + 1}</span>
                          </div>
                          <button
                            onClick={() => addToTrack({ type: ItemType.VIDEO, url, title: `镜头${i + 1}`, duration: dur }, 'video')}
                            className="opacity-0 group-hover/item:opacity-100 p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--accent-text)]"
                            title="添加到轨道"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                    {(!project.shots || project.shots.filter((s) => s.interval?.videoUrl).length === 0) && (
                      <p className="text-[10px] text-[var(--text-muted)]">暂无视频</p>
                    )}
                  </>
                )}
                {id === 'uploaded' && (
                  <>
                    <button
                      onClick={() => uploadInputRef.current?.click()}
                      disabled={isUploading}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded bg-[var(--accent-bg)] text-[var(--accent-text)] hover:bg-[var(--accent-bg-hover)] text-xs"
                    >
                      {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      上传资源
                    </button>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      accept="image/*,video/*,audio/*"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const files = e.target.files;
                        e.target.value = '';
                        if (!files?.length) return;
                        setIsUploading(true);
                        for (const f of Array.from(files)) {
                          const reader = new FileReader();
                          reader.onload = () => {
                            const url = reader.result as string;
                            const type = f.type.startsWith('image/') ? ItemType.IMAGE : f.type.startsWith('video/') ? ItemType.VIDEO : ItemType.MUSIC;
                            store.uploadedResources.push({ id: Math.random().toString(36).slice(2), type, url, title: f.name });
                            onRefresh();
                          };
                          reader.readAsDataURL(f);
                        }
                        setIsUploading(false);
                      }}
                    />
                    {store.uploadedResources.map((r) => {
                      const layerType = r.type === ItemType.TEXT ? 'text' : r.type === ItemType.VIDEO ? 'video' : r.type === ItemType.IMAGE ? 'image' : 'audio';
                      const previewType = r.type === ItemType.VIDEO ? 'video' : r.type === ItemType.IMAGE ? 'image' : r.type === ItemType.MUSIC ? 'audio' : 'text';
                      return (
                        <div key={r.id} className="flex items-center gap-2 p-2 rounded bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] group/item">
                          <div
                            className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer"
                            onClick={() => selectForPreview({ type: previewType, url: r.url, title: r.title, duration: r.duration ?? 5000 })}
                          >
                            {r.type === ItemType.IMAGE && <img src={r.url} alt="" className="w-8 h-8 rounded object-cover" />}
                            {r.type === ItemType.VIDEO && <Video className="w-4 h-4" />}
                            {r.type === ItemType.MUSIC && <Music className="w-4 h-4" />}
                            <span className="text-xs truncate">{r.title}</span>
                          </div>
                          <button
                            onClick={() => addToTrack({ type: r.type, url: r.url, title: r.title, duration: r.duration ?? 5000 }, layerType)}
                            className="opacity-0 group-hover/item:opacity-100 p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--accent-text)]"
                            title="添加到轨道"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                    {store.uploadedResources.length === 0 && !isUploading && (
                      <p className="text-[10px] text-[var(--text-muted)]">暂无上传</p>
                    )}
                  </>
                )}
                {id === 'ai_subtitles' && (
                  <>
                    <button
                      onClick={async () => {
                        const text = prompt('输入要生成字幕的文本：');
                        if (!text?.trim()) return;
                        setIsGenSubtitle(true);
                        try {
                          const result = await onAIGenerateSubtitle(text.trim());
                          if (result) {
                            store.aiSubtitleResources.push({ id: Math.random().toString(36).slice(2), content: result, duration: 4000 });
                            onRefresh();
                          }
                        } finally {
                          setIsGenSubtitle(false);
                        }
                      }}
                      disabled={isGenSubtitle}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded bg-[var(--accent-bg)] text-[var(--accent-text)] hover:bg-[var(--accent-bg-hover)] text-xs"
                    >
                      {isGenSubtitle ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      AI 生成字幕
                    </button>
                    {store.aiSubtitleResources.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 p-2 rounded bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] group/item">
                        <div
                          className="flex-1 min-w-0 cursor-pointer text-[10px]"
                          onClick={() => selectForPreview({ type: 'text', content: r.content, title: r.content.slice(0, 6), duration: r.duration ?? 4000 })}
                        >
                          {r.content.slice(0, 30)}…
                        </div>
                        <button
                          onClick={() => addToTrack({ type: ItemType.TEXT, content: r.content, title: r.content.slice(0, 6), duration: r.duration ?? 4000 }, 'text')}
                          className="opacity-0 group-hover/item:opacity-100 p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--accent-text)]"
                          title="添加到轨道"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {store.aiSubtitleResources.length === 0 && !isGenSubtitle && (
                      <p className="text-[10px] text-[var(--text-muted)]">暂无 AI 字幕</p>
                    )}
                  </>
                )}
                {id === 'ai_audio' && (
                  <>
                    <button
                      onClick={async () => {
                        const text = prompt('输入要生成配音的文本：');
                        if (!text?.trim()) return;
                        setIsGenAudio(true);
                        try {
                          const result = await onAIGenerateAudio(text.trim());
                          if (result) {
                            store.aiAudioResources.push({ id: Math.random().toString(36).slice(2), url: result.url, title: text.slice(0, 10), duration: result.duration });
                            onRefresh();
                          }
                        } finally {
                          setIsGenAudio(false);
                        }
                      }}
                      disabled={isGenAudio}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded bg-[var(--accent-bg)] text-[var(--accent-text)] hover:bg-[var(--accent-bg-hover)] text-xs"
                    >
                      {isGenAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      AI 生成音频
                    </button>
                    {store.aiAudioResources.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 p-2 rounded bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] group/item">
                        <div
                          className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer"
                          onClick={() => selectForPreview({ type: 'audio', url: r.url, title: r.title, duration: r.duration ?? 5000 })}
                        >
                          <Music className="w-4 h-4" />
                          <span className="text-xs truncate">{r.title}</span>
                        </div>
                        <button
                          onClick={() => addToTrack({ type: ItemType.MUSIC, url: r.url, title: r.title, duration: r.duration ?? 5000 }, 'audio')}
                          className="opacity-0 group-hover/item:opacity-100 p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--accent-text)]"
                          title="添加到轨道"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {store.aiAudioResources.length === 0 && !isGenAudio && (
                      <p className="text-[10px] text-[var(--text-muted)]">暂无 AI 音频</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ResourcePanel;
