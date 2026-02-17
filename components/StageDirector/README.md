# StageDirector 组件重构说明

## 📋 重构概述

将原本 **1418 行**的单体组件 StageDirector 重构为模块化架构，拆分为 **11 个独立模块**，主组件精简至约 **450 行**（减少 68%）。

## 🎯 重构目标

- ✅ **提高可维护性**：将超大组件拆分为职责清晰的小模块
- ✅ **消除代码重复**：统一三个重复的编辑弹窗（ModalOverlay）
- ✅ **提升可复用性**：创建通用组件如 EditModal、ShotCard
- ✅ **优化代码组织**：分离配置、工具函数与 UI 组件
- ✅ **保持向后兼容**：不改变任何现有功能和对外接口

## 📁 新目录结构

```
components/
└── StageDirector/
    ├── index.tsx                    # 主组件 (~450行)
    ├── cameraMovementGuides.ts      # 镜头运动配置 (157行)
    ├── constants.ts                 # 常量和样式配置 (95行)
    ├── utils.ts                     # 工具函数集 (130行)
    ├── EditModal.tsx                # 通用编辑弹窗 (70行)
    ├── ShotCard.tsx                 # 镜头缩略卡片 (68行)
    ├── SceneContext.tsx             # 场景上下文信息 (133行)
    ├── KeyframeEditor.tsx           # 关键帧编辑器 (142行)
    ├── VideoGenerator.tsx           # 视频生成器 (99行)
    ├── ImagePreviewModal.tsx        # 图片预览弹窗 (44行)
    ├── ShotWorkbench.tsx            # 集成工作台面板 (165行)
    └── README.md                    # 文档说明
```

## 🔄 模块详解

### 1. **cameraMovementGuides.ts** - 镜头运动配置

**功能**：27种电影镜头运动类型及其构图指南

**提取原因**：
- 原本 150 行的配置对象嵌入在组件中
- 配置数据与业务逻辑混合

**优势**：
- 独立维护镜头运动库
- 支持 TypeScript 类型提示
- 便于扩展新的运动类型

**使用示例**：
```typescript
import { cameraMovementGuides } from './cameraMovementGuides';

const guide = cameraMovementGuides.find(g => g.value === 'tracking-shot');
console.log(guide?.compositionGuide); // 输出构图指南
```

---

### 2. **constants.ts** - 常量和样式配置

**包含内容**：
- 样式常量（STYLES）- 卡片、按钮、徽章样式
- 视觉风格提示词（VISUAL_STYLE_PROMPTS）
- 视频模型默认值（VIDEO_TEMPLATES）
- 默认配置（DEFAULTS）

**提取原因**：
- 样式字符串散布在组件各处
- 配置值硬编码在逻辑中

**优势**：
- 集中管理样式和配置
- 便于主题定制
- 减少魔法数字

---

### 3. **utils.ts** - 工具函数集

**包含函数**：
- `getRefImagesForShot()` - 收集参考图片
- `buildKeyframePrompt()` - 构建关键帧提示词
- `buildVideoPrompt()` - 构建视频提示词
- `extractBasePrompt()` - 提取基础提示词
- `generateId()` - 生成唯一 ID
- `delay()` - 延迟函数
- `convertImageToBase64()` - 图片转 base64
- `createKeyframe()` - 创建关键帧对象
- `updateKeyframeInShot()` - 更新镜头中的关键帧

**提取原因**：
- 复杂的字符串拼接逻辑分散在组件中
- 重复的数据转换代码

**优势**：
- 纯函数易于测试
- 提高代码复用性
- 降低主组件复杂度

---

### 4. **EditModal.tsx** - 通用编辑弹窗

**功能**：统一的编辑弹窗组件

**替代内容**：原组件中三个重复的 `ModalOverlay` 实现（~300行）

**Props**：
```typescript
interface EditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  title: string;
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  textareaClassName?: string;
}
```

**使用示例**：
```typescript
<EditModal
  isOpen={isEditing}
  onClose={() => setIsEditing(false)}
  onSave={handleSave}
  title="编辑叙事动作"
  icon={<Film />}
  value={currentValue}
  onChange={setValue}
/>
```

**优势**：
- 消除 83% 的重复代码
- 统一编辑体验
- 易于扩展新的编辑类型

---

### 5. **ShotCard.tsx** - 镜头缩略卡片

**功能**：网格视图中的镜头卡片

**显示内容**：
- 镜头序号
- 起始帧缩略图
- 镜头描述
- 视频生成状态
- 角色数量

**Props**：
```typescript
interface ShotCardProps {
  shot: Shot;
  index: number;
  isActive: boolean;
  onClick: () => void;
}
```

**优势**：
- 独立的展示逻辑
- 支持不同布局模式
- 易于添加交互功能

---

### 6. **SceneContext.tsx** - 场景上下文信息

**功能**：显示并管理当前镜头的场景信息

**包含内容**：
- 镜头导航（上一个/下一个）
- 叙事动作编辑
- 角色管理（添加/移除）
- 角色变体选择

**Props**：
```typescript
interface SceneContextProps {
  shot: Shot;
  shotIndex: number;
  totalShots: number;
  scriptData?: ScriptData;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onEditActionSummary: () => void;
  onAddCharacter: (charId: string) => void;
  onRemoveCharacter: (charId: string) => void;
  onVariationChange: (charId: string, varId: string) => void;
}
```

**优势**：
- 场景信息集中管理
- 清晰的角色关系展示
- 独立的交互逻辑

---

