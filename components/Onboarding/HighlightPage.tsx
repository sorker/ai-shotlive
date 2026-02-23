import React from 'react';
import { HIGHLIGHTS } from './constants';

interface HighlightPageProps {
  onNext: () => void;
}

const HighlightPage: React.FC<HighlightPageProps> = ({ onNext }) => {
  return (
    <div className="flex flex-col items-center text-center">
      <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">
        核心功能，一页看懂
      </h2>

      <p className="text-[var(--text-tertiary)] text-sm mb-6 max-w-md">
        重点功能已就位，按下面路径就能快速上手
      </p>

      {/* 功能方块网格 */}
      <div className="w-full max-w-md grid grid-cols-3 gap-2.5 mb-6">
        {HIGHLIGHTS.map((highlight, index) => (
          <div
            key={index}
            className="bg-[var(--nav-hover-bg)] border border-[var(--border-primary)] rounded-xl p-3 text-center hover:border-[var(--accent-border)] transition-colors"
          >
            <span className="text-xl block mb-1.5">{highlight.icon}</span>
            <h3 className="text-[var(--text-primary)] font-bold text-[11px] mb-0.5 leading-tight">{highlight.title}</h3>
            <p className="text-[var(--text-muted)] text-[10px] leading-snug">{highlight.description}</p>
          </div>
        ))}
      </div>

      {/* 使用路径 */}
      <div className="w-full max-w-md bg-[var(--accent-bg)] border border-[var(--accent-border)] rounded-xl px-5 py-3 mb-6 text-left">
        <h3 className="text-[10px] font-bold text-[var(--text-primary)] mb-2 uppercase tracking-wider">
          推荐使用路径
        </h3>
        <div className="space-y-1 text-[10px] text-[var(--text-secondary)] leading-relaxed">
          <p>1. 在「小说与剧本」完成项目设置、上传小说并创建剧集。</p>
          <p>2. 在「导演工作台」用九宫格预览确认构图，选格子作为首帧。</p>
          <p>3. 补齐首帧+尾帧后选择视频模型生成片段。</p>
        </div>
      </div>

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
