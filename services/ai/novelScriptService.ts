/**
 * 小说 → 剧本 生成服务
 * 从小说章节生成剧集剧本（移植自 Toonflow 的 generateScript 逻辑）
 */

import { NovelChapter, NovelEpisode } from '../../types';
import { addRenderLogWithTokens } from '../renderLogService';
import {
  retryOperation,
  chatCompletion,
  chatCompletionStream,
  logScriptProgress,
} from './apiCore';

/**
 * 从选中的小说章节生成一集剧本
 * @param chapters 选中的章节列表（已排序）
 * @param episodeName 集名
 * @param language 输出语言
 * @param model 使用的模型
 * @param onDelta 流式输出回调
 * @returns 生成的剧本文本
 */
export async function generateNovelScript(
  chapters: NovelChapter[],
  episodeName: string,
  language: string = '中文',
  model?: string,
  onDelta?: (delta: string) => void,
): Promise<string> {
  const startTime = Date.now();
  logScriptProgress(`开始从小说章节生成剧本：${episodeName}...`);

  const chapterRangeText = chapters
    .map(ch => ch.title ? `第${ch.index}章 ${ch.title}` : `第${ch.index}章`)
    .join('、');

  const novelText = chapters
    .sort((a, b) => a.index - b.index)
    .map(ch => {
      const header = ch.title ? `第${ch.index}章 ${ch.title}` : `第${ch.index}章`;
      return `${header}\n\n${ch.content}`;
    })
    .join('\n\n---\n\n');

  // 限制输入长度避免超出 token 限制
  const truncatedText = novelText.slice(0, 60000);

  const systemPrompt = `你是一位顶尖的影视剧本编剧，擅长将小说改编为引人入胜的短剧/漫剧剧本。

你的任务是将提供的小说章节内容改编为一集完整的剧本。

改编核心原则：
1. 忠实原著：保留原文的核心情节、人物设定、关键对话和情感基调
2. 视觉化转化：将小说的叙述、心理描写转化为可拍摄的场景动作和对话
3. 戏剧性增强：提炼和强化戏剧冲突，确保每集有明确的开端-发展-高潮-结尾
4. 场景分割：合理分割场景，每个场景标注时间、地点、出场角色
5. 角色刻画：通过对话和动作表现角色性格，首次出场需描写外貌特征
6. 节奏把控：控制剧本节奏，适合短视频/漫剧的快节奏呈现
7. 结尾悬念：在集末设置悬念或情感钩子，吸引观众继续观看

剧本格式要求：
- 场景标注格式：【场景X】外景/内景。地点 - 时间
- 角色首次出场需在括号中简述外貌
- 对话格式：角色名\\n对话内容
- 动作/表情用圆括号：（动作描写）
- 旁白用方括号：[旁白内容]
- 以【黑屏】结尾
- 总字数 800-1500 字`;

  const userPrompt = `请将以下小说章节改编为短剧剧本。

═══════════════════════════════════════
集名：${episodeName}
关联章节：${chapterRangeText}
输出语言：${language}
═══════════════════════════════════════

小说原文：
${truncatedText}

═══════════════════════════════════════

请严格按照上述格式要求输出剧本。仅输出剧本内容，不要添加任何说明、注释或前缀。`;

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

  try {
    let result: string;

    if (onDelta) {
      logScriptProgress('使用流式输出生成剧本...');
      result = await retryOperation(() =>
        chatCompletionStream(
          fullPrompt,
          model,
          0.7,
          undefined,
          600000,
          onDelta,
        ).catch(() => {
          logScriptProgress('流式输出失败，回退到普通模式...');
          return chatCompletion(fullPrompt, model, 0.7, 8192);
        })
      );
    } else {
      result = await retryOperation(() =>
        chatCompletion(fullPrompt, model, 0.7, 8192)
      );
    }

    const duration = Date.now() - startTime;
    logScriptProgress(`剧本生成完成，耗时 ${(duration / 1000).toFixed(1)}s`);

    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: `novel-script-${Date.now()}`,
      resourceName: `小说改编剧本：${episodeName}`,
      status: 'success',
      model,
      duration,
      prompt: userPrompt.substring(0, 200) + '...',
    });

    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logScriptProgress(`剧本生成失败：${error.message}`);

    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: `novel-script-${Date.now()}`,
      resourceName: `小说改编剧本：${episodeName}`,
      status: 'failed',
      model,
      error: error.message,
      duration,
      prompt: userPrompt.substring(0, 200) + '...',
    });

    throw error;
  }
}

