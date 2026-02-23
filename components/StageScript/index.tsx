import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ProjectState, Shot } from '../../types';
import { useAlert } from '../GlobalAlert';
import { continueScript, continueScriptStream, rewriteScript, rewriteScriptStream, setScriptLogCallback, clearScriptLogCallback, logScriptProgress } from '../../services/aiService';
import { parseScriptServerSide, getActiveTasksForProject, waitForTask } from '../../services/taskService';
import { Clapperboard } from 'lucide-react';
import { getFinalValue, validateConfig } from './utils';
import { DEFAULTS } from './constants';
import ConfigPanel from './ConfigPanel';
import ScriptEditor from './ScriptEditor';
import SceneBreakdown from './SceneBreakdown';
import NovelManager from './NovelManager';
import EpisodeManager from './EpisodeManager';
import * as PS from '../../services/projectPatchService';
import { fetchVisualStyles, stylesToOptions, VisualStyle } from '../../services/visualStyleService';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
  onShowModelConfig?: () => void;
  onGeneratingChange?: (isGenerating: boolean) => void;
  onSwitchEpisode?: (episodeId: string | null) => Promise<void>;
}

type TabMode = 'novel' | 'episodes' | 'story' | 'script';

const StageScript: React.FC<Props> = ({ project, updateProject, onShowModelConfig, onGeneratingChange, onSwitchEpisode }) => {
  const { showAlert } = useAlert();
  const [activeTab, setActiveTab] = useState<TabMode>(
    project.scriptData ? 'script' : (project.novelChapters?.length > 0 ? 'episodes' : 'novel')
  );
  
  // Configuration state
  const [localScript, setLocalScript] = useState(project.rawScript);
  const [localTitle, setLocalTitle] = useState(project.title);
  const [localNovelGenre, setLocalNovelGenre] = useState(project.novelGenre || '');
  const [localNovelSynopsis, setLocalNovelSynopsis] = useState(project.novelSynopsis || '');
  const [localDuration, setLocalDuration] = useState(project.targetDuration || DEFAULTS.duration);
  const [localLanguage, setLocalLanguage] = useState(project.language || DEFAULTS.language);
  const [localModel, setLocalModel] = useState(project.shotGenerationModel || DEFAULTS.model);
  const [localVisualStyle, setLocalVisualStyle] = useState(project.visualStyle || DEFAULTS.visualStyle);
  const [customDurationInput, setCustomDurationInput] = useState('');
  const [customModelInput, setCustomModelInput] = useState('');
  const [customStyleInput, setCustomStyleInput] = useState('');
  const [customGenreInput, setCustomGenreInput] = useState('');
  
  // 数据库视觉风格
  const [dbVisualStyles, setDbVisualStyles] = useState<VisualStyle[]>([]);
  const [visualStyleOptions, setVisualStyleOptions] = useState<{ label: string; value: string; desc?: string }[]>([]);

  useEffect(() => {
    fetchVisualStyles()
      .then((styles) => {
        setDbVisualStyles(styles);
        setVisualStyleOptions(stylesToOptions(styles));
      })
      .catch((err) => console.error('加载视觉风格失败:', err));
  }, []);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingMessage, setProcessingMessage] = useState('');
  const [processingLogs, setProcessingLogs] = useState<string[]>([]);

  // Editing state - unified
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [editingCharacterPrompt, setEditingCharacterPrompt] = useState('');
  const [editingShotId, setEditingShotId] = useState<string | null>(null);
  const [editingShotPrompt, setEditingShotPrompt] = useState('');
  const [editingShotCharactersId, setEditingShotCharactersId] = useState<string | null>(null);
  const [editingShotActionId, setEditingShotActionId] = useState<string | null>(null);
  const [editingShotActionText, setEditingShotActionText] = useState('');
  const [editingShotDialogueText, setEditingShotDialogueText] = useState('');

  useEffect(() => {
    setLocalScript(project.rawScript);
    setLocalTitle(project.title);
    setLocalNovelGenre(project.novelGenre || '');
    setLocalNovelSynopsis(project.novelSynopsis || '');
    setLocalDuration(project.targetDuration || DEFAULTS.duration);
    setLocalLanguage(project.language || DEFAULTS.language);
    setLocalModel(project.shotGenerationModel || DEFAULTS.model);
    setLocalVisualStyle(project.visualStyle || DEFAULTS.visualStyle);
  }, [project.id]);

  // 上报生成状态给父组件，用于导航锁定
  useEffect(() => {
    const generating = isProcessing || isContinuing || isRewriting;
    onGeneratingChange?.(generating);
  }, [isProcessing, isContinuing, isRewriting]);

  // 组件卸载时重置生成状态
  useEffect(() => {
    return () => {
      onGeneratingChange?.(false);
    };
  }, []);

  // 小说管理字段的自动保存（debounced）
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(true);

  const debouncedSaveProjectInfo = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const finalGenre = localNovelGenre === 'custom' ? customGenreInput : localNovelGenre;
      const finalStyle = localVisualStyle === 'custom' ? customStyleInput : localVisualStyle;
      const updates: Partial<ProjectState> = {
        title: localTitle,
        novelGenre: finalGenre,
        novelSynopsis: localNovelSynopsis,
        language: localLanguage,
        visualStyle: finalStyle,
      };
      updateProject(updates);
      PS.patchProject(project.id, {
        title: localTitle,
        novelGenre: finalGenre,
        novelSynopsis: localNovelSynopsis,
        language: localLanguage,
        visualStyle: finalStyle,
      });
    }, 600);
  }, [localTitle, localNovelGenre, localNovelSynopsis, localLanguage, localVisualStyle, customGenreInput, customStyleInput, project.id, updateProject]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    debouncedSaveProjectInfo();
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [localTitle, localNovelGenre, localNovelSynopsis, localLanguage, localVisualStyle, customGenreInput, customStyleInput]);

  useEffect(() => {
    setScriptLogCallback((message) => {
      setProcessingLogs(prev => {
        const next = [...prev, message];
        return next.slice(-8);
      });
    });

    return () => clearScriptLogCallback();
  }, []);

  // 页面刷新后恢复正在运行的剧本解析任务
  useEffect(() => {
    if (!project.id || isProcessing) return;

    const recoverScriptParseTask = async () => {
      try {
        const activeTasks = await getActiveTasksForProject(project.id);
        const scriptTask = activeTasks.find(t => t.type === 'script_parse');
        if (!scriptTask) return;

        console.log(`🔄 [StageScript] 发现正在运行的剧本解析任务: ${scriptTask.id}`);
        setIsProcessing(true);
        setProcessingMessage(`正在恢复后台解析任务 (${scriptTask.progress}%)...`);
        logScriptProgress('检测到未完成的后台解析任务，正在恢复...');

        const resultStr = await waitForTask(scriptTask.id, {
          onProgress: (progress, status) => {
            setProcessingMessage(`后台解析中 (${progress}%) - 刷新页面不影响进度`);
          },
          timeout: 15 * 60 * 1000,
          pollInterval: 3000,
        });

        const { scriptData, shots } = JSON.parse(resultStr);
        updateProject({
          scriptData,
          shots,
          isParsingScript: false,
          title: scriptData.title,
        });
        setActiveTab('script');
        console.log('✅ [StageScript] 后台剧本解析任务恢复完成');
      } catch (err: any) {
        console.error('❌ [StageScript] 恢复解析任务失败:', err.message);
        setError(`恢复解析任务失败: ${err.message}`);
        updateProject({ isParsingScript: false });
        PS.patchProject(project.id, { isParsingScript: false });
      } finally {
        setIsProcessing(false);
        setProcessingMessage('');
      }
    };

    recoverScriptParseTask();
  }, [project.id]);

  const handleAnalyze = async () => {
    const finalDuration = getFinalValue(localDuration, customDurationInput);
    const finalModel = getFinalValue(localModel, customModelInput);
    const finalVisualStyle = getFinalValue(localVisualStyle, customStyleInput);

    const validation = validateConfig({
      script: localScript,
      duration: finalDuration,
      model: finalModel,
      visualStyle: finalVisualStyle
    });

    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    console.log('🎯 用户选择的模型:', localModel);
    console.log('🎯 最终使用的模型:', finalModel);
    console.log('🎨 视觉风格:', finalVisualStyle);
    logScriptProgress(`已选择模型：${localModel}`);
    logScriptProgress(`最终使用模型：${finalModel}`);
    logScriptProgress(`视觉风格：${finalVisualStyle}`);

    setIsProcessing(true);
    setProcessingMessage('正在解析剧本（后台运行中，刷新不会中断）...');
    setProcessingLogs([]);
    setError(null);
    try {
      const finalGenre = localNovelGenre === 'custom' ? customGenreInput : localNovelGenre;
      updateProject({
        title: localTitle,
        novelGenre: finalGenre,
        novelSynopsis: localNovelSynopsis,
        rawScript: localScript,
        targetDuration: finalDuration,
        language: localLanguage,
        visualStyle: finalVisualStyle,
        shotGenerationModel: finalModel,
        isParsingScript: true
      });

      PS.patchProject(project.id, {
        rawScript: localScript,
        targetDuration: finalDuration,
        language: localLanguage,
        visualStyle: finalVisualStyle,
        shotGenerationModel: finalModel,
        isParsingScript: true,
      });

      logScriptProgress('正在提交后台解析任务...');
      const result = await parseScriptServerSide(
        project.id,
        localScript,
        finalModel,
        {
          language: localLanguage,
          visualStyle: finalVisualStyle,
          targetDuration: finalDuration,
          title: localTitle && localTitle !== '未命名项目' ? localTitle : undefined,
          onProgress: (progress, status) => {
            const phaseMessages: Record<string, string> = {
              pending: '等待开始...',
              running: '正在解析...',
              polling: '正在解析...',
            };
            const msg = phaseMessages[status] || `进度 ${progress}%`;
            setProcessingMessage(`后台解析中 (${progress}%) - ${msg}`);
            if (progress > 0 && progress <= 20) logScriptProgress('正在解析剧本结构...');
            else if (progress > 20 && progress <= 35) logScriptProgress('正在生成美术指导文档...');
            else if (progress > 35 && progress <= 60) logScriptProgress('正在生成角色视觉提示词...');
            else if (progress > 60 && progress <= 75) logScriptProgress('正在生成场景视觉提示词...');
            else if (progress > 75) logScriptProgress('正在生成分镜列表...');
          },
        }
      );

      const { scriptData, shots } = result;

      scriptData.targetDuration = finalDuration;
      scriptData.language = localLanguage;
      scriptData.visualStyle = finalVisualStyle;
      scriptData.shotGenerationModel = finalModel;

      if (localTitle && localTitle !== "未命名项目") {
        scriptData.title = localTitle;
      }

      updateProject({ 
        scriptData, 
        shots, 
        isParsingScript: false,
        title: scriptData.title 
      });

      setActiveTab('script');

    } catch (err: any) {
      console.error(err);
      setError(`错误: ${err.message || "AI 连接失败"}`);
      updateProject({ isParsingScript: false });
      PS.patchProject(project.id, { isParsingScript: false });
    } finally {
      setIsProcessing(false);
      setProcessingMessage('');
    }
  };

  const handleContinueScript = async () => {
    const finalModel = getFinalValue(localModel, customModelInput);
    
    if (!localScript.trim()) {
      setError("请先输入一些剧本内容作为基础。");
      return;
    }
    if (!finalModel) {
      setError("请选择或输入模型名称。");
      return;
    }

    setIsContinuing(true);
    setProcessingMessage('AI续写中...');
    setProcessingLogs([]);
    setError(null);
    const baseScript = localScript;
    let streamed = '';
    try {
      const continuedContent = await continueScriptStream(
        baseScript,
        localLanguage,
        finalModel,
        (delta) => {
          streamed += delta;
          const newScript = baseScript + '\n\n' + streamed;
          setLocalScript(newScript);
          updateProject({ rawScript: newScript });
        }
      );
      if (continuedContent) {
        const newScript = baseScript + '\n\n' + continuedContent;
        setLocalScript(newScript);
        updateProject({ rawScript: newScript });
        PS.patchProject(project.id, { rawScript: newScript });
      } else if (streamed) {
        PS.patchProject(project.id, { rawScript: baseScript + '\n\n' + streamed });
      }
    } catch (err: any) {
      console.error(err);
      setError(`AI续写失败: ${err.message || "连接失败"}`);
      try {
        const continuedContent = await continueScript(baseScript, localLanguage, finalModel);
        const newScript = baseScript + '\n\n' + continuedContent;
        setLocalScript(newScript);
        updateProject({ rawScript: newScript });
        PS.patchProject(project.id, { rawScript: newScript });
      } catch (fallbackErr: any) {
        console.error(fallbackErr);
      }
    } finally {
      setIsContinuing(false);
      setProcessingMessage('');
    }
  };

  const handleRewriteScript = async () => {
    const finalModel = getFinalValue(localModel, customModelInput);
    
    if (!localScript.trim()) {
      setError("请先输入剧本内容。");
      return;
    }
    if (!finalModel) {
      setError("请选择或输入模型名称。");
      return;
    }

    setIsRewriting(true);
    setProcessingMessage('AI改写中...');
    setProcessingLogs([]);
    setError(null);
    const baseScript = localScript;
    let streamed = '';
    try {
      setLocalScript('');
      updateProject({ rawScript: '' });
      const rewrittenContent = await rewriteScriptStream(
        baseScript,
        localLanguage,
        finalModel,
        (delta) => {
          streamed += delta;
          setLocalScript(streamed);
          updateProject({ rawScript: streamed });
        }
      );
      if (rewrittenContent) {
        setLocalScript(rewrittenContent);
        updateProject({ rawScript: rewrittenContent });
        PS.patchProject(project.id, { rawScript: rewrittenContent });
      } else if (streamed) {
        PS.patchProject(project.id, { rawScript: streamed });
      }
    } catch (err: any) {
      console.error(err);
      setError(`AI改写失败: ${err.message || "连接失败"}`);
      try {
        const rewrittenContent = await rewriteScript(baseScript, localLanguage, finalModel);
        setLocalScript(rewrittenContent);
        updateProject({ rawScript: rewrittenContent });
        PS.patchProject(project.id, { rawScript: rewrittenContent });
      } catch (fallbackErr: any) {
        console.error(fallbackErr);
      }
    } finally {
      setIsRewriting(false);
      setProcessingMessage('');
    }
  };

  const showProcessingToast = isProcessing || isContinuing || isRewriting;
  const toastMessage = processingMessage || (isProcessing
    ? '正在生成剧本...'
    : isContinuing
      ? 'AI续写中...'
      : isRewriting
        ? 'AI改写中...'
        : '');

  // Character editing handlers
  const handleEditCharacter = (charId: string, prompt: string) => {
    setEditingCharacterId(charId);
    setEditingCharacterPrompt(prompt);
  };

  const handleSaveCharacter = (charId: string, prompt: string) => {
    if (!project.scriptData) return;
    
    const updatedCharacters = project.scriptData.characters.map(c => 
      c.id === charId ? { ...c, visualPrompt: prompt } : c
    );
    
    updateProject({
      scriptData: {
        ...project.scriptData,
        characters: updatedCharacters
      }
    });
    PS.patchCharacter(project.id, charId, { visualPrompt: prompt });
    
    setEditingCharacterId(null);
    setEditingCharacterPrompt('');
  };

  const handleCancelCharacterEdit = () => {
    setEditingCharacterId(null);
    setEditingCharacterPrompt('');
  };

  // Shot prompt editing handlers
  const handleEditShotPrompt = (shotId: string, prompt: string) => {
    setEditingShotId(shotId);
    setEditingShotPrompt(prompt);
  };

  const handleSaveShotPrompt = () => {
    if (!editingShotId) return;
    
    const shot = project.shots.find(s => s.id === editingShotId);
    const updatedShots = project.shots.map(s => {
      if (s.id === editingShotId && s.keyframes.length > 0) {
        return {
          ...s,
          keyframes: s.keyframes.map((kf, idx) => 
            idx === 0 ? { ...kf, visualPrompt: editingShotPrompt } : kf
          )
        };
      }
      return s;
    });
    
    updateProject({ shots: updatedShots });
    if (shot && shot.keyframes.length > 0) {
      PS.patchKeyframe(project.id, editingShotId, shot.keyframes[0].id, { visualPrompt: editingShotPrompt });
    }
    setEditingShotId(null);
    setEditingShotPrompt('');
  };

  const handleCancelShotPrompt = () => {
    setEditingShotId(null);
    setEditingShotPrompt('');
  };

  // Shot characters editing handlers
  const handleEditShotCharacters = (shotId: string) => {
    setEditingShotCharactersId(shotId);
  };

  const handleAddCharacterToShot = (shotId: string, characterId: string) => {
    const shot = project.shots.find(s => s.id === shotId);
    if (shot && !shot.characters.includes(characterId)) {
      const newChars = [...shot.characters, characterId];
      const updatedShots = project.shots.map(s =>
        s.id === shotId ? { ...s, characters: newChars } : s
      );
      updateProject({ shots: updatedShots });
      PS.patchShot(project.id, shotId, { characters: newChars });
    }
  };

  const handleRemoveCharacterFromShot = (shotId: string, characterId: string) => {
    const shot = project.shots.find(s => s.id === shotId);
    if (shot) {
      const newChars = shot.characters.filter(cid => cid !== characterId);
      const updatedShots = project.shots.map(s =>
        s.id === shotId ? { ...s, characters: newChars } : s
      );
      updateProject({ shots: updatedShots });
      PS.patchShot(project.id, shotId, { characters: newChars });
    }
  };

  const handleCloseShotCharactersEdit = () => {
    setEditingShotCharactersId(null);
  };

  // Shot action editing handlers
  const handleEditShotAction = (shotId: string, action: string, dialogue: string) => {
    setEditingShotActionId(shotId);
    setEditingShotActionText(action);
    setEditingShotDialogueText(dialogue);
  };

  const handleSaveShotAction = () => {
    if (!editingShotActionId) return;
    
    const updatedShots = project.shots.map(shot => {
      if (shot.id === editingShotActionId) {
        return {
          ...shot,
          actionSummary: editingShotActionText,
          dialogue: editingShotDialogueText.trim() || undefined
        };
      }
      return shot;
    });
    
    updateProject({ shots: updatedShots });
    PS.patchShot(project.id, editingShotActionId, {
      actionSummary: editingShotActionText,
      dialogue: editingShotDialogueText.trim() || null,
    });
    setEditingShotActionId(null);
    setEditingShotActionText('');
    setEditingShotDialogueText('');
  };

  const handleCancelShotAction = () => {
    setEditingShotActionId(null);
    setEditingShotActionText('');
    setEditingShotDialogueText('');
  };

  const getNextShotId = (shots: Shot[]) => {
    const maxMain = shots.reduce((max, shot) => {
      const parts = shot.id.split('-');
      const main = Number(parts[1]);
      if (!Number.isFinite(main)) return max;
      return Math.max(max, main);
    }, 0);
    return `shot-${maxMain + 1}`;
  };

  const handleAddSubShot = (anchorShotId: string) => {
    const anchorShot = project.shots.find(s => s.id === anchorShotId);
    if (!anchorShot) return;

    const parts = anchorShotId.split('-');
    const main = Number(parts[1]);
    if (!Number.isFinite(main)) return;

    const baseId = `shot-${main}`;
    const maxSuffix = project.shots.reduce((max, shot) => {
      if (!shot.id.startsWith(`${baseId}-`)) return max;
      const subParts = shot.id.split('-');
      const suffix = Number(subParts[2]);
      if (!Number.isFinite(suffix)) return max;
      return Math.max(max, suffix);
    }, 0);

    const newId = `${baseId}-${maxSuffix + 1}`;
    const baseShot = project.shots.find(s => s.id === baseId) || anchorShot;
    const newShot: Shot = {
      id: newId,
      sceneId: baseShot.sceneId,
      actionSummary: '在此输入动作描述',
      cameraMovement: baseShot.cameraMovement || '平移',
      shotSize: baseShot.shotSize || '中景',
      characters: [...(baseShot.characters || [])],
      characterVariations: baseShot.characterVariations ? { ...baseShot.characterVariations } : undefined,
      props: baseShot.props ? [...baseShot.props] : undefined,
      videoModel: baseShot.videoModel,
      keyframes: [
        {
          id: `kf-${newId}-start`,
          type: 'start',
          visualPrompt: '',
          status: 'pending'
        }
      ]
    };

    const lastIndexInGroup = project.shots.reduce((idx, shot, i) => {
      const isGroup = shot.id === baseId || shot.id.startsWith(`${baseId}-`);
      return isGroup ? i : idx;
    }, -1);

    const insertAt = lastIndexInGroup >= 0 ? lastIndexInGroup + 1 : project.shots.length;
    const nextShots = [
      ...project.shots.slice(0, insertAt),
      newShot,
      ...project.shots.slice(insertAt)
    ];

    updateProject({ shots: nextShots });
    PS.addShot(project.id, newShot, insertAt > 0 ? insertAt - 1 : undefined);
    setEditingShotActionId(newId);
    setEditingShotActionText(newShot.actionSummary);
    setEditingShotDialogueText('');
  };

  const handleAddShot = (sceneId: string) => {
    if (!project.scriptData) return;

    const sceneShots = project.shots.filter(s => s.sceneId === sceneId);
    if (sceneShots.length > 0) {
      handleAddSubShot(sceneShots[sceneShots.length - 1].id);
      return;
    }

    const newId = getNextShotId(project.shots);
    const newShot: Shot = {
      id: newId,
      sceneId,
      actionSummary: '在此输入动作描述',
      cameraMovement: '平移',
      shotSize: '中景',
      characters: [],
      keyframes: [
        {
          id: `kf-${newId}-start`,
          type: 'start',
          visualPrompt: '',
          status: 'pending'
        }
      ]
    };

    const sceneIndex = project.scriptData.scenes.findIndex(s => s.id === sceneId);
    const lastIndexInScene = project.shots.reduce((idx, shot, i) => (
      shot.sceneId === sceneId ? i : idx
    ), -1);

    let insertAt = project.shots.length;
    if (lastIndexInScene >= 0) {
      insertAt = lastIndexInScene + 1;
    } else if (sceneIndex >= 0) {
      for (let i = sceneIndex + 1; i < project.scriptData.scenes.length; i += 1) {
        const nextSceneId = project.scriptData.scenes[i].id;
        const nextIndex = project.shots.findIndex(s => s.sceneId === nextSceneId);
        if (nextIndex >= 0) {
          insertAt = nextIndex;
          break;
        }
      }
    }

    const nextShots = [
      ...project.shots.slice(0, insertAt),
      newShot,
      ...project.shots.slice(insertAt)
    ];

    updateProject({ shots: nextShots });
    PS.addShot(project.id, newShot, insertAt > 0 ? insertAt - 1 : undefined);
    setEditingShotActionId(newId);
    setEditingShotActionText(newShot.actionSummary);
    setEditingShotDialogueText('');
  };

  const getShotDisplayName = (shot: Shot, fallbackIndex: number) => {
    const idParts = shot.id.split('-').slice(1);
    if (idParts.length === 1) {
      return `SHOT ${String(idParts[0]).padStart(3, '0')}`;
    }
    if (idParts.length === 2) {
      return `SHOT ${String(idParts[0]).padStart(3, '0')}-${idParts[1]}`;
    }
    return `SHOT ${String(fallbackIndex + 1).padStart(3, '0')}`;
  };

  const handleDeleteShot = (shotId: string) => {
    const shotIndex = project.shots.findIndex(s => s.id === shotId);
    const shot = shotIndex >= 0 ? project.shots[shotIndex] : null;
    if (!shot) return;

    const displayName = getShotDisplayName(shot, shotIndex);
    showAlert(`确定要删除 ${displayName} 吗？此操作不可撤销。`, {
      type: 'warning',
      showCancel: true,
      onConfirm: () => {
        updateProject({ shots: project.shots.filter(s => s.id !== shotId) });
        PS.removeShot(project.id, shotId);
        if (editingShotId === shotId) {
          setEditingShotId(null);
          setEditingShotPrompt('');
        }
        if (editingShotCharactersId === shotId) {
          setEditingShotCharactersId(null);
        }
        if (editingShotActionId === shotId) {
          setEditingShotActionId(null);
          setEditingShotActionText('');
          setEditingShotDialogueText('');
        }
        showAlert(`${displayName} 已删除`, { type: 'success' });
      }
    });
  };

  const handleSelectEpisodeForStoryboard = (episodeId: string) => {
    setActiveTab('story');
    showAlert('剧本已导入到故事编辑器，可以进行编辑后点击"生成分镜脚本"', { type: 'success' });
  };

  const tabItems: { id: TabMode; label: string; badge?: number }[] = [
    { id: 'novel', label: '小说管理', badge: project.novelChapters?.length || 0 },
    { id: 'episodes', label: '剧集剧本', badge: project.novelEpisodes?.filter(e => e.status === 'completed').length || 0 },
    { id: 'story', label: '故事编辑' },
    { id: 'script', label: '分镜预览' },
  ];

  return (
    <div className="h-full bg-[var(--bg-base)] flex flex-col">
      {showProcessingToast && (
        <div className="fixed right-4 top-4 z-[9999] w-full max-w-md rounded-xl border border-[var(--border-default)] bg-black/80 px-4 py-3 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-500 border-t-white" />
            <div className="text-sm text-white">{toastMessage}</div>
          </div>
          {processingLogs.length > 0 && (
            <div className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-zinc-300">
              {processingLogs.map((line, index) => (
                <div key={`${line}-${index}`} className="truncate">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 导航栏 */}
      <div className="flex-shrink-0 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]">
        <div className="flex">
          {tabItems.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-5 py-3 text-xs font-medium uppercase tracking-wider transition-colors
                ${activeTab === tab.id
                  ? 'text-[var(--text-primary)] border-b-2 border-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
            >
              <span className="flex items-center gap-1.5">
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-mono rounded-full bg-[var(--accent-bg)] text-[var(--accent-text)] border border-[var(--accent-border)]">
                    {tab.badge}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'novel' && (
          <NovelManager
            project={project}
            updateProject={updateProject}
            title={localTitle}
            novelGenre={localNovelGenre}
            novelSynopsis={localNovelSynopsis}
            language={localLanguage}
            visualStyle={localVisualStyle}
            customGenreInput={customGenreInput}
            customStyleInput={customStyleInput}
            visualStyleOptions={visualStyleOptions}
            onTitleChange={setLocalTitle}
            onNovelGenreChange={setLocalNovelGenre}
            onNovelSynopsisChange={setLocalNovelSynopsis}
            onLanguageChange={setLocalLanguage}
            onVisualStyleChange={setLocalVisualStyle}
            onCustomGenreChange={setCustomGenreInput}
            onCustomStyleChange={setCustomStyleInput}
          />
        )}

        {activeTab === 'episodes' && (
          <EpisodeManager
            project={project}
            updateProject={updateProject}
            onSelectEpisodeForStoryboard={handleSelectEpisodeForStoryboard}
            onSwitchEpisode={onSwitchEpisode}
            onGeneratingChange={onGeneratingChange}
          />
        )}

        {activeTab === 'story' && !project.selectedEpisodeId && (project.novelEpisodes?.length > 0) && (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <Clapperboard className="w-16 h-16 text-[var(--text-muted)] mb-4 opacity-30" />
            <p className="text-sm text-[var(--text-tertiary)] mb-2">请先选择一个剧本</p>
            <p className="text-xs text-[var(--text-muted)] mb-4">在「剧集剧本」标签页中点击"使用此剧本创作"来选定一个剧本，<br />后续的故事编辑、分镜、角色等数据将绑定到该剧本。</p>
            <button
              onClick={() => setActiveTab('episodes')}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] transition-colors"
            >
              前往选择剧本
            </button>
          </div>
        )}

        {activeTab === 'story' && (project.selectedEpisodeId || !(project.novelEpisodes?.length > 0)) && (
          <div className="flex h-full bg-[var(--bg-base)] text-[var(--text-secondary)]">
            <ConfigPanel
              duration={localDuration}
              model={localModel}
              customDurationInput={customDurationInput}
              customModelInput={customModelInput}
              isProcessing={isProcessing}
              error={error}
              onShowModelConfig={onShowModelConfig}
              onDurationChange={setLocalDuration}
              onModelChange={setLocalModel}
              onCustomDurationChange={setCustomDurationInput}
              onCustomModelChange={setCustomModelInput}
              onAnalyze={handleAnalyze}
            />
            <ScriptEditor
              script={localScript}
              onChange={setLocalScript}
              onContinue={handleContinueScript}
              onRewrite={handleRewriteScript}
              isContinuing={isContinuing}
              isRewriting={isRewriting}
              lastModified={project.lastModified}
            />
          </div>
        )}

        {activeTab === 'script' && !project.selectedEpisodeId && (project.novelEpisodes?.length > 0) && (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <Clapperboard className="w-16 h-16 text-[var(--text-muted)] mb-4 opacity-30" />
            <p className="text-sm text-[var(--text-tertiary)] mb-2">请先选择一个剧本</p>
            <p className="text-xs text-[var(--text-muted)] mb-4">在「剧集剧本」标签页中点击"使用此剧本创作"来选定一个剧本。</p>
            <button
              onClick={() => setActiveTab('episodes')}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] transition-colors"
            >
              前往选择剧本
            </button>
          </div>
        )}

        {activeTab === 'script' && (project.selectedEpisodeId || !(project.novelEpisodes?.length > 0)) && (
          <SceneBreakdown
            project={project}
            editingCharacterId={editingCharacterId}
            editingCharacterPrompt={editingCharacterPrompt}
            editingShotId={editingShotId}
            editingShotPrompt={editingShotPrompt}
            editingShotCharactersId={editingShotCharactersId}
            editingShotActionId={editingShotActionId}
            editingShotActionText={editingShotActionText}
            editingShotDialogueText={editingShotDialogueText}
            onEditCharacter={handleEditCharacter}
            onSaveCharacter={handleSaveCharacter}
            onCancelCharacterEdit={handleCancelCharacterEdit}
            onEditShotPrompt={handleEditShotPrompt}
            onSaveShotPrompt={handleSaveShotPrompt}
            onCancelShotPrompt={handleCancelShotPrompt}
            onEditShotCharacters={handleEditShotCharacters}
            onAddCharacterToShot={handleAddCharacterToShot}
            onRemoveCharacterFromShot={handleRemoveCharacterFromShot}
            onCloseShotCharactersEdit={handleCloseShotCharactersEdit}
            onEditShotAction={handleEditShotAction}
            onSaveShotAction={handleSaveShotAction}
            onCancelShotAction={handleCancelShotAction}
            onAddShot={handleAddShot}
            onAddSubShot={handleAddSubShot}
            onDeleteShot={handleDeleteShot}
            onBackToStory={() => setActiveTab('story')}
          />
        )}
      </div>
    </div>
  );
};

export default StageScript;
