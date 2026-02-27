import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ProjectState, NovelChapter } from '../../types';
import { readFileAsText, parseNovelToChapters } from '../../services/novelParser';
import { fetchChaptersPaginated, fetchChapterContent } from '../../services/storageService';
import { generateNovelChapter } from '../../services/ai/novelScriptService';
import { getActiveChatModel } from '../../services/modelRegistry';
import { Upload, BookOpen, Trash2, ChevronDown, ChevronRight, FileText, AlertCircle, CheckCircle2, X, ChevronLeft, Loader2, Wand2, Settings2, Plus, Sparkles } from 'lucide-react';
import * as PS from '../../services/projectPatchService';
import OptionSelector from './OptionSelector';
import { NOVEL_GENRE_OPTIONS, NOVEL_LENGTH_OPTIONS, NOVEL_TONE_OPTIONS, LANGUAGE_OPTIONS, STYLES } from './constants';

type VisualStyleOption = { label: string; value: string; desc?: string };

const PAGE_SIZE = 10;

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
  title: string;
  novelGenre: string;
  novelSynopsis: string;
  language: string;
  visualStyle: string;
  customGenreInput: string;
  customStyleInput: string;
  visualStyleOptions: VisualStyleOption[];
  onTitleChange: (value: string) => void;
  onNovelGenreChange: (value: string) => void;
  onNovelSynopsisChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onVisualStyleChange: (value: string) => void;
  onCustomGenreChange: (value: string) => void;
  onCustomStyleChange: (value: string) => void;
}

