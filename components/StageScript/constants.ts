/**
 * StageScript 配置常量
 */

/** 小说类型（用于 AI 生成系统提示词） */
export const NOVEL_GENRE_OPTIONS = [
  { label: '🗡️ 玄幻', value: '玄幻' },
  { label: '🏙️ 都市', value: '都市' },
  { label: '🔍 悬疑', value: '悬疑' },
  { label: '💕 言情', value: '言情' },
  { label: '⚔️ 武侠', value: '武侠' },
  { label: '🚀 科幻', value: '科幻' },
  { label: '👻 恐怖', value: '恐怖' },
  { label: '📖 历史', value: '历史' },
  { label: '🎭 喜剧', value: '喜剧' },
  { label: '🎖️ 军事', value: '军事' },
  { label: '🏫 校园', value: '校园' },
  { label: '🎮 游戏', value: '游戏' },
  { label: '🌙 仙侠', value: '仙侠' },
  { label: '🦄 奇幻', value: '奇幻' },
  { label: '🍬 甜宠', value: '甜宠' },
  { label: '💔 虐恋', value: '虐恋' },
  { label: '🔄 重生', value: '重生' },
  { label: '⏰ 穿越', value: '穿越' },
  { label: '📱 系统流', value: '系统流' },
  { label: '👻 灵异', value: '灵异' },
  { label: '🗺️ 冒险', value: '冒险' },
  { label: '🌸 治愈', value: '治愈' },
  { label: '💼 职场', value: '职场' },
  { label: '🏛️ 权谋', value: '权谋' },
  { label: '👑 宫斗', value: '宫斗' },
  { label: '🌾 种田', value: '种田' },
  { label: '✨ 其他', value: 'custom' },
];

/** 篇幅/字数（用于 AI 生成系统提示词） */
export const NOVEL_LENGTH_OPTIONS = [
  { label: '单章 (1500-2500字)', value: 'single' },
  { label: '短片 (800-1500字)', value: 'short-film' },
  { label: '短剧 (2000-4000字)', value: 'short-drama' },
  { label: '中篇 (3000-5000字)', value: 'medium' },
  { label: '长篇 (4000-6000字)', value: 'long' },
];

/** 情感基调（用于 AI 生成系统提示词） */
export const NOVEL_TONE_OPTIONS = [
  { label: '默认', value: 'default' },
  { label: '轻松幽默', value: 'humorous' },
  { label: '紧张刺激', value: 'thrilling' },
  { label: '温馨治愈', value: 'healing' },
  { label: '虐心催泪', value: 'tragic' },
  { label: '热血燃情', value: 'passionate' },
  { label: '悬疑烧脑', value: 'mysterious' },
  { label: '浪漫唯美', value: 'romantic' },
  { label: '黑暗沉重', value: 'dark' },
];

export const DURATION_OPTIONS = [
  { label: '30秒 (广告)', value: '30s' },
  { label: '60秒 (预告)', value: '60s' },
  { label: '2分钟 (片花)', value: '120s' },
  { label: '5分钟 (短片)', value: '300s' },
  { label: '自定义', value: 'custom' }
];

export const LANGUAGE_OPTIONS = [
  { label: '中文 (Chinese)', value: '中文' },
  { label: 'English (US)', value: 'English' },
  { label: '日本語 (Japanese)', value: 'Japanese' },
  { label: 'Français (French)', value: 'French' },
  { label: 'Español (Spanish)', value: 'Spanish' }
];

export const MODEL_OPTIONS = [
  { label: 'GPT-5.1 (推荐)', value: 'gpt-5.1' },
  { label: 'GPT-5.2', value: 'gpt-5.2' },
  { label: 'GPT-4.1', value: 'gpt-41' },
  { label: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5-20250929' },
  { label: '其他 (自定义)', value: 'custom' }
];

export const STYLES = {
  input: 'w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-3 py-2.5 text-sm rounded-md focus:border-[var(--border-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--border-secondary)] transition-all placeholder:text-[var(--text-muted)]',
  label: 'text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest',
  select: 'w-full bg-[var(--bg-surface)] border border-[var(--border-primary)] text-[var(--text-primary)] px-3 py-2.5 text-sm rounded-md appearance-none focus:border-[var(--border-secondary)] focus:outline-none transition-all cursor-pointer',
  button: {
    primary: 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] shadow-lg shadow-[var(--btn-primary-shadow)]',
    secondary: 'bg-transparent border-[var(--border-primary)] text-[var(--text-tertiary)] hover:border-[var(--border-secondary)] hover:text-[var(--text-secondary)]',
    selected: 'bg-[var(--accent-bg-hover)] text-[var(--text-primary)] border-[var(--accent-border)] shadow-sm ring-1 ring-[var(--accent-border)]',
    disabled: 'bg-[var(--bg-hover)] text-[var(--text-tertiary)] cursor-not-allowed'
  },
  editor: {
    textarea: 'w-full bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-secondary)] px-3 py-2 text-sm rounded-md focus:border-[var(--border-primary)] focus:outline-none resize-none',
    mono: 'font-mono',
    serif: 'font-serif italic'
  }
};

export const DEFAULTS = {
  duration: '60s',
  language: '中文',
  model: 'gpt-5.1',
  visualStyle: 'live-action'
};
