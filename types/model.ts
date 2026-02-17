/**
 * 模型抽象层类型定义
 * 定义模型注册、配置、适配器相关的所有类型
 */

// ============================================
// 基础类型
// ============================================

/**
 * 模型类型
 */
export type ModelType = 'chat' | 'image' | 'video';

/**
 * 横竖屏比例类型
 */
export type AspectRatio = '16:9' | '9:16' | '1:1';

/**
 * 视频时长类型（仅异步视频模式支持）
 */
export type VideoDuration = 4 | 8 | 12;

/**
 * 视频生成模式
 */
export type VideoMode = 'sync' | 'async';

// ============================================
// 模型参数配置
// ============================================

/**
 * 对话模型参数
 */
export interface ChatModelParams {
  temperature: number;           // 温度 0-2，默认 0.7
  maxTokens?: number;            // 最大 token，留空表示不限制
  topP?: number;                 // Top P，可选
  frequencyPenalty?: number;     // 频率惩罚，可选
  presencePenalty?: number;      // 存在惩罚，可选
}

/**
 * 图片生成 API 格式
 * - gemini: Google Gemini generateContent 格式（contents/parts + inlineData）
 * - openai-image: OpenAI / 火山引擎兼容的 /images/generations 格式
 */
export type ImageApiFormat = 'gemini' | 'openai-image' | 'dashscope-image';

/**
 * 图片模型参数
 */
export interface ImageModelParams {
  defaultAspectRatio: AspectRatio;
  supportedAspectRatios: AspectRatio[];
  apiFormat?: ImageApiFormat;  // 默认 'gemini'
}

/**
 * 视频模型参数
 */
export interface VideoModelParams {
  mode: VideoMode;                        // sync=Veo, async=Sora
  defaultAspectRatio: AspectRatio;
  supportedAspectRatios: AspectRatio[];
  defaultDuration: VideoDuration;
  supportedDurations: VideoDuration[];
}

/**
 * 模型参数联合类型
 */
export type ModelParams = ChatModelParams | ImageModelParams | VideoModelParams;

// ============================================
// 模型定义
// ============================================

/**
 * 模型定义基础接口
 */
export interface ModelDefinitionBase {
  id: string;                    // 唯一标识，如 'gpt-5.1'
  apiModel?: string;             // API 实际模型名（可与其他模型重复）
  name: string;                  // 显示名称，如 'GPT-5.1'
  type: ModelType;               // 模型类型
  providerId: string;            // 提供商 ID
  endpoint?: string;             // API 端点（可覆盖默认）
  description?: string;          // 描述
  isBuiltIn: boolean;            // 是否内置（内置模型不可删除）
  isEnabled: boolean;            // 是否启用
}

/**
 * 对话模型定义
 */
export interface ChatModelDefinition extends ModelDefinitionBase {
  type: 'chat';
  params: ChatModelParams;
}

/**
 * 图片模型定义
 */
export interface ImageModelDefinition extends ModelDefinitionBase {
  type: 'image';
  params: ImageModelParams;
}

/**
 * 视频模型定义
 */
export interface VideoModelDefinition extends ModelDefinitionBase {
  type: 'video';
  params: VideoModelParams;
}

/**
 * 模型定义联合类型
 */
export type ModelDefinition = ChatModelDefinition | ImageModelDefinition | VideoModelDefinition;

// ============================================
// 提供商定义
// ============================================

/**
 * 模型提供商配置
 */
export interface ModelProvider {
  id: string;                    // 唯一标识
  name: string;                  // 显示名称
  baseUrl: string;               // API 基础 URL
  apiKey?: string;               // 独立 API Key（可选）
  apiKeyUrl?: string;            // API Key 获取地址（用于引导用户获取 Key）
  isBuiltIn: boolean;            // 是否内置
  isDefault: boolean;            // 是否为默认提供商
}

// ============================================
// 注册中心状态
// ============================================

/**
 * 激活的模型配置
 */
export interface ActiveModels {
  chat: string;                  // 当前激活的对话模型 ID
  image: string;                 // 当前激活的图片模型 ID
  video: string;                 // 当前激活的视频模型 ID
}

/**
 * 模型注册中心状态
 */
export interface ModelRegistryState {
  providers: ModelProvider[];
  models: ModelDefinition[];
  activeModels: ActiveModels;
}

