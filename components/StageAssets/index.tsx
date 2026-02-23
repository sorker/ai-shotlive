import React, { useState, useEffect } from 'react';
import { Users, Sparkles, RefreshCw, Loader2, MapPin, Archive, X, Search, Trash2, Package } from 'lucide-react';
import { ProjectState, CharacterVariation, Character, Scene, Prop, AspectRatio, AssetLibraryItem, CharacterTurnaroundPanel } from '../../types';
import { generateImage, generateVisualPrompts, generateCharacterTurnaroundPanels, generateCharacterTurnaroundImage } from '../../services/aiService';
import { generateImageServerSide } from '../../services/taskService';
import { 
  getRegionalPrefix, 
  handleImageUpload, 
  getProjectLanguage, 
  getProjectVisualStyle,
  delay,
  generateId,
  compareIds 
} from './utils';
import { DEFAULTS, STYLES, GRID_LAYOUTS } from './constants';
import ImagePreviewModal from './ImagePreviewModal';
import CharacterCard from './CharacterCard';
import SceneCard from './SceneCard';
import PropCard from './PropCard';
import WardrobeModal from './WardrobeModal';
import TurnaroundModal from './TurnaroundModal';
import { useAlert } from '../GlobalAlert';
import { getAllAssetLibraryItems, saveAssetToLibrary, deleteAssetFromLibrary } from '../../services/storageService';
import { applyLibraryItemToProject, createLibraryItemFromCharacter, createLibraryItemFromScene, createLibraryItemFromProp, cloneCharacterForProject, cloneSceneForProject, clonePropForProject } from '../../services/assetLibraryService';
import * as PS from '../../services/projectPatchService';
import { getToken } from '../../services/apiClient';
import { AspectRatioSelector } from '../AspectRatioSelector';
import { getUserAspectRatio, setUserAspectRatio, getActiveImageModel } from '../../services/modelRegistry';

/**
 * 清理图片 URL 中的旧 token，用于跨剧本/项目导入资产时避免重复/过期 token 问题。
 * 返回不带 token 的干净 URL（后端 resolveToFilePath 会负责将 /api/ URL 解析为文件副本）
 */
const stripAuthToken = (url: string | undefined): string | undefined => {
  if (!url || !url.startsWith('/api/')) return url;
  return url.split('?')[0];
};

/**
 * 为 /api/ 图片 URL 追加当前 token，用于 React 状态下 <img src> 即时显示
 */
const withAuthToken = (url: string | undefined): string | undefined => {
  if (!url || !url.startsWith('/api/')) return url;
  const clean = url.split('?')[0];
  const token = getToken();
  return token ? `${clean}?token=${token}` : clean;
};

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
  onApiKeyError?: (error: any) => boolean;
  onGeneratingChange?: (isGenerating: boolean) => void;
}

/**
 * 判断图片结果是否为 URL 格式（非 base64）
 */
const isImageUrl = (s: string): boolean => /^https?:\/\//i.test(s);

