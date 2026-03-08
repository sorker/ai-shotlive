# AI shotlive Director

> **AI-Powered End-to-End Short Drama & Motion Comic Platform**

[![中文](https://img.shields.io/badge/Language-中文-gray.svg)](./README.md)
[![English](https://img.shields.io/badge/Language-English-blue.svg)](./README_EN.md)
[![日本語](https://img.shields.io/badge/Language-日本語-gray.svg)](./README_JA.md)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

**AI shotlive Director** is an **AI-powered, one-stop platform** for **short dramas** and **motion comics**, built for creators who want to go from idea to final video fast.

Moving away from the traditional "slot machine" style of random generation, AiShotlive adopts an industrial **"Script-to-Asset-to-Keyframe"** workflow. With deep integration of AntSK API’s advanced AI models, it enables **one-sentence to complete drama** — fully automated from **script** to **final video**, while maintaining precise control over character consistency, scene continuity, and camera movement.
## UI Showcase

### Project Management
![Project Management](./images/项目管理.png)

### Phase 01: Script & Storyboard
![Script Creation](./images/剧本创作.png)
![Script & Story](./images/剧本与故事.png)

### Phase 02: Character & Scene Assets
![Character & Scene](./images/角色场景.png)
![Scenes](./images/场景.png)

### Phase 03: Director Workbench
![Director Workbench](./images/导演工作台.png)
![Nine-Grid Storyboard](./images/镜头九宫格.png)
![Shots & Frames](./images/镜头与帧.png)
![Shots & Frames Detail](./images/镜头与帧1.png)

### Phase 04: Export
![Export](./images/成片导出.png)

### Prompt Management
![Prompt Management](./images/提示词管理.png)
## Core Philosophy: Keyframe-Driven

Traditional Text-to-Video models often struggle with specific camera movements and precise start/end states. AiShotlive introduces the animation concept of **Keyframes**:

1.  **Draw First, Move Later**: First, generate precise Start and End frames.
2.  **Interpolation**: Use the Veo model to generate smooth video transitions between these two frames.
3.  **Asset Constraint**: All visual generation is strictly constrained by "Character Sheets" and "Scene Concepts" to prevent hallucinations or inconsistencies.

## Key Features

### Phase 01: Novel & Script
*   **Project Settings Integrated**: Project title, genre, visual style, language and other settings are managed directly in the Novel Management page — no page switching needed.
*   **Novel → Script**: Upload `.txt` novel files, auto-parse chapters with pagination support, select chapters to create episodes, and AI adapts them into full scripts.
*   **Episode Isolation**: Each episode maintains independent data for characters, storyboards, and assets.
*   **Intelligent Breakdown**: Input a novel or story outline, and the AI automatically breaks it down into a standard script structure (Scenes, Time, Atmosphere).
*   **Visual Translation**: Automatically converts text descriptions into professional visual prompts.
*   **Pacing Control**: Set target durations (e.g., 30s Teaser, 3min Short), and the AI plans shot density accordingly.
*   **Manual Editing**: Edit character visual descriptions, shot prompts, character lists, action descriptions and dialogues for each shot.

### Phase 02: Assets & Casting
*   **Character Consistency**:
    *   Generate standard Reference Images for every character.
    *   **Wardrobe System**: Support for multiple looks (e.g., Casual, Combat, Injured) while maintaining facial identity based on a Base Look.
*   **Set Design**: Generate environmental reference images to ensure lighting consistency across different shots in the same location.

### Phase 03: Director Workbench
*   **Grid Storyboard**: Manage all shots in a panoramic view.
*   **Precise Control**:
    *   **Start Frame**: The strictly consistent starting image of the shot.
    *   **End Frame**: (Optional) Define the state at the end of the shot (e.g., character turns head, lighting shifts).
*   **Nine-Grid Storyboard Preview (NEW)**:
    *   Split one shot into 9 viewpoints, review/edit panel descriptions, then generate the 3x3 storyboard image.
    *   Use the whole grid as the start frame, or crop a selected panel as the start frame.
*   **Context Awareness**: When generating shots, the AI automatically reads the Context (Current Scene Image + Character's Specific Outfit Image) to solve continuity issues.
*   **Dual Video Modes**: Supports single-image Image-to-Video and Start/End keyframe interpolation.

### Phase 04: Export
*   **Timeline Preview**: Preview generated motion comic segments in a timeline format.
*   **Render Tracking**: Monitor API render progress in real-time.
*   **Asset Export**: Export all high-def keyframes and MP4 clips for post-production in Premiere/After Effects.

### Account Management
*   Click your username in the sidebar or project list to open Account Settings.
*   Change username and password after verifying your current password.

### Data Export & Import
*   **Export**: From System Settings, export the current user's entire database (projects, assets, visual styles, model config, preferences) plus all media files from the `data/` folder as a single ZIP archive.
*   **Import**: Upload a ZIP backup file, and the system automatically creates a new user account and imports all data under it. The new username and default password are displayed upon completion.
*   Ideal for cross-server migration, periodic backups, and disaster recovery.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, Vite 6, Tailwind CSS 4, Radix UI, Framer Motion |
| **Backend** | Express.js, MySQL 8 / SQLite (local mode), JWT authentication |
| **AI** | Multi-provider text/image/video/audio API with unified adapter layer (see `services/adapters`, `types/model.ts`); CutOS AI Agent (`@ai-sdk/openai`, `ai`) |
| **Storage** | MySQL / SQLite for projects, assets, model configs, and user preferences; user data isolated by `user_id` |
| **Desktop** | Electron 33, better-sqlite3, electron-builder (macOS .dmg / Windows .exe) |
| **Files** | Novel uploads in `uploads/`, media files (images/videos) in `data/`, isolated by user/project |
| **Backup** | ZIP archive export/import (database + media files); import auto-creates a new user |

## Why Choose AntSK API?

This project deeply integrates [**AntSK API Platform**](https://api.antsk.cn/), delivering exceptional value for creators:

### 🎯 Full Model Coverage
* **Text Models**: GPT-5.2, GPT-5.1, Claude 3.5 Sonnet
* **Vision Models**: Gemini 3 Pro, Nano Banana Pro
* **Video Models**: Sora-2, Veo-3.1 (with keyframe interpolation)
* **Unified Access**: Single API for all models, no platform switching

### 💰 Unbeatable Pricing
* **Under 20% of Official Prices**: Save 80%+ on all models
* **Pay-As-You-Go**: No minimum spend, pay only for what you use
* **Enterprise-Grade Reliability**: 99.9% SLA, 24/7 technical support

### 🚀 Developer-Friendly
* **OpenAI-Compatible**: Zero migration cost for existing code
* **Comprehensive Docs**: Full API documentation and code examples
* **Real-Time Monitoring**: Visual usage stats and cost tracking

[**Sign Up for Free Credits**](https://api.antsk.cn/) →

## ⚠️ Open-Source & “Free” Clarification (Please Read)

* **Model usage note**: This open-source project’s default workflow requires a capability-matched model stack, for example an LLM (such as **GPT-5.2**), an image model (such as **Nano Banana Pro**), and a video model (such as **Sora-2** / **Veo-3.1**). If you want to connect other providers or models, you can modify and adapt it yourself.
* **Why we open-sourced this**: Our goal is to lower the barrier to entry and make creation more accessible. The project code is open-source, and model configuration is replaceable.
* **About our API service**: The API we provide is mainly for quick experience and integration, not as a core profit source.
* **Freedom of choice**: If our API does not meet your expectations, you can absolutely use official OpenAI or Google services directly (even at a higher price). That is a normal and respected choice.
* **About “always free” expectations**: If your primary criterion is long-term “must be free,” this project may not be the best fit for you.

---

## 💬 Community & Feedback

Visit our GitHub repository to report issues, request features, and connect with other creators:

**[GitHub: sorker/ai-shotlive](https://github.com/sorker/ai-shotlive)**

---

### 🎨 Lightweight Creation Tools

For **quick one-off creative tasks**, try our online tool platform:

**AiShotlive Creation Studio** offers:
* 📷 **AI Image Generation**: Text-to-image with multiple styles
* 📊 **AI PowerPoint**: Generate presentations instantly
* 🎬 **AI Video**: Intelligent video content generation
* 📱 **Social Media Content**: Viral titles and posts for Xiaohongshu
* 📖 **AI Novel Creation**: Intelligent novel generation and continuation
* 🎨 **AI Anime Generation**: Anime-style image creation
* 🎭 **No Installation**: Use directly in browser, instant access

**Best For**: Daily creation, rapid prototyping, idea validation  
**This Project Is For**: Systematic drama production, batch video generation, industrial workflows

## Client Download

Download the installer and get started right away — no development environment needed:

- **macOS (Apple Silicon)**: [Download .dmg](https://github.com/sorker/ai-shotlive/releases)
- **macOS (Intel)**: [Download .dmg](https://github.com/sorker/ai-shotlive/releases)
- **Windows**: [Download .exe](https://github.com/sorker/ai-shotlive/releases)

> See [Releases](https://github.com/sorker/ai-shotlive/releases) for all available versions.

---

## Requirements

- **Node.js** >= 20
- **MySQL** >= 5.7 (8.0+ recommended) — for web deployment
- **SQLite** (built-in) — for local/desktop mode, no extra installation needed
- **npm** >= 9

---

## Getting Started

### 1. Environment Setup

```bash
git clone https://github.com/shuyu-labs/ai-shotlive-Director.git
cd ai-shotlive-Director

npm install
cp .env.example .env
```

Edit `.env` with your database and JWT configuration:

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

### 2. Database Initialization

The server auto-creates tables on first startup. Optionally seed a default admin user:

```bash
# Default account: admin / admin123
npx tsx server/src/scripts/seed.ts

# Import a project backup
npx tsx server/src/scripts/seed.ts ./your-backup.json
```

### 3. Deployment Options

**Local Development (Frontend + Backend):**

```bash
npm run dev
# Frontend: http://localhost:3000  Backend API: http://localhost:3001
```

**Docker Deployment (with host MySQL):**

```bash
docker-compose up -d --build
# Visit: http://localhost:3001
```

**Docker Deployment (App + MySQL stack, no external DB):**

```bash
docker compose -f docker-compose.mysql.yaml up -d --build
# Visit: http://localhost:3001
```

**Local Lightweight (SQLite, no MySQL required):**

```bash
npm run build:local
npm run start:local
# Visit: http://localhost:3001
# Data stored in data/local.db
```

**Production Build:**

```bash
npm run build
NODE_ENV=production npm start
```

**Other Commands:** `npm run build:client` / `npm run build:server` / `npm run preview`; Docker no-cache rebuild: `docker compose build --no-cache && docker compose up -d --force-recreate`.

---

## Desktop Client Packaging (Electron)

The desktop client is packaged with Electron and includes an embedded SQLite database. It works out of the box — no MySQL or server setup required.

### Requirements

- **Node.js** >= 18
- **Xcode Command Line Tools** (macOS, for native module compilation): `xcode-select --install`
- **Visual Studio Build Tools** (Windows, for native module compilation)

### Build Commands

```bash
# Install dependencies (first time or after changes)
npm install --legacy-peer-deps

# Build + package for current platform
npm run build:electron

# Package for macOS only (.dmg)
npm run build:electron:mac

# Package for Windows only (.exe)
npm run build:electron:win
```

### Build Pipeline

```
npm run build:client          # Vite compiles frontend → dist/
npm run build:server          # tsc compiles server → server/dist/
npm run build:electron-main   # tsc compiles Electron entry → electron/dist/
npx electron-builder          # Package into installer → release/
```

### Output Artifacts

| Platform | Artifact | Architecture |
|----------|----------|-------------|
| macOS | `release/AI-ShotLive-{version}-mac-arm64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| macOS | `release/AI-ShotLive-{version}-mac-x64.dmg` | Intel |
| Windows | `release/AI-ShotLive-Setup-{version}-win.exe` | x64 |

### Data Storage Location

Desktop client data is stored separately from the application:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/ai-shotlive-director/` |
| Windows | `%APPDATA%/ai-shotlive-director/` |

Contains: `local.db` (SQLite database), `data/` (media files), `uploads/` (uploaded files)

### Customization

Place a `.env` file in the data directory to override default settings (e.g., API Keys, JWT secret).

### Notes

- `better-sqlite3` is a native C++ module; electron-builder automatically recompiles it for the target Electron version
- Cross-platform Windows packaging requires a Windows environment (or CI)
- App icons are in `electron/icons/`; replace `icon.png` and follow `electron/icons/README.md` to generate `.icns` / `.ico`

---

## Quick Start

1.  **Login**: Use the default account (admin / admin123) or register a new user. Click your username to update account info.
2.  **Configure Models**: In Model Config, enter API Keys for your preferred providers and select active text/image/video models.
3.  **Project & Script**: In Phase 01, project settings (title, genre, style) are managed alongside the novel. Upload a `.txt` novel → parse chapters → create episodes → generate scripts; or paste a story directly.
4.  **Assets**: Go to Phase 02, generate character sheets and scene concepts.
5.  **Shots & Export**: In Phase 03, generate the Start Frame first; for tighter control, add an End Frame or use the Nine-Grid preview. Phase 04 for preview and export.

---

## Acknowledgements

This project builds upon the following open-source projects, with added frontend-backend separation and user services. Thanks to all original authors for their contributions:

- [BigBanana-AI-Director](https://github.com/shuyu-labs/BigBanana-AI-Director) — Core workflow and project architecture reference
- [CutOS](https://github.com/shamsharoon/CutOS) — AI video editor (CutOS AI editing module)
- [CineGen-AI](https://github.com/Will-Water/CineGen-AI) — Storyboard generation and keyframe-driven workflow
- [Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) — Motion comic generation workflow reference

---

## License

This project is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

- ✅ Personal learning and non-commercial use allowed
- ✅ Modification and derivative works allowed (under the same license)


---
*Built for Creators, by AiShotlive.*