const NovelManager: React.FC<Props> = ({
  project, updateProject,
  title, novelGenre, novelSynopsis, language, visualStyle,
  customGenreInput, customStyleInput, visualStyleOptions,
  onTitleChange, onNovelGenreChange, onNovelSynopsisChange,
  onLanguageChange, onVisualStyleChange,
  onCustomGenreChange, onCustomStyleChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedChapterId, setExpandedChapterId] = useState<string | null>(null);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const [paginatedChapters, setPaginatedChapters] = useState<NovelChapter[]>([]);
  const [totalChapters, setTotalChapters] = useState(0);
  const [isLoadingPage, setIsLoadingPage] = useState(false);

  // 章节内容缓存（避免重复请求）
  const [contentCache, setContentCache] = useState<Map<string, string>>(new Map());
  const [loadingContentId, setLoadingContentId] = useState<string | null>(null);

  // AI 生成章节
  const [generatingChapterId, setGeneratingChapterId] = useState<string | null>(null);

  // AI 生成弹窗
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiModalChapter, setAiModalChapter] = useState<NovelChapter | null>(null);
  const [aiModalUseRefPrev, setAiModalUseRefPrev] = useState(false);
  const [aiModalPlotPrompt, setAiModalPlotPrompt] = useState('');
  const [aiModalLength, setAiModalLength] = useState('single');
  const [aiModalTone, setAiModalTone] = useState('default');
  const [aiModalGenre, setAiModalGenre] = useState('');
  const [aiModalCustomGenre, setAiModalCustomGenre] = useState('');

  const activeChatModel = getActiveChatModel();
  const model = activeChatModel?.id || project.shotGenerationModel || 'gpt-5.1';
  const totalPages = Math.max(1, Math.ceil(totalChapters / PAGE_SIZE));

  // 从服务端分页加载章节（合并本地新建但尚未同步到服务端的章节）
  const loadChaptersPage = useCallback(async (page: number) => {
    setIsLoadingPage(true);
    try {
      const data = await fetchChaptersPaginated(project.id, page, PAGE_SIZE);
      const serverIds = new Set(data.chapters.map((c: NovelChapter) => c.id));
      const localOnly = (project.novelChapters || []).filter(ch => !serverIds.has(ch.id));
      const allMerged = [...data.chapters, ...localOnly].sort((a, b) => a.index - b.index);
      const total = Math.max(data.total, allMerged.length);
      const start = (page - 1) * PAGE_SIZE;
      const forPage = allMerged.slice(start, start + PAGE_SIZE);
      setPaginatedChapters(forPage);
      setTotalChapters(total);
      setCurrentPage(page);
    } catch (err) {
      console.error('加载章节列表失败:', err);
      // 降级：使用 project state 中的轻量数据做本地分页
      const allChapters = project.novelChapters || [];
      setTotalChapters(allChapters.length);
      const start = (page - 1) * PAGE_SIZE;
      setPaginatedChapters(allChapters.slice(start, start + PAGE_SIZE));
      setCurrentPage(page);
    } finally {
      setIsLoadingPage(false);
    }
  }, [project.id, project.novelChapters]);

  // 初始化和 project 变化时加载第一页
  useEffect(() => {
    loadChaptersPage(1);
    setExpandedChapterId(null);
    setEditingChapterId(null);
    setContentCache(new Map());
  }, [project.id]);

  // 当 novelChapters 长度变化时（如上传、删除），刷新当前页
  const prevChapterCountRef = useRef(project.novelChapters?.length || 0);
  useEffect(() => {
    const currentCount = project.novelChapters?.length || 0;
    if (currentCount !== prevChapterCountRef.current) {
      prevChapterCountRef.current = currentCount;
      loadChaptersPage(currentPage);
    }
  }, [project.novelChapters?.length, currentPage, loadChaptersPage]);

  // 按需加载章节内容
  const loadChapterContent = async (chapterId: string) => {
    if (contentCache.has(chapterId)) return;
    setLoadingContentId(chapterId);
    try {
      const chapter = await fetchChapterContent(project.id, chapterId);
      setContentCache(prev => new Map(prev).set(chapterId, chapter.content));
    } catch (err) {
      console.error('加载章节内容失败:', err);
    } finally {
      setLoadingContentId(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.txt')) {
      setUploadError('目前仅支持 .txt 格式，请将文件转换为 UTF-8 编码的 .txt 文件后重试');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('文件大小不能超过 10MB');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const text = await readFileAsText(file);
      const parsedChapters = parseNovelToChapters(text);

      if (parsedChapters.length === 0) {
        setUploadError('未能识别章节结构。请确保小说包含"第X章"格式的章节标题。');
        return;
      }

      updateProject({ novelChapters: parsedChapters });
      PS.addChapters(project.id, parsedChapters);
      setUploadError(null);
      setContentCache(new Map());
      // 上传后回到第一页
      setTimeout(() => loadChaptersPage(1), 300);
    } catch (err: any) {
      setUploadError(err.message || '文件解析失败');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteChapter = (chapterId: string) => {
    const newChapters = (project.novelChapters || []).filter(ch => ch.id !== chapterId);
    const newEpisodes = (project.novelEpisodes || []).map(ep => ({
      ...ep,
      chapterIds: ep.chapterIds.filter(id => id !== chapterId),
    }));
    updateProject({
      novelChapters: newChapters,
      novelEpisodes: newEpisodes,
    });
    PS.removeChapter(project.id, chapterId);
    if (expandedChapterId === chapterId) setExpandedChapterId(null);
    if (editingChapterId === chapterId) setEditingChapterId(null);
    contentCache.delete(chapterId);
  };

  const handleDeleteAllChapters = () => {
    updateProject({
      novelChapters: [],
      novelEpisodes: [],
      selectedEpisodeId: null,
    });
    PS.removeAllChapters(project.id);
    PS.patchProject(project.id, { selectedEpisodeId: null });
    setExpandedChapterId(null);
    setEditingChapterId(null);
    setContentCache(new Map());
    setPaginatedChapters([]);
    setTotalChapters(0);
    setCurrentPage(1);
  };

  /** 新建章节：自动递增章节序号 */
  const handleAddChapter = () => {
    const nextIndex = totalChapters + 1;
    const newChapter: NovelChapter = {
      id: `novel-ch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      index: nextIndex,
      reel: '正文卷',
      title: '',
      content: '',
    };
    const updatedChapters = [...(project.novelChapters || []), newChapter];
    updateProject({ novelChapters: updatedChapters });
    PS.addChapters(project.id, [newChapter]);
    setContentCache(prev => new Map(prev).set(newChapter.id, ''));
    const newTotal = totalChapters + 1;
    setTotalChapters(newTotal);
    const targetPage = Math.ceil(newTotal / PAGE_SIZE);
    setCurrentPage(targetPage);
    loadChaptersPage(targetPage).then(() => {
      setExpandedChapterId(newChapter.id);
      setEditingChapterId(newChapter.id);
      setEditingContent('');
    });
  };

  const handleToggleChapter = async (chapterId: string) => {
    if (expandedChapterId === chapterId) {
      setExpandedChapterId(null);
    } else {
      setExpandedChapterId(chapterId);
      await loadChapterContent(chapterId);
    }
  };

  const handleStartEdit = async (chapter: NovelChapter) => {
    setEditingChapterId(chapter.id);
    // 确保内容已加载
    if (!contentCache.has(chapter.id)) {
      await loadChapterContent(chapter.id);
    }
    setEditingContent(contentCache.get(chapter.id) || chapter.content || '');
  };

  const handleSaveEdit = (chapterId: string) => {
    const newChapters = (project.novelChapters || []).map(ch =>
      ch.id === chapterId ? { ...ch, content: editingContent } : ch
    );
    updateProject({ novelChapters: newChapters });
    PS.patchChapter(project.id, chapterId, { content: editingContent });
    setContentCache(prev => new Map(prev).set(chapterId, editingContent));
    setEditingChapterId(null);
    setEditingContent('');
    // 刷新当前页以更新字数
    loadChaptersPage(currentPage);
  };

  const handleCancelEdit = () => {
    setEditingChapterId(null);
    setEditingContent('');
  };

  /** 获取上一章内容（用于 AI 参考） */
  const getPrevChapterContent = useCallback(async (currentChapter: NovelChapter): Promise<string> => {
    const prevIndex = currentChapter.index - 1;
    if (prevIndex < 1) return '';
    const allFromProject = project.novelChapters || [];
    let prevChapter = allFromProject.find(ch => ch.index === prevIndex);
    if (!prevChapter) {
      const targetPage = Math.ceil(prevIndex / PAGE_SIZE);
      const data = await fetchChaptersPaginated(project.id, targetPage, PAGE_SIZE);
      const serverIds = new Set(data.chapters.map((c: NovelChapter) => c.id));
      const localOnly = allFromProject.filter(ch => !serverIds.has(ch.id));
      const merged = [...data.chapters, ...localOnly].sort((a, b) => a.index - b.index);
      prevChapter = merged.find(ch => ch.index === prevIndex);
    }
    if (!prevChapter) return '';
    if (contentCache.has(prevChapter.id)) return contentCache.get(prevChapter.id)!;
    if (prevChapter.content) return prevChapter.content;
    const ch = await fetchChapterContent(project.id, prevChapter.id);
    return ch.content || '';
  }, [project.id, project.novelChapters, contentCache]);

  /** 打开 AI 生成弹窗 */
  const openAiModal = (chapter: NovelChapter, useRefPrev: boolean) => {
    setAiModalChapter(chapter);
    setAiModalUseRefPrev(useRefPrev);
    setAiModalPlotPrompt('');
    setAiModalLength('single');
    setAiModalTone('default');
    setAiModalGenre(novelGenre === 'custom' ? 'custom' : novelGenre);
    setAiModalCustomGenre(novelGenre === 'custom' ? customGenreInput : '');
    setAiModalOpen(true);
  };

  /** 确认 AI 生成 */
  const handleAiModalConfirm = async () => {
    if (!aiModalChapter) return;
    const chapter = aiModalChapter;
    const useRefPrev = aiModalUseRefPrev;
    setAiModalOpen(false);
    setAiModalChapter(null);

    setGeneratingChapterId(chapter.id);
    setUploadError(null);
    setEditingContent('');
    try {
      let prevContent = '';
      if (useRefPrev) {
        prevContent = await getPrevChapterContent(chapter);
      }
      const genre = (aiModalGenre === 'custom' ? aiModalCustomGenre : aiModalGenre) || (novelGenre === 'custom' ? customGenreInput : novelGenre) || '都市';
      const result = await generateNovelChapter(
        chapter.index,
        chapter.title,
        genre,
        novelSynopsis || '',
        title || '未命名项目',
        aiModalPlotPrompt || '',
        aiModalLength || 'single',
        aiModalTone || 'default',
        useRefPrev,
        prevContent,
        language || '中文',
        model,
        (delta) => setEditingContent(prev => prev + delta),
      );
      setEditingContent(result);
      setContentCache(prev => new Map(prev).set(chapter.id, result));
    } catch (err: any) {
      setUploadError(err?.message || 'AI 生成失败');
    } finally {
      setGeneratingChapterId(null);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setExpandedChapterId(null);
    setEditingChapterId(null);
    loadChaptersPage(newPage);
  };

  // 总字数从 project state 计算（使用 wordCount 字段）
  const allChapters = project.novelChapters || [];
  const totalWords = allChapters.reduce((sum, ch) => sum + (ch.wordCount || ch.content?.length || 0), 0);

  // 按卷分组当前页的章节
  const reelGroups = paginatedChapters.reduce<Record<string, NovelChapter[]>>((acc, ch) => {
    const reel = ch.reel || '正文卷';
    if (!acc[reel]) acc[reel] = [];
    acc[reel].push(ch);
    return acc;
  }, {});

  return (
    <div className="h-full flex bg-[var(--bg-base)] text-[var(--text-secondary)]">
      {/* 左侧：项目配置面板 */}
      <div className="w-96 border-r border-[var(--border-primary)] flex flex-col bg-[var(--bg-primary)]">
        {/* Header */}
        <div className="h-14 px-5 border-b border-[var(--border-primary)] flex items-center shrink-0">
          <h2 className="text-sm font-bold text-[var(--text-primary)] tracking-wide flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-[var(--text-tertiary)]" />
            项目配置
          </h2>
        </div>

        {/* Config Form */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* 标题 */}
          <div className="space-y-2">
            <label className={STYLES.label}>项目标题</label>
            <input
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              className={STYLES.input}
              placeholder="输入项目名称..."
            />
          </div>

          {/* 小说类型 */}
          <div className="space-y-2">
            <label className={STYLES.label}>小说类型</label>
            <div className="relative">
              <select
                value={NOVEL_GENRE_OPTIONS.some(o => o.value === novelGenre) ? novelGenre : 'custom'}
                onChange={(e) => onNovelGenreChange(e.target.value)}
                className={STYLES.select}
              >
                {NOVEL_GENRE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div className="absolute right-3 top-3 pointer-events-none">
                <ChevronRight className="w-4 h-4 text-[var(--text-muted)] rotate-90" />
              </div>
            </div>
            {novelGenre === 'custom' && (
              <input
                type="text"
                value={customGenreInput}
                onChange={(e) => onCustomGenreChange(e.target.value)}
                className={STYLES.input}
                placeholder="输入自定义类型..."
              />
            )}
          </div>

          {/* 输出语言 */}
          <div className="space-y-2">
            <label className={STYLES.label}>输出语言</label>
            <div className="relative">
              <select
                value={language}
                onChange={(e) => onLanguageChange(e.target.value)}
                className={STYLES.select}
              >
                {LANGUAGE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div className="absolute right-3 top-3 pointer-events-none">
                <ChevronRight className="w-4 h-4 text-[var(--text-muted)] rotate-90" />
              </div>
            </div>
          </div>

          {/* 小说简介 */}
          <div className="space-y-2">
            <label className={STYLES.label}>小说简介</label>
            <textarea
              value={novelSynopsis}
              onChange={(e) => onNovelSynopsisChange(e.target.value)}
              className={`${STYLES.input} resize-none`}
              rows={4}
              placeholder="输入小说的故事梗概或简介，整个项目将基于此展开..."
            />
          </div>

          {/* 视觉风格 */}
          <OptionSelector
            label="视觉风格"
            icon={<Wand2 className="w-3 h-3" />}
            options={visualStyleOptions}
            value={visualStyle}
            onChange={onVisualStyleChange}
            customInput={customStyleInput}
            onCustomInputChange={onCustomStyleChange}
            customPlaceholder="输入风格 (如: 水彩风格, 像素艺术)"
            gridCols={2}
          />
        </div>
      </div>

      {/* 右侧：小说章节管理 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 头部：上传区域 */}
        <div className="flex-shrink-0 p-6 border-b border-[var(--border-primary)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                小说章节
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                上传小说文件或新建章节，系统自动解析/递增章节序号
              </p>
            </div>
            {totalChapters > 0 && (
              <div className="text-xs text-[var(--text-tertiary)] font-mono">
                {totalChapters} 章 · {totalWords.toLocaleString()} 字
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg transition-all
                bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {isUploading ? '解析中...' : '上传小说文件'}
            </button>
            <button
              onClick={handleAddChapter}
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg transition-all
                bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-primary)]
                hover:bg-[var(--bg-hover)] hover:border-[var(--accent)]"
            >
              <Plus className="w-3.5 h-3.5" />
              新建章节
            </button>

            {totalChapters > 0 && (
              <button
                onClick={handleDeleteAllChapters}
                className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-lg transition-all
                  text-[var(--error-text)] bg-[var(--error-bg)] border border-[var(--error-border)]
                  hover:bg-[var(--error-hover-bg)]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                清空全部
              </button>
            )}
          </div>

          <p className="text-[10px] text-[var(--text-muted)] mt-2">
            上传：支持 .txt 格式（UTF-8 编码），最大 10MB，需包含"第X章"格式。新建：点击「新建章节」可手动编写，章节序号自动递增。
          </p>

          {uploadError && (
            <div className="mt-3 flex items-start gap-2 text-xs text-[var(--error-text)] bg-[var(--error-bg)] border border-[var(--error-border)] rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{uploadError}</span>
              <button onClick={() => setUploadError(null)} className="ml-auto flex-shrink-0">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* 章节列表 */}
        <div className="flex-1 overflow-y-auto">
          {isLoadingPage ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <Loader2 className="w-8 h-8 text-[var(--text-muted)] animate-spin mb-4" />
              <p className="text-xs text-[var(--text-muted)]">加载章节列表...</p>
            </div>
          ) : paginatedChapters.length === 0 && totalChapters === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <FileText className="w-12 h-12 text-[var(--text-muted)] mb-4 opacity-30" />
              <p className="text-sm text-[var(--text-tertiary)] mb-1">暂无小说内容</p>
              <p className="text-xs text-[var(--text-muted)]">上传小说文件后，章节将在此处显示</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {Object.entries(reelGroups).map(([reelName, reelChapters]) => (
                <div key={reelName}>
                  {Object.keys(reelGroups).length > 1 && (
                    <div className="px-6 py-2 bg-[var(--bg-sunken)] text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-mono">
                      {reelName}
                    </div>
                  )}
                  {Array.isArray(reelChapters) && reelChapters.map((chapter) => {
                    const isExpanded = expandedChapterId === chapter.id;
                    const isEditing = editingChapterId === chapter.id;
                    const wordCount = chapter.wordCount || chapter.content?.length || 0;
                    const hasEpisode = (project.novelEpisodes || []).some(ep =>
                      ep.chapterIds.includes(chapter.id) && ep.status === 'completed'
                    );
                    const cachedContent = contentCache.get(chapter.id);
                    const isLoadingContent = loadingContentId === chapter.id;

                    return (
                      <div key={chapter.id} className="group">
                        {/* 章节行 */}
                        <div
                          className="flex items-center gap-3 px-6 py-3 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                          onClick={() => handleToggleChapter(chapter.id)}
                        >
                          <div className="flex-shrink-0 text-[var(--text-muted)]">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-[var(--text-tertiary)]">
                                第{chapter.index}章
                              </span>
                              {chapter.title && (
                                <span className="text-xs text-[var(--text-secondary)] truncate">
                                  {chapter.title}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-3 flex-shrink-0">
                            {hasEpisode && (
                              <span className="flex items-center gap-1 text-[10px] text-[var(--success-text)]">
                                <CheckCircle2 className="w-3 h-3" />
                                已生成剧本
                              </span>
                            )}
                            <span className="text-[10px] text-[var(--text-muted)] font-mono">
                              {wordCount.toLocaleString()} 字
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteChapter(chapter.id);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--text-muted)] hover:text-[var(--error-text)] hover:bg-[var(--error-bg)] transition-all"
                              title="删除此章节"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* 展开内容（按需加载） */}
                        {isExpanded && (
                          <div className="px-6 pb-4 pl-12">
                            {isLoadingContent ? (
                              <div className="flex items-center gap-2 py-4 text-xs text-[var(--text-muted)]">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                加载章节内容...
                              </div>
                            ) : isEditing ? (
                              <div>
                                <textarea
                                  value={editingContent}
                                  onChange={(e) => setEditingContent(e.target.value)}
                                  disabled={!!generatingChapterId}
                                  className="w-full h-64 p-3 text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg resize-y focus:outline-none focus:border-[var(--accent)] disabled:opacity-80 disabled:cursor-not-allowed"
                                />
                                <div className="flex flex-wrap gap-2 mt-2 items-center">
                                  <button
                                    onClick={() => handleSaveEdit(chapter.id)}
                                    disabled={!!generatingChapterId}
                                    className="px-3 py-1.5 text-[10px] font-medium rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
                                  >
                                    保存
                                  </button>
                                  <button
                                    onClick={handleCancelEdit}
                                    disabled={!!generatingChapterId}
                                    className="px-3 py-1.5 text-[10px] font-medium rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                                  >
                                    取消
                                  </button>
                                  <span className="text-[10px] text-[var(--text-muted)] mx-1">|</span>
                                  {generatingChapterId === chapter.id ? (
                                    <span className="flex items-center gap-1.5 text-[10px] text-[var(--accent-text)]">
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      AI 生成中...
                                    </span>
                                  ) : chapter.index > 1 ? (
                                    <>
                                      <button
                                        onClick={() => openAiModal(chapter, true)}
                                        className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-medium rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:border-[var(--accent)] transition-colors"
                                      >
                                        <Sparkles className="w-3 h-3" />
                                        AI生成（参考上一章）
                                      </button>
                                      <button
                                        onClick={() => openAiModal(chapter, false)}
                                        className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-medium rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:border-[var(--accent)] transition-colors"
                                      >
                                        <Sparkles className="w-3 h-3" />
                                        AI生成（独立创作）
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => openAiModal(chapter, false)}
                                      className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-medium rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:border-[var(--accent)] transition-colors"
                                    >
                                      <Sparkles className="w-3 h-3" />
                                      AI生成
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : cachedContent ? (
                              <div>
                                <div className="text-xs text-[var(--text-tertiary)] leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-subtle)]">
                                  {cachedContent.slice(0, 2000)}
                                  {cachedContent.length > 2000 && (
                                    <span className="text-[var(--text-muted)]">
                                      ...（共 {cachedContent.length.toLocaleString()} 字）
                                    </span>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleStartEdit(chapter)}
                                  className="mt-2 text-[10px] text-[var(--accent-text)] hover:text-[var(--accent-text-hover)] transition-colors"
                                >
                                  编辑内容
                                </button>
                              </div>
                            ) : (
                              <div className="text-xs text-[var(--text-muted)] py-2">
                                无法加载内容
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 分页控件 */}
        {totalPages > 1 && (
          <div className="flex-shrink-0 border-t border-[var(--border-primary)] px-6 py-3 flex items-center justify-between">
            <div className="text-[10px] text-[var(--text-muted)] font-mono">
              共 {totalChapters} 章 · 第 {currentPage}/{totalPages} 页
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    className={`w-7 h-7 rounded-md text-[10px] font-mono transition-colors
                      ${pageNum === currentPage
                        ? 'bg-[var(--accent)] text-white'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                      }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* AI 生成弹窗 */}
      {aiModalOpen && aiModalChapter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAiModalOpen(false)}>
          <div
            className="w-full max-w-md bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                AI 生成第{aiModalChapter.index}章
              </h3>
              <button onClick={() => setAiModalOpen(false)} className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className={STYLES.label}>剧情提示词</label>
              <textarea
                value={aiModalPlotPrompt}
                onChange={(e) => setAiModalPlotPrompt(e.target.value)}
                className={`${STYLES.input} resize-none`}
                rows={3}
                placeholder="描述本章希望发生的情节、人物动向、情感转折等..."
              />
            </div>

            <div className="space-y-2">
              <label className={STYLES.label}>小说类型</label>
              <div className="relative">
                <select
                  value={NOVEL_GENRE_OPTIONS.some(o => o.value === aiModalGenre) ? aiModalGenre : 'custom'}
                  onChange={(e) => setAiModalGenre(e.target.value)}
                  className={STYLES.select}
                >
                  {NOVEL_GENRE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-3 pointer-events-none">
                  <ChevronRight className="w-4 h-4 text-[var(--text-muted)] rotate-90" />
                </div>
              </div>
              {aiModalGenre === 'custom' && (
                <input
                  type="text"
                  value={aiModalCustomGenre}
                  onChange={(e) => setAiModalCustomGenre(e.target.value)}
                  className={STYLES.input}
                  placeholder="输入自定义类型..."
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className={STYLES.label}>篇幅</label>
                <div className="relative">
                  <select
                    value={aiModalLength}
                    onChange={(e) => setAiModalLength(e.target.value)}
                    className={STYLES.select}
                  >
                    {NOVEL_LENGTH_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-3 pointer-events-none">
                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)] rotate-90" />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className={STYLES.label}>情感基调</label>
                <div className="relative">
                  <select
                    value={aiModalTone}
                    onChange={(e) => setAiModalTone(e.target.value)}
                    className={STYLES.select}
                  >
                    {NOVEL_TONE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-3 pointer-events-none">
                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)] rotate-90" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setAiModalOpen(false)}
                className="flex-1 px-4 py-2.5 text-xs font-medium rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                取消
              </button>
              <button
                onClick={handleAiModalConfirm}
                className="flex-1 px-4 py-2.5 text-xs font-medium rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
              >
                开始生成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NovelManager;