// ============================================
// 服务调用参数
// ============================================

/**
 * 对话服务调用参数
 */
export interface ChatOptions {
  prompt: string;
  systemPrompt?: string;
  responseFormat?: 'text' | 'json';
  timeout?: number;
  // 可选覆盖模型参数
  overrideParams?: Partial<ChatModelParams>;
}

/**
 * 图片生成调用参数
 */
export interface ImageGenerateOptions {
  prompt: string;
  referenceImages?: string[];
  aspectRatio?: AspectRatio;
}

/**
 * 视频生成调用参数
 */
export interface VideoGenerateOptions {
  prompt: string;
  startImage?: string;
  endImage?: string;
  aspectRatio?: AspectRatio;
  duration?: VideoDuration;
}

// ============================================
// 默认值常量
// ============================================

/**
 * 默认对话模型参数
 */
export const DEFAULT_CHAT_PARAMS: ChatModelParams = {
  temperature: 0.7,
  maxTokens: undefined,
};

/**
 * 默认图片模型参数
 * 注意：Gemini 3 Pro Image 只支持横屏(16:9)和竖屏(9:16)，不支持方形(1:1)
 */
export const DEFAULT_IMAGE_PARAMS: ImageModelParams = {
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],
};

/**
 * 默认视频模型参数 (Veo 首尾帧模式)
 */
export const DEFAULT_VIDEO_PARAMS_VEO: VideoModelParams = {
  mode: 'sync',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],  // Veo 不支持 1:1
  defaultDuration: 8,
  supportedDurations: [8],  // Veo 固定时长
};

/**
 * 默认视频模型参数 (Sora)
 */
export const DEFAULT_VIDEO_PARAMS_SORA: VideoModelParams = {
  mode: 'async',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  defaultDuration: 8,
  supportedDurations: [4, 8, 12],
};

/**
 * 默认视频模型参数 (Veo 3.1 Fast)
 */
export const DEFAULT_VIDEO_PARAMS_VEO_FAST: VideoModelParams = {
  mode: 'async',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['16:9', '9:16'],
  defaultDuration: 8,
  supportedDurations: [8],
};

// ============================================
// 内置模型定义
// ============================================

/**
 * 内置对话模型列表
 * 包含原有模型 + 从 Toonflow 移植的多厂商模型
 */
