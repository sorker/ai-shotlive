import React, { useState } from 'react';
import { Key, Loader2, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { verifyApiKey } from '../../services/modelService';
import { updateProvider, getProviderById } from '../../services/modelRegistry';

interface ApiKeyPageProps {
  onNext: () => void;
  onSkip: () => void;
}

const ApiKeyPage: React.FC<ApiKeyPageProps> = ({ 
  onNext,
  onSkip 
}) => {
  const antskProvider = getProviderById('antsk');
  const [inputKey, setInputKey] = useState(antskProvider?.apiKey || '');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'success' | 'error'>(
    antskProvider?.apiKey ? 'success' : 'idle'
  );
  const [verifyMessage, setVerifyMessage] = useState(antskProvider?.apiKey ? '已配置' : '');

  const handleVerifyAndContinue = async () => {
    if (!inputKey.trim()) {
      setVerifyStatus('error');
      setVerifyMessage('请输入 API Key');
      return;
    }

    setIsVerifying(true);
    setVerifyStatus('idle');

    try {
      const result = await verifyApiKey(inputKey.trim());
      
      if (result.success) {
        setVerifyStatus('success');
        setVerifyMessage('验证成功！');
        updateProvider('antsk', { apiKey: inputKey.trim() });
        setTimeout(() => {
          onNext();
        }, 500);
      } else {
        setVerifyStatus('error');
        setVerifyMessage(result.message);
      }
    } catch (error: any) {
      setVerifyStatus('error');
      setVerifyMessage(error.message || '验证出错');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="flex flex-col items-center text-center">
      {/* 图标 */}
      <div className="relative mb-6">
        <div className="w-16 h-16 rounded-2xl bg-[var(--accent-bg)] border border-[var(--accent-border)] flex items-center justify-center">
          <Key className="w-8 h-8 text-[var(--accent-text)]" />
        </div>
        {verifyStatus === 'success' && (
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-[var(--success)] rounded-full flex items-center justify-center">
            <CheckCircle className="w-4 h-4 text-[var(--text-primary)]" />
          </div>
        )}
      </div>

      {/* 标题 */}
      <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">
        配置你的 API Key
      </h2>

      {/* 说明 */}
      <p className="text-[var(--text-tertiary)] text-sm mb-6 max-w-xs">
        需要 API Key 才能使用 AI 生成功能
      </p>

      {/* 使用预期提醒 */}
      <div className="w-full max-w-sm mb-6 text-left border border-[var(--border-primary)] bg-[var(--bg-surface)]/60 rounded-lg p-3">
        <h3 className="text-xs font-bold text-[var(--text-primary)] mb-2">
          使用预期提醒
        </h3>
        <div className="space-y-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          <p>
            如果你的核心诉求是"必须先给免费额度"，这个项目可能不太适合你。
          </p>
          <p>
            更建议先体验元宝或者豆包，产品成熟，也常有活动福利。
          </p>
          <p>
            我们做开源的初衷是降低门槛，让技术更普惠；这里提供的 API 主要用于快速体验和集成，不是盈利核心。
          </p>
          <p>
            项目本身支持自配模型。若我们的 API 不符合你的预期，你也可以直接使用 OpenAI 或 Google 官方服务，哪怕价格更高也完全没问题。
          </p>
        </div>
      </div>

      {/* 输入框 */}
      <div className="w-full max-w-sm mb-4">
        <input
          type="password"
          value={inputKey}
          onChange={(e) => {
            setInputKey(e.target.value);
            setVerifyStatus('idle');
            setVerifyMessage('');
          }}
          placeholder="输入你的 BigBanana API Key..."
          className="w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-4 py-3 text-sm rounded-lg focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-hover)] transition-all font-mono placeholder:text-[var(--text-muted)] text-center"
          disabled={isVerifying}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && inputKey.trim() && !isVerifying) {
              handleVerifyAndContinue();
            }
          }}
        />

        {/* 状态提示 */}
        {verifyMessage && (
          <div className={`mt-2 flex items-center justify-center gap-2 text-xs ${
            verifyStatus === 'success' ? 'text-[var(--success-text)]' : 'text-[var(--error-text)]'
          }`}>
            {verifyStatus === 'success' ? (
              <CheckCircle className="w-3.5 h-3.5" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5" />
            )}
            {verifyMessage}
          </div>
        )}
      </div>

      {/* 获取 Key 链接 */}
      <div className="flex items-center gap-4 mb-8">
        <a 
          href="https://api.antsk.cn" 
          target="_blank" 
          rel="noreferrer" 
          className="text-xs text-[var(--accent-text)] hover:underline inline-flex items-center gap-1"
        >
          立即购买 <ExternalLink className="w-3 h-3" />
        </a>
        <span className="text-[var(--text-muted)]">|</span>
        <a 
          href="https://ocnf8yod3ljg.feishu.cn/wiki/MgFVw2EoQieTLKktaf2cHvu6nY3" 
          target="_blank" 
          rel="noreferrer" 
          className="text-xs text-[var(--accent-text)] hover:underline inline-flex items-center gap-1"
        >
          使用教程 <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* 主按钮 */}
      <button
        onClick={handleVerifyAndContinue}
        disabled={isVerifying}
        className="px-8 py-3 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] font-bold text-sm rounded-lg hover:bg-[var(--btn-primary-hover)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {isVerifying ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            验证中...
          </>
        ) : (
          '验证并继续'
        )}
      </button>

      {/* 跳过入口 */}
      <button
        onClick={onSkip}
        className="mt-4 text-xs text-[var(--text-muted)] hover:text-[var(--text-tertiary)] transition-colors"
      >
        稍后在设置中配置
      </button>
    </div>
  );
};

export default ApiKeyPage;
