import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ProjectState, NovelChapter } from '../../types';
import { readFileAsText, parseNovelToChapters } from '../../services/novelParser';
import { fetchChaptersPaginated, fetchChapterContent } from '../../services/storageService';
import { Upload, BookOpen, Trash2, ChevronDown, ChevronRight, FileText, AlertCircle, CheckCircle2, X, ChevronLeft, Loader2 } from 'lucide-react';
import * as PS from '../../services/projectPatchService';

const PAGE_SIZE = 10;

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
}

const NovelManager: React.FC<Props> = ({ project, updateProject }) => {
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

  const totalPages = Math.max(1, Math.ceil(totalChapters / PAGE_SIZE));

  // 从服务端分页加载章节
  const loadChaptersPage = useCallback(async (page: number) => {
    setIsLoadingPage(true);
    try {
      const data = await fetchChaptersPaginated(project.id, page, PAGE_SIZE);
      setPaginatedChapters(data.chapters);
      setTotalChapters(data.total);
      setCurrentPage(data.page);
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
    <div className="h-full flex flex-col">
      {/* 头部：上传区域 */}
      <div className="flex-shrink-0 p-6 border-b border-[var(--border-primary)]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              小说管理
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              上传小说文件，系统自动解析章节结构
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
          支持 .txt 格式（UTF-8 编码），最大 10MB。需包含"第X章"格式的章节标题。
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
                                className="w-full h-64 p-3 text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg resize-y focus:outline-none focus:border-[var(--accent)]"
                              />
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={() => handleSaveEdit(chapter.id)}
                                  className="px-3 py-1.5 text-[10px] font-medium rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
                                >
                                  保存
                                </button>
                                <button
                                  onClick={handleCancelEdit}
                                  className="px-3 py-1.5 text-[10px] font-medium rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                                >
                                  取消
                                </button>
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
  );
};

export default NovelManager;