export const BUILTIN_CHAT_MODELS: ChatModelDefinition[] = [
  // ========== OpenAI ==========
  {
    id: 'gpt-5.1',
    name: 'GPT-5.1',
    type: 'chat',
    providerId: 'openai',
    description: '剧情脚本切分首选：结构化输出稳定，适合分场/分镜、提取人物与事件',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    type: 'chat',
    providerId: 'openai',
    description: '创意增强型切分：更适合提供多种切分方案、改写节奏与镜头建议（一致性略弱）',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'gpt-41',
    name: 'GPT-4.1',
    type: 'chat',
    providerId: 'openai',
    description: '严谨切分：对复杂叙事与长文本更稳，适合时间线梳理、因果关系与要点校对',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    type: 'chat',
    providerId: 'openai',
    description: 'OpenAI GPT-4o 多模态模型，支持图文理解',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  // ========== Anthropic ==========
  // 注意：Anthropic 官方 API 使用 /v1/messages 格式，与 OpenAI 格式不同。
  // 如直接使用 Anthropic 官方 Key，需通过兼容代理或使用 BigBanana API。
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    type: 'chat',
    providerId: 'anthropic',
    endpoint: '/v1/messages',
    description: '长文友好：适合长篇剧本的分段、摘要与角色弧线整理，文字表达更细腻',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    type: 'chat',
    providerId: 'anthropic',
    endpoint: '/v1/messages',
    description: 'Anthropic 最强模型，深度推理与创意写作能力突出',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  // ========== DeepSeek ==========
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    type: 'chat',
    providerId: 'deepseek',
    description: 'DeepSeek 对话模型，性价比高，适合长文本处理',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    type: 'chat',
    providerId: 'deepseek',
    description: 'DeepSeek 推理模型，适合复杂逻辑分析',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  // ========== 豆包 (Doubao) ==========
  {
    id: 'doubao-seed-1-8-251228',
    name: '豆包 Seed 1.8',
    type: 'chat',
    providerId: 'doubao',
    endpoint: '/api/v3/chat/completions',
    description: '字节跳动豆包大模型，支持图文理解和深度思考',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'doubao-seed-1-6-251015',
    name: '豆包 Seed 1.6',
    type: 'chat',
    providerId: 'doubao',
    endpoint: '/api/v3/chat/completions',
    description: '字节跳动豆包大模型，多模态能力强',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  // ========== 千问 (Qwen) ==========
  {
    id: 'qwen-plus-latest',
    name: '通义千问 Plus',
    type: 'chat',
    providerId: 'qwen',
    endpoint: '/compatible-mode/v1/chat/completions',
    description: '阿里千问 Plus，均衡的性能与成本',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'qwen-max',
    name: '通义千问 Max',
    type: 'chat',
    providerId: 'qwen',
    endpoint: '/compatible-mode/v1/chat/completions',
    description: '阿里千问旗舰版，最强推理与创作',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  // ========== 智谱 (Zhipu/GLM) ==========
  {
    id: 'glm-4.7',
    name: '智谱 GLM-4.7',
    type: 'chat',
    providerId: 'zhipu',
    endpoint: '/api/paas/v4/chat/completions',
    description: '智谱 AI 最新模型，中文理解能力出色',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'glm-4.5-flash',
    name: '智谱 GLM-4.5 Flash',
    type: 'chat',
    providerId: 'zhipu',
    endpoint: '/api/paas/v4/chat/completions',
    description: '智谱 AI 快速模型，支持深度思考',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  // ========== Google Gemini ==========
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    type: 'chat',
    providerId: 'google',
    endpoint: '/v1beta/openai/chat/completions',
    description: 'Google 旗舰模型，多模态+深度思考',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    type: 'chat',
    providerId: 'google',
    endpoint: '/v1beta/openai/chat/completions',
    description: 'Google 快速模型，高性价比',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
  // ========== xAI ==========
  {
    id: 'grok-4',
    name: 'Grok-4',
    type: 'chat',
    providerId: 'xai',
    description: 'xAI Grok-4 模型',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_CHAT_PARAMS },
  },
];

/**
 * 内置图片模型列表
 * 包含原有模型 + 从 Toonflow 移植的多厂商图片模型
 */
export const BUILTIN_IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: 'gemini-3-pro-image-preview',
    name: 'Gemini 3 Pro Image(Nano Banana Pro)',
    type: 'image',
    providerId: 'google',
    endpoint: '/v1beta/models/gemini-3-pro-image-preview:generateContent',
    description: 'Google Nano Banana Pro 图片生成模型',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS },
  },
  {
    id: 'gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash Image',
    type: 'image',
    providerId: 'google',
    endpoint: '/v1beta/models/gemini-2.5-flash-image:generateContent',
    description: 'Google Gemini 2.5 Flash 图片生成，支持九宫格',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS },
  },
  {
    id: 'doubao-seedream-4-5',
    apiModel: 'doubao-seedream-4-5-251128',
    name: '豆包 Seedream 4.5',
    type: 'image',
    providerId: 'doubao',
    endpoint: '/api/v3/images/generations',
    description: '字节火山引擎图片生成模型',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS, supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[], apiFormat: 'openai-image' as ImageApiFormat },
  },
  {
    id: 'kling-image-o1',
    name: '可灵 Image O1',
    type: 'image',
    providerId: 'antsk',
    description: '可灵 AI 图片生成模型（通过 BigBanana API 代理）',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS, supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[] },
  },
  // ========== 通义千问 Qwen-Image（DashScope）==========
  {
    id: 'qwen-image-max',
    name: '通义万相 Image Max',
    type: 'image',
    providerId: 'qwen',
    endpoint: '/api/v1/services/aigc/text2image/image-synthesis',
    description: '阿里通义万相旗舰图片模型，200亿参数 MMDiT 架构，擅长复杂中英文文字渲染',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS, supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[], apiFormat: 'dashscope-image' as ImageApiFormat },
  },
  {
    id: 'qwen-image-plus',
    name: '通义万相 Image Plus',
    type: 'image',
    providerId: 'qwen',
    endpoint: '/api/v1/services/aigc/text2image/image-synthesis',
    description: '阿里通义万相均衡图片模型，支持文字渲染和多种画风',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS, supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[], apiFormat: 'dashscope-image' as ImageApiFormat },
  },
  {
    id: 'qwen-image',
    name: '通义万相 Image',
    type: 'image',
    providerId: 'qwen',
    endpoint: '/api/v1/services/aigc/text2image/image-synthesis',
    description: '阿里通义万相基础图片模型，性价比高',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_IMAGE_PARAMS, supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[], apiFormat: 'dashscope-image' as ImageApiFormat },
  },
];

