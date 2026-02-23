import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import StageScript from './components/StageScript';
import StageAssets from './components/StageAssets';
import StageDirector from './components/StageDirector';
import StageExport from './components/StageExport';
import StagePrompts from './components/StagePrompts';
import Dashboard from './components/Dashboard';
import Onboarding, { shouldShowOnboarding, resetOnboarding } from './components/Onboarding';
import ModelConfigModal from './components/ModelConfig';
import Login from './components/Login';
import { ProjectState } from './types';
import { Loader2, Clapperboard } from 'lucide-react';
import { loadProjectFromDB } from './services/storageService';
import { patchProject } from './services/projectPatchService';
import { setLogCallback, clearLogCallback } from './services/renderLogService';
import { useAlert } from './components/GlobalAlert';
import { useAuth } from './contexts/AuthContext';
import logoImg from './logo.png';

function App() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { showAlert } = useAlert();
  const [project, setProject] = useState<ProjectState | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProjectLoading, setIsProjectLoading] = useState(false);

  // Detect mobile device on mount
  useEffect(() => {
    const checkMobile = () => {
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 1024;
      setIsMobile(isMobileDevice);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 检查是否需要显示首次引导
  useEffect(() => {
    if (shouldShowOnboarding()) {
      setShowOnboarding(true);
    }
  }, []);

  // 处理引导完成
  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  // 处理快速开始选项
  const handleOnboardingQuickStart = (option: 'script' | 'example') => {
    setShowOnboarding(false);
    // 如果选择"从剧本开始"，可以后续扩展为创建新项目
    // 如果选择"看看示例项目"，可以后续扩展为打开示例项目
    console.log('Quick start option:', option);
  };

  // 重新显示引导（供帮助菜单调用）
  const handleShowOnboarding = () => {
    resetOnboarding();
    setShowOnboarding(true);
  };

  // 显示模型配置弹窗
  const handleShowModelConfig = () => {
    setShowModelConfig(true);
  };

  // Global error handler to catch API Key errors
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      // Check if error is related to API Key
      if (event.error?.name === 'ApiKeyError' || 
          event.error?.message?.includes('API Key missing') ||
          event.error?.message?.includes('AntSK API Key')) {
        console.warn('🔐 检测到 API Key 错误，请配置 API Key...');
        setShowModelConfig(true); // 打开模型配置弹窗让用户配置
        event.preventDefault(); // Prevent default error display
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      // Check if rejection is related to API Key
      if (event.reason?.name === 'ApiKeyError' ||
          event.reason?.message?.includes('API Key missing') ||
          event.reason?.message?.includes('AntSK API Key')) {
        console.warn('🔐 检测到 API Key 错误，请配置 API Key...');
        setShowModelConfig(true); // 打开模型配置弹窗让用户配置
        event.preventDefault(); // Prevent default error display
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  // Setup render log callback
  useEffect(() => {
    if (project) {
      setLogCallback((log) => {
        setProject(prev => {
          if (!prev) return null;
          return {
            ...prev,
            renderLogs: [...(prev.renderLogs || []), log]
          };
        });
      });
    } else {
      clearLogCallback();
    }
    
    return () => clearLogCallback();
  }, [project?.id]); // Re-setup when project changes

  // Auto-save 已移除：各组件在用户编辑时直接调用 projectPatchService 进行增量保存。
  // 任务结果由服务端 TaskRunner 直接写入 DB，无需前端保存。


  const updateProject = (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => {
    if (!project) return;
    setProject(prev => {
      if (!prev) return null;
      // 支持函数式更新
      if (typeof updates === 'function') {
        return updates(prev);
      }
      return { ...prev, ...updates };
    });
  };

  const setStage = (stage: 'script' | 'assets' | 'director' | 'export' | 'prompts') => {
    if (isGenerating) {
      showAlert('当前正在执行生成任务（剧本分镜 / 首帧 / 视频等），切换页面会导致生成数据丢失，且已扣除的费用无法恢复。\n\n确定要离开当前页面吗？', {
        title: '生成任务进行中',
        type: 'warning',
        showCancel: true,
        confirmText: '确定离开',
        cancelText: '继续等待',
        onConfirm: () => {
          setIsGenerating(false);
          updateProject({ stage });
          if (project) patchProject(project.id, { stage });
        }
      });
      return;
    }
    updateProject({ stage });
    if (project) patchProject(project.id, { stage });
  };

  const handleOpenProject = async (proj: ProjectState) => {
    setIsProjectLoading(true);
    try {
      const fullProject = await loadProjectFromDB(proj.id);
      setProject(fullProject);
    } catch (e) {
      console.error('加载项目失败:', e);
      setProject(proj);
    } finally {
      setIsProjectLoading(false);
    }
  };

  // 切换剧本后重新加载项目数据（获取该剧本的隔离数据）
  const handleSwitchEpisode = async (episodeId: string | null) => {
    if (!project) return;
    setIsProjectLoading(true);
    try {
      // 先更新 selectedEpisodeId
      await patchProject(project.id, { selectedEpisodeId: episodeId });
      // 重新加载项目（后端会按新的 episodeId 过滤数据）
      const fullProject = await loadProjectFromDB(project.id);
      setProject(fullProject);
    } catch (e) {
      console.error('切换剧本失败:', e);
    } finally {
      setIsProjectLoading(false);
    }
  };

  const handleExitProject = async () => {
    if (isGenerating) {
      showAlert('当前正在执行生成任务（剧本分镜 / 首帧 / 视频等），退出项目会导致生成数据丢失，且已扣除的费用无法恢复。\n\n确定要退出吗？', {
        title: '生成任务进行中',
        type: 'warning',
        showCancel: true,
        confirmText: '确定退出',
        cancelText: '继续等待',
        onConfirm: () => {
          setIsGenerating(false);
          setProject(null);
        }
      });
      return;
    }
    setProject(null);
  };

  // 判断是否需要先选择剧本（有剧集但未选择时）
  const needsEpisodeSelection = project
    && (project.novelEpisodes?.length > 0)
    && !project.selectedEpisodeId;

  const renderEpisodeGate = () => (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <Clapperboard className="w-16 h-16 text-[var(--text-muted)] mb-4 opacity-30" />
      <p className="text-lg text-[var(--text-tertiary)] mb-2">请先选择一个剧本</p>
      <p className="text-xs text-[var(--text-muted)] mb-6 max-w-md leading-relaxed">
        本项目包含多个剧本，请先在「小说与剧本」页面中选择一个剧本进行创作。<br />
        不同剧本的故事、角色、场景、分镜等数据相互隔离，资产库数据可共享。
      </p>
      <button
        onClick={() => setStage('script')}
        className="px-5 py-2.5 text-xs font-medium rounded-lg bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] transition-colors"
      >
        前往选择剧本
      </button>
    </div>
  );

  const renderStage = () => {
    if (!project) return null;
    switch (project.stage) {
      case 'script':
        return (
          <StageScript
            project={project}
            updateProject={updateProject}
            onShowModelConfig={handleShowModelConfig}
            onGeneratingChange={setIsGenerating}
            onSwitchEpisode={handleSwitchEpisode}
          />
        );
      case 'assets':
        if (needsEpisodeSelection) return renderEpisodeGate();
        return <StageAssets project={project} updateProject={updateProject} onGeneratingChange={setIsGenerating} />;
      case 'director':
        if (needsEpisodeSelection) return renderEpisodeGate();
        return <StageDirector project={project} updateProject={updateProject} onGeneratingChange={setIsGenerating} />;
      case 'export':
        if (needsEpisodeSelection) return renderEpisodeGate();
        return <StageExport project={project} />;
      case 'prompts':
        return <StagePrompts project={project} updateProject={updateProject} />;
      default:
        return <div className="text-[var(--text-primary)]">未知阶段</div>;
    }
  };

  // Auth Loading Screen
  if (authLoading) {
    return (
      <div className="h-screen bg-[var(--bg-base)] flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 text-[var(--text-muted)] animate-spin mx-auto" />
          <p className="text-xs text-[var(--text-muted)] font-mono uppercase tracking-widest">加载中...</p>
        </div>
      </div>
    );
  }

  // Login Screen - 未登录时显示登录页面
  if (!isAuthenticated) {
    return <Login />;
  }

  // Mobile Warning Screen
  if (isMobile) {
    return (
      <div className="h-screen bg-[var(--bg-base)] flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-6">
          <img src={logoImg} alt="Logo" className="w-20 h-20 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">AI shotlive Director</h1>
          <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl p-8">
            <p className="text-[var(--text-tertiary)] text-base leading-relaxed mb-4">
              为了获得最佳体验，请使用 PC 端浏览器访问。
            </p>
            <p className="text-[var(--text-muted)] text-sm">
              本应用需要较大的屏幕空间和桌面级浏览器环境才能正常运行。
            </p>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            <a href="https://director.tree456.com/" target="_blank" rel="noreferrer" className="hover:text-[var(--accent-text)] transition-colors">
              访问产品首页了解更多
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Project Loading Screen
  if (isProjectLoading) {
    return (
      <div className="h-screen bg-[var(--bg-base)] flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 text-[var(--text-muted)] animate-spin mx-auto" />
          <p className="text-xs text-[var(--text-muted)] font-mono uppercase tracking-widest">加载项目数据...</p>
        </div>
      </div>
    );
  }

  // Dashboard View
  if (!project) {
    return (
       <>
         <Dashboard 
           onOpenProject={handleOpenProject} 
           onShowOnboarding={handleShowOnboarding}
           onShowModelConfig={handleShowModelConfig}
         />
         {showOnboarding && (
           <Onboarding 
             onComplete={handleOnboardingComplete}
             onQuickStart={handleOnboardingQuickStart}
           />
         )}
         <ModelConfigModal
           isOpen={showModelConfig}
           onClose={() => setShowModelConfig(false)}
         />
       </>
    );
  }

  // Workspace View
  return (
    <div className="flex h-screen bg-[var(--bg-secondary)] font-sans text-[var(--text-secondary)] selection:bg-[var(--accent-bg)]">
      <Sidebar 
        currentStage={project.stage} 
        setStage={setStage} 
        onExit={handleExitProject} 
        projectName={project.title}
        activeEpisodeName={
          project.selectedEpisodeId
            ? (project.novelEpisodes || []).find(ep => ep.id === project.selectedEpisodeId)?.name || '当前剧本'
            : undefined
        }
        onShowOnboarding={handleShowOnboarding}
        onShowModelConfig={() => setShowModelConfig(true)}
        isNavigationLocked={isGenerating}
      />
      
      <main className="ml-72 flex-1 h-screen overflow-hidden relative">
        {renderStage()}
        
        {/* Save Status Indicator — 已移除：改用增量 PATCH 保存 */}
      </main>

      {/* Onboarding Modal */}
      {showOnboarding && (
        <Onboarding 
          onComplete={handleOnboardingComplete}
          onQuickStart={handleOnboardingQuickStart}
        />
      )}

      {/* Model Config Modal */}
      <ModelConfigModal
        isOpen={showModelConfig}
        onClose={() => setShowModelConfig(false)}
      />
    </div>
  );
}

export default App;