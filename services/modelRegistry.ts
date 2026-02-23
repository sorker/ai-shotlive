/**
 * 模型注册中心
 * 管理所有已注册的模型，提供 CRUD 操作
 */

import {
  ModelType,
  ModelDefinition,
  ModelProvider,
  ModelRegistryState,
  ActiveModels,
  ChatModelDefinition,
  ImageModelDefinition,
  VideoModelDefinition,
  BUILTIN_PROVIDERS,
  ALL_BUILTIN_MODELS,
  DEFAULT_ACTIVE_MODELS,
  AspectRatio,
  VideoDuration,
} from '../types/model';

// localStorage 键名
const STORAGE_KEY = 'aishotlive_model_registry';

// 规范化 URL（去尾部斜杠、转小写）用于去重
const normalizeBaseUrl = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();

// 运行时状态缓存
let registryState: ModelRegistryState | null = null;

// ============================================
// 状态管理
// ============================================

/**
 * 获取默认状态
 */
const getDefaultState = (): ModelRegistryState => ({
  providers: [...BUILTIN_PROVIDERS],
  models: [...ALL_BUILTIN_MODELS],
  activeModels: { ...DEFAULT_ACTIVE_MODELS },
});

/**
 * 从 localStorage 加载状态
 */
export const loadRegistry = (): ModelRegistryState => {
  if (registryState) {
    return registryState;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as ModelRegistryState;
      const deprecatedVideoModelIds = [
        'veo-3.1',
        'veo-r2v',
        'veo_3_0_r2v_fast_portrait',
        'veo_3_0_r2v_fast_landscape',
        'veo_3_1_t2v_fast_landscape',
        'veo_3_1_t2v_fast_portrait',
        'veo_3_1_i2v_s_fast_fl_landscape',
        'veo_3_1_i2v_s_fast_fl_portrait',
      ];
      
      // 确保内置模型和提供商始终存在
      const builtInProviderIds = BUILTIN_PROVIDERS.map(p => p.id);
      const builtInModelIds = ALL_BUILTIN_MODELS.map(m => m.id);
      
      // 合并内置提供商
      const existingProviderIds = parsed.providers.map(p => p.id);
      BUILTIN_PROVIDERS.forEach(bp => {
        const existingIndex = parsed.providers.findIndex(p => p.id === bp.id);
        if (existingIndex === -1) {
          parsed.providers.unshift(bp);
        } else {
          // 同步内置提供商的结构性字段（如 apiKeyUrl、name），保留用户自定义的 apiKey 和 baseUrl
          const existing = parsed.providers[existingIndex];
          parsed.providers[existingIndex] = {
            ...bp,
            apiKey: existing.apiKey,
            baseUrl: existing.baseUrl,
          };
        }
      });

      // 按 baseUrl 去重提供商（保留先出现的项，通常为内置）
      // 同时记录被移除的 provider ID → 保留的 provider ID 的映射，用于迁移模型引用
      const seenBaseUrls = new Map<string, string>(); // normalizedUrl → survivingProviderId
      const removedProviderMap = new Map<string, string>(); // removedId → survivingId
      parsed.providers = parsed.providers.filter(p => {
        const key = normalizeBaseUrl(p.baseUrl);
        if (seenBaseUrls.has(key)) {
          // 记录被移除的 provider 应该映射到哪个存活的 provider
          removedProviderMap.set(p.id, seenBaseUrls.get(key)!);
          return false;
        }
        seenBaseUrls.set(key, p.id);
        return true;
      });

      // 将引用了被移除提供商的模型迁移到存活的提供商
      if (removedProviderMap.size > 0) {
        parsed.models.forEach(m => {
          const newProviderId = removedProviderMap.get(m.providerId);
          if (newProviderId) {
            (m as any).providerId = newProviderId;
          }
        });
      }
      
      // 合并内置模型，并确保内置模型的参数与代码保持同步
      const existingModelIds = parsed.models.map(m => m.id);
      ALL_BUILTIN_MODELS.forEach(bm => {
        const existingIndex = parsed.models.findIndex(m => m.id === bm.id);
        if (existingIndex === -1) {
          // 内置模型不存在，添加
          parsed.models.push(bm);
        } else {
          // 内置模型已存在：以代码定义为基础，保留用户的个性化设置
          const existing = parsed.models[existingIndex];
          // 用户可调整的偏好参数（defaultAspectRatio, temperature, maxTokens, defaultDuration 等）
          // 结构性参数（supportedAspectRatios, supportedDurations, mode 等）始终从代码同步
          const USER_PREF_KEYS = ['defaultAspectRatio', 'temperature', 'maxTokens', 'defaultDuration'];
          const mergedParams = { ...(bm as any).params };
          const existingParams = (existing as any).params;
          if (existingParams) {
            for (const key of USER_PREF_KEYS) {
              if (key in existingParams && existingParams[key] !== undefined) {
                mergedParams[key] = existingParams[key];
              }
            }
          }
          parsed.models[existingIndex] = {
            ...bm,
            isEnabled: existing.isEnabled,
            providerId: existing.providerId || bm.providerId,
            params: mergedParams as any,
          };
        }
      });

      // 迁移缺失的 apiModel（优先从 id 或 providerId 前缀推断）
      parsed.models = parsed.models.map(m => {
        if (m.apiModel) return m;
        if (m.providerId && m.id.startsWith(`${m.providerId}:`)) {
          return { ...m, apiModel: m.id.slice(m.providerId.length + 1) };
        }
        return { ...m, apiModel: m.id };
      });

      // 清理旧的已废弃视频模型
      const modelCountBefore = parsed.models.length;
      parsed.models = parsed.models.filter(
        m => !(m.type === 'video' && deprecatedVideoModelIds.includes(m.id))
      );
      const modelsRemoved = modelCountBefore - parsed.models.length;

      // 迁移激活视频模型
      let activeModelMigrated = false;
      if (
        deprecatedVideoModelIds.includes(parsed.activeModels.video) ||
        parsed.activeModels.video === 'veo_3_1' ||
        parsed.activeModels.video?.startsWith('veo_3_1_')
      ) {
        parsed.activeModels.video = 'veo';
        activeModelMigrated = true;
      }
      
      // 迁移：清除旧版 globalApiKey 字段（如果存在）
      delete (parsed as any).globalApiKey;
      
      registryState = parsed;

      // 每次加载后回写 localStorage，确保内置模型/提供商的更新（如 providerId 变更）被持久化
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        if (modelsRemoved > 0 || activeModelMigrated) {
          console.log(`🔄 模型注册中心迁移完成：清理 ${modelsRemoved} 个废弃模型`);
        }
      } catch (e) {
        // 回写失败不影响运行
      }

      return parsed;
    }
  } catch (e) {
    console.error('加载模型注册中心失败:', e);
  }

  registryState = getDefaultState();
  return registryState;
};