/**
 * 内置视频模型列表
 * 包含原有模型 + 从 Toonflow 移植的多厂商视频模型
 */
export const BUILTIN_VIDEO_MODELS: VideoModelDefinition[] = [
  // ========== Google Veo ==========
  {
    id: 'veo',
    name: 'Veo 3.1 首尾帧',
    type: 'video',
    providerId: 'antsk',
    endpoint: '/v1/chat/completions',
    description: 'Veo 3.1 首尾帧模式（通过 BigBanana API）',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_VEO },
  },
  {
    id: 'veo_3_1-fast',
    name: 'Veo 3.1 Fast',
    type: 'video',
    providerId: 'antsk',
    endpoint: '/v1/videos',
    description: '异步模式，支持横屏/竖屏（通过 BigBanana API）',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_VEO_FAST },
  },
  // ========== OpenAI Sora ==========
  {
    id: 'sora-2',
    name: 'Sora-2',
    type: 'video',
    providerId: 'openai',
    endpoint: '/v1/videos',
    description: 'OpenAI Sora 视频生成，异步模式，支持多种时长',
    isBuiltIn: true,
    isEnabled: true,
    params: { ...DEFAULT_VIDEO_PARAMS_SORA },
  },
  // ========== 豆包 Seedance（火山引擎）==========
  {
    id: 'doubao-seedance-1-5-pro',
    apiModel: 'doubao-seedance-1-5-pro-251215',
    name: '豆包 Seedance 1.5 Pro',
    type: 'video',
    providerId: 'doubao',
    endpoint: '/v1/videos',
    description: '字节火山引擎视频生成，支持有声视频，4-12秒',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      mode: 'async' as VideoMode,
      defaultAspectRatio: '16:9' as AspectRatio,
      supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[],
      defaultDuration: 8 as VideoDuration,
      supportedDurations: [4, 8, 12] as VideoDuration[],
    },
  },
  {
    id: 'doubao-seedance-2-0',
    apiModel: 'doubao-seedance-2-0-260214',
    name: '豆包 Seedance 2.0',
    type: 'video',
    providerId: 'doubao',
    endpoint: '/v1/videos',
    description: '字节火山引擎最新视频模型，画面质量和动态效果大幅提升，支持有声视频',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      mode: 'async' as VideoMode,
      defaultAspectRatio: '16:9' as AspectRatio,
      supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[],
      defaultDuration: 8 as VideoDuration,
      supportedDurations: [4, 8, 12] as VideoDuration[],
    },
  },
  // ========== 可灵 (Kling) ==========
  {
    id: 'kling-v2-6-pro',
    name: '可灵 V2.6 Pro',
    type: 'video',
    providerId: 'antsk',
    endpoint: '/v1/videos',
    description: '可灵 AI 最新视频模型（通过 BigBanana API）',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      mode: 'async' as VideoMode,
      defaultAspectRatio: '16:9' as AspectRatio,
      supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[],
      defaultDuration: 8 as VideoDuration,
      supportedDurations: [4, 8] as VideoDuration[],
    },
  },
  // ========== Vidu ==========
  {
    id: 'viduq3-pro',
    name: 'ViduQ3 Pro',
    type: 'video',
    providerId: 'antsk',
    endpoint: '/v1/videos',
    description: 'Vidu Q3 Pro 视频生成（通过 BigBanana API）',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      mode: 'async' as VideoMode,
      defaultAspectRatio: '16:9' as AspectRatio,
      supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[],
      defaultDuration: 8 as VideoDuration,
      supportedDurations: [4, 8, 12] as VideoDuration[],
    },
  },
  // ========== 万象 (Wan) ==========
  // 使用 DashScope 原生适配器（通过本地代理解决 CORS）
  // img_url 支持直接传入 URL，无需 base64 转换
  {
    id: 'wan2.6-t2v',
    name: '万象 2.6 文生视频',
    type: 'video',
    providerId: 'qwen',
    description: '阿里万象视频生成，支持有声视频（DashScope 原生 API）',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      mode: 'async' as VideoMode,
      defaultAspectRatio: '16:9' as AspectRatio,
      supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[],
      defaultDuration: 8 as VideoDuration,
      supportedDurations: [4, 8, 12] as VideoDuration[],
    },
  },
  {
    id: 'wan2.6-i2v-flash',
    name: '万象 2.6 首帧 Flash',
    type: 'video',
    providerId: 'qwen',
    description: '阿里万象首帧图生视频闪电版（DashScope 原生 API）',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      mode: 'async' as VideoMode,
      defaultAspectRatio: '16:9' as AspectRatio,
      supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[],
      defaultDuration: 4 as VideoDuration,
      supportedDurations: [4, 8] as VideoDuration[],
    },
  },
  {
    id: 'wan2.6-i2v',
    name: '万象 2.6 首帧',
    type: 'video',
    providerId: 'qwen',
    description: '阿里万象首帧图生视频标准版（DashScope 原生 API）',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      mode: 'async' as VideoMode,
      defaultAspectRatio: '16:9' as AspectRatio,
      supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[],
      defaultDuration: 4 as VideoDuration,
      supportedDurations: [4, 8] as VideoDuration[],
    },
  },
  {
    id: 'wan2.2-kf2v-flash',
    name: '万象 2.2 首尾帧 Flash',
    type: 'video',
    providerId: 'qwen',
    description: '阿里万象首尾帧关键帧生视频闪电版（DashScope 原生 API）',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      mode: 'async' as VideoMode,
      defaultAspectRatio: '16:9' as AspectRatio,
      supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[],
      defaultDuration: 4 as VideoDuration,
      supportedDurations: [4, 8] as VideoDuration[],
    },
  },
  {
    id: 'wanx2.1-kf2v-plus',
    name: '万象 2.1 首尾帧 Plus',
    type: 'video',
    providerId: 'qwen',
    description: '阿里万象首尾帧关键帧生视频增强版（DashScope 原生 API）',
    isBuiltIn: true,
    isEnabled: true,
    params: {
      mode: 'async' as VideoMode,
      defaultAspectRatio: '16:9' as AspectRatio,
      supportedAspectRatios: ['16:9', '9:16', '1:1'] as AspectRatio[],
      defaultDuration: 4 as VideoDuration,
      supportedDurations: [4, 8] as VideoDuration[],
    },
  },
];

