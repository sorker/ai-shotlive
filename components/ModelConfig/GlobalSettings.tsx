/**
 * 提供商配置组件
 * 包含提供商 API Key、API 地址配置和新增自定义提供商
 */

import React, { useState, useEffect } from 'react';
import { Key, CheckCircle, ExternalLink, Gift, Sparkles, Eye, EyeOff, Save, Trash2, Plus, Globe, Edit3, X, Loader2 } from 'lucide-react';
import { 
  getProviders, 
  updateProvider,
  addProvider,
  removeProvider,
} from '../../services/modelRegistry';
import { ModelProvider, BUILTIN_PROVIDERS } from '../../types/model';
import { verifyApiKey } from '../../services/modelService';

interface GlobalSettingsProps {
  onRefresh: () => void;
}

/**
 * 单个提供商配置行
 */
const ProviderRow: React.FC<{
  provider: ModelProvider;
  defaultBaseUrl?: string;
  onSaveKey: (id: string, apiKey: string) => void;
  onClearKey: (id: string) => void;
  onSaveBaseUrl: (id: string, baseUrl: string) => void;
  onResetBaseUrl: (id: string) => void;
  onDelete?: (id: string) => void;
  onVerifyKey: (apiKey: string, baseUrl: string) => Promise<{ success: boolean; message: string }>;
}> = ({ provider, defaultBaseUrl, onSaveKey, onClearKey, onSaveBaseUrl, onResetBaseUrl, onDelete, onVerifyKey }) => {
  const [editKey, setEditKey] = useState(provider.apiKey || '');
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [editingUrl, setEditingUrl] = useState(false);
  const [editUrl, setEditUrl] = useState(provider.baseUrl);
  const [urlSaved, setUrlSaved] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    setEditKey(provider.apiKey || '');
  }, [provider.apiKey]);

  useEffect(() => {
    setEditUrl(provider.baseUrl);
  }, [provider.baseUrl]);

  const keyDirty = editKey !== (provider.apiKey || '');
  const hasKey = !!provider.apiKey;
  const urlChanged = defaultBaseUrl ? provider.baseUrl !== defaultBaseUrl : false;

  const handleSaveKey = () => {
    if (editKey.trim()) {
      onSaveKey(provider.id, editKey.trim());
      setKeySaved(true);
      setVerifyResult(null);
      setTimeout(() => setKeySaved(false), 2000);
    }
  };

  const handleClearKey = () => {
    setEditKey('');
    onClearKey(provider.id);
    setKeySaved(true);
    setVerifyResult(null);
    setTimeout(() => setKeySaved(false), 2000);
  };

  const handleSaveUrl = () => {
    const url = editUrl.trim().replace(/\/+$/, '');
    if (url) {
      onSaveBaseUrl(provider.id, url);
      setEditingUrl(false);
      setUrlSaved(true);
      setTimeout(() => setUrlSaved(false), 2000);
    }
  };

  const handleResetUrl = () => {
    if (defaultBaseUrl) {
      onResetBaseUrl(provider.id);
      setEditUrl(defaultBaseUrl);
      setEditingUrl(false);
      setUrlSaved(true);
      setTimeout(() => setUrlSaved(false), 2000);
    }
  };

  const handleVerify = async () => {
    const keyToVerify = editKey.trim() || provider.apiKey;
    if (!keyToVerify) return;
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const result = await onVerifyKey(keyToVerify, provider.baseUrl);
      setVerifyResult(result);
    } catch (e: any) {
      setVerifyResult({ success: false, message: e.message || '验证失败' });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="bg-[var(--bg-elevated)]/50 border border-[var(--border-primary)] rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--text-primary)]">{provider.name}</span>
          {!provider.isBuiltIn && (
            <span className="px-1.5 py-0.5 bg-[var(--accent-bg)] text-[var(--accent-text)] text-[8px] rounded">自定义</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {keySaved && (
            <span className="text-[9px] text-[var(--success-text)] flex items-center gap-0.5">
              <CheckCircle className="w-3 h-3" /> 已保存
            </span>
          )}
          {!keySaved && hasKey && !keyDirty && (
            <span className="text-[9px] text-[var(--success-text)] flex items-center gap-0.5">
              <CheckCircle className="w-3 h-3" /> 已配置
            </span>
          )}
          {keyDirty && (
            <span className="text-[9px] text-[var(--warning-text)]">未保存</span>
          )}
          {!provider.isBuiltIn && onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(provider.id); }}
              className="text-[var(--text-muted)] hover:text-[var(--error-text)] transition-colors ml-1"
              title="删除提供商"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* API 地址 */}
      <div className="mb-2">
        <div className="flex items-center gap-1.5 mb-1">
          <Globe className="w-3 h-3 text-[var(--text-muted)]" />
          <span className="text-[9px] text-[var(--text-muted)]">API 地址</span>
          {urlSaved && (
            <span className="text-[9px] text-[var(--success-text)]">已保存</span>
          )}
        </div>
        {editingUrl ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveUrl(); if (e.key === 'Escape') setEditingUrl(false); }}
              className="flex-1 bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-2 py-1 text-[10px] text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:border-[var(--accent)] focus:ring-[var(--accent)]/30"
              autoFocus
            />
            <button
              onClick={(e) => { e.stopPropagation(); handleSaveUrl(); }}
              className="px-2 py-1 text-[9px] font-medium rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
            >
              保存
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setEditingUrl(false); setEditUrl(provider.baseUrl); }}
              className="px-2 py-1 text-[9px] font-medium rounded bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:bg-[var(--border-secondary)] transition-colors"
            >
              取消
            </button>
            {defaultBaseUrl && provider.baseUrl !== defaultBaseUrl && (
              <button
                onClick={(e) => { e.stopPropagation(); handleResetUrl(); }}
                className="px-2 py-1 text-[9px] font-medium rounded text-[var(--warning-text)] bg-[var(--warning-bg)] hover:bg-[var(--warning-border)] transition-colors"
              >
                重置
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--text-tertiary)] font-mono flex-1 truncate">{provider.baseUrl}</span>
            {urlChanged && (
              <span className="text-[8px] text-[var(--warning-text)] px-1 py-0.5 bg-[var(--warning-bg)] rounded flex-shrink-0">已修改</span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setEditingUrl(true); }}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0"
              title="修改 API 地址"
            >
              <Edit3 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* API Key */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type={showKey ? 'text' : 'password'}
            value={editKey}
            onChange={(e) => { setEditKey(e.target.value); setKeySaved(false); setVerifyResult(null); }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey(); }}
            placeholder="输入此提供商的 API Key..."
            className={`w-full bg-[var(--bg-hover)] border rounded px-3 py-2 pr-8 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] font-mono focus:outline-none focus:ring-1 transition-colors ${
              keyDirty
                ? 'border-[var(--warning-border)] focus:border-[var(--warning)] focus:ring-[var(--warning)]/30'
                : 'border-[var(--border-secondary)] focus:border-[var(--accent)] focus:ring-[var(--accent)]/30'
            }`}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowKey(!showKey); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            tabIndex={-1}
          >
            {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </button>
        </div>
        {keyDirty && editKey.trim() && (
          <button
            onClick={(e) => { e.stopPropagation(); handleSaveKey(); }}
            className="px-3 py-2 text-[10px] font-medium rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors flex items-center gap-1 whitespace-nowrap"
          >
            <Save className="w-3 h-3" />
            保存
          </button>
        )}
        {hasKey && !keyDirty && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); handleVerify(); }}
              disabled={isVerifying}
              className="px-3 py-2 text-[10px] font-medium rounded bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border-secondary)] transition-colors flex items-center gap-1 whitespace-nowrap disabled:opacity-50"
            >
              {isVerifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
              验证
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleClearKey(); }}
              className="px-3 py-2 text-[10px] font-medium rounded text-[var(--error-text)] bg-[var(--error-bg)] hover:bg-[var(--error-hover-bg)] transition-colors flex items-center gap-1 whitespace-nowrap"
            >
              <Trash2 className="w-3 h-3" />
              清除
            </button>
          </>
        )}
      </div>

      {/* 获取 API Key 链接 */}
      {provider.apiKeyUrl && (
        <div className="mt-1.5 flex items-center gap-1">
          <a
            href={provider.apiKeyUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] text-[var(--accent-text)] hover:underline inline-flex items-center gap-1"
          >
            点击获取 {provider.name} API Key
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* 验证结果 */}
      {verifyResult && (
        <div className={`mt-1.5 text-[10px] flex items-center gap-1 ${verifyResult.success ? 'text-[var(--success-text)]' : 'text-[var(--error-text)]'}`}>
          <CheckCircle className="w-3 h-3" />
          {verifyResult.message}
        </div>
      )}
    </div>
  );
};

