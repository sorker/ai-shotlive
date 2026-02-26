# CutOS AI 剪辑模块

从 [CutOS](https://github.com/vercel/cutos) 项目迁移的 AI 视频剪辑功能，集成到 ai-shotlive 的成片与导出阶段。

## 迁移说明

- **CutOS 原项目**: Next.js + Supabase，`proxy.ts` 为中间件（Supabase 会话刷新、/projects 路由保护）
- **ai-shotlive**: Vite + Express，无 Supabase，API 通过 `/api/cutos/*` 提供
- **差异与限制**: 详见 `MIGRATION_ANALYSIS.md`

## 已集成内容

### 1. 依赖（已安装）
- framer-motion, @radix-ui/*, react-resizable-panels, clsx, tailwind-merge, class-variance-authority
- 若安装报 peer 冲突，使用：`npm install --legacy-peer-deps`

### 2. Lib 工具（`lib/cutos/`）
- **chromakey.ts** - WebGL 绿幕抠图处理器
- **frame-extractor.ts** - 视频帧提取

### 3. 数据适配器（`projectAdapter.ts`）
- `projectToCutOSTimeline(project)` - 将 ProjectState 的已完成镜头转为 CutOS 时间轴格式

### 4. 完整编辑器（已迁移，无 Supabase）
- **editor-context.tsx** - 本地状态，无 Supabase
- **editor-shell.tsx** - 编辑器外壳
- **timeline.tsx** - 时间轴（拖拽、裁剪、分割）
- **media-panel.tsx** - 媒体库 + 效果面板
- **video-preview.tsx** - 视频预览（含绿幕）
- **export-modal.tsx** - MP4/WebM 导出
- **ui/** - dialog, button, accordion, select, resizable, color-picker 等

### 5. 已集成
- **inspector-panel**（AI Agent、智能增强）- 使用项目已有的 dashscope、豆包等 AI 能力
- Agent API：`POST /api/cutos/agent`，支持 modelConfig（apiBase、apiKey、endpoint、model）

### Morph 转场（已支持）
- 使用万象首尾帧或豆包 Seedance 模型
- 需在模型配置中启用「万象 2.2 首尾帧 Flash」或豆包 Seedance

### 语音转字幕（已支持）
- 使用 qwen3-livetranslate-flash（通义音视频翻译）
- 需配置通义千问 (DashScope) API Key
- 在输入框旁点击麦克风按钮或按 ` 键进行语音输入

### 暂未集成
- TwelveLabs 视频搜索（需 projectId + Supabase 项目，本地模式不可用）
- 配音（dub）、语音分离（isolateVoice）- 需 ElevenLabs 等额外 API