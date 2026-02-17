import React, { useState } from 'react';
import { ProjectState, NovelChapter, NovelEpisode } from '../../types';
import { generateNovelScript, createNovelEpisode } from '../../services/ai/novelScriptService';
import { getSelectedChaptersWordCount, getChapterRangeLabel } from '../../services/novelParser';
import { getActiveChatModel } from '../../services/modelRegistry';
import { Clapperboard, Plus, Trash2, RotateCcw, ChevronDown, ChevronRight, Check, Play, BookOpen, AlertCircle, FileText, Edit3 } from 'lucide-react';
import { useAlert } from '../GlobalAlert';
import * as PS from '../../services/projectPatchService';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
  onSelectEpisodeForStoryboard: (episodeId: string) => void;
  onGeneratingChange?: (isGenerating: boolean) => void;
}

const EpisodeManager: React.FC<Props> = ({ project, updateProject, onSelectEpisodeForStoryboard, onGeneratingChange }) => {
  const { showAlert } = useAlert();
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [generatingEpisodeId, setGeneratingEpisodeId] = useState<string | null>(null);
  const [expandedEpisodeId, setExpandedEpisodeId] = useState<string | null>(null);
  const [editingEpisodeId, setEditingEpisodeId] = useState<string | null>(null);
  const [editingScript, setEditingScript] = useState('');
  const [streamingText, setStreamingText] = useState('');

  const chapters = project.novelChapters || [];
  const episodes = project.novelEpisodes || [];
  // 使用模型配置中激活的对话模型，而非项目的 shotGenerationModel
  const activeChatModel = getActiveChatModel();
  const model = activeChatModel?.id || project.shotGenerationModel || 'gpt-5.1';
  const language = project.language || '中文';

  const toggleChapterSelection = (chapterId: string) => {
    setSelectedChapterIds(prev =>
      prev.includes(chapterId)
        ? prev.filter(id => id !== chapterId)
        : [...prev, chapterId]
    );
  };

  const handleSelectAll = () => {
    if (selectedChapterIds.length === chapters.length) {
      setSelectedChapterIds([]);
    } else {
      setSelectedChapterIds(chapters.map(ch => ch.id));
    }
  };

  const handleGenerateEpisode = async () => {
    if (selectedChapterIds.length === 0) {
      showAlert('请先选择要生成剧本的章节', { type: 'warning' });
      return;
    }

    const selectedChapters = chapters.filter(ch => selectedChapterIds.includes(ch.id));
    const totalWords = getSelectedChaptersWordCount(chapters, selectedChapterIds);

    if (totalWords > 200000) {
      showAlert(`选中章节总字数 ${totalWords.toLocaleString()} 超过 200,000 字限制，请减少选择的章节。`, { type: 'warning' });
      return;
    }

    const chapterRange = getChapterRangeLabel(chapters, selectedChapterIds);
    const episodeIndex = episodes.length + 1;
    const episodeName = `第${episodeIndex}集`;

    const newEpisode = createNovelEpisode(episodeName, [...selectedChapterIds], chapterRange);

    // 先添加 pending 状态的剧集
    const updatedEpisodes = [...episodes, newEpisode];
    updateProject({ novelEpisodes: updatedEpisodes });
    PS.addEpisode(project.id, newEpisode);

    setGeneratingEpisodeId(newEpisode.id);
    setStreamingText('');
    onGeneratingChange?.(true);

    try {
      const script = await generateNovelScript(
        selectedChapters,
        episodeName,
        language,
        model,
        (delta) => {
          setStreamingText(prev => prev + delta);
        },
      );

      // 更新剧集状态为完成
      const now = Date.now();
      updateProject((prev: ProjectState) => ({
        ...prev,
        novelEpisodes: prev.novelEpisodes.map(ep =>
          ep.id === newEpisode.id
            ? { ...ep, script, status: 'completed' as const, updatedAt: now }
            : ep
        ),
      }));
      PS.patchEpisode(project.id, newEpisode.id, { script, status: 'completed', updatedAt: now });

      setSelectedChapterIds([]);
      showAlert(`${episodeName} 剧本生成成功！`, { type: 'success' });
    } catch (err: any) {
      // 标记失败
      const now = Date.now();
      updateProject((prev: ProjectState) => ({
        ...prev,
        novelEpisodes: prev.novelEpisodes.map(ep =>
          ep.id === newEpisode.id
            ? { ...ep, status: 'failed' as const, updatedAt: now }
            : ep
        ),
      }));
      PS.patchEpisode(project.id, newEpisode.id, { status: 'failed', updatedAt: now });
      showAlert(`剧本生成失败：${err.message}`, { type: 'error' });
    } finally {
      setGeneratingEpisodeId(null);
      setStreamingText('');
      onGeneratingChange?.(false);
    }
  };

  const handleRegenerateEpisode = async (episode: NovelEpisode) => {
    const selectedChapters = chapters.filter(ch => episode.chapterIds.includes(ch.id));
    if (selectedChapters.length === 0) {
      showAlert('关联的章节已被删除，无法重新生成', { type: 'warning' });
      return;
    }

    setGeneratingEpisodeId(episode.id);
    setStreamingText('');
    onGeneratingChange?.(true);

    // 设置为 generating 状态
    updateProject((prev: ProjectState) => ({
      ...prev,
      novelEpisodes: prev.novelEpisodes.map(ep =>
        ep.id === episode.id ? { ...ep, status: 'generating' as const } : ep
      ),
    }));
    PS.patchEpisode(project.id, episode.id, { status: 'generating' });

    try {
      const script = await generateNovelScript(
        selectedChapters,
        episode.name,
        language,
        model,
        (delta) => {
          setStreamingText(prev => prev + delta);
        },
      );

      const now = Date.now();
      updateProject((prev: ProjectState) => ({
        ...prev,
        novelEpisodes: prev.novelEpisodes.map(ep =>
          ep.id === episode.id
            ? { ...ep, script, status: 'completed' as const, updatedAt: now }
            : ep
        ),
      }));
      PS.patchEpisode(project.id, episode.id, { script, status: 'completed', updatedAt: now });

      showAlert(`${episode.name} 剧本重新生成成功！`, { type: 'success' });
    } catch (err: any) {
      const now = Date.now();
      updateProject((prev: ProjectState) => ({
        ...prev,
        novelEpisodes: prev.novelEpisodes.map(ep =>
          ep.id === episode.id
            ? { ...ep, status: 'failed' as const, updatedAt: now }
            : ep
        ),
      }));
      PS.patchEpisode(project.id, episode.id, { status: 'failed', updatedAt: now });
      showAlert(`重新生成失败：${err.message}`, { type: 'error' });
    } finally {
      setGeneratingEpisodeId(null);
      setStreamingText('');
      onGeneratingChange?.(false);
    }
  };

  const handleDeleteEpisode = (episodeId: string) => {
    const episode = episodes.find(ep => ep.id === episodeId);
    showAlert(`确定要删除 ${episode?.name || '此剧集'} 的剧本吗？`, {
      type: 'warning',
      showCancel: true,
      onConfirm: () => {
        updateProject((prev: ProjectState) => ({
          ...prev,
          novelEpisodes: prev.novelEpisodes.filter(ep => ep.id !== episodeId),
          selectedEpisodeId: prev.selectedEpisodeId === episodeId ? null : prev.selectedEpisodeId,
        }));
        PS.removeEpisode(project.id, episodeId);
        if (project.selectedEpisodeId === episodeId) {
          PS.patchProject(project.id, { selectedEpisodeId: null });
        }
      },
    });
  };

  const handleUseForStoryboard = (episode: NovelEpisode) => {
    updateProject({
      rawScript: episode.script,
      selectedEpisodeId: episode.id,
    });
    PS.patchProject(project.id, { rawScript: episode.script, selectedEpisodeId: episode.id });
    onSelectEpisodeForStoryboard(episode.id);
  };

  const handleStartEditScript = (episode: NovelEpisode) => {
    setEditingEpisodeId(episode.id);
    setEditingScript(episode.script);
  };

  const handleSaveEditScript = (episodeId: string) => {
    const now = Date.now();
    updateProject((prev: ProjectState) => ({
      ...prev,
      novelEpisodes: prev.novelEpisodes.map(ep =>
        ep.id === episodeId
          ? { ...ep, script: editingScript, updatedAt: now }
          : ep
      ),
    }));
    PS.patchEpisode(project.id, episodeId, { script: editingScript, updatedAt: now });
    setEditingEpisodeId(null);
    setEditingScript('');
  };

  const isGenerating = generatingEpisodeId !== null;

  return (
    <div className="h-full flex">
      {/* 左侧：章节选择 */}
      <div className="w-80 flex-shrink-0 border-r border-[var(--border-primary)] flex flex-col">
        <div className="flex-shrink-0 p-4 border-b border-[var(--border-primary)]">
          <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider mb-3 flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5" />
            选择章节生成剧本
          </h4>

          {chapters.length > 0 && (
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={handleSelectAll}
                className="text-[10px] text-[var(--accent-text)] hover:text-[var(--accent-text-hover)] transition-colors"
              >
                {selectedChapterIds.length === chapters.length ? '取消全选' : '全选'}
              </button>
              <span className="text-[10px] text-[var(--text-muted)] font-mono">
                已选 {selectedChapterIds.length}/{chapters.length} 章
                {selectedChapterIds.length > 0 && (
                  <> · {getSelectedChaptersWordCount(chapters, selectedChapterIds).toLocaleString()} 字</>
                )}
              </span>
            </div>
          )}

          <button
            onClick={handleGenerateEpisode}
            disabled={selectedChapterIds.length === 0 || isGenerating}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg transition-all
              bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                生成中...
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                生成一集剧本
              </>
            )}
          </button>
          <p className="text-[9px] text-[var(--text-muted)] mt-1.5 text-center">
            使用模型：{activeChatModel?.name || model}
          </p>
        </div>

        {/* 章节复选列表 */}
        <div className="flex-1 overflow-y-auto">
          {chapters.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <FileText className="w-10 h-10 text-[var(--text-muted)] mb-3 opacity-30" />
              <p className="text-xs text-[var(--text-muted)]">
                请先在"小说管理"中上传小说
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {chapters.map((chapter) => {
                const isSelected = selectedChapterIds.includes(chapter.id);
                const wordCount = chapter.content.length;
                const associatedEpisodes = episodes.filter(ep =>
                  ep.chapterIds.includes(chapter.id) && ep.status === 'completed'
                );

                return (
                  <label
                    key={chapter.id}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors
                      ${isSelected ? 'bg-[var(--accent-bg)]' : 'hover:bg-[var(--bg-hover)]'}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleChapterSelection(chapter.id)}
                      className="w-3.5 h-3.5 rounded accent-[var(--accent)] flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[var(--text-secondary)] truncate">
                        第{chapter.index}章 {chapter.title}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-[var(--text-muted)] font-mono">
                          {wordCount.toLocaleString()} 字
                        </span>
                        {associatedEpisodes.length > 0 && (
                          <span className="text-[10px] text-[var(--success-text)]">
                            → {associatedEpisodes.map(ep => ep.name).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：剧集列表 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-shrink-0 p-4 border-b border-[var(--border-primary)]">
          <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
            <Clapperboard className="w-3.5 h-3.5" />
            剧集剧本列表
          </h4>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">
            点击"用于分镜"可将剧本导入故事编辑器，进行分镜生成
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {episodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <Clapperboard className="w-12 h-12 text-[var(--text-muted)] mb-4 opacity-30" />
              <p className="text-sm text-[var(--text-tertiary)] mb-1">暂无剧集剧本</p>
              <p className="text-xs text-[var(--text-muted)]">从左侧选择章节后点击"生成一集剧本"</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {episodes.map((episode) => {
                const isExpanded = expandedEpisodeId === episode.id;
                const isThisGenerating = generatingEpisodeId === episode.id;
                const isEditing = editingEpisodeId === episode.id;
                const isSelected = project.selectedEpisodeId === episode.id;

                return (
                  <div key={episode.id} className={`${isSelected ? 'bg-[var(--accent-bg)] border-l-2 border-[var(--accent)]' : ''}`}>
                    {/* 剧集头 */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                      onClick={() => setExpandedEpisodeId(isExpanded ? null : episode.id)}
                    >
                      <div className="text-[var(--text-muted)]">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-[var(--text-primary)]">{episode.name}</span>
                          <span className="text-[10px] text-[var(--text-muted)] font-mono">{episode.chapterRange}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {episode.status === 'completed' && (
                            <span className="text-[10px] text-[var(--success-text)] flex items-center gap-1">
                              <Check className="w-2.5 h-2.5" /> 已生成
                            </span>
                          )}
                          {episode.status === 'generating' && (
                            <span className="text-[10px] text-[var(--warning-text)] flex items-center gap-1">
                              <div className="w-2.5 h-2.5 animate-spin rounded-full border border-current border-t-transparent" />
                              生成中
                            </span>
                          )}
                          {episode.status === 'failed' && (
                            <span className="text-[10px] text-[var(--error-text)] flex items-center gap-1">
                              <AlertCircle className="w-2.5 h-2.5" /> 生成失败
                            </span>
                          )}
                          {episode.status === 'pending' && (
                            <span className="text-[10px] text-[var(--text-muted)]">等待生成</span>
                          )}
                          {isSelected && (
                            <span className="text-[10px] text-[var(--accent-text)] font-medium">当前使用中</span>
                          )}
                        </div>
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        {episode.status === 'completed' && (
                          <>
                            <button
                              onClick={() => handleUseForStoryboard(episode)}
                              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md
                                bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
                              title="将此剧本导入故事编辑器用于分镜生成"
                            >
                              <Play className="w-2.5 h-2.5" /> 用于分镜
                            </button>
                            <button
                              onClick={() => handleStartEditScript(episode)}
                              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                              title="编辑剧本"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                          </>
                        )}
                        {(episode.status === 'completed' || episode.status === 'failed') && (
                          <button
                            onClick={() => handleRegenerateEpisode(episode)}
                            disabled={isGenerating}
                            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--warning-text)] hover:bg-[var(--warning-bg)] transition-colors disabled:opacity-50"
                            title="重新生成"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteEpisode(episode.id)}
                          disabled={isThisGenerating}
                          className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--error-text)] hover:bg-[var(--error-bg)] transition-colors disabled:opacity-50"
                          title="删除"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* 展开内容 */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pl-10">
                        {isThisGenerating && streamingText ? (
                          <div className="text-xs text-[var(--text-tertiary)] leading-relaxed whitespace-pre-wrap bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-subtle)] max-h-96 overflow-y-auto">
                            {streamingText}
                            <span className="inline-block w-1.5 h-3.5 bg-[var(--accent)] animate-pulse ml-0.5" />
                          </div>
                        ) : isEditing ? (
                          <div>
                            <textarea
                              value={editingScript}
                              onChange={(e) => setEditingScript(e.target.value)}
                              className="w-full h-96 p-3 text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg resize-y focus:outline-none focus:border-[var(--accent)] font-mono leading-relaxed"
                            />
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handleSaveEditScript(episode.id)}
                                className="px-3 py-1.5 text-[10px] font-medium rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
                              >
                                保存修改
                              </button>
                              <button
                                onClick={() => { setEditingEpisodeId(null); setEditingScript(''); }}
                                className="px-3 py-1.5 text-[10px] font-medium rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : episode.script ? (
                          <div className="text-xs text-[var(--text-tertiary)] leading-relaxed whitespace-pre-wrap bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-subtle)] max-h-96 overflow-y-auto">
                            {episode.script}
                          </div>
                        ) : (
                          <div className="text-xs text-[var(--text-muted)] italic">
                            {episode.status === 'pending' ? '等待生成...' : '暂无内容'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EpisodeManager;