/** 篇幅对应的字数与节奏说明 */
const LENGTH_GUIDE: Record<string, { wordRange: string; pace: string; focus: string }> = {
  'single': { wordRange: '1500-2500', pace: '中速推进，单章完整', focus: '单章内完成一个小高潮或情感节点' },
  'short-film': { wordRange: '800-1500', pace: '快节奏，精炼紧凑', focus: '类似短片剧本，场景集中，冲突迅速' },
  'short-drama': { wordRange: '2000-4000', pace: '短剧节奏，单集完整', focus: '一集完整故事弧，强悬念结尾' },
  'medium': { wordRange: '3000-5000', pace: '中篇节奏，可展开', focus: '可多线并行，细节丰富' },
  'long': { wordRange: '4000-6000', pace: '长篇节奏，从容铺陈', focus: '可充分展开世界观与人物内心' },
};

/** 情感基调对应的写作指引 */
const TONE_GUIDE: Record<string, string> = {
  'default': '保持与类型相符的默认基调。',
  'humorous': '轻松幽默，适当加入喜剧元素、俏皮对话或意外反转，让读者会心一笑。',
  'thrilling': '紧张刺激，强化冲突与危机感，节奏紧凑，悬念迭起。',
  'healing': '温馨治愈，注重情感共鸣与心灵抚慰，可加入温暖细节与成长感悟。',
  'tragic': '虐心催泪，深化人物困境与情感张力，可适度虐心但需有情感合理性。',
  'passionate': '热血燃情，突出信念、斗志与高光时刻，感染力强。',
  'mysterious': '悬疑烧脑，埋设伏笔，制造疑云，引导读者推理。',
  'romantic': '浪漫唯美，注重氛围与情感细腻描写，可适度文艺。',
  'dark': '黑暗沉重，可涉及道德灰色地带，氛围压抑但需有叙事深度。',
};

/**
 * AI 生成小说章节内容
 * @param chapterIndex 章节序号
 * @param chapterTitle 章节标题（可选）
 * @param novelGenre 小说类型
 * @param novelSynopsis 小说简介
 * @param projectTitle 项目标题
 * @param plotPrompt 剧情提示词（用户输入的本章方向）
 * @param lengthKey 篇幅：single|short-film|short-drama|medium|long
 * @param toneKey 情感基调
 * @param useRefPrevChapter 是否参考上一章
 * @param prevChapterContent 上一章内容
 * @param language 输出语言
 * @param model 使用的模型
 * @param onDelta 流式输出回调
 */