/**
 * 新增提供商表单
 */
const AddProviderForm: React.FC<{
  onAdd: (name: string, baseUrl: string, apiKey?: string) => void;
  onCancel: () => void;
}> = ({ onAdd, onCancel }) => {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  const handleSubmit = () => {
    if (!name.trim() || !baseUrl.trim()) return;
    onAdd(name.trim(), baseUrl.trim().replace(/\/+$/, ''), apiKey.trim() || undefined);
  };

  return (
    <div className="bg-[var(--accent-bg)] border border-[var(--accent-border)] rounded-lg p-4 space-y-3">
      <h4 className="text-xs font-bold text-[var(--text-primary)]">新增提供商</h4>
      <div>
        <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">提供商名称 *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          placeholder="如：My Custom API"
          className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:border-[var(--accent)] focus:ring-[var(--accent)]/30"
        />
      </div>
      <div>
        <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">API 基础 URL *</label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          placeholder="如：https://api.example.com"
          className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] font-mono focus:outline-none focus:ring-1 focus:border-[var(--accent)] focus:ring-[var(--accent)]/30"
        />
      </div>
      <div>
        <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">API Key（可选，可稍后配置）</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          placeholder="输入 API Key..."
          className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] font-mono focus:outline-none focus:ring-1 focus:border-[var(--accent)] focus:ring-[var(--accent)]/30"
          autoComplete="off"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || !baseUrl.trim()}
          className="flex-1 py-2 text-[10px] font-bold rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          添加提供商
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-[10px] font-medium rounded bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:bg-[var(--border-secondary)] transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  );
};

