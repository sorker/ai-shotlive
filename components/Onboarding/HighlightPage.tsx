import React from 'react';
import { HIGHLIGHTS } from './constants';

interface HighlightPageProps {
  onNext: () => void;
}

const HighlightPage: React.FC<HighlightPageProps> = ({ onNext }) => {
  return (
    <div className="flex flex-col items-center text-center">
      {/* 标题 */}
      <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-8">
        新功能怎么用，一页看懂
      </h2>

      <p className="text-[var(--text-tertiary)] text-sm mb-6 max-w-md">
        重点功能已就位，按下面路径就能快速上手
      </p>

      {/* 亮点说明 */}
      <div className="w-full max-w-md space-y-4 mb-8">
        {HIGHLIGHTS.map((highlight, index) => (
          <div
            key={index}
            className="flex items-start gap-4 bg-[var(--nav-hover-bg)] border border-[var(--border-primary)] rounded-xl p-4 text-left hover:border-[var(--accent-border)] transition-colors"
          >
            <span className="text-2xl flex-shrink-0">{highlight.icon}</span>
            <div>
              <h3 className="text-[var(--text-primary)] font-bold text-sm mb-1">{highlight.title}</h3>
              <p className="text-[var(--text-tertiary)] text-xs">{highlight.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* 使用路径 */}
      <div className="w-full max-w-md bg-[var(--accent-bg)] border border-[var(--accent-border)] rounded-xl px-6 py-4 mb-10 text-left">
        <h3 className="text-xs font-bold text-[var(--text-primary)] mb-3 uppercase tracking-wider">
          推荐使用路径
        </h3>
        <div className="space-y-2 text-[11px] text-[var(--text-secondary)] leading-relaxed">
          <p>1. 在「导演工作台」点击「九宫格分镜预览」，先确认 9 个镜头描述再生成九宫格图。</p>
          <p>2. 生成后可点击单个格子裁剪为首帧，也可直接使用整张九宫格图作为首帧。</p>
          <p>3. 选择 Veo 系列模型时建议补齐首帧+尾帧；仅有首帧也可先生成单图视频。</p>
        </div>
      </div>

      {/* 主按钮 */}
      <button
        onClick={onNext}
        className="px-8 py-3 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] font-bold text-sm rounded-lg hover:bg-[var(--btn-primary-hover)] transition-all duration-200 transform hover:scale-105"
      >
        继续下一步
      </button>
    </div>
  );
};

export default HighlightPage;
