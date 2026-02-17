/**
 * 模型列表组件
 * 显示特定类型的模型列表，支持选择激活模型，支持按提供商筛选
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Info, CheckCircle, Filter } from 'lucide-react';
import { 
  ModelType, 
  ModelDefinition, 
} from '../../types/model';
import {
  getModels,
  updateModel,
  registerModel,
  removeModel,
  getActiveModelsConfig,
  setActiveModel,
  getProviderById,
  getProviders,
} from '../../services/modelRegistry';
import { ModelProvider } from '../../types/model';
import { useAlert } from '../GlobalAlert';
import ModelCard from './ModelCard';
import AddModelForm from './AddModelForm';

interface ModelListProps {
  type: ModelType;
  onRefresh: () => void;
}

const typeDescriptions: Record<ModelType, string> = {
  chat: '用于剧本解析、分镜生成、提示词优化等文本生成任务',
  image: '用于角色定妆、场景生成、关键帧生成等图片生成任务',
  video: '用于视频片段生成任务',
};

/**
 * 根据提供商 ID 获取显示标签
 * 优先使用 providerId 映射，回退到模型名称推断
 */
const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  doubao: '豆包',
  qwen: '千问',
  zhipu: '智谱',
  google: 'Google',
  xai: 'xAI',
  siliconflow: 'SiliconFlow',
  moonshot: 'Moonshot',
  openrouter: 'OpenRouter',
  antsk: 'BigBanana',
};

function getModelVendorTag(model: ModelDefinition): string {
  // 优先使用 providerId 映射
  if (model.providerId && PROVIDER_LABELS[model.providerId]) {
    return PROVIDER_LABELS[model.providerId];
  }

  // 回退：从模型名称/ID推断
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();

  if (id.startsWith('gpt-') || id.startsWith('gpt4') || id === 'gpt-41' || id === 'gpt-4o') return 'OpenAI';
  if (id.startsWith('claude-')) return 'Anthropic';
  if (id.startsWith('deepseek-')) return 'DeepSeek';
  if (id.startsWith('doubao-') || name.includes('豆包')) return '豆包';
  if (id.startsWith('qwen-') || name.includes('千问')) return '千问';
  if (id.startsWith('glm-') || name.includes('智谱')) return '智谱';
  if (id.startsWith('gemini-') || id.startsWith('veo')) return 'Google';
  if (id.startsWith('grok-')) return 'xAI';
  if (id.startsWith('kling-') || name.includes('可灵')) return '可灵';
  if (id.startsWith('vidu') || name.includes('vidu')) return 'Vidu';
  if (id.startsWith('wan') || name.includes('万象')) return '万象';
  if (id.startsWith('sora')) return 'OpenAI';

  return '其他';
}