/**
 * 保存状态到 localStorage 并异步同步到服务器
 */
export const saveRegistry = (state: ModelRegistryState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    registryState = state;

    // 异步同步到服务器（不阻塞 UI）
    syncRegistryToServer(state);
  } catch (e) {
    console.error('保存模型注册中心失败:', e);
  }
};

/**
 * 异步将模型注册表同步到服务器
 */
const syncRegistryToServer = async (state: ModelRegistryState): Promise<void> => {
  try {
    const token = localStorage.getItem('aishotlive_auth_token');
    if (!token) return; // 未登录时不同步

    await fetch('/api/models/registry', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(state),
    });
  } catch {
    // 同步失败不影响本地使用
  }
};

/**
 * 从服务器加载模型注册表到 localStorage（登录后调用）
 */
export const syncRegistryFromServer = async (): Promise<void> => {
  try {
    const token = localStorage.getItem('aishotlive_auth_token');
    if (!token) return;

    const res = await fetch('/api/models/registry', {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json();
      if (data) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        registryState = null; // 强制下次 loadRegistry 重新从 localStorage 读取
      }
    }
  } catch {
    // 同步失败使用本地缓存
  }
};

/**
 * 获取当前状态
 */
export const getRegistryState = (): ModelRegistryState => {
  return loadRegistry();
};

