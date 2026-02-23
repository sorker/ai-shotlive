import React from 'react';
import { Wand2, BrainCircuit, AlertCircle } from 'lucide-react';
import OptionSelector from './OptionSelector';
import { DURATION_OPTIONS, STYLES } from './constants';
import ModelSelector from '../ModelSelector';

interface Props {
  duration: string;
  model: string;
  customDurationInput: string;
  customModelInput: string;
  isProcessing: boolean;
  error: string | null;
  onShowModelConfig?: () => void;
  onDurationChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onCustomDurationChange: (value: string) => void;
  onCustomModelChange: (value: string) => void;
  onAnalyze: () => void;
}

const ConfigPanel: React.FC<Props> = ({
  duration,
  model,
  customDurationInput,
  customModelInput,
  isProcessing,
  error,
  onShowModelConfig,
  onDurationChange,
  onModelChange,
  onCustomDurationChange,
  onCustomModelChange,
  onAnalyze
}) => {
  return (
    <div className="w-80 border-r border-[var(--border-primary)] flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="h-14 px-5 border-b border-[var(--border-primary)] flex items-center justify-between shrink-0">
        <h2 className="text-sm font-bold text-[var(--text-primary)] tracking-wide flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-[var(--text-tertiary)]" />
          分镜配置
        </h2>
      </div>

      {/* Config Form */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {/* Duration */}
        <OptionSelector
          label="目标时长"
          options={DURATION_OPTIONS}
          value={duration}
          onChange={onDurationChange}
          customInput={customDurationInput}
          onCustomInputChange={onCustomDurationChange}
          customPlaceholder="输入时长 (如: 90s, 3m)"
          gridCols={2}
        />

        {/* Model */}
        <div className="space-y-2">
          <ModelSelector
            type="chat"
            value={model}
            onChange={onModelChange}
            disabled={isProcessing}
            label="分镜生成模型"
          />
          <p className="text-[9px] text-[var(--text-muted)]">
            在{' '}
            <button
              type="button"
              onClick={onShowModelConfig}
              className="text-[var(--accent-text)] hover:text-[var(--accent-text-hover)] underline underline-offset-2 transition-colors"
            >
              模型配置
            </button>{' '}
            中可添加更多模型
          </p>
        </div>
      </div>

      {/* Action Button */}
      <div className="p-6 border-t border-[var(--border-primary)] bg-[var(--bg-primary)]">
        <button
          onClick={onAnalyze}
          disabled={isProcessing}
          className={`w-full py-3.5 font-bold text-xs tracking-widest uppercase rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg ${
            isProcessing 
              ? STYLES.button.disabled
              : STYLES.button.primary
          }`}
        >
          {isProcessing ? (
            <>
              <BrainCircuit className="w-4 h-4 animate-spin" />
              智能分析中...
            </>
          ) : (
            <>
              <Wand2 className="w-4 h-4" />
              生成分镜脚本
            </>
          )}
        </button>
        {error && (
          <div className="mt-4 p-3 bg-[var(--error-bg)] border border-[var(--error-border)] text-[var(--error)] text-xs rounded flex items-center gap-2">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfigPanel;