const ModelList: React.FC<ModelListProps> = ({ type, onRefresh }) => {
  const [models, setModels] = useState<ModelDefinition[]>([]);
  const [allProviders, setAllProviders] = useState<ModelProvider[]>([]);
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [activeModelId, setActiveModelId] = useState<string>('');
  const [selectedVendor, setSelectedVendor] = useState<string>('all');
  const { showAlert } = useAlert();

  useEffect(() => {
    loadModels();
    setSelectedVendor('all');
  }, [type]);

  const loadModels = () => {
    const allModels = getModels(type);
    setModels(allModels);
    setAllProviders(getProviders());
    const activeConfig = getActiveModelsConfig();
    setActiveModelId(activeConfig[type]);
  };

  // 提取所有可用的提供商标签
  const vendorTags = useMemo(() => {
    const tags = new Set<string>();
    models.forEach(m => tags.add(getModelVendorTag(m)));
    return Array.from(tags).sort();
  }, [models]);

  // 按提供商筛选后的模型列表
  const filteredModels = useMemo(() => {
    if (selectedVendor === 'all') return models;
    return models.filter(m => getModelVendorTag(m) === selectedVendor);
  }, [models, selectedVendor]);

  const handleSetActiveModel = (modelId: string) => {
    if (setActiveModel(type, modelId)) {
      setActiveModelId(modelId);
      const model = models.find(m => m.id === modelId);
      const provider = model ? getProviderById(model.providerId) : null;
      showAlert(
        `已切换到 ${model?.name}${provider ? ` (${provider.name})` : ''}`, 
        { type: 'success' }
      );
      onRefresh();
    } else {
      showAlert('设置激活模型失败，请确保模型已启用', { type: 'error' });
    }
  };

  const handleUpdateModel = (modelId: string, updates: Partial<ModelDefinition>) => {
    if (updateModel(modelId, updates)) {
      loadModels();
      // 注意：不调用 onRefresh()，因为 loadModels() 已经更新了本地状态。
      // onRefresh() 会导致父组件 refreshKey++ → key 改变 → 整个内容区域卸载重建，
      // 从而使输入框失焦，造成"每打一个字就刷新弹窗"的问题。
    }
  };

  const handleDeleteModel = (modelId: string) => {
    showAlert('确定要删除这个模型吗？', {
      type: 'warning',
      showCancel: true,
      onConfirm: () => {
        if (removeModel(modelId)) {
          loadModels();
          onRefresh();
          showAlert('模型已删除', { type: 'success' });
        }
      }
    });
  };

  const handleAddModel = (model: Omit<ModelDefinition, 'id' | 'isBuiltIn'>) => {
    try {
      registerModel(model);
      setIsAddingModel(false);
      loadModels();
      onRefresh();
      showAlert('模型添加成功', { type: 'success' });
    } catch (error) {
      showAlert(error instanceof Error ? error.message : '添加模型失败', { type: 'error' });
    }
  };

  const handleToggleExpand = (modelId: string) => {
    setExpandedModelId(expandedModelId === modelId ? null : modelId);
  };

  return (
    <div className="space-y-4">
      {/* 类型说明 */}
      <div className="mb-4">
        <p className="text-xs text-[var(--text-tertiary)]">{typeDescriptions[type]}</p>
      </div>

      {/* 当前激活模型信息 */}
      <div className="bg-[var(--accent-bg)] border border-[var(--accent-border)] rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle className="w-4 h-4 text-[var(--accent-text)]" />
          <span className="text-xs font-bold text-[var(--accent-text-hover)]">当前使用</span>
        </div>
        {(() => {
          const activeModel = models.find(m => m.id === activeModelId);
          const provider = activeModel ? getProviderById(activeModel.providerId) : null;
          return (
            <p className="text-[11px] text-[var(--text-secondary)]">
              <span className="font-medium">{activeModel?.name || '未选择'}</span>
              {provider && (
                <span className="text-[var(--text-tertiary)] ml-2">
                  → {provider.name} ({provider.baseUrl})
                </span>
              )}
            </p>
          );
        })()}
      </div>

      {/* 提供商筛选栏 */}
      {vendorTags.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
          <button
            onClick={() => setSelectedVendor('all')}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-colors ${
              selectedVendor === 'all'
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--border-secondary)]'
            }`}
          >
            全部 ({models.length})
          </button>
          {vendorTags.map((tag) => {
            const count = models.filter(m => getModelVendorTag(m) === tag).length;
            return (
              <button
                key={tag}
                onClick={() => setSelectedVendor(tag)}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-colors ${
                  selectedVendor === tag
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--border-secondary)]'
                }`}
              >
                {tag} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* 提示信息 */}
      <div className="bg-[var(--bg-hover)]/50 border border-[var(--border-secondary)] rounded-lg p-3 flex items-start gap-2">
        <Info className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0 mt-0.5" />
        <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
          点击「使用」按钮切换激活模型。展开模型卡片可修改所属提供商和参数。
        </p>
      </div>

      {/* 模型列表 */}
      <div className="space-y-2">
        {filteredModels.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            isExpanded={expandedModelId === model.id}
            isActive={activeModelId === model.id}
            providers={allProviders}
            onToggleExpand={() => handleToggleExpand(model.id)}
            onUpdate={(updates) => handleUpdateModel(model.id, updates)}
            onDelete={() => handleDeleteModel(model.id)}
            onSetActive={() => handleSetActiveModel(model.id)}
          />
        ))}
        {filteredModels.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] text-center py-4">
            当前筛选条件下无模型
          </p>
        )}
      </div>

      {/* 添加模型 */}
      {isAddingModel ? (
        <AddModelForm
          type={type}
          onSave={handleAddModel}
          onCancel={() => setIsAddingModel(false)}
        />
      ) : (
        <button
          onClick={() => setIsAddingModel(true)}
          className="w-full py-3 border border-dashed border-[var(--border-secondary)] rounded-lg text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:border-[var(--border-secondary)] transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          添加自定义模型
        </button>
      )}
    </div>
  );
};

export default ModelList;