/**
 * 重置为默认状态
 */
export const resetRegistry = (): void => {
  registryState = null;
  localStorage.removeItem(STORAGE_KEY);
  loadRegistry();
};

// ============================================
// 提供商管理
// ============================================

/**
 * 获取所有提供商
 */
export const getProviders = (): ModelProvider[] => {
  return loadRegistry().providers;
};

/**
 * 根据 ID 获取提供商
 */
export const getProviderById = (id: string): ModelProvider | undefined => {
  return getProviders().find(p => p.id === id);
};

/**
 * 获取默认提供商
 */
export const getDefaultProvider = (): ModelProvider => {
  return getProviders().find(p => p.isDefault) || BUILTIN_PROVIDERS[0];
};

/**
 * 添加提供商
 */
export const addProvider = (provider: Omit<ModelProvider, 'id' | 'isBuiltIn'>): ModelProvider => {
  const state = loadRegistry();
  const normalized = normalizeBaseUrl(provider.baseUrl);
  const existing = state.providers.find(p => normalizeBaseUrl(p.baseUrl) === normalized);
  if (existing) return existing;
  const newProvider: ModelProvider = {
    ...provider,
    id: `provider_${Date.now()}`,
    isBuiltIn: false,
  };
  state.providers.push(newProvider);
  saveRegistry(state);
  return newProvider;
};

/**
 * 更新提供商
 */
export const updateProvider = (id: string, updates: Partial<ModelProvider>): boolean => {
  const state = loadRegistry();
  const index = state.providers.findIndex(p => p.id === id);
  if (index === -1) {
    console.warn(`[updateProvider] provider not found: ${id}`);
    return false;
  }

  // 内置提供商不能修改 id 和 isBuiltIn
  if (state.providers[index].isBuiltIn) {
    delete updates.id;
    delete updates.isBuiltIn;
  }

  state.providers[index] = { ...state.providers[index], ...updates };

  // 清除值为 undefined 的可选字段，确保 JSON 序列化干净
  if (state.providers[index].apiKey === undefined || state.providers[index].apiKey === '') {
    delete (state.providers[index] as any).apiKey;
  }

  console.log(`[updateProvider] ${id}: apiKey=${state.providers[index].apiKey ? '***set***' : 'empty'}`);
  saveRegistry(state);
  return true;
};

/**
 * 删除提供商
 */
export const removeProvider = (id: string): boolean => {
  const state = loadRegistry();
  const provider = state.providers.find(p => p.id === id);
  
  // 不能删除内置提供商
  if (!provider || provider.isBuiltIn) return false;
  
  // 删除该提供商的所有模型
  state.models = state.models.filter(m => m.providerId !== id);
  state.providers = state.providers.filter(p => p.id !== id);
  
  saveRegistry(state);
  return true;
};

// ============================================
// 模型管理
// ============================================

/**
 * 获取所有模型
 */
export const getModels = (type?: ModelType): ModelDefinition[] => {
  const models = loadRegistry().models;
  if (type) {
    return models.filter(m => m.type === type);
  }
  return models;
};

/**
 * 获取对话模型列表
 */
export const getChatModels = (): ChatModelDefinition[] => {
  return getModels('chat') as ChatModelDefinition[];
};

/**
 * 获取图片模型列表
 */
export const getImageModels = (): ImageModelDefinition[] => {
  return getModels('image') as ImageModelDefinition[];
};

/**
 * 获取视频模型列表
 */