### 7. **KeyframeEditor.tsx** - 关键帧编辑器

**功能**：管理起始帧和结束帧

**包含操作**：
- 生成关键帧（AI）
- 上传自定义图片
- 编辑提示词
- 复制上一镜头结束帧

**Props**：
```typescript
interface KeyframeEditorProps {
  shot: Shot;
  showCopyPrevious: boolean;
  onGenerate: (type: 'start' | 'end') => void;
  onUpload: (type: 'start' | 'end') => void;
  onEditPrompt: (type: 'start' | 'end', prompt: string) => void;
  onCopyPrevious: () => void;
  onImageClick: (url: string, title: string) => void;
}
```

**优势**：
- 起始帧和结束帧逻辑统一
- 状态展示清晰（生成中/失败/完成）
- 支持多种输入方式

---

### 8. **VideoGenerator.tsx** - 视频生成器

**功能**：视频生成和预览

**包含内容**：
- 视频模型选择
- 视频提示词编辑
- 生成按钮
- 视频预览播放器

**Props**：
```typescript
interface VideoGeneratorProps {
  shot: Shot;
  onGenerate: () => void;
  onModelChange: (model: string) => void;
  onEditPrompt: () => void;
}
```

**优势**：
- 视频生成流程独立
- 支持不同模型切换
- 状态反馈直观

---

### 9. **ImagePreviewModal.tsx** - 图片预览弹窗

**功能**：全屏图片预览

**Props**：
```typescript
interface ImagePreviewModalProps {
  imageUrl: string | null;
  title?: string;
  onClose: () => void;
}
```

**优势**：
- 轻量级独立组件
- 支持点击关闭
- 带标题显示

---

### 10. **ShotWorkbench.tsx** - 集成工作台面板

**功能**：右侧工作台集成界面

**集成组件**：
- SceneContext - 场景信息
- KeyframeEditor - 关键帧编辑
- VideoGenerator - 视频生成

**Props**：整合所有子组件的 Props

**优势**：
- 统一的工作流界面
- 模块化的布局结构
- 便于整体调整样式

---

### 11. **index.tsx** - 主组件

**职责**：
- 状态管理（镜头选择、批量进度、编辑状态）
- 业务逻辑协调（生成、上传、保存）
- 子组件编排

**精简内容**：
- 移除了 300 行重复的弹窗代码
- 提取了 150 行的配置数据
- 抽离了 200 行的工具函数
- 分离了 500+ 行的 UI 组件

**保留功能**：
- 批量生成首帧
- 镜头切换
- 编辑保存逻辑
- 错误处理

---

## 🎨 重构前后对比

| 指标 | 重构前 | 重构后 | 改进 |
|------|--------|--------|------|
| **主组件行数** | 1418 行 | ~450 行 | 减少 68% |
| **最大函数复杂度** | 80+ 行 | 30 行 | 降低 62% |
| **重复代码** | 3 个重复弹窗（300 行） | 1 个通用组件（70 行） | 减少 83% |
| **配置维护** | 混在组件中 | 独立文件 | 集中管理 |
| **模块数量** | 1 个文件 | 11 个模块 | 职责分离 |
| **可测试性** | 困难 | 简单 | 函数可独立测试 |

## 🔧 向后兼容性

重构保持 100% 向后兼容：

```typescript
// 原有导入方式仍然有效
import StageDirector from './components/StageDirector';

// 内部实现完全重构，但对外接口不变
<StageDirector 
  project={project} 
  updateProject={updateProject}
  onApiKeyError={handleApiKeyError}
/>
```

## 📦 使用建议

### 1. **添加新的镜头运动类型**
编辑 `cameraMovementGuides.ts`：
```typescript
export const cameraMovementGuides: CameraMovementGuide[] = [
  // ...现有类型
  {
    value: 'new-movement',
    label: '新镜头运动',
    description: '描述...',
    compositionGuide: '构图提示...'
  }
];
```

### 2. **修改样式主题**
编辑 `constants.ts` 中的 `STYLES` 对象：
```typescript
export const STYLES = {
  card: {
    base: 'bg-zinc-900 border-zinc-700', // 修改基础样式
    // ...
  }
};
```

### 3. **扩展工具函数**
在 `utils.ts` 中添加新函数：
```typescript
export const myCustomFunction = (param: string): string => {
  // 自定义逻辑
  return result;
};
```

### 4. **创建新的编辑类型**
复用 `EditModal` 组件：
```typescript
<EditModal
  isOpen={isOpen}
  onClose={handleClose}
  onSave={handleSave}
  title="新编辑类型"
  icon={<MyIcon />}
  value={value}
  onChange={setValue}
  placeholder="输入内容..."
/>
```

## 🚀 未来优化方向

- [ ] 添加单元测试（utils.ts 中的纯函数）
- [ ] 使用 Context API 减少 prop drilling
- [ ] 考虑引入状态管理库（Zustand/Jotai）
- [ ] 实现镜头拖拽排序功能
- [ ] 优化大量镜头的渲染性能（虚拟滚动）

## 📝 总结

通过模块化重构，StageDirector 组件从单体架构转变为清晰的模块化架构：

✅ **可维护性**：每个模块职责单一，便于理解和修改  
✅ **可复用性**：通用组件可在其他地方使用  
✅ **可扩展性**：新功能可以独立添加而不影响现有代码  
✅ **可测试性**：工具函数和组件可以独立测试  
✅ **可读性**：主组件逻辑清晰，代码量减少 68%  

重构遵循单一职责原则、开闭原则，显著提升了代码质量和开发体验。
