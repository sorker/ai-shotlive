# StageScript 组件重构说明

## 📋 重构概述

将原本 **1118 行**的单体组件 StageScript 重构为模块化架构，拆分为 **10 个独立模块**，主组件精简至约 **330 行**（减少 70%）。

## 🎯 重构目标

- ✅ **消除重复代码**：统一6组分散的编辑状态管理
- ✅ **提取通用组件**：3个重复的配置选择器合并为1个
- ✅ **分离关注点**：配置、编辑、展示逻辑独立
- ✅ **提升可维护性**：每个模块职责单一，易于理解和修改
- ✅ **保持向后兼容**：不改变任何现有功能和对外接口

## 📁 新目录结构

```
components/
└── StageScript/
    ├── index.tsx                    # 主组件 (~330行)
    ├── constants.ts                 # 配置常量 (70行)
    ├── utils.ts                     # 工具函数 (55行)
    ├── OptionSelector.tsx           # 通用选项选择器 (95行)
    ├── InlineEditor.tsx             # 内联编辑器 (65行)
    ├── ConfigPanel.tsx              # 项目配置面板 (125行)
    ├── ScriptEditor.tsx             # 剧本编辑器 (85行)
    ├── CharacterList.tsx            # 角色列表 (55行)
    ├── SceneList.tsx                # 场景列表 (30行)
    ├── ShotRow.tsx                  # 镜头行组件 (245行)
    ├── SceneBreakdown.tsx           # 场景分解视图 (140行)
    └── README.md                    # 文档说明
```

## 🔄 模块详解

### 1. **constants.ts** - 配置常量

**包含内容**：
- `DURATION_OPTIONS` - 时长选项
- `LANGUAGE_OPTIONS` - 语言选项
- `MODEL_OPTIONS` - 模型选项
- `VISUAL_STYLE_OPTIONS` - 视觉风格选项
- `STYLES` - 统一样式类名
- `DEFAULTS` - 默认值配置

**提取原因**：
- 4 个大型配置数组原本硬编码在组件中
- 样式类名字符串重复出现

**优势**：
- 集中管理所有配置项
- 便于添加新选项
- 统一样式主题

---

### 2. **utils.ts** - 工具函数

**包含函数**：
- `getFinalValue()` - 处理自定义选项
- `deduplicateScenes()` - 场景去重
- `getTextStats()` - 文本统计
- `validateConfig()` - 配置验证

**提取原因**：
- 3 个相似的 `getFinal*()` 函数重复
- 场景去重逻辑混在渲染中

**优势**：
- 纯函数易于测试
- 提高代码复用性
- 简化主组件逻辑

---

### 3. **OptionSelector.tsx** - 通用选项选择器

**功能**：统一的配置选择器组件

**替代内容**：原组件中 3 个重复的选择器 UI（Duration、Model、Visual Style）

**Props**：
```typescript
interface Props {
  label: string;
  icon?: React.ReactNode;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  customInput?: string;
  onCustomInputChange?: (value: string) => void;
  customPlaceholder?: string;
  gridCols?: 1 | 2;
  helpText?: string;
  helpLink?: { text: string; url: string };
}
```

**优势**：
- 消除 200+ 行重复代码
- 统一交互体验
- 支持自定义输入和帮助提示

---

### 4. **InlineEditor.tsx** - 内联编辑器

**功能**：统一的内联编辑组件

**替代内容**：原组件中 4 处重复的编辑表单（textarea + 保存/取消按钮）

**Props**：
```typescript
interface Props {
  isEditing: boolean;
  value: string;
  displayValue?: string;
  onEdit: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  italic?: boolean;
  showEditButton?: boolean;
  emptyText?: string;
}
```

**优势**：
- 统一编辑交互模式
- 支持多种显示样式（mono、italic）
- 减少 80% 编辑表单代码

---

### 5. **ConfigPanel.tsx** - 项目配置面板

**功能**：左侧配置面板

**集成内容**：
- 项目标题输入
- 语言选择下拉框
- 4 个配置选择器（Duration、Model、Visual Style）
- 生成按钮和错误提示

**优势**：
- 配置逻辑独立
- 便于整体调整布局
- 易于添加新配置项

---

### 6. **ScriptEditor.tsx** - 剧本编辑器

**功能**：右侧剧本编辑区

**包含内容**：
- 编辑器工具栏（AI续写、AI改写）
- Markdown 文本编辑区
- 状态栏（字符数、行数）

**优势**：
- 编辑器逻辑独立
- 文本统计自动化
- 易于扩展新功能

---

### 7. **CharacterList.tsx** - 角色列表

**功能**：侧边栏角色展示和编辑

**包含内容**：
- 角色卡片列表
- 视觉描述编辑

**优势**：
- 角色管理独立
- 复用 InlineEditor 组件
- 清晰的数据流

---

### 8. **SceneList.tsx** - 场景列表

**功能**：侧边栏场景展示