export async function generateNovelChapter(
  chapterIndex: number,
  chapterTitle: string,
  novelGenre: string,
  novelSynopsis: string,
  projectTitle: string,
  plotPrompt: string,
  lengthKey: string,
  toneKey: string,
  useRefPrevChapter: boolean,
  prevChapterContent: string,
  language: string = '中文',
  model?: string,
  onDelta?: (delta: string) => void,
): Promise<string> {
  const startTime = Date.now();
  logScriptProgress(`开始 AI 生成第${chapterIndex}章...`);

  const lengthGuide = LENGTH_GUIDE[lengthKey] || LENGTH_GUIDE['single'];
  const toneGuide = TONE_GUIDE[toneKey] || TONE_GUIDE['default'];

  const systemPrompt = `你是一位专业的小说作家，擅长创作引人入胜的网文/小说内容，精通多种类型与风格。

你的任务是根据给定的项目设定与剧情提示，续写或创作小说章节。

【核心创作原则】
1. 世界观与人物一致：严格遵循项目设定中的世界观、人物性格与叙事风格
2. 情节自然：章节需有清晰的起承转合，情节推进符合逻辑
3. 描写生动：注重对话、动作与环境描写，避免空洞叙述
4. 吸引力：适当设置悬念或情感钩子，吸引读者继续阅读
5. 类型贴合：充分体现「${novelGenre}」类型的特色与读者期待

【篇幅要求】
- 字数：${lengthGuide.wordRange} 字
- 节奏：${lengthGuide.pace}
- 重点：${lengthGuide.focus}

【情感基调】
${toneGuide}

【格式与输出】
- 输出语言：${language}
- 仅输出章节正文内容，不要输出章节标题（如"第X章 XXX"）
- 不要添加任何说明、注释或前缀`;

  let userPrompt = `请为以下小说项目创作第${chapterIndex}章。

═══════════════════════════════════════
项目标题：${projectTitle}
小说类型：${novelGenre}
小说简介：
${novelSynopsis || '（无）'}
═══════════════════════════════════════

${chapterTitle ? `本章标题：第${chapterIndex}章 ${chapterTitle}\n\n` : ''}`;

  if (plotPrompt && plotPrompt.trim()) {
    userPrompt += `【剧情提示词 - 请重点参考】
${plotPrompt.trim()}

═══════════════════════════════════════

`;
  }

  if (useRefPrevChapter && prevChapterContent && prevChapterContent.trim()) {
    const truncatedPrev = prevChapterContent.slice(0, 15000);
    userPrompt += `【上一章内容，请承接续写】
${truncatedPrev}
${truncatedPrev.length < prevChapterContent.length ? '\n...（内容已截断）' : ''}

═══════════════════════════════════════

请根据上一章的内容和结尾，自然衔接续写第${chapterIndex}章。保持情节连贯、人物一致。`;
  } else {
    userPrompt += `请根据项目设定${plotPrompt?.trim() ? '与剧情提示词' : ''}创作第${chapterIndex}章的开篇或独立章节。`;
  }

  userPrompt += `\n\n仅输出章节正文，不要添加任何说明、注释或章节标题。`;

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

  try {
    let result: string;

    if (onDelta) {
      logScriptProgress('使用流式输出生成章节...');
      result = await retryOperation(() =>
        chatCompletionStream(
          fullPrompt,
          model,
          0.8,
          undefined,
          300000,
          onDelta,
        ).catch(() => {
          logScriptProgress('流式输出失败，回退到普通模式...');
          return chatCompletion(fullPrompt, model, 0.8, 8192);
        })
      );
    } else {
      result = await retryOperation(() =>
        chatCompletion(fullPrompt, model, 0.8, 8192)
      );
    }

    const duration = Date.now() - startTime;
    logScriptProgress(`章节生成完成，耗时 ${(duration / 1000).toFixed(1)}s`);

    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: `novel-chapter-${Date.now()}`,
      resourceName: `AI 生成小说第${chapterIndex}章`,
      status: 'success',
      model,
      duration,
      prompt: userPrompt.substring(0, 200) + '...',
    });

    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logScriptProgress(`章节生成失败：${error.message}`);

    addRenderLogWithTokens({
      type: 'script-parsing',
      resourceId: `novel-chapter-${Date.now()}`,
      resourceName: `AI 生成小说第${chapterIndex}章`,
      status: 'failed',
      model,
      error: error.message,
      duration,
      prompt: userPrompt.substring(0, 200) + '...',
    });

    throw error;
  }
}

/**
 * 创建一个新的 NovelEpisode 对象
 */
export function createNovelEpisode(
  name: string,
  chapterIds: string[],
  chapterRange: string,
): NovelEpisode {
  return {
    id: `episode_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    chapterIds,
    chapterRange,
    script: '',
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