const GlobalSettings: React.FC<GlobalSettingsProps> = ({ onRefresh }) => {
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  const loadProviders = () => {
    setProviders(getProviders());
  };

  useEffect(() => {
    loadProviders();
  }, []);

  const builtInDefaultUrls = new Map(BUILTIN_PROVIDERS.map(p => [p.id, p.baseUrl]));

  const handleSaveKey = (providerId: string, key: string) => {
    updateProvider(providerId, { apiKey: key });
    loadProviders();
  };

  const handleClearKey = (providerId: string) => {
    updateProvider(providerId, { apiKey: undefined } as any);
    loadProviders();
  };

  const handleSaveBaseUrl = (providerId: string, baseUrl: string) => {
    updateProvider(providerId, { baseUrl });
    loadProviders();
  };

  const handleResetBaseUrl = (providerId: string) => {
    const defaultUrl = builtInDefaultUrls.get(providerId);
    if (defaultUrl) {
      updateProvider(providerId, { baseUrl: defaultUrl });
      loadProviders();
    }
  };

  const handleDeleteProvider = (providerId: string) => {
    if (removeProvider(providerId)) {
      loadProviders();
      onRefresh();
    }
  };

  const handleAddProvider = (name: string, baseUrl: string, apiKey?: string) => {
    addProvider({ name, baseUrl, apiKey, isDefault: false });
    setIsAdding(false);
    loadProviders();
    onRefresh();
  };

  const handleVerifyKey = async (apiKey: string, baseUrl: string): Promise<{ success: boolean; message: string }> => {
    return verifyApiKey(apiKey, baseUrl);
  };

  return (
    <div className="space-y-6">
      {/* 折扣广告卡片 */}
      <div className="bg-[var(--accent-bg)] border border-[var(--accent-border)] rounded-xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-[var(--accent)] flex items-center justify-center flex-shrink-0">
            <Gift className="w-6 h-6 text-[var(--text-primary)]" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-[var(--text-primary)] mb-1 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--warning-text)]" />
              推荐使用 BigBanana API
            </h3>
            <p className="text-xs text-[var(--text-tertiary)] mb-3 leading-relaxed">
              支持 GPT-5.1、GPT-5.2、Claude Sonnet 4.5、Gemini-3、Veo 3.1、Sora-2 等多种模型。
              稳定快速，价格优惠。本开源项目由 BigBanana API 提供支持。
            </p>
            <div className="flex items-center gap-3">
              <a 
                href="https://api.antsk.cn" 
                target="_blank" 
                rel="noreferrer"
                className="px-4 py-2 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] text-xs font-bold rounded-lg hover:bg-[var(--btn-primary-hover)] transition-colors inline-flex items-center gap-1.5"
              >
                立即购买
                <ExternalLink className="w-3 h-3" />
              </a>
              <a 
                href="https://ocnf8yod3ljg.feishu.cn/wiki/MgFVw2EoQieTLKktaf2cHvu6nY3" 
                target="_blank" 
                rel="noreferrer"
                className="px-4 py-2 bg-[var(--bg-hover)] text-[var(--text-secondary)] text-xs font-bold rounded-lg hover:bg-[var(--border-secondary)] transition-colors inline-flex items-center gap-1.5"
              >
                使用教程
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* 提供商配置 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Key className="w-4 h-4 text-[var(--warning-text)]" />
          <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
            提供商配置
          </label>
          <span className="text-[9px] text-[var(--text-muted)] ml-auto">
            {providers.filter(p => p.apiKey).length}/{providers.length} 已配置 Key
          </span>
        </div>
        <p className="text-[10px] text-[var(--text-muted)] mb-3 leading-relaxed">
          为每个提供商设置 API Key 和 API 地址。模型会自动使用其所属提供商的 Key 和地址。
          内置提供商有默认地址，也可以自行修改（如使用代理地址）。
        </p>
        <div className="space-y-2">
          {providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              defaultBaseUrl={builtInDefaultUrls.get(provider.id)}
              onSaveKey={handleSaveKey}
              onClearKey={handleClearKey}
              onSaveBaseUrl={handleSaveBaseUrl}
              onResetBaseUrl={handleResetBaseUrl}
              onDelete={!provider.isBuiltIn ? handleDeleteProvider : undefined}
              onVerifyKey={handleVerifyKey}
            />
          ))}
        </div>
      </div>

      {/* 添加自定义提供商 */}
      {isAdding ? (
        <AddProviderForm
          onAdd={handleAddProvider}
          onCancel={() => setIsAdding(false)}
        />
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          className="w-full py-3 border border-dashed border-[var(--border-secondary)] rounded-lg text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:border-[var(--border-secondary)] transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          添加自定义提供商
        </button>
      )}

      {/* 配置说明 */}
      <div className="p-4 bg-[var(--bg-elevated)]/50 rounded-lg border border-[var(--border-primary)]">
        <h4 className="text-xs font-bold text-[var(--text-tertiary)] mb-2">配置说明</h4>
        <ul className="text-[10px] text-[var(--text-muted)] space-y-1 list-disc list-inside">
          <li>为每个使用的提供商配置 API Key，模型会自动使用所属提供商的 Key</li>
          <li>内置提供商有默认 API 地址，点击编辑图标可修改（如使用代理）</li>
          <li>你可以添加自定义提供商，用于对接其他 API 服务</li>
          <li>内置模型默认关联到对应提供商，也可以在模型列表中修改所属提供商</li>
          <li>所有配置仅保存在本地浏览器，不会上传到服务器</li>
        </ul>
      </div>
    </div>
  );
};

export default GlobalSettings;
