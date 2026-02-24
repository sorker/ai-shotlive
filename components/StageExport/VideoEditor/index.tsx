/**
 * 视频剪辑器 - 主组件
 * 集成到 AI 短剧成片导出，支持多轨道、资源库、AI 功能、导出
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Sparkles, Type, Cloud, CloudOff, Download, Loader2 } from 'lucide-react';
import { ProjectState } from '../../../types';
import { VideoEditorStore } from './VideoEditorStore';
import Player from './Player';
import Timeline from './Timeline';
import PropertyPanel from './PropertyPanel';
import ResourcePanel from './ResourcePanel';
import { useAlert } from '../../GlobalAlert';
import { createItem, ItemType } from './types';
import {
  getVideoEditorState,
  saveVideoEditorState,
  layersToStorageFormat,
  layersFromStorageFormat,
} from '../../../services/videoEditorService';
import { generateSubtitleText } from '../../../services/videoEditorAiService';
import { exportEditedVideos } from './VideoExporter';

const SAVE_DEBOUNCE_MS = 800;

interface VideoEditorProps {
  project: ProjectState;
  onClose: () => void;
  onShowModelConfig?: () => void;
}

const VideoEditor: React.FC<VideoEditorProps> = ({ project, onClose, onShowModelConfig }) => {
  const { showAlert } = useAlert();
  const [refresh, setRefresh] = useState(Symbol(1));
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isExporting, setIsExporting] = useState(false);
  const [serverVersion, setServerVersion] = useState(0);
  const store = useMemo(() => new VideoEditorStore(), []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverVersionRef = useRef(0);
  serverVersionRef.current = serverVersion;

  const episodeId = project.selectedEpisodeId || '_default';

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      if (store.layers.length === 0) return;
      setSaveStatus('saving');
      const layersForStorage = layersToStorageFormat(store.layers, project.shots);
      saveVideoEditorState(
        project.id,
        episodeId,
        layersForStorage,
        serverVersionRef.current
      )
        .then((res) => {
          setServerVersion(res.version);
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        })
        .catch((err) => {
          setSaveStatus('error');
          showAlert(`保存失败: ${err.message}`, { type: 'error' });
        });
    }, SAVE_DEBOUNCE_MS);
  }, [project.id, project.shots, episodeId, showAlert]);

  const onRefresh = useCallback(() => {
    setRefresh(Symbol(1));
    scheduleSave();
  }, [scheduleSave]);

  useEffect(() => {
    store.setUpdateCallback(onRefresh);
    let isMounted = true;

    const load = async () => {
      try {
        const res = await getVideoEditorState(project.id, episodeId);
        if (!isMounted) return;
        if (res.data && Array.isArray(res.data) && res.data.length > 0) {
          const resolved = layersFromStorageFormat(res.data, project.shots);
          store.deserialize(JSON.stringify(resolved));
          setServerVersion(res.version);
        } else {
          store.importFromProject(project.shots);
        }
      } catch {
        if (isMounted) store.importFromProject(project.shots);
      }
      onRefresh();
    };

    load();
    return () => {
      isMounted = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [project.id, episodeId]);

  const handleAddSubtitle = () => {
    const layer = store.layers.find((l) => l.type === 'text') ?? store.addLayer('text', '字幕轨道');
    const curItem = store.getActiveItem();
    const start = curItem ? curItem.start + curItem.duration : store.getTotalTime();
    const subtitle = createItem(3000, '字幕', ItemType.TEXT, { content: '请输入字幕内容' });
    store.addItemToLayer(layer.id, subtitle);
    subtitle.start = start;
    onRefresh();
  };

  const handleAIGenerateSubtitle = useCallback(async (text: string): Promise<string | null> => {
    try {
      return await generateSubtitleText(text);
    } catch (e: any) {
      showAlert(e?.message || '生成失败', { type: 'error' });
      if (e?.message?.includes('配置') && onShowModelConfig) onShowModelConfig();
      return null;
    }
  }, [showAlert, onShowModelConfig]);

  const handleAIGenerateAudio = useCallback(async (text: string): Promise<{ url: string; duration: number } | null> => {
    try {
      const { generateAudioFromText } = await import('../../../services/videoEditorAiService');
      return await generateAudioFromText(text);
    } catch (e: any) {
      showAlert(e?.message || 'AI 音频生成失败', { type: 'error' });
      if (onShowModelConfig) onShowModelConfig();
      return null;
    }
  }, [showAlert, onShowModelConfig]);

  const handleExport = useCallback(async () => {
    try {
      setIsExporting(true);
      await exportEditedVideos(store, project.scriptData?.title || project.title, (phase, prog) => {
        setSaveStatus(prog >= 100 ? 'idle' : 'saving');
      });
      showAlert('导出完成', { type: 'success' });
    } catch (e: any) {
      showAlert(e?.message || '导出失败', { type: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [store, project, showAlert]);

  /** 自动从镜头生成字幕（按 dialogue 和 actionSummary） */
  const handleAIGenerateSubtitles = () => {
    const completedShots = project.shots.filter((s) => s.interval?.videoUrl);
    if (completedShots.length === 0) {
      showAlert('暂无已完成的镜头，无法生成字幕', { type: 'warning' });
      return;
    }
    const layer = store.layers.find((l) => l.type === 'text') ?? store.addLayer('text', '字幕轨道');
    let currentStart = 0;
    for (const shot of completedShots) {
      const duration = (shot.interval!.duration || 10) * 1000;
      const text = shot.dialogue || shot.actionSummary || '';
      if (text.trim()) {
        const subtitle = createItem(Math.min(duration, 4000), '字幕', ItemType.TEXT, {
          content: text.trim().slice(0, 50),
        });
        store.addItemToLayer(layer.id, subtitle);
        subtitle.start = currentStart;
      }
      currentStart += duration;
    }
    showAlert(`已生成 ${completedShots.length} 条字幕`, { type: 'success' });
    onRefresh();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-base)]">
      {/* 头部 */}
      <div className="h-14 border-b border-[var(--border-primary)] bg-[var(--bg-elevated)] flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[var(--accent)]" />
            智能剪辑
          </h2>
          <span className="text-xs text-[var(--text-muted)] font-mono bg-[var(--bg-base)]/50 px-2 py-1 rounded">
            {project.scriptData?.title || project.title}
          </span>
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
              <Cloud className="w-3.5 h-3.5 animate-pulse" />
              保存中…
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1.5 text-[10px] text-[var(--success-text)]">
              <Cloud className="w-3.5 h-3.5" />
              已同步
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="flex items-center gap-1.5 text-[10px] text-[var(--error-text)]">
              <CloudOff className="w-3.5 h-3.5" />
              同步失败
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAIGenerateSubtitles}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-bg)] text-[var(--accent-text)] hover:bg-[var(--accent-bg-hover)] border border-[var(--accent-border)] transition-colors text-sm"
            title="根据镜头自动生成字幕"
          >
            <Type className="w-4 h-4" />
            AI 字幕
          </button>
          <button
            onClick={handleAddSubtitle}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border-secondary)] transition-colors text-sm"
            title="添加空白字幕"
          >
            <Type className="w-4 h-4" />
            添加字幕
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors text-sm"
            title="下载剪辑"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            下载
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 主体 */}
      <div className="flex-1 flex overflow-hidden p-4 gap-4">
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <Player store={store} layers={store.layers} refresh={refresh} />
          <div className="flex-1 min-h-0">
            <Timeline store={store} refresh={refresh} onRefresh={onRefresh} />
          </div>
        </div>
        <ResourcePanel
          project={project}
          store={store}
          onRefresh={onRefresh}
          onShowModelConfig={onShowModelConfig ?? (() => {})}
          onAIGenerateSubtitle={handleAIGenerateSubtitle}
          onAIGenerateAudio={handleAIGenerateAudio}
        />
        <PropertyPanel store={store} item={store.getActiveItem()} onRefresh={onRefresh} />
      </div>
    </div>
  );
};

export default VideoEditor;
