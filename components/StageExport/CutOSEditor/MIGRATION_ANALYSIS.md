# CutOS 迁移分析报告

## 一、CutOS 原项目架构

### 1. proxy.ts（中间件）
- **位置**: `CutOS/proxy.ts`
- **作用**: Next.js 中间件入口，对（几乎）所有请求执行：
  1. 调用 `updateSession`（Supabase）刷新用户 session
  2. 保护 `/projects` 路由：未登录则重定向到首页
- **依赖**: `@/lib/supabase/middleware`（Supabase SSR 客户端）
- **注意**: Next.js 标准中间件文件名为 `middleware.ts`，proxy.ts 可能是自定义命名或需重命名

### 2. 技术栈
| 项目 | CutOS | ai-shotlive |
|------|-------|-------------|
| 框架 | Next.js 16 (App Router) | Vite + React |
| API | Next.js API Routes (`app/api/*`) | Express (`server/src/routes/*`) |
| 认证 | Supabase (cookie session) | JWT (apiClient) |
| react-resizable-panels | **2.1.7** (PanelGroup, PanelResizeHandle) | **2.1.7** (PanelGroup, PanelResizeHandle) ✓ 已对齐 |
| 样式 | Tailwind 语义 token (bg-background, border-border) | CSS 变量 (var(--bg-primary)) |

### 3. CutOS API 路由一览
| 路由 | 用途 | ai-shotlive 对应 |
|------|------|------------------|
| POST /api/agent | AI 剪辑 Agent（OpenAI） | POST /api/cutos/agent ✓ |
| POST /api/transcribe | 视频/音频字幕生成（Whisper） | POST /api/cutos/captions ✓（DashScope qwen3-livetranslate） |
| POST /api/speech-to-text | 语音输入（ElevenLabs） | POST /api/cutos/transcribe（改用 qwen3-livetranslate） |
| POST /api/refine-transcription | 转录文本润色 | 未集成 |
| POST /api/dub | 配音（ElevenLabs） | 未集成 |
| POST /api/remove-noise | 语音分离（ElevenLabs） | 未集成 |
| POST /api/kling | Morph 转场（Kling） | 使用万象/豆包 ✓ |
| POST /api/twelvelabs/index | 视频索引 | 未集成 |
| POST /api/twelvelabs/status | 索引状态 | 未集成 |
| POST /api/twelvelabs/search | NLP 视频搜索 | **缺失** |

### 4. 代理差异
- **CutOS**: 无显式 HTTP 代理，API 为同源 Next.js 路由
- **ai-shotlive**: Vite `proxy` 将 `/api` 转发到 Express `:3001`；另有 `/api/proxy/dashscope`、`/api/proxy/volcengine` 等第三方代理

## 二、迁移方式与不一致点

### 1. 迁移方式
- **组件**: 从 CutOS 复制到 `components/StageExport/CutOSEditor/`，并做适配
- **路径**: `@/` → 相对路径或 `@/`（Vite alias 指向项目根）
- **API**: `/api/xxx` → `/api/cutos/xxx` 或 `/api/xxx`（需后端存在）
- **样式**: `bg-background` 等 → `var(--bg-primary)` 等
- **resizable**: v2 → v4，用 Group/Separator 包装

### 2. 已发现的不一致

| 问题 | 说明 |
|------|------|
| 1. /api/transcribe → /api/cutos/captions | 已修复：editor-context 改为调用 `/api/cutos/captions` |
| 2. TwelveLabs 搜索 | 已修复：projectId 为 null 时提前返回，不发起请求 |
| 3. projectId 为 null | CutOS editor-context 有 projectId（Supabase 项目），ai-shotlive 本地模式无 projectId，TwelveLabs 等依赖 projectId 的功能不可用 |
| 4. 样式 token 混用 | 部分组件仍用 `bg-primary`、`text-primary-foreground` 等 Tailwind 语义类，可能未在 ai-shotlive 主题中定义 |

### 3. UI 界面不一致（与 CutOS 原版对比）

| 组件 | CutOS 原版 | 迁移版 | 修复建议 |
|------|------------|--------|----------|
| **Editor Shell 顶栏** | | | |
| 返回按钮 | "Projects"（带 motion 动效） | "Back"（带 motion） | ✓ 已修复 |
| 项目名 | 可点击编辑 | 静态文本 | 本地模式保持静态 |
| 分辨率 | `project.resolution • project.frame_rate fps` | 从 context `projectResolution` 读取 | ✓ 已修复 |
| 保存/导出 | "Save" / "Saving..." / "Saved" / "Export" | 英文 | ✓ 已修复 |
| Export 按钮 | motion.div 包裹，hover 动效 | 已添加 motion | ✓ 已修复 |
| **Inspector Panel** | | | |
| 标题 | "AI Assistant" | 英文 | ✓ 已修复 |
| 新建对话 | "New Chat" | 英文 | ✓ 已修复 |
| 智能增强 | "Auto Enhance Video" / "AI + Video RAG for smart enhancements" | 英文 | ✓ 已修复 |
| 输入框占位 | "Ask AI to edit your video..." | 英文 | ✓ 已修复 |
| 欢迎语 | "Hi! I'm your AI editing assistant..." | 英文 | ✓ 已修复 |
| 加载/思考 | "Loading chat history..." / "Thinking..." | 英文 | ✓ 已修复 |
| 录音 UI | 脉冲环、声波动画、AnimatePresence | 已恢复完整动效 | ✓ 已修复 |
| 新建对话弹窗 | "Start New Chat?" / "Cancel" / "Start New Chat" | 英文 | ✓ 已修复 |
| **Media Panel** | 英文 | 英文 | 已一致 |
| **样式** | `bg-background`、`border-border`、`bg-card` | `var(--bg-primary)` 等 | 视 ai-shotlive 主题而定 |

## 三、建议修复项

1. **添加 /api/cutos/captions**：实现视频字幕生成（可复用 Whisper 或接入 dashscope 语音识别）
2. **media-panel**：在无 projectId / 无 TwelveLabs 时隐藏或禁用 NLP 搜索
3. **统一样式**：确保所有 CutOS 组件使用 ai-shotlive 的 CSS 变量
4. **README**：更新迁移说明，明确与 CutOS 的差异和限制
5. **UI 对齐 CutOS**：Editor Shell 与 Inspector Panel 的文案、动效、布局与 CutOS 原版保持一致（见上表）
6. **react-resizable-panels v2 布局适配**：已修复。使用 PanelGroup/PanelResizeHandle (v2 API)，defaultSize 为数字 1-100 表示百分比。面板容器需 `min-w-0` 以允许 flex 子项正确收缩；Media/Inspector 面板需使用 ai-shotlive 的 CSS 变量 (--bg-elevated, --border-primary 等) 替代 Tailwind 语义 token
