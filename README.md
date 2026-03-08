# AI shotlive Director (AI 漫剧工场)

> **AI 一站式短剧/漫剧生成平台**
> *Industrial AI Motion Comic & Video Workbench*

[![中文](https://img.shields.io/badge/Language-中文-blue.svg)](./README.md)
[![English](https://img.shields.io/badge/Language-English-gray.svg)](./README_EN.md)
[![日本語](https://img.shields.io/badge/Language-日本語-gray.svg)](./README_JA.md)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

**AI shotlive Director** 是面向创作者的 **AI 短剧/漫剧生产平台**，采用 **「小说 → 剧本 → 分镜 → 资产 → 关键帧 → 成片」** 的工业化工作流，支持**多模型提供商**，从灵感到成片一站式完成。

- **前后端分离**：React 前端 + Express 后端，数据持久化于 MySQL，用户隔离。
- **小说与剧本**：支持上传小说文件、自动解析章节，选章生成剧集剧本；也支持直接输入故事/剧本生成分镜。项目设置（标题、体裁、风格等）集成在小说管理页面，一处完成所有配置。
- **分镜与资产**：分镜可编辑（角色、提示词、动作、台词），角色定妆与场景概念图保证画面一致性。
- **关键帧驱动**：首帧/首尾帧控制运镜，多厂商图像与视频模型可选。
- **CutOS AI 剪辑**：集成 CutOS 视频编辑器，支持多轨道时间线、AI Agent 对话式剪辑、视频预览、属性检查与导出。
- **账户管理**：支持修改用户名与密码，点击侧边栏或顶栏用户名即可进入账户设置。
- **数据导出/导入**：系统设置中可将当前用户的全部数据库数据及 `data/` 文件夹媒体文件打包为 ZIP 导出；导入时自动创建新用户，适用于跨服务器迁移或数据备份还原。

---

## 界面展示

### 项目管理
![项目管理](./images/项目管理.png)

### Phase 01: 剧本与分镜
![剧本创作](./images/剧本创作.png)
![剧本与故事](./images/剧本与故事.png)

### Phase 02: 角色与场景资产
![角色场景](./images/角色场景.png)
![场景](./images/场景.png)

### Phase 03: 导演工作台
![导演工作台](./images/导演工作台.png)
![镜头九宫格](./images/镜头九宫格.png)
![镜头与帧](./images/镜头与帧.png)
![镜头与帧1](./images/镜头与帧1.png)

### Phase 04: 成片导出
![成片导出](./images/成片导出.png)

### 模型配置
![模型配置](./images/模型配置.png)

### 提示词管理
![提示词管理](./images/提示词管理.png)

### CutOS AI 剪辑
![AI 剪辑](./images/剪辑.png)

---

## 核心理念：关键帧驱动 (Keyframe-Driven)

- **先画后动**：先生成起始帧与结束帧，再在中间插值生成视频。
- **资产约束**：画面生成受「角色定妆照」和「场景概念图」约束，保证人物与场景一致。
- **多模型支持**：文本/图像/视频可分别选用不同厂商与模型（如 OpenAI、Google、豆包、通义、可灵、万象等）。

---

## 核心功能模块

### Phase 01: 小说与剧本 (Novel & Script)

- **项目管理集成**：项目标题、体裁、风格、语言等配置项集成在小说管理页面，无需切换页面即可完成项目设置。
- **小说 → 剧本**
  - 上传 `.txt` 小说文件，系统按「第 X 章」自动解析章节，支持分页浏览与按需加载。
  - 选择章节创建剧集，AI 将选定章节改编为一集剧本（场次、对话、动作、视觉化描述）。
  - 剧集间数据隔离，各剧本独立管理角色、分镜与资产。
- **故事/剧本输入**：直接粘贴故事大纲或剧本，AI 拆解为场次、时间、气氛与分镜结构。
- **视觉化翻译**：将剧本描述转为绘图提示词，支持设定目标时长与镜头密度。
- **手动编辑**：可编辑角色视觉描述、分镜提示词、分镜内角色列表、动作与台词，精细控制生成效果。

### Phase 02: 资产与选角 (Assets & Casting)

- **角色定妆**：为角色生成参考图；衣橱系统支持多套造型（日常、战斗等），保持面部一致。
- **场景概念**：生成场景参考图，保证同场景下镜头光影统一。
- **道具**：支持道具资产上传与管理。

### Phase 03: 导演工作台 (Director Workbench)

- **分镜表**：网格化管理所有镜头。
- **首帧 / 尾帧**：生成并可选编辑首帧与结束帧，支持首尾帧插值成片。
- **九宫格分镜**：同一镜头 9 个视角预览，可选用整图或单格作为首帧。
- **上下文感知**：生成时自动带入当前场景图与角色服装图，减少「不连戏」。
- **视频模式**：支持单图图生视频 (I2V) 与首尾帧插值，按所选视频模型切换。

### Phase 04: 成片与导出 (Export)

- **时间轴预览**：渲染进度追踪，导出高清关键帧与 MP4 片段。
- **视频剪辑器**：
  - **多轨道**：支持视频、音频、字幕、图片轨道，可自由增加与删除轨道。
  - **右侧资源库**：按剧本/镜头、角色、场景、视频、上传、AI 字幕、AI 音频分类展示，点击即可拖入对应轨道。
  - **上传资源**：支持上传图片、视频、音频文件供剪辑使用。
  - **AI 字幕**：输入文本，AI 整理为字幕格式并加入字幕轨道。
  - **AI 音频**：输入文本，AI 生成配音（TTS）并加入音频轨道。
  - **下载剪辑**：将当前轨道中的视频与图片片段打包为 ZIP 下载。

### CutOS AI 剪辑编辑器

集成自 [CutOS](https://github.com/shamsharoon/CutOS) 项目，提供专业级 AI 辅助视频剪辑能力：

- **可视化时间线**：拖拽式多轨道剪辑，支持裁剪、分割、复制、粘贴、撤销/重做。
- **AI Agent 对话式剪辑**：通过自然语言与 AI Agent 对话，自动执行剪辑操作（裁剪、排序、删除等），支持 dashscope、豆包等 OpenAI 兼容接口。
- **视频预览**：实时预览当前时间线上的视频片段。
- **属性检查器**：选中片段后可查看与编辑属性（时长、位置等）。
- **媒体面板**：从项目资产中导入素材，一键加入时间线。
- **导出**：将剪辑结果导出为最终视频。

### 账户管理

- 点击侧边栏或项目列表页的用户名，打开「账户设置」弹窗。
- 支持修改用户名和密码，修改前需验证当前密码。

### 数据导出与导入

- **导出**：在系统设置中点击「导出数据」，系统将当前用户的全部数据库记录（项目、资产库、视觉风格、模型配置、用户偏好）及 `data/` 文件夹中的媒体文件打包为 ZIP 文件下载。
- **导入**：上传 ZIP 备份文件后，系统自动创建一个新用户并将全部数据导入到该用户名下。导入完成后会提示新用户名和默认密码，用新账号登录即可查看数据。
- 适用于跨服务器/实例数据迁移、定期备份与灾难恢复。

---

## 多模型支持

项目支持**多模型提供商**，文本、图像、视频可分别配置 API Key 与当前使用模型。

| 类型 | 支持厂商示例 |
|------|----------------|
| **文本 (Chat)** | OpenAI、Anthropic、DeepSeek、豆包、通义千问、智谱、Google Gemini、xAI、AntSK、SiliconFlow、Moonshot、OpenRouter 等 |
| **图像 (Image)** | Google Gemini、豆包 Seedream、通义万相、可灵 Image（AntSK）等 |
| **视频 (Video)** | Veo 3.1 / Sora-2（AntSK/OpenAI）、豆包 Seedance、可灵、Vidu、万象（通义）等 |
| **音频 (Audio)** | 用于 AI 字幕整理与 TTS 配音，可配置对话模型或 TTS 专用模型 |

- 在 **模型配置** 中为各提供商填写 API Key，并选择当前激活的文本/图像/视频/音频模型。
- 默认推荐使用 [**AntSK API**](https://api.antsk.cn/) 一站式调用多类模型；也可使用各厂商官方 API，按需切换。

---

## 技术架构

| 层级 | 技术 |
|------|------|
| **前端** | React 19, Vite 6, Tailwind CSS 4, Radix UI, Framer Motion |
| **后端** | Express.js, MySQL 8 / SQLite (本地模式), JWT 认证 |
| **AI** | 多厂商文本/图像/视频/音频 API，适配器层统一调用（见 `services/adapters`、`types/model.ts`）；CutOS AI Agent（`@ai-sdk/openai`、`ai`） |
| **存储** | MySQL / SQLite 持久化项目、资产、模型配置、用户偏好；用户数据按 `user_id` 隔离 |
| **桌面** | Electron 33, better-sqlite3, electron-builder (macOS .dmg / Windows .exe) |
| **文件** | 小说上传文件存于 `uploads/`，媒体文件（图片/视频）存于 `data/`，均按用户/项目隔离 |
| **备份** | 支持 ZIP 归档导出/导入（数据库 + 媒体文件），导入时自动创建新用户 |

---

## ⚠️ 开源与使用说明

- **模型与费用**：工作流依赖大语言模型、图像模型、视频模型等，需自行配置相应 API Key 并承担调用费用；项目不绑定单一厂商，可替换为 OpenAI、Google、豆包、通义等。
- **开源目的**：降低使用与集成门槛，代码与模型配置均可修改、扩展。
- 若希望长期「完全免费」使用，本仓库可能不适合；可搭配各厂商免费额度或选用其他产品。

---

## 环境要求

- **Node.js** >= 20
- **MySQL** >= 5.7（推荐 8.0+）— Web 部署模式
- **SQLite**（内置）— 本地/桌面客户端模式，无需额外安装
- **npm** >= 9

---

## 项目启动

### 1. 环境配置

```bash
git clone https://github.com/shuyu-labs/ai-shotlive-Director.git
cd ai-shotlive-Director

npm install
cp .env.example .env
```

编辑 `.env`，配置数据库与 JWT：

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=banana
DB_PASSWORD=banana
DB_NAME=banana

JWT_SECRET=aishotlive_jwt_secret_change_me_in_production
SERVER_PORT=3001
NODE_ENV=development
```

### 2. 初始化数据库与默认用户

首次启动时服务端会**自动建表**。可选：创建默认管理员并导入备份数据：

```bash
# 默认账号 admin / admin123
npx tsx server/src/scripts/seed.ts

# 并导入浏览器导出的项目备份
npx tsx server/src/scripts/seed.ts ./your-backup.json
```

### 3. 启动方式

**本地开发（前端 + 后端同时启动）：**

```bash
npm run dev
# 前端: http://localhost:3000  后端 API: http://localhost:3001
```

**Docker 部署（使用宿主机 MySQL）：**

```bash
docker-compose up -d --build
# 访问: http://localhost:3001
```

**Docker 部署（应用 + MySQL 同栈，无需外部数据库）：**

```bash
docker compose -f docker-compose.mysql.yaml up -d --build
# 访问: http://localhost:3001
```

**生产构建：**

```bash
npm run build
NODE_ENV=production npm start
```

**本地轻量部署（SQLite，无需 MySQL）：**

```bash
npm run build:local
npm run start:local
# 访问: http://localhost:3001
# 数据存储在 data/local.db
```

**其他命令：** `npm run build:client` / `npm run build:server` / `npm run preview`；Docker 无缓存重建：`docker compose build --no-cache && docker compose up -d --force-recreate`。

---

## 桌面客户端打包 (Electron)

桌面客户端基于 Electron 打包，内嵌 SQLite 数据库，双击即用，无需安装 MySQL 或配置服务器。

### 环境要求

- **Node.js** >= 18
- **Xcode Command Line Tools**（macOS 编译 native 模块）：`xcode-select --install`
- **Visual Studio Build Tools**（Windows 编译 native 模块）

### 打包命令

```bash
# 安装依赖（首次或依赖变更后）
npm install --legacy-peer-deps

# 一键编译 + 打包（当前平台）
npm run build:electron

# 仅打包 macOS (.dmg)
npm run build:electron:mac

# 仅打包 Windows (.exe)
npm run build:electron:win
```

### 打包流程

```
npm run build:client          # Vite 编译前端 → dist/
npm run build:server          # tsc 编译服务端 → server/dist/
npm run build:electron-main   # tsc 编译 Electron 入口 → electron/dist/
npx electron-builder          # 打包为安装包 → release/
```

### 产物

| 平台 | 产物 | 架构 |
|------|------|------|
| macOS | `release/AI-ShotLive-{version}-mac-arm64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| macOS | `release/AI-ShotLive-{version}-mac-x64.dmg` | Intel |
| Windows | `release/AI-ShotLive-Setup-{version}-win.exe` | x64 |

### 数据存储位置

桌面客户端的数据与应用分离，存储在用户数据目录下：

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/ai-shotlive-director/` |
| Windows | `%APPDATA%/ai-shotlive-director/` |

包含：`local.db`（SQLite 数据库）、`data/`（媒体文件）、`uploads/`（上传文件）

### 配置与自定义

用户可在数据目录下放置 `.env` 文件覆盖默认配置（如 API Key、JWT 密钥等）。

### 注意事项

- `better-sqlite3` 为 C++ 原生模块，打包时 electron-builder 会自动针对 Electron 版本重新编译
- 跨平台打包 Windows 安装包需在 Windows 环境下执行（或使用 CI）
- 应用图标位于 `electron/icons/`，替换 `icon.png` 后可参考 `electron/icons/README.md` 生成 `.icns` / `.ico`

---

## 项目结构

```
ai-shotlive-Director/
├── .env / .env.example      # 环境变量
├── docker-compose.yaml      # Docker 编排
├── electron-builder.yml     # Electron 打包配置
├── electron/                # Electron 桌面客户端
│   ├── main.ts             # 主进程（启动 Express + BrowserWindow）
│   ├── preload.ts          # 预加载脚本
│   ├── tsconfig.json
│   └── icons/              # 应用图标（.png / .icns / .ico）
├── scripts/                 # 编译脚本
│   ├── build-local.sh      # 本地 SQLite 模式编译
│   └── build-electron.sh   # Electron 桌面客户端编译
├── package.json / vite.config.ts
├── App.tsx, index.tsx, types.ts
├── types/model.ts           # 模型与提供商类型、内置模型列表
├── components/              # 前端组件
│   ├── Login.tsx, Dashboard.tsx, Sidebar.tsx, ProfileModal.tsx
│   ├── StageScript/         # Phase 01：小说/剧集/故事/剧本与分镜
│   │   ├── NovelManager.tsx # 小说上传、章节解析与项目配置
│   │   ├── EpisodeManager.tsx # 剧集与剧本生成
│   │   ├── ScriptEditor.tsx, SceneBreakdown.tsx, ConfigPanel.tsx
│   ├── StageAssets/         # Phase 02：角色/场景/道具资产
│   ├── StageDirector/       # Phase 03：导演工作台与关键帧
│   ├── StageExport/         # Phase 04：成片导出
│   │   └── CutOSEditor/    # CutOS AI 剪辑编辑器
│   │       ├── editor-shell.tsx, editor-context.tsx
│   │       ├── timeline.tsx, video-preview.tsx, media-panel.tsx
│   │       ├── inspector-panel.tsx, export-modal.tsx, auto-enhance-modal.tsx
│   │       └── ui/          # 编辑器 UI 组件
│   ├── StagePrompts/        # 提示词管理
│   ├── ModelConfig/         # 模型配置（多提供商、API Key、激活模型）
│   ├── VisualStyleManager.tsx # 视觉风格管理
│   └── Onboarding/
├── contexts/                # AuthContext, ThemeContext
├── services/                # 前端服务
│   ├── apiClient.ts, storageService.ts
│   ├── modelRegistry.ts, modelConfigService.ts
│   ├── novelParser.ts       # 小说章节解析
│   ├── ai/
│   │   ├── novelScriptService.ts  # 小说 → 剧集剧本
│   │   ├── scriptService.ts, visualService.ts, shotService.ts, videoService.ts
│   │   └── apiCore.ts, promptConstants.ts
│   ├── adapters/            # chat / image / video 多厂商适配器
│   └── projectPatchService.ts, taskService.ts, exportService.ts 等
├── server/                  # Express 后端
│   └── src/
│       ├── index.ts
│       ├── config/database.ts, sqliteDatabase.ts
│       ├── middleware/auth.ts
│       ├── routes/
│       │   ├── auth.ts      # 登录/注册/资料修改
│       │   ├── ai.ts
│       │   ├── projects.ts, assets.ts, models.ts
│       │   ├── uploads.ts   # 小说等文件上传
│       │   ├── tasks.ts     # 异步任务（图像/视频生成）
│       │   ├── dataTransfer.ts # 数据导出/导入（ZIP 归档）
│       │   ├── projectPatch.ts
│       │   ├── visualStyles.ts # 视觉风格管理
│       │   ├── cutosAgent.ts   # CutOS AI Agent / 转录 / 字幕
│       │   └── preferences.ts
│       ├── services/        # taskRunner, projectStorage, aiProxy 等
│       ├── lib/cutos/agent/ # CutOS Agent 工具与系统提示
│       └── scripts/seed.ts
├── data/                    # 媒体文件（图片/视频），按项目隔离
└── uploads/                 # 用户上传文件（按用户隔离）
```

---

## 数据库设计

| 表名 | 说明 | 用户隔离 |
|------|------|---------|
| `users` | 用户账号（支持修改用户名/密码） | - |
| `projects` | 项目元数据（标题、阶段、风格、小说配置等） | 按 user_id |
| `novel_chapters` | 小说章节（上传解析后按章存储） | 按 user_id |
| `novel_episodes` | 剧集（章节范围、生成的剧本、状态） | 按 user_id |
| `script_characters` | 角色（名称、性别、视觉描述、参考图等） | 按 user_id + episode_id |
| `character_variations` | 角色变体/衣橱（多套造型） | 按 user_id + episode_id |
| `script_scenes` | 场景（地点、时段、氛围、概念图） | 按 user_id + episode_id |
| `script_props` | 道具（分类、描述、参考图） | 按 user_id + episode_id |
| `story_paragraphs` | 故事段落与场景关联 | 按 user_id + episode_id |
| `shots` | 镜头（动作、对话、镜头尺寸、九宫格等） | 按 user_id + episode_id |
| `shot_keyframes` | 关键帧（首帧/尾帧、提示词、图像） | 按 user_id + episode_id |
| `shot_video_intervals` | 视频片段（起止帧、时长、视频 URL） | 按 user_id + episode_id |
| `generation_tasks` | 异步生成任务（图像/视频生成进度追踪） | 按 user_id |
| `render_logs` | 渲染日志 | 按 user_id + episode_id |
| `asset_library` | 共享资产库 | 按 user_id |
| `model_registry` | 模型配置（提供商、API Key、激活模型） | 按 user_id |
| `user_preferences` | 主题、引导状态等 | 按 user_id |
| `visual_styles` | 视觉风格与提示词配置 | 按 user_id |

> 剧集内数据（角色、场景、镜头等）通过 `episode_id` 隔离，支持同一项目下多集剧本独立管理。
> 导出/导入功能覆盖以上所有用户关联表及 `data/` 文件夹中的媒体文件。

---

## 快速开始

1. **登录**：使用默认账号（admin / admin123）或注册新用户。可点击用户名修改账户信息。
2. **配置模型**：在「模型配置」中为需要的厂商填写 API Key，并选择当前文本/图像/视频模型。
3. **项目与剧本**：
   - **小说**：Phase 01 小说管理页面同时管理项目配置（标题、体裁、风格等），上传 `.txt` 小说 → 解析章节 → 选择章节创建剧集 → 生成该集剧本；
   - **故事/剧本**：直接粘贴故事或剧本 → 生成分镜脚本。
4. **资产**：Phase 02 生成角色定妆与场景概念图。
5. **分镜与成片**：Phase 03 生成首帧（及可选尾帧），可选九宫格选构图，再选视频模型生成片段；Phase 04 预览与导出。
6. **视频剪辑**：在成片导出页打开视频剪辑器，从资源库拖入素材到多轨道，使用 AI 字幕/音频增强，最后下载剪辑后的视频。

---

## 客户端下载

下载安装包即可使用，无需搭建开发环境：

- **macOS (Apple Silicon)**: [下载 .dmg](https://github.com/sorker/ai-shotlive/releases)
- **macOS (Intel)**: [下载 .dmg](https://github.com/sorker/ai-shotlive/releases)
- **Windows**: [下载 .exe](https://github.com/sorker/ai-shotlive/releases)

> 查看 [Releases](https://github.com/sorker/ai-shotlive/releases) 获取所有版本。

---

## 致谢

本项目参考以下开源项目修改而来，提供前后端分离和用户服务。感谢各位原作者的开源贡献：

- [BigBanana-AI-Director](https://github.com/shuyu-labs/BigBanana-AI-Director) — 核心工作流与项目架构参考
- [CutOS](https://github.com/shamsharoon/CutOS) — AI 视频剪辑编辑器（CutOS AI 剪辑模块）
- [CineGen-AI](https://github.com/Will-Water/CineGen-AI) — 分镜生成与关键帧驱动工作流
- [Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) — 漫剧生成流程参考

---

## 许可证

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — 允许个人与非商业使用及在相同许可下修改与二次创作；

*Built for Creators, by AiShotlive.*
