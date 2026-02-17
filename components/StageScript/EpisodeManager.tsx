import React, { useState, useEffect, useCallback } from 'react';
import { ProjectState, NovelChapter, NovelEpisode } from '../../types';
import { generateNovelScript, createNovelEpisode } from '../../services/ai/novelScriptService';
import { getSelectedChaptersWordCount, getChapterRangeLabel } from '../../services/novelParser';
import { getActiveChatModel } from '../../services/modelRegistry';
import { fetchChaptersPaginated, fetchChapterContent, fetchEpisodesPaginated, fetchEpisodeContent } from '../../services/storageService';
import { Clapperboard, Plus, Trash2, RotateCcw, ChevronDown, ChevronRight, ChevronLeft, Check, Play, BookOpen, AlertCircle, FileText, Edit3, Loader2 } from 'lucide-react';
import { useAlert } from '../GlobalAlert';
import * as PS from '../../services/projectPatchService';

const PAGE_SIZE = 10;

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

  // 分页状态 — 章节列表
  const [chapterPage, setChapterPage] = useState(1);
  const [paginatedChapters, setPaginatedChapters] = useState<NovelChapter[]>([]);
  const [totalChapters, setTotalChapters] = useState(0);
  const [isLoadingChapters, setIsLoadingChapters] = useState(false);

  // 分页状态 — 剧集列表
  const [episodePage, setEpisodePage] = useState(1);
  const [paginatedEpisodes, setPaginatedEpisodes] = useState<(NovelEpisode & { scriptLength?: number })[]>([]);
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);

  // 剧集内容缓存
  const [scriptCache, setScriptCache] = useState<Map<string, string>>(new Map());
  const [loadingScriptId, setLoadingScriptId] = useState<string | null>(null);

  // 章节内容缓存（用于生成剧本时获取完整内容）
  const [chapterContentCache, setChapterContentCache] = useState<Map<string, NovelChapter>>(new Map());

  const activeChatModel = getActiveChatModel();
  const model = activeChatModel?.id || project.shotGenerationModel || 'gpt-5.1';
  const language = project.language || '中文';

  const totalChapterPages = Math.max(1, Math.ceil(totalChapters / PAGE_SIZE));
  const totalEpisodePages = Math.max(1, Math.ceil(totalEpisodes / PAGE_SIZE));

  // 加载章节列表
  const loadChaptersPage = useCallback(async (page: number) => {
    setIsLoadingChapters(true);
    try {
      const data = await fetchChaptersPaginated(project.id, page, PAGE_SIZE);
      setPaginatedChapters(data.chapters);
      setTotalChapters(data.total);
      setChapterPage(data.page);
    } catch (err) {
      console.error('加载章节列表失败:', err);
      const allChapters = project.novelChapters || [];
      setTotalChapters(allChapters.length);
      const start = (page - 1) * PAGE_SIZE;
      setPaginatedChapters(allChapters.slice(start, start + PAGE_SIZE));
      setChapterPage(page);
    } finally {
      setIsLoadingChapters(false);
    }
  }, [project.id, project.novelChapters]);

  // 加载剧集列表
  const loadEpisodesPage = useCallback(async (page: number) => {
    setIsLoadingEpisodes(true);
    try {
      const data = await fetchEpisodesPaginated(project.id, page, PAGE_SIZE);
      setPaginatedEpisodes(data.episodes);
      setTotalEpisodes(data.total);
      setEpisodePage(data.page);
    } catch (err) {
      console.error('加载剧集列表失败:', err);
      const allEpisodes = project.novelEpisodes || [];
      setTotalEpisodes(allEpisodes.length);
      const start = (page - 1) * PAGE_SIZE;
      setPaginatedEpisodes(allEpisodes.slice(start, start + PAGE_SIZE));
      setEpisodePage(page);
    } finally {
      setIsLoadingEpisodes(false);
    }
  }, [project.id, project.novelEpisodes]);

  // 初始化
  useEffect(() => {
    loadChaptersPage(1);
    loadEpisodesPage(1);
    setScriptCache(new Map());
    setChapterContentCache(new Map());
  }, [project.id]);

  // 当章节数/剧集数变化时刷新
  const prevChapterCount = React.useRef(project.novelChapters?.length || 0);
  const prevEpisodeCount = React.useRef(project.novelEpisodes?.length || 0);
  useEffect(() => {
    const cc = project.novelChapters?.length || 0;
    const ec = project.novelEpisodes?.length || 0;
    if (cc !== prevChapterCount.current) {
      prevChapterCount.current = cc;
      loadChaptersPage(chapterPage);
    }
    if (ec !== prevEpisodeCount.current) {
      prevEpisodeCount.current = ec;
      loadEpisodesPage(episodePage);
    }
  }, [project.novelChapters?.length, project.novelEpisodes?.length]);

  // 按需加载剧集内容
  const loadEpisodeScript = async (episodeId: string) => {
    if (scriptCache.has(episodeId)) return;
    setLoadingScriptId(episodeId);
    try {
      const episode = await fetchEpisodeContent(project.id, episodeId);
      setScriptCache(prev => new Map(prev).set(episodeId, episode.script));
    } catch (err) {
      console.error('加载剧集内容失败:', err);
    } finally {
      setLoadingScriptId(null);
    }
  };

  // 获取完整章节内容（用于生成剧本）
  const getFullChapters = async (chapterIds: string[]): Promise<NovelChapter[]> => {
    const results: NovelChapter[] = [];
    for (const id of chapterIds) {
      if (chapterContentCache.has(id)) {
        results.push(chapterContentCache.get(id)!);
      } else {
        try {
          const ch = await fetchChapterContent(project.id, id);
          setChapterContentCache(prev => new Map(prev).set(id, ch));
          results.push(ch);
        } catch (err) {
          console.error(`获取章节 ${id} 内容失败:`, err);
          const fallback = (project.novelChapters || []).find(c => c.id === id);
          if (fallback && fallback.content) results.push(fallback);
        }
      }
    }
    return results;
  };

  const toggleChapterSelection = (chapterId: string) => {
    setSelectedChapterIds(prev =>
      prev.includes(chapterId)
        ? prev.filter(id => id !== chapterId)
        : [...prev, chapterId]
    );
  };

  const handleSelectAll = () => {
    if (selectedChapterIds.length === paginatedChapters.length) {
      setSelectedChapterIds([]);
    } else {
      setSelectedChapterIds(paginatedChapters.map(ch => ch.id));
    }
  };

  const handleGenerateEpisode = async () => {
    if (selectedChapterIds.length === 0) {
      showAlert('请先选择要生成剧本的章节', { type: 'warning' });
      return;
    }

    // 获取完整章节内容
    const selectedChapters = await getFullChapters(selectedChapterIds);
    const totalWords = selectedChapters.reduce((sum, ch) => sum + (ch.content?.length || 0), 0);

    if (totalWords > 200000) {
      showAlert(`选中章节总字数 ${totalWords.toLocaleString()} 超过 200,000 字限制，请减少选择的章节。`, { type: 'warning' });
      return;
    }

    const allChapters = project.novelChapters || [];
    const chapterRange = getChapterRangeLabel(allChapters, selectedChapterIds);
    const episodes = project.novelEpisodes || [];
    const episodeIndex = episodes.length + 1;
    const episodeName = `第${episodeIndex}集`;

    const newEpisode = createNovelEpisode(episodeName, [...selectedChapterIds], chapterRange);

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
      setScriptCache(prev => new Map(prev).set(newEpisode.id, script));

      setSelectedChapterIds([]);
      showAlert(`${episodeName} 剧本生成成功！`, { type: 'success' });
      // 刷新剧集列表
      setTimeout(() => loadEpisodesPage(episodePage), 300);
    } catch (err: any) {
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
    const selectedChapters = await getFullChapters(episode.chapterIds);
    if (selectedChapters.length === 0) {
      showAlert('关联的章节已被删除，无法重新生成', { type: 'warning' });
      return;
    }

    setGeneratingEpisodeId(episode.id);
    setStreamingText('');
    onGeneratingChange?.(true);

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
      setScriptCache(prev => new Map(prev).set(episode.id, script));

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
    const episode = paginatedEpisodes.find(ep => ep.id === episodeId) ||
                    (project.novelEpisodes || []).find(ep => ep.id === episodeId);
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
        scriptCache.delete(episodeId);
      },
    });
  };

  const handleUseForStoryboard = async (episode: NovelEpisode) => {
    // 确保有完整剧本内容
    let script = scriptCache.get(episode.id) || episode.script;
    if (!script) {
      try {
        const fullEp = await fetchEpisodeContent(project.id, episode.id);
        script = fullEp.script;
        setScriptCache(prev => new Map(prev).set(episode.id, script));
      } catch (err) {
        showAlert('获取剧本内容失败', { type: 'error' });
        return;
      }
    }
    updateProject({
      rawScript: script,
      selectedEpisodeId: episode.id,
    });
    PS.patchProject(project.id, { rawScript: script, selectedEpisodeId: episode.id });
    onSelectEpisodeForStoryboard(episode.id);
  };

  const handleStartEditScript = async (episode: NovelEpisode) => {
    setEditingEpisodeId(episode.id);
    // 确保内容已加载
    let script = scriptCache.get(episode.id);
    if (!script) {
      try {
        const fullEp = await fetchEpisodeContent(project.id, episode.id);
        script = fullEp.script;
        setScriptCache(prev => new Map(prev).set(episode.id, script!));
      } catch (err) {
        console.error('加载剧本失败:', err);
        script = episode.script || '';
      }
    }
    setEditingScript(script || '');
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
    setScriptCache(prev => new Map(prev).set(episodeId, editingScript));
    setEditingEpisodeId(null);
    setEditingScript('');
  };

  const handleToggleEpisode = async (episodeId: string) => {
    if (expandedEpisodeId === episodeId) {
      setExpandedEpisodeId(null);
    } else {
      setExpandedEpisodeId(episodeId);
      await loadEpisodeScript(episodeId);
    }
  };

  const isGenerating = generatingEpisodeId !== null;

  const handleChapterPageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalChapterPages) return;
    setSelectedChapterIds([]);
    loadChaptersPage(newPage);
  };

  const handleEpisodePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalEpisodePages) return;
    setExpandedEpisodeId(null);
    setEditingEpisodeId(null);
    loadEpisodesPage(newPage);
  };

  // 分页组件
  const Pagination = ({ currentPage, totalPages, onChange }: { currentPage: number; totalPages: number; onChange: (p: number) => void }) => {
    if (totalPages <= 1) return null;
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-3 h-3" />
        </button>
        <span className="text-[9px] text-[var(--text-muted)] font-mono px-1">
          {currentPage}/{totalPages}
        </span>
        <button
          onClick={() => onChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    );
  };

  return (
    <div className="h-full flex">
      {/* 左侧：章节选择（分页） */}
      <div className="w-80 flex-shrink-0 border-r border-[var(--border-primary)] flex flex-col">
        <div className="flex-shrink-0 p-4 border-b border-[var(--border-primary)]">
          <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider mb-3 flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5" />
            选择章节生成剧本
          </h4>

          {totalChapters > 0 && (
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={handleSelectAll}
                className="text-[10px] text-[var(--accent-text)] hover:text-[var(--accent-text-hover)] transition-colors"
              >
                {selectedChapterIds.length === paginatedChapters.length && paginatedChapters.length > 0 ? '取消全选' : '全选本页'}
              </button>
              <span className="text-[10px] text-[var(--text-muted)] font-mono">
                已选 {selectedChapterIds.length} 章
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
          {isLoadingChapters ? (
            <div className="flex flex-col items-center justify-center h-full p-6">
              <Loader2 className="w-6 h-6 text-[var(--text-muted)] animate-spin mb-2" />
              <p className="text-[10px] text-[var(--text-muted)]">加载章节...</p>
            </div>
          ) : paginatedChapters.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <FileText className="w-10 h-10 text-[var(--text-muted)] mb-3 opacity-30" />
              <p className="text-xs text-[var(--text-muted)]">
                请先在"小说管理"中上传小说
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {paginatedChapters.map((chapter) => {
                const isSelected = selectedChapterIds.includes(chapter.id);
                const wordCount = chapter.wordCount || chapter.content?.length || 0;
                const associatedEpisodes = paginatedEpisodes.filter(ep =>
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

        {/* 章节分页 */}
        {totalChapterPages > 1 && (
          <div className="flex-shrink-0 border-t border-[var(--border-primary)] px-4 py-2 flex items-center justify-between">
            <span className="text-[9px] text-[var(--text-muted)] font-mono">
              共 {totalChapters} 章
            </span>
            <Pagination currentPage={chapterPage} totalPages={totalChapterPages} onChange={handleChapterPageChange} />
          </div>
        )}
      </div>

      {/* 右侧：剧集列表（分页） */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-shrink-0 p-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
                <Clapperboard className="w-3.5 h-3.5" />
                剧集剧本列表
              </h4>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                点击"用于分镜"可将剧本导入故事编辑器，进行分镜生成
              </p>
            </div>
            {totalEpisodes > 0 && (
              <span className="text-[10px] text-[var(--text-muted)] font-mono">
                共 {totalEpisodes} 集
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoadingEpisodes ? (
            <div className="flex flex-col items-center justify-center h-full p-8">
              <Loader2 className="w-8 h-8 text-[var(--text-muted)] animate-spin mb-3" />
              <p className="text-xs text-[var(--text-muted)]">加载剧集...</p>
            </div>
          ) : paginatedEpisodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <Clapperboard className="w-12 h-12 text-[var(--text-muted)] mb-4 opacity-30" />
              <p className="text-sm text-[var(--text-tertiary)] mb-1">暂无剧集剧本</p>
              <p className="text-xs text-[var(--text-muted)]">从左侧选择章节后点击"生成一集剧本"</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {paginatedEpisodes.map((episode) => {
                const isExpanded = expandedEpisodeId === episode.id;
                const isThisGenerating = generatingEpisodeId === episode.id;
                const isEditing = editingEpisodeId === episode.id;
                const isSelected = project.selectedEpisodeId === episode.id;
                const cachedScript = scriptCache.get(episode.id);
                const isLoadingScript = loadingScriptId === episode.id;

                return (
                  <div key={episode.id} className={`${isSelected ? 'bg-[var(--accent-bg)] border-l-2 border-[var(--accent)]' : ''}`}>
                    {/* 剧集头 */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                      onClick={() => handleToggleEpisode(episode.id)}
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

                    {/* 展开内容（按需加载） */}
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
                        ) : isLoadingScript ? (
                          <div className="flex items-center gap-2 py-4 text-xs text-[var(--text-muted)]">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            加载剧本内容...
                          </div>
                        ) : cachedScript ? (
                          <div className="text-xs text-[var(--text-tertiary)] leading-relaxed whitespace-pre-wrap bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-subtle)] max-h-96 overflow-y-auto">
                            {cachedScript}
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

        {/* 剧集分页 */}
        {totalEpisodePages > 1 && (
          <div className="flex-shrink-0 border-t border-[var(--border-primary)] px-4 py-2 flex items-center justify-between">
            <span className="text-[9px] text-[var(--text-muted)] font-mono">
              共 {totalEpisodes} 集
            </span>
            <Pagination currentPage={episodePage} totalPages={totalEpisodePages} onChange={handleEpisodePageChange} />
          </div>
        )}
      </div>
    </div>
  );
};

export default EpisodeManager;
