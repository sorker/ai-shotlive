// Onboarding 常量配置

export const ONBOARDING_STORAGE_KEY = 'aishotlive_onboarding_completed';

export const ONBOARDING_PAGES = {
  WELCOME: 0,
  WORKFLOW: 1,
  HIGHLIGHTS: 2,
  API_KEY: 3,
  ACTION: 4,
} as const;

export const TOTAL_PAGES = 5;

// 工作流步骤
export const WORKFLOW_STEPS = [
  {
    number: '①',
    title: '写剧本',
    description: '上传小说或输入故事，AI自动提取角色和场景',
  },
  {
    number: '②',
    title: '定形象',
    description: '角色参考图 + 造型九宫格',
  },
  {
    number: '③',
    title: '排分镜',
    description: '首尾帧/九宫格驱动视频生成',
  },
  {
    number: '④',
    title: '导成片',
    description: '合并导出完整短剧',
  },
] as const;

// 核心亮点
export const HIGHLIGHTS = [
  {
    icon: '📖',
    title: '小说管理一体化',
    description: '项目配置、小说上传、章节解析、剧集管理集中在同一页面',
  },
  {
    icon: '🎬',
    title: '首尾帧衔接',
    description: '可复制上一镜尾帧到下一镜首帧，镜头过渡更连贯',
  },
  {
    icon: '🧩',
    title: '九宫格分镜',
    description: '一键拆分9个视角，支持整图或裁剪格子设为首帧',
  },
  {
    icon: '👔',
    title: '角色衣橱',
    description: '同一角色，多套造型随时切换',
  },
  {
    icon: '🔐',
    title: '账户管理',
    description: '点击用户名即可修改用户名和密码',
  },
] as const;

// 快速开始选项
export const QUICK_START_OPTIONS = [
  {
    id: 'novel',
    icon: '📖',
    title: '从小说开始',
    description: '上传小说，按章节生成剧本再拆分镜（推荐）',
  },
  {
    id: 'script',
    icon: '📝',
    title: '从剧本开始',
    description: '粘贴你的故事，AI帮你拆分镜',
  },
  {
    id: 'example',
    icon: '🎬',
    title: '看看示例项目',
    description: '先逛逛别人怎么做的',
  },
] as const;
