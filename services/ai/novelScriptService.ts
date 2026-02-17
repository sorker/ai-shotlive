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