**特性**：
- 自动去重（通过 utils）
- 简洁的列表展示

**优势**：
- 轻量级独立组件
- 去重逻辑复用

---

### 9. **ShotRow.tsx** - 镜头行组件

**功能**：单个镜头的完整展示和编辑

**包含内容**：
- 镜头编号和技术参数
- 动作描述和台词编辑
- 角色管理（添加/移除）
- 画面提示词编辑

**优势**：
- 镜头相关逻辑封装
- 复用 InlineEditor 组件
- 响应式设计（移动端/桌面端）

---

### 10. **SceneBreakdown.tsx** - 场景分解视图

**功能**：分镜脚本展示页面

**集成组件**：
- CharacterList - 角色侧边栏
- SceneList - 场景侧边栏
- ShotRow - 镜头行列表

**优势**：
- 清晰的页面结构
- 模块化的布局组件
- 便于整体样式调整

---

### 11. **index.tsx** - 主组件

**职责**：
- 状态管理（配置、编辑状态）
- 业务逻辑协调（AI 生成、编辑保存）
- 视图切换（story / script）
- 子组件编排

**精简内容**：
- 移除了 200+ 行重复的选择器代码
- 提取了 70 行的配置数据
- 抽离了 55 行的工具函数
- 分离了 500+ 行的 UI 组件

**保留功能**：
- 剧本分析生成
- AI续写/改写
- 编辑状态管理
- 项目配置持久化

---

## 🎨 重构前后对比

| 指标 | 重构前 | 重构后 | 改进 |
|------|--------|--------|------|
| **主组件行数** | 1118 行 | ~330 行 | 减少 70% |
| **配置选择器** | 3 处重复（~200 行） | 1 个通用组件（95 行） | 减少 50% |
| **编辑表单** | 4 处重复（~150 行） | 1 个通用组件（65 行） | 减少 55% |
| **编辑状态** | 6 组分散的 useState | 统一管理 | 易于维护 |
| **模块数量** | 1 个文件 | 10 个模块 | 职责分离 |
| **配置维护** | 混在组件中 | 独立文件 | 集中管理 |

## 🔧 向后兼容性

重构保持 100% 向后兼容：

```typescript
// 原有导入方式仍然有效
import StageScript from './components/StageScript';

// 内部实现完全重构，但对外接口不变
<StageScript 
  project={project} 
  updateProject={updateProject}
/>
```

## 📦 使用建议

### 1. **添加新的配置选项**
编辑 `constants.ts`：
```typescript
export const MODEL_OPTIONS = [
  // ...现有选项
  { label: '新模型', value: 'new-model' }
];
```

### 2. **修改默认配置**
编辑 `constants.ts` 中的 `DEFAULTS`：
```typescript
export const DEFAULTS = {
  duration: '120s',  // 修改默认时长
  language: 'English',
  model: 'gpt-5.2',
  visualStyle: 'anime'
};
```

### 3. **添加新的工具函数**
在 `utils.ts` 中添加：
```typescript
export const myHelper = (param: string): string => {
  // 自定义逻辑
  return result;
};
```

### 4. **创建新的编辑类型**
复用 `InlineEditor` 组件：
```typescript
<InlineEditor
  isEditing={isEditing}
  value={value}
  onEdit={handleEdit}
  onChange={setValue}
  onSave={handleSave}
  onCancel={handleCancel}
  mono={true}
  rows={6}
/>
```

## 🚀 未来优化方向

- [ ] 添加单元测试（utils.ts 中的纯函数）
- [ ] 使用 Context API 减少 prop drilling
- [ ] 实现撤销/重做功能
- [ ] 添加键盘快捷键支持
- [ ] 优化大量镜头的渲染性能

## 📝 总结

通过模块化重构，StageScript 组件从单体架构转变为清晰的模块化架构：

✅ **可维护性**：每个模块职责单一，便于理解和修改  
✅ **可复用性**：通用组件可在其他地方使用  
✅ **可扩展性**：新功能可以独立添加而不影响现有代码  
✅ **可测试性**：工具函数和组件可以独立测试  
✅ **可读性**：主组件逻辑清晰，代码量减少 70%  

重构遵循单一职责原则、DRY 原则，显著提升了代码质量和开发体验。

## 📊 模块依赖图

```
index.tsx
├── constants.ts
├── utils.ts
├── ConfigPanel.tsx
│   ├── constants.ts
│   └── OptionSelector.tsx
│       └── constants.ts
├── ScriptEditor.tsx
│   └── constants.ts
└── SceneBreakdown.tsx
    ├── utils.ts
    ├── CharacterList.tsx
    │   └── InlineEditor.tsx
    ├── SceneList.tsx
    └── ShotRow.tsx
        ├── constants.ts
        └── InlineEditor.tsx
```

---

**重构完成时间**: 2025年12月20日  
**重构效果**: 主组件代码量减少 70%，创建 10 个可复用模块，消除所有重复代码