export const getVideoModels = (): VideoModelDefinition[] => {
  return getModels('video') as VideoModelDefinition[];
};

/**
 * 根据 ID 获取模型
 */
export const getModelById = (id: string): ModelDefinition | undefined => {
  return getModels().find(m => m.id === id);
};

/**
 * 获取当前激活的模型
 */
export const getActiveModel = (type: ModelType): ModelDefinition | undefined => {
  const state = loadRegistry();
  const activeId = state.activeModels[type];
  return getModelById(activeId);
};

/**
 * 获取当前激活的对话模型
 */
export const getActiveChatModel = (): ChatModelDefinition | undefined => {
  return getActiveModel('chat') as ChatModelDefinition | undefined;
};

/**
 * 获取当前激活的图片模型
 */
export const getActiveImageModel = (): ImageModelDefinition | undefined => {
  return getActiveModel('image') as ImageModelDefinition | undefined;
};

/**
 * 获取当前激活的视频模型
 */
export const getActiveVideoModel = (): VideoModelDefinition | undefined => {
  return getActiveModel('video') as VideoModelDefinition | undefined;
};

/**
 * 设置激活的模型
 */
export const setActiveModel = (type: ModelType, modelId: string): boolean => {
  const model = getModelById(modelId);
  if (!model || model.type !== type || !model.isEnabled) return false;

  const state = loadRegistry();
  state.activeModels[type] = modelId;
  saveRegistry(state);
  return true;
};

/**
 * 注册新模型
 * @param model - 模型定义（可包含自定义 id，不包含 isBuiltIn）
 */
export const registerModel = (model: Omit<ModelDefinition, 'isBuiltIn'> & { id?: string }): ModelDefinition => {
  const state = loadRegistry();
  
  const providedId = (model as any).id?.trim();
  const apiModel = (model as any).apiModel?.trim();
  const baseId = providedId || (apiModel ? `${model.providerId}:${apiModel}` : `model_${Date.now()}`);
  let modelId = baseId;

  // 若未显式提供 ID，则自动生成唯一 ID（允许 API 模型名重复）
  if (!providedId) {
    let suffix = 1;
    while (state.models.some(m => m.id === modelId)) {
      modelId = `${baseId}_${suffix++}`;
    }
  } else if (state.models.some(m => m.id === modelId)) {
    throw new Error(`模型 ID "${modelId}" 已存在，请使用其他 ID`);
  }
  
  const newModel = {
    ...model,
    id: modelId,
    apiModel: apiModel || (model.providerId && modelId.startsWith(`${model.providerId}:`)
      ? modelId.slice(model.providerId.length + 1)
      : modelId),
    isBuiltIn: false,
  } as ModelDefinition;
  
  state.models.push(newModel);
  saveRegistry(state);
  return newModel;
};

/**
 * 更新模型
 */
export const updateModel = (id: string, updates: Partial<ModelDefinition>): boolean => {
  const state = loadRegistry();
  const index = state.models.findIndex(m => m.id === id);
  if (index === -1) return false;

  // 内置模型只能修改 isEnabled、params 和 providerId
  if (state.models[index].isBuiltIn) {
    const allowedUpdates: Partial<ModelDefinition> = {};
    if (updates.isEnabled !== undefined) allowedUpdates.isEnabled = updates.isEnabled;
    if (updates.params) allowedUpdates.params = updates.params as any;
    if (updates.providerId !== undefined) allowedUpdates.providerId = updates.providerId;
    state.models[index] = { ...state.models[index], ...allowedUpdates } as ModelDefinition;
  } else {
    state.models[index] = { ...state.models[index], ...updates } as ModelDefinition;
  }

  saveRegistry(state);
  return true;
};

/**
 * 删除模型
 */
