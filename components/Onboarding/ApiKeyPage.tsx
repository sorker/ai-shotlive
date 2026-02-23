import React, { useState } from 'react';
import { Key, Loader2, CheckCircle, AlertCircle, ExternalLink, ChevronDown } from 'lucide-react';
import { verifyApiKey } from '../../services/modelService';
import { updateProvider, getProviderById, loadRegistry } from '../../services/modelRegistry';

interface ApiKeyPageProps {
  onNext: () => void;
  onSkip: () => void;
}

const ApiKeyPage: React.FC<ApiKeyPageProps> = ({ onNext, onSkip }) => {
  const registry = loadRegistry();
  const providers = registry.providers.filter(p => p.isBuiltIn);

  const [selectedProviderId, setSelectedProviderId] = useState(providers[0]?.id || 'antsk');
  const selectedProvider = providers.find(p => p.id === selectedProviderId) || providers[0];
  const existingKey = getProviderById(selectedProviderId)?.apiKey || '';

  const [inputKey, setInputKey] = useState(existingKey);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'success' | 'error'>(
    existingKey ? 'success' : 'idle'
  );
  const [verifyMessage, setVerifyMessage] = useState(existingKey ? '已配置' : '');

  const handleProviderChange = (providerId: string) => {
    setSelectedProviderId(providerId);
    const key = getProviderById(providerId)?.apiKey || '';
    setInputKey(key);
    setVerifyStatus(key ? 'success' : 'idle');
    setVerifyMessage(key ? '已配置' : '');
  };

  const handleSaveAndContinue = async () => {
    if (!inputKey.trim()) {
      setVerifyStatus('error');
      setVerifyMessage('请输入 API Key');
      return;
    }

    setIsVerifying(true);
    setVerifyStatus('idle');

    try {
      if (selectedProviderId === 'antsk') {
        const result = await verifyApiKey(inputKey.trim());
        if (result.success) {
          setVerifyStatus('success');
          setVerifyMessage('验证成功！');
          updateProvider(selectedProviderId, { apiKey: inputKey.trim() });
          setTimeout(onNext, 500);
        } else {
          setVerifyStatus('error');
          setVerifyMessage(result.message);
        }
      } else {
        updateProvider(selectedProviderId, { apiKey: inputKey.trim() });
        setVerifyStatus('success');
        setVerifyMessage('已保存');
        setTimeout(onNext, 500);
      }
    } catch (error: any) {
      setVerifyStatus('error');
      setVerifyMessage(error.message || '操作出错');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative mb-5">
        <div className="w-14 h-14 rounded-2xl bg-[var(--accent-bg)] border border-[var(--accent-border)] flex items-center justify-center">
          <Key className="w-7 h-7 text-[var(--accent-text)]" />
        </div>
        {verifyStatus === 'success' && (
          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-[var(--success)] rounded-full flex items-center justify-center">
            <CheckCircle className="w-3.5 h-3.5 text-[var(--text-primary)]" />
          </div>
        )}
      </div>

      <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1">
        配置 API Key
      </h2>
      <p className="text-[var(--text-tertiary)] text-xs mb-5">
        选择提供商并填写 API Key，即可使用 AI 生成功能
      </p>

      {/* 提供商选择 */}
      <div className="w-full max-w-sm mb-3">
        <label className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest block text-left mb-1.5">
          选择提供商
        </label>
        <div className="relative">
          <select
            value={selectedProviderId}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-4 py-2.5 text-sm rounded-lg focus:border-[var(--accent)] focus:outline-none transition-all appearance-none cursor-pointer"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-[var(--text-muted)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* API Key 输入框 */}
      <div className="w-full max-w-sm mb-3">
        <label className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest block text-left mb-1.5">
          API Key
        </label>
        <input
          type="password"
          value={inputKey}
          onChange={(e) => {
            setInputKey(e.target.value);
            setVerifyStatus('idle');
            setVerifyMessage('');
          }}
          placeholder={`输入 ${selectedProvider?.name || ''} API Key...`}
          className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-4 py-2.5 text-sm rounded-lg focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-hover)] transition-all font-mono placeholder:text-[var(--text-muted)]"
          disabled={isVerifying}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && inputKey.trim() && !isVerifying) {
              handleSaveAndContinue();
            }
          }}
        />

        {verifyMessage && (
          <div className={`mt-1.5 flex items-center justify-center gap-1.5 text-xs ${
            verifyStatus === 'success' ? 'text-[var(--success-text)]' : 'text-[var(--error-text)]'
          }`}>
            {verifyStatus === 'success' ? (
              <CheckCircle className="w-3 h-3" />
            ) : (
              <AlertCircle className="w-3 h-3" />
            )}
            {verifyMessage}
          </div>
        )}
      </div>

      {/* 获取 Key 链接 */}
      {selectedProvider?.apiKeyUrl && (
        <a
          href={selectedProvider.apiKeyUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[var(--accent-text)] hover:underline inline-flex items-center gap-1 mb-5"
        >
          获取 {selectedProvider.name} API Key <ExternalLink className="w-3 h-3" />
        </a>
      )}

      {/* 提示 */}
      <p className="text-[10px] text-[var(--text-muted)] mb-5 max-w-sm leading-relaxed">
        项目支持多厂商模型，可在「模型配置」中随时添加或切换其他提供商。
      </p>

      <button
        onClick={handleSaveAndContinue}
        disabled={isVerifying}
        className="px-8 py-2.5 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] font-bold text-sm rounded-lg hover:bg-[var(--btn-primary-hover)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {isVerifying ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            验证中...
          </>
        ) : (
          '保存并继续'
        )}
      </button>

      <button
        onClick={onSkip}
        className="mt-3 text-xs text-[var(--text-muted)] hover:text-[var(--text-tertiary)] transition-colors"
      >
        稍后在设置中配置
      </button>
    </div>
  );
};

export default ApiKeyPage;