/**
 * 内置提供商列表
 */
export const BUILTIN_PROVIDERS: ModelProvider[] = [
  {
    id: 'antsk',
    name: 'BigBanana API (api.antsk.cn)',
    baseUrl: 'https://api.antsk.cn',
    apiKeyUrl: 'https://api.antsk.cn',
    isBuiltIn: true,
    isDefault: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'doubao',
    name: '豆包 (火山引擎)',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'qwen',
    name: '通义千问 (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com',
    apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'zhipu',
    name: '智谱 AI (GLM)',
    baseUrl: 'https://open.bigmodel.cn',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai',
    apiKeyUrl: 'https://console.x.ai/',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow (硅基流动)',
    baseUrl: 'https://api.siliconflow.cn',
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'moonshot',
    name: 'Moonshot (月之暗面)',
    baseUrl: 'https://api.moonshot.cn',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    isBuiltIn: true,
    isDefault: false,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
    isBuiltIn: true,
    isDefault: false,
  },
];

/**
 * 所有内置模型
 */
export const ALL_BUILTIN_MODELS: ModelDefinition[] = [
  ...BUILTIN_CHAT_MODELS,
  ...BUILTIN_IMAGE_MODELS,
  ...BUILTIN_VIDEO_MODELS,
];

/**
 * 默认激活模型
 */
export const DEFAULT_ACTIVE_MODELS: ActiveModels = {
  chat: 'gpt-5.1',
  image: 'gemini-3-pro-image-preview',
  video: 'sora-2',
};