const StageAssets: React.FC<Props> = ({ project, updateProject, onApiKeyError, onGeneratingChange }) => {
  const { showAlert } = useAlert();
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number} | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [libraryItems, setLibraryItems] = useState<AssetLibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'character' | 'scene' | 'prop'>('all');
  const [libraryProjectFilter, setLibraryProjectFilter] = useState('all');
  const [replaceTargetCharId, setReplaceTargetCharId] = useState<string | null>(null);
  const [turnaroundCharId, setTurnaroundCharId] = useState<string | null>(null);
  
  // 横竖屏选择状态（从持久化配置读取）
  const [aspectRatio, setAspectRatioState] = useState<AspectRatio>(() => getUserAspectRatio());
  
  // 包装 setAspectRatio，同时持久化到模型配置
  const setAspectRatio = (ratio: AspectRatio) => {
    setAspectRatioState(ratio);
    setUserAspectRatio(ratio);
  };
  

  // 获取项目配置
  const language = getProjectLanguage(project.language, project.scriptData?.language);
  const visualStyle = getProjectVisualStyle(project.visualStyle, project.scriptData?.visualStyle);
  const genre = project.scriptData?.genre || DEFAULTS.genre;

  // ============================
  // Immutable update helpers
  // Prevent direct state mutation that causes React DOM reconciliation errors (insertBefore)
  // ============================

  const patchScriptData = (patcher: (data: NonNullable<ProjectState['scriptData']>) => NonNullable<ProjectState['scriptData']>) => {
    updateProject((prev) => {
      if (!prev.scriptData) return prev;
      return { ...prev, scriptData: patcher(prev.scriptData) };
    });
  };

  const patchCharacterInScript = (charId: string, updater: (c: Character) => Character) => {
    patchScriptData(data => ({
      ...data,
      characters: data.characters.map(c =>
        compareIds(c.id, charId) ? updater(c) : c
      ),
    }));
  };

  const patchSceneInScript = (sceneId: string, updater: (s: Scene) => Scene) => {
    patchScriptData(data => ({
      ...data,
      scenes: data.scenes.map(s =>
        compareIds(s.id, sceneId) ? updater(s) : s
      ),
    }));
  };

  const patchPropInScript = (propId: string, updater: (p: Prop) => Prop) => {
    patchScriptData(data => ({
      ...data,
      props: (data.props || []).map(p =>
        compareIds(p.id, propId) ? updater(p) : p
      ),
    }));
  };

  /**
   * 组件加载时，检测并重置卡住的生成状态
   * 解决关闭页面后重新打开时，状态仍为"generating"导致无法重新生成的问题
   */
  useEffect(() => {
    if (!project.scriptData) return;

    const hasStuckCharacters = project.scriptData.characters.some(char => {
      const isCharStuck = char.status === 'generating' && !char.referenceImage;
      const hasStuckVariations = char.variations?.some(v => v.status === 'generating' && !v.referenceImage);
      return isCharStuck || hasStuckVariations;
    });

    const hasStuckScenes = project.scriptData.scenes.some(scene => 
      scene.status === 'generating' && !scene.referenceImage
    );

    const hasStuckProps = (project.scriptData.props || []).some(prop =>
      prop.status === 'generating' && !prop.referenceImage
    );

    if (hasStuckCharacters || hasStuckScenes || hasStuckProps) {
      console.log('🔧 检测到卡住的生成状态，正在重置...');
      patchScriptData(data => ({
        ...data,
        characters: data.characters.map(char => ({
          ...char,
          status: char.status === 'generating' && !char.referenceImage ? 'failed' as const : char.status,
          variations: char.variations?.map(v => ({
            ...v,
            status: v.status === 'generating' && !v.referenceImage ? 'failed' as const : v.status
          }))
        })),
        scenes: data.scenes.map(scene => ({
          ...scene,
          status: scene.status === 'generating' && !scene.referenceImage ? 'failed' as const : scene.status
        })),
        props: data.props?.map(prop => ({
          ...prop,
          status: prop.status === 'generating' && !prop.referenceImage ? 'failed' as const : prop.status
        })),
      }));
    }
  }, [project.id]);

  /**
   * 上报生成状态给父组件，用于导航锁定
   * 检测角色、场景、道具、角色变体的生成状态
   */
  useEffect(() => {
    const hasGeneratingCharacters = project.scriptData?.characters.some(char => {
      const isCharGenerating = char.status === 'generating';
      const hasGeneratingVariations = char.variations?.some(v => v.status === 'generating');
      return isCharGenerating || hasGeneratingVariations;
    }) ?? false;

    const hasGeneratingScenes = project.scriptData?.scenes.some(scene => 
      scene.status === 'generating'
    ) ?? false;

    const hasGeneratingProps = (project.scriptData?.props || []).some(prop =>
      prop.status === 'generating'
    );

    const generating = !!batchProgress || hasGeneratingCharacters || hasGeneratingScenes || hasGeneratingProps;
    onGeneratingChange?.(generating);
  }, [batchProgress, project.scriptData]);

  // 组件卸载时重置生成状态
  useEffect(() => {
    return () => {
      onGeneratingChange?.(false);
    };
  }, []);

  const refreshLibrary = async () => {
    setLibraryLoading(true);
    try {
      console.log('📦 [资产库] 正在加载资产库列表...');
      const items = await getAllAssetLibraryItems();
      console.log(`📦 [资产库] 已加载 ${items.length} 个资产`);
      setLibraryItems(items);
    } catch (e) {
      console.error('❌ [资产库] 加载资产库失败:', e);
    } finally {
      setLibraryLoading(false);
    }
  };

  useEffect(() => {
    if (showLibraryModal) {
      refreshLibrary();
    }
  }, [showLibraryModal]);

  const openLibrary = (filter: 'all' | 'character' | 'scene' | 'prop', targetCharId: string | null = null) => {
    setLibraryFilter(filter);
    setReplaceTargetCharId(targetCharId);
    setShowLibraryModal(true);
  };

  /**
   * 生成资源（角色或场景）
   */
  const handleGenerateAsset = async (type: 'character' | 'scene', id: string) => {
    // Set generating status via functional update (avoids direct state mutation)
    if (type === 'character') {
      patchCharacterInScript(id, c => ({ ...c, status: 'generating' as const }));
    } else {
      patchSceneInScript(id, s => ({ ...s, status: 'generating' as const }));
    }

    try {
      let prompt = "";
      
      if (type === 'character') {
        const char = project.scriptData?.characters.find(c => compareIds(c.id, id));
        if (char) {
          if (char.visualPrompt) {
            prompt = char.visualPrompt;
          } else {
            const prompts = await generateVisualPrompts('character', char, genre, DEFAULTS.modelVersion, visualStyle, language);
            prompt = prompts.visualPrompt;
            
            patchCharacterInScript(id, c => ({
              ...c,
              visualPrompt: prompts.visualPrompt,
              negativePrompt: prompts.negativePrompt,
            }));
          }
        }
      } else {
        const scene = project.scriptData?.scenes.find(s => compareIds(s.id, id));
        if (scene) {
          if (scene.visualPrompt) {
            prompt = scene.visualPrompt;
          } else {
            const prompts = await generateVisualPrompts('scene', scene, genre, DEFAULTS.modelVersion, visualStyle, language);
            prompt = prompts.visualPrompt;
            
            patchSceneInScript(id, s => ({
              ...s,
              visualPrompt: prompts.visualPrompt,
              negativePrompt: prompts.negativePrompt,
            }));
          }
        }
      }

      const regionalPrefix = getRegionalPrefix(language, type);
      let enhancedPrompt = regionalPrefix + prompt;

      if (type === 'scene') {
        enhancedPrompt += '. IMPORTANT: This is a pure environment/background scene with absolutely NO people, NO human figures, NO characters, NO silhouettes, NO crowds - empty scene only.';
      }

      const activeImgModel = getActiveImageModel();
      const imgModelId = activeImgModel?.apiModel || activeImgModel?.id || 'gemini-3-pro-image-preview';
      const imageUrl = await generateImageServerSide(
        project.id,
        enhancedPrompt,
        imgModelId,
        {
          referenceImages: [],
          aspectRatio,
          target: {
            type: type === 'character' ? 'character_image' : 'scene_image',
            entityId: id,
          },
        }
      );

      const resultIsUrl = isImageUrl(imageUrl);

      if (type === 'character') {
        patchCharacterInScript(id, c => ({
          ...c,
          referenceImage: imageUrl,
          referenceImageUrl: resultIsUrl ? imageUrl : undefined,
          status: 'completed' as const,
        }));
      } else {
        patchSceneInScript(id, s => ({
          ...s,
          referenceImage: imageUrl,
          referenceImageUrl: resultIsUrl ? imageUrl : undefined,
          status: 'completed' as const,
        }));
      }

    } catch (e: any) {
      console.error(e);
      if (type === 'character') {
        patchCharacterInScript(id, c => ({ ...c, status: 'failed' as const }));
      } else {
        patchSceneInScript(id, s => ({ ...s, status: 'failed' as const }));
      }
      if (onApiKeyError && onApiKeyError(e)) {
        return;
      }
    }
  };

  /**
   * 批量生成资源
   */
  const handleBatchGenerate = async (type: 'character' | 'scene') => {
    const items = type === 'character' 
      ? project.scriptData?.characters 
      : project.scriptData?.scenes;
    
    if (!items) return;

    const itemsToGen = items.filter(i => !i.referenceImage);
    const isRegenerate = itemsToGen.length === 0;

    if (isRegenerate) {
      showAlert(`确定要重新生成所有${type === 'character' ? '角色' : '场景'}图吗？`, {
        type: 'warning',
        showCancel: true,
        onConfirm: async () => {
          await executeBatchGenerate(items, type);
        }
      });
      return;
    }

    await executeBatchGenerate(itemsToGen, type);
  };

  const executeBatchGenerate = async (targetItems: any[], type: 'character' | 'scene') => {
    setBatchProgress({ current: 0, total: targetItems.length });

    for (let i = 0; i < targetItems.length; i++) {
      if (i > 0) await delay(DEFAULTS.batchGenerateDelay);
      
      await handleGenerateAsset(type, targetItems[i].id);
      setBatchProgress({ current: i + 1, total: targetItems.length });
    }

    setBatchProgress(null);
  };

  /**
   * 上传角色图片
   */
  const handleUploadCharacterImage = async (charId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);

      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = { ...prev.scriptData };
        const char = newData.characters.find(c => compareIds(c.id, charId));
        if (char) {
          char.referenceImage = base64;
          char.status = 'completed';
        }
        return { ...prev, scriptData: newData };
      });
    } catch (e: any) {
      showAlert(e.message, { type: 'error' });
    }
  };

  /**
   * 上传场景图片
   */
  const handleUploadSceneImage = async (sceneId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);

      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = { ...prev.scriptData };
        const scene = newData.scenes.find(s => compareIds(s.id, sceneId));
        if (scene) {
          scene.referenceImage = base64;
          scene.status = 'completed';
        }
        return { ...prev, scriptData: newData };
      });
    } catch (e: any) {
      showAlert(e.message, { type: 'error' });
    }
  };

  const handleAddCharacterToLibrary = (char: Character) => {
    const saveItem = async () => {
      try {
        console.log(`📦 [资产库] 保存角色: ${char.name} (id=${char.id}), project=${project.id}`);
        const item = createLibraryItemFromCharacter(char, project);
        await saveAssetToLibrary(item);
        console.log(`✅ [资产库] 角色保存成功: ${char.name}`);
        showAlert(`已加入资产库：${char.name}`, { type: 'success' });
        refreshLibrary();
      } catch (e: any) {
        console.error(`❌ [资产库] 角色保存失败:`, e);
        showAlert(e?.message || '加入资产库失败', { type: 'error' });
      }
    };

    if (!char.referenceImage) {
      showAlert('该角色暂无参考图，仍要加入资产库吗？', {
        type: 'warning',
        showCancel: true,
        onConfirm: saveItem
      });
      return;
    }

    void saveItem();
  };

  const handleAddSceneToLibrary = (scene: Scene) => {
    const saveItem = async () => {
      try {
        console.log(`📦 [资产库] 保存场景: ${scene.location} (id=${scene.id}), project=${project.id}`);
        const item = createLibraryItemFromScene(scene, project);
        await saveAssetToLibrary(item);
        console.log(`✅ [资产库] 场景保存成功: ${scene.location}`);
        showAlert(`已加入资产库：${scene.location}`, { type: 'success' });
        refreshLibrary();
      } catch (e: any) {
        console.error(`❌ [资产库] 场景保存失败:`, e);
        showAlert(e?.message || '加入资产库失败', { type: 'error' });
      }
    };

    if (!scene.referenceImage) {
      showAlert('该场景暂无参考图，仍要加入资产库吗？', {
        type: 'warning',
        showCancel: true,
        onConfirm: saveItem
      });
      return;
    }

    void saveItem();
  };

  const handleImportFromLibrary = (item: AssetLibraryItem) => {
    try {
      if (!project.scriptData) {
        showAlert('项目尚未生成角色和场景，无法导入资产。', { type: 'error' });
        return;
      }

      if (item.type === 'character') {
        const character = cloneCharacterForProject(item.data as Character);
        const displayChar = { ...character, referenceImage: withAuthToken(character.referenceImage) ?? character.referenceImage };
        patchScriptData(data => ({
          ...data,
          characters: [...data.characters, displayChar],
        }));
        PS.addCharacter(project.id, {
          ...character,
          referenceImage: stripAuthToken(character.referenceImage),
          variations: (character.variations || []).map(v => ({ ...v, referenceImage: stripAuthToken(v.referenceImage) })),
        });
      } else if (item.type === 'scene') {
        const scene = cloneSceneForProject(item.data as Scene);
        const displayScene = { ...scene, referenceImage: withAuthToken(scene.referenceImage) ?? scene.referenceImage };
        patchScriptData(data => ({
          ...data,
          scenes: [...data.scenes, displayScene],
        }));
        PS.addScene(project.id, { ...scene, referenceImage: stripAuthToken(scene.referenceImage) });
      } else if (item.type === 'prop') {
        const prop = clonePropForProject(item.data as Prop);
        const displayProp = { ...prop, referenceImage: withAuthToken(prop.referenceImage) ?? prop.referenceImage };
        patchScriptData(data => ({
          ...data,
          props: [...(data.props || []), displayProp],
        }));
        PS.addProp(project.id, { ...prop, referenceImage: stripAuthToken(prop.referenceImage) });
      }

      showAlert(`已导入：${item.name}`, { type: 'success' });
    } catch (e: any) {
      showAlert(e?.message || '导入失败', { type: 'error' });
    }
  };

  const handleReplaceCharacterFromLibrary = (item: AssetLibraryItem, targetId: string) => {
    if (item.type !== 'character') {
      showAlert('请选择角色资产进行替换', { type: 'warning' });
      return;
    }
    if (!project.scriptData) return;

    const cloned = cloneCharacterForProject(item.data as Character);
    const previous = project.scriptData.characters.find(c => compareIds(c.id, targetId));
    if (!previous) return;

    // For React state: use current auth token so <img> can display immediately
    const displayChar = {
      ...cloned,
      referenceImage: withAuthToken(cloned.referenceImage) ?? cloned.referenceImage,
    };

    updateProject((prev) => {
      if (!prev.scriptData) return prev;
      return {
        ...prev,
        scriptData: {
          ...prev.scriptData,
          characters: prev.scriptData.characters.map(c =>
            compareIds(c.id, targetId) ? { ...displayChar, id: c.id } : c
          ),
        },
        shots: prev.shots.map((shot) => {
          if (!shot.characterVariations || !shot.characterVariations[targetId]) return shot;
          const { [targetId]: _removed, ...rest } = shot.characterVariations;
          return {
            ...shot,
            characterVariations: Object.keys(rest).length > 0 ? rest : undefined
          };
        }),
      };
    });

    // For backend: strip stale tokens — resolveToFilePath will copy the actual image file
    PS.patchCharacter(project.id, targetId, {
      name: cloned.name,
      gender: cloned.gender,
      age: cloned.age,
      personality: cloned.personality,
      visualPrompt: cloned.visualPrompt,
      negativePrompt: cloned.negativePrompt,
      coreFeatures: cloned.coreFeatures,
      referenceImage: stripAuthToken(cloned.referenceImage),
      referenceImageUrl: cloned.referenceImageUrl,
      status: cloned.status,
      turnaround: cloned.turnaround || null,
    });

    // Replace variations: remove old, add new
    for (const v of (previous.variations || [])) {
      PS.removeVariation(project.id, targetId, v.id);
    }
    for (const v of (cloned.variations || [])) {
      PS.addVariation(project.id, targetId, {
        ...v,
        referenceImage: stripAuthToken(v.referenceImage),
      });
    }

    // Update shots that had characterVariations for this character
    for (const shot of project.shots) {
      if (shot.characterVariations && shot.characterVariations[targetId]) {
        const { [targetId]: _removed, ...rest } = shot.characterVariations;
        PS.patchShot(project.id, shot.id, {
          characterVariations: Object.keys(rest).length > 0 ? rest : {},
        });
      }
    }

    showAlert(`已替换角色：${previous.name} → ${cloned.name}`, { type: 'success' });
    setShowLibraryModal(false);
    setReplaceTargetCharId(null);
  };

  const handleDeleteLibraryItem = async (itemId: string) => {
    try {
      await deleteAssetFromLibrary(itemId);
      setLibraryItems((prev) => prev.filter((item) => item.id !== itemId));
    } catch (e: any) {
      showAlert(e?.message || '删除资产失败', { type: 'error' });
    }
  };

  /**
   * 保存角色提示词
   */
  const handleSaveCharacterPrompt = (charId: string, newPrompt: string) => {
    patchCharacterInScript(charId, c => ({ ...c, visualPrompt: newPrompt }));
  };

  /**
   * 更新角色基本信息
   */
  const handleUpdateCharacterInfo = (charId: string, updates: { name?: string; gender?: string; age?: string; personality?: string }) => {
    patchCharacterInScript(charId, c => ({ ...c, ...updates }));
  };

  /**
   * 保存场景提示词
   */
  const handleSaveScenePrompt = (sceneId: string, newPrompt: string) => {
    patchSceneInScript(sceneId, s => ({ ...s, visualPrompt: newPrompt }));
  };

  /**
   * 更新场景基本信息
   */
  const handleUpdateSceneInfo = (sceneId: string, updates: { location?: string; time?: string; atmosphere?: string }) => {
    patchSceneInScript(sceneId, s => ({ ...s, ...updates }));
  };

  /**
   * 新建角色
   */
  const handleAddCharacter = () => {
    if (!project.scriptData) return;
    
    const newChar: Character = {
      id: generateId('char'),
      name: '新角色',
      gender: '未设定',
      age: '未设定',
      personality: '待补充',
      visualPrompt: '',
      variations: [],
      status: 'pending'
    };

    patchScriptData(data => ({
      ...data,
      characters: [...data.characters, newChar],
    }));
    showAlert('新角色已创建，请编辑提示词并生成图片', { type: 'success' });
  };

  /**
   * 删除角色
   */
  const handleDeleteCharacter = (charId: string) => {
    if (!project.scriptData) return;
    const char = project.scriptData.characters.find(c => compareIds(c.id, charId));
    if (!char) return;

    showAlert(
      `确定要删除角色 "${char.name}" 吗？\n\n注意：这将会影响所有使用该角色的分镜，可能导致分镜关联错误。`,
      {
        type: 'warning',
        title: '删除角色',
        showCancel: true,
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: () => {
          patchScriptData(data => ({
            ...data,
            characters: data.characters.filter(c => !compareIds(c.id, charId)),
          }));
          showAlert(`角色 "${char.name}" 已删除`, { type: 'success' });
        }
      }
    );
  };

  /**
   * 新建场景
   */
  const handleAddScene = () => {
    if (!project.scriptData) return;
    
    const newScene: Scene = {
      id: generateId('scene'),
      location: '新场景',
      time: '未设定',
      atmosphere: '待补充',
      visualPrompt: '',
      status: 'pending'
    };

    patchScriptData(data => ({
      ...data,
      scenes: [...data.scenes, newScene],
    }));
    showAlert('新场景已创建，请编辑提示词并生成图片', { type: 'success' });
  };

  /**
   * 删除场景
   */
  const handleDeleteScene = (sceneId: string) => {
    if (!project.scriptData) return;
    const scene = project.scriptData.scenes.find(s => compareIds(s.id, sceneId));
    if (!scene) return;

    showAlert(
      `确定要删除场景 "${scene.location}" 吗？\n\n注意：这将会影响所有使用该场景的分镜，可能导致分镜关联错误。`,
      {
        type: 'warning',
        title: '删除场景',
        showCancel: true,
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: () => {
          patchScriptData(data => ({
            ...data,
            scenes: data.scenes.filter(s => !compareIds(s.id, sceneId)),
          }));
          showAlert(`场景 "${scene.location}" 已删除`, { type: 'success' });
        }
      }
    );
  };

  // ============================
  // 道具相关处理函数
  // ============================

  /**
   * 新建道具
   */
  const handleAddProp = () => {
    if (!project.scriptData) return;
    
    const newProp: Prop = {
      id: generateId('prop'),
      name: '新道具',
      category: '其他',
      description: '',
      visualPrompt: '',
      status: 'pending'
    };

    patchScriptData(data => ({
      ...data,
      props: [...(data.props || []), newProp],
    }));
    showAlert('新道具已创建，请编辑描述和提示词并生成图片', { type: 'success' });
  };

  /**
   * 删除道具
   */
  const handleDeleteProp = (propId: string) => {
    if (!project.scriptData) return;
    const prop = (project.scriptData.props || []).find(p => compareIds(p.id, propId));
    if (!prop) return;

    showAlert(
      `确定要删除道具 "${prop.name}" 吗？\n\n注意：这将会影响所有使用该道具的分镜。`,
      {
        type: 'warning',
        title: '删除道具',
        showCancel: true,
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: () => {
          updateProject((prev) => {
            if (!prev.scriptData) return prev;
            return {
              ...prev,
              scriptData: {
                ...prev.scriptData,
                props: (prev.scriptData.props || []).filter(p => !compareIds(p.id, propId)),
              },
              shots: prev.shots.map(shot => {
                if (!shot.props || !shot.props.includes(propId)) return shot;
                return { ...shot, props: shot.props.filter(id => id !== propId) };
              }),
            };
          });
          showAlert(`道具 "${prop.name}" 已删除`, { type: 'success' });
        }
      }
    );
  };

  /**
   * 生成道具图片
   */
  const handleGeneratePropAsset = async (propId: string) => {
    if (!project.scriptData) return;
    
    patchPropInScript(propId, p => ({ ...p, status: 'generating' as const }));

    try {
      const prop = project.scriptData.props?.find(p => compareIds(p.id, propId));
      if (!prop) return;

      let prompt = '';
      if (prop.visualPrompt) {
        prompt = prop.visualPrompt;
      } else {
        const prompts = await generateVisualPrompts('prop', prop, genre, DEFAULTS.modelVersion, visualStyle, language);
        prompt = prompts.visualPrompt;

        patchPropInScript(propId, p => ({
          ...p,
          visualPrompt: prompts.visualPrompt,
          negativePrompt: prompts.negativePrompt,
        }));
      }

      let enhancedPrompt = prompt;
      enhancedPrompt += '. IMPORTANT: This is a standalone prop/item shot with absolutely NO people, NO human figures, NO characters - object only on clean/simple background.';

      const activeImgModel2 = getActiveImageModel();
      const imgModelId2 = activeImgModel2?.apiModel || activeImgModel2?.id || 'gemini-3-pro-image-preview';
      const imageUrl = await generateImageServerSide(
        project.id, enhancedPrompt, imgModelId2,
        {
          referenceImages: [],
          aspectRatio,
          target: {
            type: 'prop_image',
            entityId: propId,
          },
        }
      );

      const propResultIsUrl = isImageUrl(imageUrl);

      patchPropInScript(propId, p => ({
        ...p,
        referenceImage: imageUrl,
        referenceImageUrl: propResultIsUrl ? imageUrl : undefined,
        status: 'completed' as const,
        visualPrompt: p.visualPrompt || prompt,
      }));
    } catch (e: any) {
      console.error(e);
      patchPropInScript(propId, p => ({ ...p, status: 'failed' as const }));
      if (onApiKeyError && onApiKeyError(e)) return;
    }
  };

  /**
   * 上传道具图片
   */
  const handleUploadPropImage = async (propId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);
      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = { ...prev.scriptData };
        const prop = (newData.props || []).find(p => compareIds(p.id, propId));
        if (prop) {
          prop.referenceImage = base64;
          prop.status = 'completed';
        }
        return { ...prev, scriptData: newData };
      });
    } catch (e: any) {
      showAlert(e.message, { type: 'error' });
    }
  };

  /**
   * 保存道具提示词
   */
  const handleSavePropPrompt = (propId: string, newPrompt: string) => {
    patchPropInScript(propId, p => ({ ...p, visualPrompt: newPrompt }));
  };

  /**
   * 更新道具基本信息
   */
  const handleUpdatePropInfo = (propId: string, updates: { name?: string; category?: string; description?: string }) => {
    patchPropInScript(propId, p => ({ ...p, ...updates }));
  };

  /**
   * 加入资产库（道具）
   */
  const handleAddPropToLibrary = (prop: Prop) => {
    const saveItem = async () => {
      try {
        console.log(`📦 [资产库] 保存道具: ${prop.name} (id=${prop.id}), project=${project.id}`);
        const item = createLibraryItemFromProp(prop, project);
        await saveAssetToLibrary(item);
        console.log(`✅ [资产库] 道具保存成功: ${prop.name}`);
        showAlert(`已加入资产库：${prop.name}`, { type: 'success' });
        refreshLibrary();
      } catch (e: any) {
        console.error(`❌ [资产库] 道具保存失败:`, e);
        showAlert(e?.message || '加入资产库失败', { type: 'error' });
      }
    };

    if (!prop.referenceImage) {
      showAlert('该道具暂无参考图，仍要加入资产库吗？', {
        type: 'warning',
        showCancel: true,
        onConfirm: saveItem
      });
      return;
    }

    void saveItem();
  };

  /**
   * 批量生成道具
   */
  const handleBatchGenerateProps = async () => {
    const items = project.scriptData?.props || [];
    if (!items.length) return;

    const itemsToGen = items.filter(p => !p.referenceImage);
    const isRegenerate = itemsToGen.length === 0;

    if (isRegenerate) {
      showAlert('确定要重新生成所有道具图吗？', {
        type: 'warning',
        showCancel: true,
        onConfirm: async () => {
          await executeBatchGenerateProps(items);
        }
      });
      return;
    }

    await executeBatchGenerateProps(itemsToGen);
  };

  const executeBatchGenerateProps = async (targetItems: Prop[]) => {
    setBatchProgress({ current: 0, total: targetItems.length });

    for (let i = 0; i < targetItems.length; i++) {
      if (i > 0) await delay(DEFAULTS.batchGenerateDelay);
      await handleGeneratePropAsset(targetItems[i].id);
      setBatchProgress({ current: i + 1, total: targetItems.length });
    }

    setBatchProgress(null);
  };

  /**
   * 添加角色变体
   */
  const handleAddVariation = (charId: string, name: string, prompt: string) => {
    if (!project.scriptData) return;
    const char = project.scriptData.characters.find(c => compareIds(c.id, charId));
    if (!char) return;

    const newVar: CharacterVariation = {
      id: generateId('var'),
      name: name || "New Outfit",
      visualPrompt: prompt || char.visualPrompt || "",
      referenceImage: undefined
    };

    patchCharacterInScript(charId, c => ({
      ...c,
      variations: [...(c.variations || []), newVar],
    }));
  };

  /**
   * 删除角色变体
   */
  const handleDeleteVariation = (charId: string, varId: string) => {
    patchCharacterInScript(charId, c => ({
      ...c,
      variations: c.variations?.filter(v => !compareIds(v.id, varId)),
    }));
  };

  /**
   * 生成角色变体
   */
  const handleGenerateVariation = async (charId: string, varId: string) => {
    const char = project.scriptData?.characters.find(c => compareIds(c.id, charId));
    const variation = char?.variations?.find(v => compareIds(v.id, varId));
    if (!char || !variation) return;

    patchCharacterInScript(charId, c => ({
      ...c,
      variations: c.variations?.map(v =>
        compareIds(v.id, varId) ? { ...v, status: 'generating' as const } : v
      ),
    }));

    try {
      const charRefImg = char.referenceImageUrl || char.referenceImage;
      const refImages = charRefImg ? [charRefImg] : [];
      const regionalPrefix = getRegionalPrefix(language, 'character');
      const enhancedPrompt = `${regionalPrefix}Character "${char.name}" wearing NEW OUTFIT: ${variation.visualPrompt}. This is a costume/outfit change - the character's face and identity must remain identical to the reference, but they should be wearing the described new outfit.`;
      
      const activeImgModelVar = getActiveImageModel();
      const imgModelIdVar = activeImgModelVar?.apiModel || activeImgModelVar?.id || 'gemini-3-pro-image-preview';
      const imageUrl = await generateImageServerSide(
        project.id, enhancedPrompt, imgModelIdVar,
        { referenceImages: refImages, aspectRatio, isVariation: true }
      );

      const varResultIsUrl = isImageUrl(imageUrl);

      patchCharacterInScript(charId, c => ({
        ...c,
        variations: c.variations?.map(v =>
          compareIds(v.id, varId)
            ? { ...v, referenceImage: imageUrl, referenceImageUrl: varResultIsUrl ? imageUrl : undefined, status: 'completed' as const }
            : v
        ),
      }));
    } catch (e: any) {
      console.error(e);
      patchCharacterInScript(charId, c => ({
        ...c,
        variations: c.variations?.map(v =>
          compareIds(v.id, varId) ? { ...v, status: 'failed' as const } : v
        ),
      }));
      if (onApiKeyError && onApiKeyError(e)) {
        return;
      }
      showAlert("Variation generation failed", { type: 'error' });
    }
  };

  /**
   * 上传角色变体图片
   */
  const handleUploadVariationImage = async (charId: string, varId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);

      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = { ...prev.scriptData };
        const char = newData.characters.find(c => compareIds(c.id, charId));
        const variation = char?.variations?.find(v => compareIds(v.id, varId));
        if (variation) {
          variation.referenceImage = base64;
          variation.status = 'completed';
        }
        return { ...prev, scriptData: newData };
      });
    } catch (e: any) {
      showAlert(e.message, { type: 'error' });
    }
  };

  // ============================
  // 角色九宫格造型相关处理函数
  // ============================

  /**
   * 生成角色九宫格造型的视角描述（Step 1）
   */
  const handleGenerateTurnaroundPanels = async (charId: string) => {
    const char = project.scriptData?.characters.find(c => compareIds(c.id, charId));
    if (!char) return;

    // 设置状态为 generating_panels
    updateProject((prev) => {
      if (!prev.scriptData) return prev;
      const newData = { ...prev.scriptData };
      const c = newData.characters.find(c => compareIds(c.id, charId));
      if (c) {
        c.turnaround = {
          panels: [],
          status: 'generating_panels',
        };
      }
      return { ...prev, scriptData: newData };
    });

    try {
      const panels = await generateCharacterTurnaroundPanels(
        char,
        visualStyle,
        project.scriptData?.artDirection,
        language
      );

      // 更新状态为 panels_ready
      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = { ...prev.scriptData };
        const c = newData.characters.find(c => compareIds(c.id, charId));
        if (c) {
          c.turnaround = {
            panels,
            status: 'panels_ready',
          };
        }
        return { ...prev, scriptData: newData };
      });
    } catch (e: any) {
      console.error('九宫格视角描述生成失败:', e);
      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = { ...prev.scriptData };
        const c = newData.characters.find(c => compareIds(c.id, charId));
        if (c && c.turnaround) {
          c.turnaround.status = 'failed';
        }
        return { ...prev, scriptData: newData };
      });
      if (onApiKeyError && onApiKeyError(e)) return;
      showAlert('九宫格视角描述生成失败', { type: 'error' });
    }
  };

  /**
   * 确认视角描述并生成九宫格图片（Step 2）
   */
  const handleConfirmTurnaroundPanels = async (charId: string, panels: CharacterTurnaroundPanel[]) => {
    const char = project.scriptData?.characters.find(c => compareIds(c.id, charId));
    if (!char) return;

    // 设置状态为 generating_image
    updateProject((prev) => {
      if (!prev.scriptData) return prev;
      const newData = { ...prev.scriptData };
      const c = newData.characters.find(c => compareIds(c.id, charId));
      if (c && c.turnaround) {
        c.turnaround.status = 'generating_image';
        c.turnaround.panels = panels;
      }
      return { ...prev, scriptData: newData };
    });

    try {
      const imageUrl = await generateCharacterTurnaroundImage(
        char,
        panels,
        visualStyle,
        char.referenceImage,
        project.scriptData?.artDirection
      );

      // 更新状态为 completed
      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = { ...prev.scriptData };
        const c = newData.characters.find(c => compareIds(c.id, charId));
        if (c && c.turnaround) {
          c.turnaround.imageUrl = imageUrl;
          c.turnaround.status = 'completed';
        }
        return { ...prev, scriptData: newData };
      });
    } catch (e: any) {
      console.error('九宫格造型图片生成失败:', e);
      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = { ...prev.scriptData };
        const c = newData.characters.find(c => compareIds(c.id, charId));
        if (c && c.turnaround) {
          c.turnaround.status = 'failed';
        }
        return { ...prev, scriptData: newData };
      });
      if (onApiKeyError && onApiKeyError(e)) return;
      showAlert('九宫格造型图片生成失败', { type: 'error' });
    }
  };

  /**
   * 更新九宫格造型的单个面板
   */
  const handleUpdateTurnaroundPanel = (charId: string, index: number, updates: Partial<CharacterTurnaroundPanel>) => {
    updateProject((prev) => {
      if (!prev.scriptData) return prev;
      const newData = { ...prev.scriptData };
      const c = newData.characters.find(c => compareIds(c.id, charId));
      if (c && c.turnaround && c.turnaround.panels[index]) {
        c.turnaround.panels[index] = { ...c.turnaround.panels[index], ...updates };
      }
      return { ...prev, scriptData: newData };
    });
  };

  /**
   * 重新生成九宫格造型（文案+图片全部重来）
   */
  const handleRegenerateTurnaround = (charId: string) => {
    handleGenerateTurnaroundPanels(charId);
  };

  /**
   * 仅重新生成九宫格造型图片（保留已有的视角描述文案）
   * 当用户对文案满意但图片效果不好时使用
   */
  const handleRegenerateTurnaroundImage = (charId: string) => {
    const char = project.scriptData?.characters.find(c => compareIds(c.id, charId));
    if (!char || !char.turnaround?.panels || char.turnaround.panels.length !== 9) return;
    
    // 直接使用已有的面板描述重新生成图片
    handleConfirmTurnaroundPanels(charId, char.turnaround.panels);
  };

  // 空状态
  if (!project.scriptData) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-tertiary)]">
        <p>请先完成 Phase 01 剧本分析</p>
      </div>
    );
  }
  
  const allCharactersReady = project.scriptData.characters.every(c => c.referenceImage);
  const allScenesReady = project.scriptData.scenes.every(s => s.referenceImage);
  const allPropsReady = (project.scriptData.props || []).length > 0 && (project.scriptData.props || []).every(p => p.referenceImage);
  const selectedChar = project.scriptData.characters.find(c => compareIds(c.id, selectedCharId));
  const turnaroundChar = turnaroundCharId
    ? project.scriptData.characters.find(c => compareIds(c.id, turnaroundCharId))
    : undefined;
  const projectNameOptions = Array.from(
    new Set(
      libraryItems.map((item) => (item.projectName && item.projectName.trim()) || '未知项目')
    )
  ).sort((a, b) => (a as string).localeCompare(b as string, 'zh-CN'));
  const filteredLibraryItems = libraryItems.filter((item) => {
    if (libraryFilter !== 'all' && item.type !== libraryFilter) return false;
    if (libraryProjectFilter !== 'all') {
      const projectName = (item.projectName && item.projectName.trim()) || '未知项目';
      if (projectName !== libraryProjectFilter) return false;
    }
    if (!libraryQuery.trim()) return true;
    const query = libraryQuery.trim().toLowerCase();
    return item.name.toLowerCase().includes(query);
  });

  return (
    <div className={STYLES.mainContainer}>
      
      {/* Image Preview Modal */}
      <ImagePreviewModal 
        imageUrl={previewImage} 
        onClose={() => setPreviewImage(null)} 
      />

      {/* Global Progress Overlay */}
      {batchProgress && (
        <div className="absolute inset-0 z-50 bg-[var(--bg-base)]/80 flex flex-col items-center justify-center backdrop-blur-md animate-in fade-in">
          <Loader2 className="w-12 h-12 text-[var(--accent)] animate-spin mb-6" />
          <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">正在批量生成资源...</h3>
          <div className="w-64 h-1.5 bg-[var(--bg-hover)] rounded-full overflow-hidden mb-2">
            <div 
              className="h-full bg-[var(--accent)] transition-all duration-300" 
              style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
            />
          </div>
          <p className="text-[var(--text-tertiary)] font-mono text-xs">
            进度: {batchProgress.current} / {batchProgress.total}
          </p>
        </div>
      )}

      {/* Wardrobe Modal */}
      {selectedChar && (
        <WardrobeModal
          character={selectedChar}
          onClose={() => setSelectedCharId(null)}
          onAddVariation={handleAddVariation}
          onDeleteVariation={handleDeleteVariation}
          onGenerateVariation={handleGenerateVariation}
          onUploadVariation={handleUploadVariationImage}
          onImageClick={setPreviewImage}
        />
      )}

      {/* Turnaround Modal */}
      {turnaroundChar && (
        <TurnaroundModal
          character={turnaroundChar}
          onClose={() => setTurnaroundCharId(null)}
          onGeneratePanels={handleGenerateTurnaroundPanels}
          onConfirmPanels={handleConfirmTurnaroundPanels}
          onUpdatePanel={handleUpdateTurnaroundPanel}
          onRegenerate={handleRegenerateTurnaround}
          onRegenerateImage={handleRegenerateTurnaroundImage}
          onImageClick={setPreviewImage}
        />
      )}

      {/* Asset Library Modal */}
      {showLibraryModal && (
        <div className={STYLES.modalOverlay} onClick={() => {
          setShowLibraryModal(false);
          setReplaceTargetCharId(null);
        }}>
          <div className={STYLES.modalContainer} onClick={(e) => e.stopPropagation()}>
            <div className={STYLES.modalHeader}>
              <div className="flex items-center gap-3">
                <Archive className="w-4 h-4 text-[var(--accent-text)]" />
                <div>
                  <div className="text-sm font-bold text-[var(--text-primary)]">资产库</div>
                  <div className="text-[10px] text-[var(--text-tertiary)] font-mono uppercase tracking-widest">
                    {libraryItems.length} assets
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowLibraryModal(false);
                  setReplaceTargetCharId(null);
                }}
                className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded"
                title="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className={STYLES.modalBody}>
              <div className="flex flex-wrap items-center gap-3 mb-6">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={libraryQuery}
                    onChange={(e) => setLibraryQuery(e.target.value)}
                    placeholder="搜索资产名称..."
                    className="w-full pl-9 pr-3 py-2 bg-[var(--bg-deep)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)]"
                  />
                </div>
                <div className="min-w-[180px]">
                  <select
                    value={libraryProjectFilter}
                    onChange={(e) => setLibraryProjectFilter(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--bg-deep)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-secondary)]"
                  >
                    <option value="all">全部项目</option>
                    {projectNameOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  {(['all', 'character', 'scene', 'prop'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setLibraryFilter(type)}
                      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest border rounded ${
                        libraryFilter === type
                          ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] border-[var(--btn-primary-bg)]'
                          : 'bg-transparent text-[var(--text-tertiary)] border-[var(--border-primary)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)]'
                      }`}
                    >
                      {type === 'all' ? '全部' : type === 'character' ? '角色' : type === 'scene' ? '场景' : '道具'}
                    </button>
                  ))}
                </div>
              </div>

              {libraryLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 text-[var(--text-tertiary)] animate-spin" />
                </div>
              ) : filteredLibraryItems.length === 0 ? (
                <div className="border border-dashed border-[var(--border-primary)] rounded-xl p-10 text-center text-[var(--text-muted)] text-sm">
                  暂无资产。可在角色或场景卡片中选择“加入资产库”。
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredLibraryItems.map((item) => {
                    const preview =
                      item.type === 'character'
                        ? (item.data as Character).referenceImage
                        : item.type === 'scene'
                        ? (item.data as Scene).referenceImage
                        : (item.data as Prop).referenceImage;
                    return (
                      <div
                        key={item.id}
                        className="bg-[var(--bg-deep)] border border-[var(--border-primary)] rounded-xl overflow-hidden hover:border-[var(--border-secondary)] transition-colors"
                      >
                        <div className="aspect-video bg-[var(--bg-elevated)] relative">
                          {preview ? (
                            <img src={preview} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
                              {item.type === 'character' ? (
                                <Users className="w-8 h-8 opacity-30" />
                              ) : item.type === 'scene' ? (
                                <MapPin className="w-8 h-8 opacity-30" />
                              ) : (
                                <Package className="w-8 h-8 opacity-30" />
                              )}
                            </div>
                          )}
                        </div>
                        <div className="p-4 space-y-3">
                          <div>
                            <div className="text-sm text-[var(--text-primary)] font-bold line-clamp-1">{item.name}</div>
                            <div className="text-[10px] text-[var(--text-tertiary)] font-mono uppercase tracking-widest mt-1">
                              {item.type === 'character' ? '角色' : item.type === 'scene' ? '场景' : '道具'}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] font-mono mt-1 line-clamp-1">
                              {(item.projectName && item.projectName.trim()) || '未知项目'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() =>
                                replaceTargetCharId
                                  ? handleReplaceCharacterFromLibrary(item, replaceTargetCharId)
                                  : handleImportFromLibrary(item)
                              }
                              className="flex-1 py-2 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
                            >
                              {replaceTargetCharId ? '替换当前角色' : '导入到当前项目'}
                            </button>
                            <button
                              onClick={() =>
                                showAlert('确定从资产库删除该资源吗？', {
                                  type: 'warning',
                                  showCancel: true,
                                  onConfirm: () => handleDeleteLibraryItem(item.id)
                                })
                              }
                              className="p-2 border border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--error-text)] hover:border-[var(--error-border)] rounded transition-colors"
                              title="删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className={STYLES.header}>
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-3">
            <Users className="w-5 h-5 text-[var(--accent)]" />
            角色与场景
            <span className="text-xs text-[var(--text-muted)] font-mono font-normal uppercase tracking-wider bg-[var(--bg-base)]/30 px-2 py-1 rounded">
              Assets & Casting
            </span>
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => openLibrary('all')}
            disabled={!!batchProgress}
            className={STYLES.secondaryButton}
          >
            <Archive className="w-4 h-4" />
            资产库
          </button>
          {/* 横竖屏选择 */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-tertiary)] uppercase">比例</span>
            <AspectRatioSelector
              value={aspectRatio}
              onChange={setAspectRatio}
              allowSquare={(() => {
                // 根据当前激活的图片模型判断是否支持方形
                const activeModel = getActiveImageModel();
                return activeModel?.params?.supportedAspectRatios?.includes('1:1') ?? false;
              })()}
              disabled={!!batchProgress}
            />
          </div>
          <div className="w-px h-6 bg-[var(--bg-hover)]" />
          <div className="flex gap-2">
            <span className={STYLES.badge}>
              {project.scriptData.characters.length} CHARS
            </span>
            <span className={STYLES.badge}>
              {project.scriptData.scenes.length} SCENES
            </span>
            <span className={STYLES.badge}>
              {(project.scriptData.props || []).length} PROPS
            </span>
          </div>
        </div>
      </div>

      <div className={STYLES.content}>
        {/* Characters Section */}
        <section>
          <div className="flex items-end justify-between mb-6 border-b border-[var(--border-primary)] pb-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-[var(--accent)] rounded-full" />
                角色定妆 (Casting)
              </h3>
              <p className="text-xs text-[var(--text-tertiary)] mt-1 pl-3.5">为剧本中的角色生成一致的参考形象</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={handleAddCharacter}
                disabled={!!batchProgress}
                className="px-3 py-1.5 bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Users className="w-3 h-3" />
                新建角色
              </button>
              <button 
                onClick={() => openLibrary('character')}
                disabled={!!batchProgress}
                className={STYLES.secondaryButton}
              >
                <Archive className="w-3 h-3" />
                从资产库选择
              </button>
              <button 
                onClick={() => handleBatchGenerate('character')}
                disabled={!!batchProgress}
                className={allCharactersReady ? STYLES.secondaryButton : STYLES.primaryButton}
              >
                {allCharactersReady ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                {allCharactersReady ? '重新生成所有角色' : '一键生成所有角色'}
              </button>
            </div>
          </div>

          <div className={GRID_LAYOUTS.cards}>
            {project.scriptData.characters.map((char) => (
              <CharacterCard
                key={char.id}
                character={char}
                isGenerating={char.status === 'generating'}
                onGenerate={() => handleGenerateAsset('character', char.id)}
                onUpload={(file) => handleUploadCharacterImage(char.id, file)}
                onPromptSave={(newPrompt) => handleSaveCharacterPrompt(char.id, newPrompt)}
                onOpenWardrobe={() => setSelectedCharId(char.id)}
                onOpenTurnaround={() => setTurnaroundCharId(char.id)}
                onImageClick={setPreviewImage}
                onDelete={() => handleDeleteCharacter(char.id)}
                onUpdateInfo={(updates) => handleUpdateCharacterInfo(char.id, updates)}
                onAddToLibrary={() => handleAddCharacterToLibrary(char)}
                onReplaceFromLibrary={() => openLibrary('character', char.id)}
              />
            ))}
          </div>
        </section>

        {/* Scenes Section */}
        <section>
          <div className="flex items-end justify-between mb-6 border-b border-[var(--border-primary)] pb-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-[var(--success)] rounded-full" />
                场景概念 (Locations)
              </h3>
              <p className="text-xs text-[var(--text-tertiary)] mt-1 pl-3.5">为剧本场景生成环境参考图</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={handleAddScene}
                disabled={!!batchProgress}
                className="px-3 py-1.5 bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <MapPin className="w-3 h-3" />
                新建场景
              </button>
              <button 
                onClick={() => openLibrary('scene')}
                disabled={!!batchProgress}
                className={STYLES.secondaryButton}
              >
                <Archive className="w-3 h-3" />
                从资产库选择
              </button>
              <button 
                onClick={() => handleBatchGenerate('scene')}
                disabled={!!batchProgress}
                className={allScenesReady ? STYLES.secondaryButton : STYLES.primaryButton}
              >
                {allScenesReady ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                {allScenesReady ? '重新生成所有场景' : '一键生成所有场景'}
              </button>
            </div>
          </div>

          <div className={GRID_LAYOUTS.cards}>
            {project.scriptData.scenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                isGenerating={scene.status === 'generating'}
                onGenerate={() => handleGenerateAsset('scene', scene.id)}
                onUpload={(file) => handleUploadSceneImage(scene.id, file)}
                onPromptSave={(newPrompt) => handleSaveScenePrompt(scene.id, newPrompt)}
                onImageClick={setPreviewImage}
                onDelete={() => handleDeleteScene(scene.id)}
                onUpdateInfo={(updates) => handleUpdateSceneInfo(scene.id, updates)}
                onAddToLibrary={() => handleAddSceneToLibrary(scene)}
              />
            ))}
          </div>
        </section>

        {/* Props Section */}
        <section>
          <div className="flex items-end justify-between mb-6 border-b border-[var(--border-primary)] pb-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
                道具库 (Props)
              </h3>
              <p className="text-xs text-[var(--text-tertiary)] mt-1 pl-3.5">管理分镜中需要保持一致性的道具/物品</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={handleAddProp}
                disabled={!!batchProgress}
                className="px-3 py-1.5 bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Package className="w-3 h-3" />
                新建道具
              </button>
              <button 
                onClick={() => openLibrary('prop')}
                disabled={!!batchProgress}
                className={STYLES.secondaryButton}
              >
                <Archive className="w-3 h-3" />
                从资产库选择
              </button>
              {(project.scriptData.props || []).length > 0 && (
                <button 
                  onClick={handleBatchGenerateProps}
                  disabled={!!batchProgress}
                  className={allPropsReady ? STYLES.secondaryButton : STYLES.primaryButton}
                >
                  {allPropsReady ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                  {allPropsReady ? '重新生成所有道具' : '一键生成所有道具'}
                </button>
              )}
            </div>
          </div>

          {(project.scriptData.props || []).length === 0 ? (
            <div className="border border-dashed border-[var(--border-primary)] rounded-xl p-10 text-center text-[var(--text-muted)] text-sm">
              暂无道具。点击"新建道具"添加需要在多个分镜中保持一致的物品。
            </div>
          ) : (
            <div className={GRID_LAYOUTS.cards}>
              {(project.scriptData.props || []).map((prop) => (
                <PropCard
                  key={prop.id}
                  prop={prop}
                  isGenerating={prop.status === 'generating'}
                  onGenerate={() => handleGeneratePropAsset(prop.id)}
                  onUpload={(file) => handleUploadPropImage(prop.id, file)}
                  onPromptSave={(newPrompt) => handleSavePropPrompt(prop.id, newPrompt)}
                  onImageClick={setPreviewImage}
                  onDelete={() => handleDeleteProp(prop.id)}
                  onUpdateInfo={(updates) => handleUpdatePropInfo(prop.id, updates)}
                  onAddToLibrary={() => handleAddPropToLibrary(prop)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

    </div>
  );
};

export default StageAssets;
