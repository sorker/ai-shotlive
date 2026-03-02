/**
 * 分镜辅助服务
 * 包含关键帧优化、动作生成、镜头拆分、九宫格分镜等功能
 */

import { AspectRatio, NineGridPanel } from "../../types";
import { addRenderLogWithTokens } from '../renderLogService';
import {
  retryOperation,
  cleanJsonString,
  chatCompletion,
  getActiveChatModel,
} from './apiCore';
import { getStylePromptCN, getStylePrompt } from './promptConstants';
import { ensureStylesLoaded } from '../visualStyleService';
import { generateImage } from './visualService';

// ============================================
// 关键帧优化
// ============================================

/**
 * AI一次性优化起始帧和结束帧视觉描述（推荐使用）
 */
export const optimizeBothKeyframes = async (
  actionSummary: string,
  cameraMovement: string,
  sceneInfo: { location: string; time: string; atmosphere: string },
  characterInfo: string[],
  visualStyle: string,
  model?: string
): Promise<{ startPrompt: string; endPrompt: string }> => {
  console.log('🎨 optimizeBothKeyframes 调用 - 同时优化起始帧和结束帧 - 使用模型:', model || '(active)');
  const startTime = Date.now();

  await ensureStylesLoaded();
  const styleDesc = getStylePromptCN(visualStyle);

  const prompt = `
你是一位专业的电影视觉导演和概念艺术家。请为以下镜头同时创作起始帧和结束帧的详细视觉描述。

## 场景信息
**地点：** ${sceneInfo.location}
**时间：** ${sceneInfo.time}
**氛围：** ${sceneInfo.atmosphere}

## 叙事动作
${actionSummary}

## 镜头运动
${cameraMovement}

## 角色信息
${characterInfo.length > 0 ? characterInfo.join('、') : '无特定角色'}

## 视觉风格
${styleDesc}

## 任务要求

你需要为这个8-10秒的镜头创作**起始帧**和**结束帧**两个关键画面的视觉描述。

### 起始帧要求：
• 建立清晰的初始场景和人物状态
• 为即将发生的动作预留视觉空间和动势
• 设定光影和色调基调
• 展现角色的起始表情、姿态和位置
• 根据镜头运动（${cameraMovement}）设置合适的初始构图
• 营造场景氛围，让观众明确故事的起点

### 结束帧要求：
• 展现动作完成后的最终状态和结果
• 体现镜头运动（${cameraMovement}）带来的视角和构图变化
• 展现角色的情绪变化、最终姿态和位置
• 可以有戏剧性的光影和色彩变化
• 达到视觉高潮或情绪释放点
• 为下一个镜头的衔接做准备

### 两帧协调性：
⚠️ **关键**：起始帧和结束帧必须在视觉上连贯协调
- 保持一致的视觉风格和色调基础
- 镜头运动轨迹要清晰可推导
- 人物/物体的空间位置变化要合理
- 光影变化要有逻辑性
- 两帧描述应该能够自然串联成一个流畅的视觉叙事

### 每帧必须包含的视觉元素：

**1. 构图与景别**
- 根据镜头运动确定画面框架和视角
- 主体在画面中的位置和大小
- 前景、中景、背景的层次关系

**2. 光影与色彩**
- 光源的方向、强度和色温
- 主光、辅光、轮廓光的配置
- 整体色调和色彩情绪（暖色/冷色）
- 阴影的长度和密度

**3. 角色细节**（如有）
- 面部表情和眼神方向
- 肢体姿态和重心分布
- 服装状态和细节
- 与环境的互动关系

**4. 环境细节**
- 场景的具体视觉元素
- 环境氛围（雾气、光束、粒子等）
- 背景的清晰度和景深效果
- 环境对叙事的支持

**5. 运动暗示**
- 动态模糊或静止清晰
- 运动方向的视觉引导
- 张力和动势的体现

**6. 电影感细节**
- 画面质感和材质
- 大气透视效果
- 电影级的视觉特征

## 输出格式

请按以下JSON格式输出（注意：描述文本用中文，每个约100-150字）：

\`\`\`json
{
  "startFrame": "起始帧的详细视觉描述...",
  "endFrame": "结束帧的详细视觉描述..."
}
\`\`\`

❌ 避免：
- 不要在描述中包含"Visual Style:"等标签
- 不要分段或使用项目符号
- 不要过于技术化的术语
- 不要描述整个动作过程，只描述画面本身

✅ 追求：
- 流畅的单段描述
- 富有画面感的语言
- 两帧描述相互呼应、逻辑连贯
- 与叙事动作和镜头运动协调一致
- 具体、可视觉化的细节

请开始创作：
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.7, 2048, 'json_object'));
    const duration = Date.now() - startTime;

    const cleaned = cleanJsonString(result);
    const parsed = JSON.parse(cleaned);

    if (!parsed.startFrame || !parsed.endFrame) {
      throw new Error('AI返回的JSON格式不正确');
    }

    console.log('✅ AI同时优化起始帧和结束帧成功，耗时:', duration, 'ms');

    return {
      startPrompt: parsed.startFrame.trim(),
      endPrompt: parsed.endFrame.trim()
    };
  } catch (error: any) {
    console.error('❌ AI关键帧优化失败:', error);
    throw new Error(`AI关键帧优化失败: ${error.message}`);
  }
};

/**
 * AI优化单个关键帧视觉描述（兼容旧版，建议使用 optimizeBothKeyframes）
 */
export const optimizeKeyframePrompt = async (
  frameType: 'start' | 'end',
  actionSummary: string,
  cameraMovement: string,
  sceneInfo: { location: string; time: string; atmosphere: string },
  characterInfo: string[],
  visualStyle: string,
  model?: string
): Promise<string> => {
  console.log(`🎨 optimizeKeyframePrompt 调用 - ${frameType === 'start' ? '起始帧' : '结束帧'} - 使用模型:`, model || '(active)');
  const startTime = Date.now();

  await ensureStylesLoaded();
  const frameLabel = frameType === 'start' ? '起始帧' : '结束帧';
  const frameFocus = frameType === 'start'
    ? '初始状态、起始姿态、预备动作、场景建立'
    : '最终状态、结束姿态、动作完成、情绪高潮';

  const styleDesc = getStylePromptCN(visualStyle);

  const prompt = `
你是一位专业的电影视觉导演和概念艺术家。请为以下镜头的${frameLabel}创作详细的视觉描述。

## 场景信息
**地点：** ${sceneInfo.location}
**时间：** ${sceneInfo.time}
**氛围：** ${sceneInfo.atmosphere}

## 叙事动作
${actionSummary}

## 镜头运动
${cameraMovement}

## 角色信息
${characterInfo.length > 0 ? characterInfo.join('、') : '无特定角色'}

## 视觉风格
${styleDesc}

## 任务要求

作为${frameLabel}，你需要重点描述：**${frameFocus}**

### ${frameType === 'start' ? '起始帧' : '结束帧'}特殊要求：
${frameType === 'start' ? `
• 建立清晰的初始场景和人物状态
• 为即将发生的动作预留视觉空间和动势
• 设定光影和色调基调
• 展现角色的起始表情、姿态和位置
• 根据镜头运动（${cameraMovement}）设置合适的初始构图
• 营造场景氛围，让观众明确故事的起点
` : `
• 展现动作完成后的最终状态和结果
• 体现镜头运动（${cameraMovement}）带来的视角和构图变化
• 展现角色的情绪变化、最终姿态和位置
• 可以有戏剧性的光影和色彩变化
• 达到视觉高潮或情绪释放点
• 为下一个镜头的衔接做准备
`}

### 必须包含的视觉元素：

**1. 构图与景别**
- 根据镜头运动确定画面框架和视角
- 主体在画面中的位置和大小
- 前景、中景、背景的层次关系

**2. 光影与色彩**
- 光源的方向、强度和色温
- 主光、辅光、轮廓光的配置
- 整体色调和色彩情绪（暖色/冷色）
- 阴影的长度和密度

**3. 角色细节**（如有）
- 面部表情和眼神方向
- 肢体姿态和重心分布
- 服装状态和细节
- 与环境的互动关系

**4. 环境细节**
- 场景的具体视觉元素
- 环境氛围（雾气、光束、粒子等）
- 背景的清晰度和景深效果
- 环境对叙事的支持

**5. 运动暗示**
- 动态模糊或静止清晰
- 运动方向的视觉引导
- 张力和动势的体现

**6. 电影感细节**
- 画面质感和材质
- 大气透视效果
- 电影级的视觉特征

## 输出格式

请直接输出简洁但详细的视觉描述，约100-150字，用中文。

❌ 避免：
- 不要包含"Visual Style:"等标签
- 不要分段或使用项目符号
- 不要过于技术化的术语
- 不要描述整个动作过程，只描述这一帧的画面

✅ 追求：
- 流畅的单段描述
- 富有画面感的语言
- 突出${frameLabel}的特点
- 与叙事动作和镜头运动协调一致
- 具体、可视觉化的细节

请开始创作这一帧的视觉描述：
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.7, 1024));
    const duration = Date.now() - startTime;

    console.log(`✅ AI ${frameLabel}优化成功，耗时:`, duration, 'ms');

    return result.trim();
  } catch (error: any) {
    console.error(`❌ AI ${frameLabel}优化失败:`, error);
    throw new Error(`AI ${frameLabel}优化失败: ${error.message}`);
  }
};