export const removeModel = (id: string): boolean => {
  const state = loadRegistry();
  const model = state.models.find(m => m.id === id);
  
  // 不能删除内置模型
  if (!model || model.isBuiltIn) return false;
  
  // 如果删除的是当前激活的模型，切换到同类型的第一个启用模型
  if (state.activeModels[model.type] === id) {
    const fallback = state.models.find(m => m.type === model.type && m.id !== id && m.isEnabled);
    if (fallback) {
      state.activeModels[model.type] = fallback.id;
    }
  }
  
  state.models = state.models.filter(m => m.id !== id);
  saveRegistry(state);
  return true;
};

/**
 * 启用/禁用模型
 */
export const toggleModelEnabled = (id: string, enabled: boolean): boolean => {
  return updateModel(id, { isEnabled: enabled });
};

// ============================================
// API Key 管理
// ============================================

/**
 * 获取模型对应的 API Key
 * 直接使用模型所属提供商的 API Key
 */
export const getApiKeyForModel = (modelId: string): string | undefined => {
  const model = getModelById(modelId);
  if (!model) {
    console.warn(`[getApiKeyForModel] model not found: ${modelId}`);
    return undefined;
  }
  
  const provider = getProviderById(model.providerId);
  if (!provider) {
    console.warn(`[getApiKeyForModel] provider not found: ${model.providerId}`);
    return undefined;
  }
  
  return provider.apiKey;
};

/**
 * 获取模型对应的 API 基础 URL
 */
export const getApiBaseUrlForModel = (modelId: string): string => {
  const model = getModelById(modelId);
  if (!model) return BUILTIN_PROVIDERS[0].baseUrl.replace(/\/+$/, '');
  
  const provider = getProviderById(model.providerId);
  const baseUrl = provider?.baseUrl || BUILTIN_PROVIDERS[0].baseUrl;
  return baseUrl.replace(/\/+$/, '');
};

// ============================================
// 辅助函数
// ============================================

/**
 * 获取激活模型的完整配置
 */
export const getActiveModelsConfig = (): ActiveModels => {
  return loadRegistry().activeModels;
};

/**
 * 检查模型是否可用（已启用且所属提供商有 API Key）
 */
export const isModelAvailable = (modelId: string): boolean => {
  const model = getModelById(modelId);
  if (!model || !model.isEnabled) return false;
  
  const provider = getProviderById(model.providerId);
  return !!provider?.apiKey;
};

// ============================================
// 默认值辅助函数（向后兼容）
// ============================================

/**
 * 获取默认横竖屏比例（模型默认值）
 */
export const getDefaultAspectRatio = (): AspectRatio => {
  const imageModel = getActiveImageModel();
  if (imageModel) {
    return imageModel.params.defaultAspectRatio;
  }
  return '16:9';
};

/**
 * 获取用户选择的横竖屏比例
 * 读取当前激活图片模型的 defaultAspectRatio
 */
export const getUserAspectRatio = (): AspectRatio => {
  return getDefaultAspectRatio();
};

/**
 * 设置用户选择的横竖屏比例（同步更新当前激活图片模型的默认比例）
 * 修改会持久化保存，并与模型配置页面的"默认比例"保持一致
 */
export const setUserAspectRatio = (ratio: AspectRatio): void => {
  const activeModel = getActiveImageModel();
  if (activeModel) {
    updateModel(activeModel.id, {
      params: { ...activeModel.params, defaultAspectRatio: ratio }
    } as any);
  }
};

/**
 * 获取默认视频时长
 */
export const getDefaultVideoDuration = (): VideoDuration => {
  const videoModel = getActiveVideoModel();
  if (videoModel) {
    return videoModel.params.defaultDuration;
  }
  return 8;
};

/**
 * 获取视频模型类型
 */
export const getVideoModelType = (): 'sora' | 'veo' => {
  const videoModel = getActiveVideoModel();
  if (videoModel) {
    return videoModel.params.mode === 'async' ? 'sora' : 'veo';
  }
  return 'sora';
};