// ============================================
// 动作生成
// ============================================

/**
 * AI生成叙事动作建议
 */
export const generateActionSuggestion = async (
  startFramePrompt: string,
  endFramePrompt: string,
  cameraMovement: string,
  model?: string
): Promise<string> => {
  console.log('🎬 generateActionSuggestion 调用 - 使用模型:', model || '(active)');
  const startTime = Date.now();

  const actionReferenceExamples = `
## 高质量动作提示词参考示例

### 特效魔法戏示例
与男生飞在空中，随着抬起手臂，镜头迅速拉远到大远景，天空不断劈下密密麻麻的闪电，男生的机甲化作蓝光，形成一个压迫感拉满，巨大的魔法冲向镜头，震撼感和压迫感拉满。要求电影级运镜，有多个镜头的转换，内容动作符合要求，运镜要有大片的既视感，动作炫酷且合理，迅速且富有张力。

### 打斗戏示例
面具人和白发男生赤手空拳展开肉搏，他们会使用魔法。要求拥有李小龙、成龙级别的打斗动作。要求电影级运镜，有多个镜头的转换，内容动作符合要求，运镜要有大片的既视感，动作炫酷且合理，迅速且富有张力。

### 蓄力攻击示例
机甲蓄力，朝天空猛开几炮，震撼感和压迫感拉满。要求电影级运镜，有多个镜头的转换，内容动作符合要求，运镜要有大片的既视感，动作炫酷且合理，迅速且富有张力。

### 魔法展开示例
男生脚下的地面突然剧烈震动，一根根粗壮的石刺破土而出如同怪兽的獠牙，压迫感拉满，疯狂地朝他刺来(给石刺特写)！男生快速跃起，同时双手在胸前合拢。眼睛散发出蓝色的魔法光芒，大喊：领域展开·无尽冰原！嗡！一股肉眼可见的蓝色波纹瞬间扩散开来，所过之处，无论是地面、墙壁全都被一层厚厚的坚冰覆盖！整个仓库还是废弃的集装箱，瞬间变成了一片光滑的溜冰场！石刺也被冻住。要求电影级运镜，有多个镜头的转换，内容动作符合要求，运镜要有大片的既视感，动作炫酷且合理，迅速且富有张力。

### 快速移动示例
镜头1：天台左侧中景，郑一剑初始站立，背后是夜色笼罩下灯火闪烁的城市，圆月高悬。他保持着一种蓄势待发的静态站立姿态，周身氛围沉静。
镜头2：郑一剑消失："模糊拖影"特效与空气扰动，画面瞬间触发"模糊拖影"特效，身影如被快速拉扯的幻影般，以极快的速度淡化、消失，原地只残留极其轻微的空气扰动波纹。
镜头3：镜头急速移至曲飞面前，从郑一剑消失的位置，以迅猛的速度横向移动，画面里天台的栏杆、地面等景物飞速掠过，产生强烈的动态模糊效果。最终镜头定格在曲飞面前，脸上露出明显的惊讶与警惕。
镜头4：郑一剑突然出现准备出拳，毫无征兆地出现在画面中央，身体大幅度前倾，呈现出极具张力的准备出拳姿势，右手紧紧握拳，带起的劲风使得衣角大幅度向后飘动。

### 能量爆发示例
镜头在倾盆大雨中快速抖动向前推进，对准在黑暗海平面中屹立不动的黑影。几道闪电快速划过，轮廓在雨幕中若隐若现。突然，一股巨大的雷暴能量在他身后快速汇聚，光芒猛烈爆发。镜头立刻快速向地面猛冲，并同时向上极度仰起，锁定他被能量光芒完全照亮的、张开双臂的威严姿态。
`;

  const prompt = `
你是一位专业的电影动作导演和叙事顾问。请根据提供的首帧和尾帧信息，结合镜头运动，设计一个既符合叙事逻辑又充满视觉冲击力的动作场景。

## 重要约束
⏱️ **时长限制**：这是一个8-10秒的单镜头场景，请严格控制动作复杂度
📹 **镜头要求**：这是一个连续镜头，不要设计多个镜头切换（除非绝对必要，最多2-3个快速切换）

## 输入信息
**首帧描述：** ${startFramePrompt}
**尾帧描述：** ${endFramePrompt}
**镜头运动：** ${cameraMovement}

${actionReferenceExamples}

## 任务要求
1. **时长适配**：动作设计必须在8-10秒内完成，避免过于复杂的多步骤动作
2. **单镜头思维**：优先设计一个连贯的镜头内动作，而非多镜头组合
3. **自然衔接**：动作需要自然地从首帧过渡到尾帧，确保逻辑合理
4. **风格借鉴**：参考上述示例的风格和语言，但要简化步骤：
   - 富有张力但简洁的描述语言
   - 强调关键的视觉冲击点
   - 电影级的运镜描述但避免过度分解
5. **创新适配**：不要重复已有提示词，结合当前场景创新
6. **镜头语言**：根据提供的镜头运动（${cameraMovement}），设计相应的运镜方案

## 输出格式
请直接输出动作描述文本，无需JSON格式或额外标记。内容应包含：
- 简洁的单镜头动作场景描述（不要"镜头1、镜头2..."的分段，除非场景确实需要快速切换）
- 关键的运镜说明（推拉摇移等）
- 核心的视觉特效或情感氛围
- 确保描述具有电影感但控制篇幅

❌ 避免：过多的镜头切换、冗长的分步描述、超过10秒的复杂动作序列
✅ 追求：精炼、有冲击力、符合8-10秒时长的单镜头动作

请开始创作：
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.8, 2048));
    const duration = Date.now() - startTime;

    console.log('✅ AI动作生成成功，耗时:', duration, 'ms');

    return result.trim();
  } catch (error: any) {
    console.error('❌ AI动作生成失败:', error);
    throw new Error(`AI动作生成失败: ${error.message}`);
  }
};

// ============================================
// 镜头拆分
// ============================================

/**
 * AI镜头拆分功能 - 将单个镜头拆分为多个细致的子镜头
 */
export const splitShotIntoSubShots = async (
  shot: any,
  sceneInfo: { location: string; time: string; atmosphere: string },
  characterNames: string[],
  visualStyle: string,
  model?: string
): Promise<{ subShots: any[] }> => {
  console.log('✂️ splitShotIntoSubShots 调用 - 使用模型:', model || '(active)');
  const startTime = Date.now();

  await ensureStylesLoaded();
  const styleDesc = getStylePromptCN(visualStyle);

  const prompt = `
你是一位专业的电影分镜师和导演。你的任务是将一个粗略的镜头描述，拆分为多个细致、专业的子镜头。

## 原始镜头信息

**场景地点：** ${sceneInfo.location}
**场景时间：** ${sceneInfo.time}
**场景氛围：** ${sceneInfo.atmosphere}
**角色：** ${characterNames.length > 0 ? characterNames.join('、') : '无特定角色'}
**视觉风格：** ${styleDesc}
**原始镜头运动：** ${shot.cameraMovement || '未指定'}

**原始动作描述：**
${shot.actionSummary}

${shot.dialogue ? `**对白：** "${shot.dialogue}"

⚠️ **对白处理说明**：原始镜头包含对白。请在拆分时，将对白放在最合适的子镜头中（通常是角色说话的中景或近景镜头），并在该子镜头的actionSummary中明确提及对白内容。其他子镜头不需要包含对白。` : ''}

## 拆分要求

### 核心原则
1. **单一职责**：每个子镜头只负责一个视角或动作细节，避免混合多个视角
2. **时长控制**：每个子镜头时长约2-4秒，总时长保持在8-10秒左右
3. **景别多样化**：合理运用全景、中景、特写等不同景别
4. **连贯性**：子镜头之间要有逻辑的视觉过渡和叙事连贯性

### 拆分维度示例

**景别分类（Shot Size）：**
- **远景 Long Shot / 全景 Wide Shot**：展示整体环境、人物位置关系、空间布局
- **中景 Medium Shot**：展示人物上半身或腰部以上，强调动作和表情
- **近景 Close-up**：展示人物头部或重要物体，强调情感和细节
- **特写 Extreme Close-up**：聚焦关键细节（如手部动作、眼神、物体特写）

### 必须包含的字段

每个子镜头必须包含以下信息：

1. **shotSize**（景别）：明确标注景别类型
2. **cameraMovement**（镜头运动）：描述镜头如何移动
3. **actionSummary**（动作描述）：清晰、具体的动作和画面内容描述（60-100字）
4. **visualFocus**（视觉焦点）：这个镜头的视觉重点
5. **keyframes**（关键帧数组）：包含起始帧(start)和结束帧(end)的视觉描述

### 专业镜头运动参考
- 静止镜头 Static Shot
- 推镜头 Dolly Shot / 拉镜头 Zoom Out
- 跟踪镜头 Tracking Shot
- 平移镜头 Pan Shot
- 环绕镜头 Circular Shot
- 俯视镜头 High Angle / 仰视镜头 Low Angle
- 主观视角 POV Shot
- 越肩镜头 Over the Shoulder

## 输出格式

请输出JSON格式，结构如下：

\`\`\`json
{
  "subShots": [
    {
      "shotSize": "全景 Wide Shot",
      "cameraMovement": "静止镜头 Static Shot",
      "actionSummary": "动作描述...",
      "visualFocus": "视觉焦点描述",
      "keyframes": [
        {
          "type": "start",
          "visualPrompt": "起始帧视觉描述，${styleDesc}，100-150字..."
        },
        {
          "type": "end",
          "visualPrompt": "结束帧视觉描述，${styleDesc}，100-150字..."
        }
      ]
    }
  ]
}
\`\`\`

**关键帧visualPrompt要求**：
- 必须包含视觉风格标记（${styleDesc}）
- 详细描述画面构图、光影、色彩、景深等视觉元素
- 起始帧和结束帧要有明显的视觉差异
- 长度控制在100-150字

## 重要提示

❌ **避免：**
- 不要在单个子镜头中混合多个视角或景别
- 不要拆分过细导致总时长超过10秒
- 不要忽略视觉连贯性

✅ **追求：**
- 每个子镜头职责清晰、画面感强
- 景别和视角多样化但符合叙事逻辑
- 保持电影级的专业表达

请开始拆分，直接输出JSON格式（不要包含markdown代码块标记）：
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.7, 4096, 'json_object'));
    const duration = Date.now() - startTime;

    const cleaned = cleanJsonString(result);
    const parsed = JSON.parse(cleaned);

    if (!parsed.subShots || !Array.isArray(parsed.subShots) || parsed.subShots.length === 0) {
      throw new Error('AI返回的JSON格式不正确或子镜头数组为空');
    }

    // 验证每个子镜头
    for (const subShot of parsed.subShots) {
      if (!subShot.shotSize || !subShot.cameraMovement || !subShot.actionSummary || !subShot.visualFocus) {
        throw new Error('子镜头缺少必需字段（shotSize、cameraMovement、actionSummary、visualFocus）');
      }
      if (!subShot.keyframes || !Array.isArray(subShot.keyframes) || subShot.keyframes.length === 0) {
        throw new Error('子镜头缺少关键帧数组（keyframes）');
      }
      for (const kf of subShot.keyframes) {
        if (!kf.type || !kf.visualPrompt) {
          throw new Error('关键帧缺少必需字段（type、visualPrompt）');
        }
        if (kf.type !== 'start' && kf.type !== 'end') {
          throw new Error('关键帧type必须是"start"或"end"');
        }
      }
    }

    console.log(`✅ 镜头拆分成功，生成 ${parsed.subShots.length} 个子镜头，耗时:`, duration, 'ms');

    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: `shot-split-${shot.id}-${Date.now()}`,
      resourceName: `镜头拆分 - ${shot.actionSummary.substring(0, 30)}...`,
      status: 'success',
      model: model,
      prompt: prompt.substring(0, 200) + '...',
      duration: duration
    });

    return parsed;
  } catch (error: any) {
    console.error('❌ 镜头拆分失败:', error);

    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: `shot-split-${shot.id}-${Date.now()}`,
      resourceName: `镜头拆分 - ${shot.actionSummary.substring(0, 30)}...`,
      status: 'failed',
      model: model,
      prompt: prompt.substring(0, 200) + '...',
      error: error.message,
      duration: Date.now() - startTime
    });

    throw new Error(`镜头拆分失败: ${error.message}`);
  }
};

// ============================================
// 关键帧增强
// ============================================

/**
 * AI增强关键帧提示词 - 添加详细的技术规格和视觉细节
 */
export const enhanceKeyframePrompt = async (
  basePrompt: string,
  visualStyle: string,
  cameraMovement: string,
  frameType: 'start' | 'end',
  model?: string
): Promise<string> => {
  console.log(`🎨 enhanceKeyframePrompt 调用 - ${frameType === 'start' ? '起始帧' : '结束帧'} - 使用模型:`, model || '(active)');
  const startTime = Date.now();

  await ensureStylesLoaded();
  const styleDesc = getStylePromptCN(visualStyle);
  const frameLabel = frameType === 'start' ? '起始帧' : '结束帧';

  const prompt = `
你是一位资深的电影摄影指导和视觉特效专家。请基于以下基础提示词,生成一个包含详细技术规格和视觉细节的专业级${frameLabel}描述。

## 基础提示词
${basePrompt}

## 视觉风格
${styleDesc}

## 镜头运动
${cameraMovement}

## ${frameLabel}要求
${frameType === 'start' ? '建立清晰的初始状态、起始姿态、为后续运动预留空间' : '展现最终状态、动作完成、情绪高潮'}

## 任务
请在基础提示词的基础上,添加以下专业的电影级视觉规格描述:

### 1. 技术规格 (Technical Specifications)
- 分辨率规格 (8K等)
- 镜头语言和摄影美学
- 景深控制和焦点策略

### 2. 视觉细节 (Visual Details)  
- 光影层次: 三点布光、阴影与高光的配置
- 色彩饱和度: 色彩分级、色温控制
- 材质质感: 表面纹理、细节丰富度
- 大气效果: 体积光、雾气、粒子、天气效果

### 3. 角色要求 (Character Details) - 如果有角色
⚠️ 最高优先级: 如果提供了角色参考图,必须严格保持人物外观的完全一致性!
- 面部表情: 在保持外观一致的基础上,添加微表情、情绪真实度、眼神方向
- 肢体语言: 在保持体型一致的基础上,展现自然的身体姿态、重心分布、肌肉张力
- 服装细节: 服装的运动感、物理真实性、纹理细节
- 毛发细节: 头发丝、自然的毛发运动

### 4. 环境要求 (Environment Details)
- 背景层次: 前景、中景、背景的深度分离
- 空间透视: 准确的线性透视、大气透视
- 环境光影: 光源的真实性、阴影投射
- 细节丰富度: 环境叙事元素、纹理变化

### 5. 氛围营造 (Mood & Atmosphere)
- 情绪基调与场景情感的匹配
- 色彩心理学的运用
- 视觉节奏的平衡
- 叙事的视觉暗示

### 6. 质量保证 (Quality Assurance)
- 主体清晰度和轮廓
- 背景过渡的自然性
- 光影一致性
- 色彩协调性
- 构图平衡(三分法或黄金比例)
- 动作连贯性

## 输出格式
请使用清晰的分节格式输出,包含上述所有要素。使用中文输出,保持专业性和可读性。

格式示例:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【技术规格】Technical Specifications
• 分辨率: ...

【视觉细节】Visual Details  
• 光影层次: ...
• 色彩饱和度: ...

(依次类推)

请开始创作:
`;

  try {
    const result = await retryOperation(() => chatCompletion(prompt, model, 0.7, 3072));
    const duration = Date.now() - startTime;

    console.log(`✅ AI ${frameLabel}增强成功，耗时:`, duration, 'ms');

    return `${basePrompt}

${result.trim()}`;
  } catch (error: any) {
    console.error(`❌ AI ${frameLabel}增强失败:`, error);
    console.warn('⚠️ 回退到基础提示词');
    return basePrompt;
  }
};

// ============================================
// 九宫格分镜预览
// ============================================

/**
 * 使用 Chat 模型将镜头动作拆分为 9 个不同的摄影视角
 */
export const generateNineGridPanels = async (
  actionSummary: string,
  cameraMovement: string,
  sceneInfo: { location: string; time: string; atmosphere: string },
  characterNames: string[],
  visualStyle: string,
  model?: string
): Promise<NineGridPanel[]> => {
  const startTime = Date.now();
  console.log('🎬 九宫格分镜 - 开始AI拆分视角...');

  const resolvedModel = model || getActiveChatModel()?.id || 'gpt-5.1';

  const systemPrompt = `你是一位专业的电影分镜师和摄影指导。你的任务是将一个镜头动作拆解为9个不同的摄影视角，用于九宫格分镜预览。
每个视角必须展示相同场景的不同景别和机位角度组合，确保覆盖从远景到特写、从俯拍到仰拍的多样化视角。`;

  const userPrompt = `请将以下镜头动作拆解为9个不同的摄影视角，用于生成一张3x3九宫格分镜图。

【镜头动作】${actionSummary}
【原始镜头运动】${cameraMovement}
【场景信息】地点: ${sceneInfo.location}, 时间: ${sceneInfo.time}, 氛围: ${sceneInfo.atmosphere}
【角色】${characterNames.length > 0 ? characterNames.join('、') : '无特定角色'}
【视觉风格】${visualStyle}

请按照以下要求返回JSON格式数据：
1. 9个视角必须覆盖不同的景别和角度组合，避免重复
2. 建议覆盖：建立镜头(远/全景)、人物交互(中景)、情绪表达(近景/特写)、氛围细节(各种角度)
3. 每个视角的description必须包含具体的画面内容描述（角色位置、动作、表情、环境细节等）
4. description使用英文撰写，但可以包含场景和角色的中文名称

请严格按照以下JSON格式输出，不要包含其他文字：
{
  "panels": [
    {
      "index": 0,
      "shotSize": "远景",
      "cameraAngle": "俯拍",
      "description": "Establishing aerial shot showing..."
    },
    {
      "index": 1,
      "shotSize": "中景",
      "cameraAngle": "平视",
      "description": "Medium shot at eye level..."
    }
  ]
}

注意：必须恰好返回9个panel（index 0-8），按照九宫格从左到右、从上到下的顺序排列。`;

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

  try {
    const responseText = await retryOperation(() => chatCompletion(fullPrompt, resolvedModel, 0.7, 4096, 'json_object'));
    const duration = Date.now() - startTime;

    const cleaned = cleanJsonString(responseText);
    const parsed = JSON.parse(cleaned);

    let panels: NineGridPanel[] = parsed.panels || [];

    if (panels.length < 9) {
      for (let i = panels.length; i < 9; i++) {
        panels.push({
          index: i,
          shotSize: '中景',
          cameraAngle: '平视',
          description: `${actionSummary} - alternate angle ${i + 1}`
        });
      }
    } else if (panels.length > 9) {
      panels = panels.slice(0, 9);
    }

    panels = panels.map((p, idx) => ({ ...p, index: idx }));

    console.log(`✅ 九宫格分镜 - AI拆分完成，耗时: ${duration}ms`);
    return panels;
  } catch (error: any) {
    console.error('❌ 九宫格分镜 - AI拆分失败:', error);
    throw new Error(`九宫格视角拆分失败: ${error.message}`);
  }
};

/**
 * 构建九宫格分镜图片的提示词（纯函数，不调用 API）
 */
export const buildNineGridImagePrompt = async (
  panels: NineGridPanel[],
  visualStyle: string,
): Promise<string> => {
  await ensureStylesLoaded();
  const stylePrompt = getStylePrompt(visualStyle);

  const positionLabels = [
    'Top-Left', 'Top-Center', 'Top-Right',
    'Middle-Left', 'Center', 'Middle-Right',
    'Bottom-Left', 'Bottom-Center', 'Bottom-Right'
  ];

  const panelDescriptions = panels.map((panel, idx) =>
    `Panel ${idx + 1} (${positionLabels[idx]}): [${panel.shotSize} / ${panel.cameraAngle}] - ${panel.description}`
  ).join('\n');

  return `Generate a SINGLE image composed as a cinematic storyboard with a 3x3 grid layout (9 equal panels).
The image shows the SAME scene from 9 DIFFERENT camera angles and shot sizes.
Each panel is separated by thin white borders.

Visual Style: ${stylePrompt}

Grid Layout (left to right, top to bottom):
${panelDescriptions}

CRITICAL REQUIREMENTS:
- The output MUST be a SINGLE image divided into exactly 9 equal rectangular panels in a 3x3 grid layout
- Each panel MUST have a thin white border/separator (2-3px) between panels
- All 9 panels show the SAME scene from DIFFERENT camera angles and shot sizes
- Maintain STRICT character consistency across ALL panels (same face, hair, clothing, body proportions)
- Maintain consistent lighting, color palette, and atmosphere across all panels
- Each panel should be a complete, well-composed frame suitable for use as a keyframe
- The overall image should read as a professional cinematographer's shot planning board`;
};

/**
 * 使用图像模型生成九宫格分镜图片
 */
export const generateNineGridImage = async (
  panels: NineGridPanel[],
  referenceImages: string[] = [],
  visualStyle: string,
  aspectRatio: AspectRatio = '16:9'
): Promise<string> => {
  const startTime = Date.now();
  console.log('🎬 九宫格分镜 - 开始生成九宫格图片...');

  const nineGridPrompt = await buildNineGridImagePrompt(panels, visualStyle);

  try {
    const imageUrl = await generateImage(nineGridPrompt, referenceImages, aspectRatio);
    const duration = Date.now() - startTime;

    console.log(`✅ 九宫格分镜 - 图片生成完成，耗时: ${duration}ms`);
    return imageUrl;
  } catch (error: any) {
    console.error('❌ 九宫格分镜 - 图片生成失败:', error);
    throw new Error(`九宫格图片生成失败: ${error.message}`);
  }
};
