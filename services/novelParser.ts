/**
 * 小说解析器 - 移植自 Toonflow
 * 支持解析 .txt 和 .docx 格式的小说文件
 * 自动识别卷/章结构，支持中文数字
 */

import { NovelChapter } from '../types';

const REEL_REGEX = /^(第[\d一二三四五六七八九十百千]+卷)\s*([^\n第]*)/gm;
const CHAPTER_REGEX = /(第[\d一二三四五六七八九十百千]+章)\s*([^\n\r]*)/g;

const CHINESE_NUM_MAP: { [key: string]: number } = {
  零: 0, 一: 1, 二: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

const CHINESE_UNIT_MAP: { [key: string]: number } = {
  十: 10, 百: 100, 千: 1000,
};

interface ParsedChapter {
  index: number;
  chapter: string;
  text: string;
}

interface ParsedReel {
  index: number;
  reel: string;
  chapters: ParsedChapter[];
}

function parseNumber(numStr: string): number {
  if (/^\d+$/.test(numStr)) return parseInt(numStr, 10);
  if (/^十[一二三四五六七八九]?$/.test(numStr)) {
    if (numStr.length === 1) return 10;
    return 10 + CHINESE_NUM_MAP[numStr[1]];
  }
  let num = 0, digit = 0;
  for (const c of numStr) {
    if (CHINESE_NUM_MAP[c] !== undefined) digit = CHINESE_NUM_MAP[c];
    else if (CHINESE_UNIT_MAP[c] !== undefined) {
      if (digit === 0 && c === '十') digit = 1;
      num += digit * CHINESE_UNIT_MAP[c];
      digit = 0;
    }
  }
  num += digit;
  return num;
}

/**
 * 解析小说文本为卷/章结构
 */
function parseNovelText(text: string): ParsedReel[] {
  REEL_REGEX.lastIndex = 0;
  const reelMatches = Array.from(text.matchAll(REEL_REGEX));
  const reels: ParsedReel[] = [];

  if (reelMatches.length === 0) {
    const chapters: ParsedChapter[] = [];
    CHAPTER_REGEX.lastIndex = 0;
    const matches = Array.from(text.matchAll(CHAPTER_REGEX));
    if (matches.length === 0 && text.trim() !== '') {
      chapters.push({ index: 1, chapter: '', text: text.trim() });
    } else {
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index! + matches[i][0].length;
        const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
        const content = text.slice(start, end).replace(/^[\r\n]+/, '').trim();
        chapters.push({
          index: parseNumber(matches[i][1].replace(/第|章/g, '')),
          chapter: matches[i][2].trim(),
          text: content,
        });
      }
    }
    chapters.sort((a, b) => a.index - b.index);
    reels.push({ index: 1, reel: '正文卷', chapters });
    return reels;
  }

  const reelMap = new Map<string, ParsedReel>();
  for (let i = 0; i < reelMatches.length; i++) {
    const match = reelMatches[i];
    const index = match.index!;
    const reelRaw = match[1];
    const reelName = match[2]?.trim() || '';
    const end = i + 1 < reelMatches.length ? reelMatches[i + 1].index! : text.length;
    const reelSection = text.slice(index, end);

    const chapterMatches = Array.from(reelSection.matchAll(CHAPTER_REGEX));
    const chapters: ParsedChapter[] = [];
    if (chapterMatches.length === 0 && reelSection.replace(REEL_REGEX, '').trim() !== '') {
      chapters.push({
        index: 1,
        chapter: '',
        text: reelSection.replace(REEL_REGEX, '').trim(),
      });
    }
    for (let j = 0; j < chapterMatches.length; j++) {
      const start = chapterMatches[j].index! + chapterMatches[j][0].length;
      const end = j + 1 < chapterMatches.length ? chapterMatches[j + 1].index! : reelSection.length;
      const content = reelSection.slice(start, end).replace(/^[\r\n]+/, '').trim();
      chapters.push({
        index: parseNumber(chapterMatches[j][1].replace(/第|章/g, '')),
        chapter: chapterMatches[j][2].trim(),
        text: content,
      });
    }
    chapters.sort((a, b) => a.index - b.index);

    if (!reelMap.has(reelName)) {
      reelMap.set(reelName, {
        index: parseNumber(reelRaw.replace(/第|卷/g, '')),
        reel: reelName,
        chapters: [],
      });
    }
    reelMap.get(reelName)!.chapters.push(...chapters);
  }

  const result = Array.from(reelMap.values()).sort((a, b) => a.index - b.index);
  result.forEach((reel) => reel.chapters.sort((a, b) => a.index - b.index));
  return result;
}

/**
 * 从文件读取文本内容
 * 支持 .txt 文件（UTF-8 编码）
 */
export async function readFileAsText(file: File): Promise<string> {
  if (!file.name.endsWith('.txt')) {
    throw new Error('目前仅支持 .txt 格式，请将文件转换为 UTF-8 编码的 .txt 文件后重试');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

/**
 * 解析小说文本为 NovelChapter 列表
 * 核心公开接口
 */
export function parseNovelToChapters(text: string): NovelChapter[] {
  const reels = parseNovelText(text);
  const chapters: NovelChapter[] = [];
  let globalIndex = 0;

  for (const reel of reels) {
    for (const ch of reel.chapters) {
      globalIndex++;
      chapters.push({
        id: `novel-ch-${globalIndex}`,
        index: ch.index,
        reel: reel.reel,
        title: ch.chapter,
        content: ch.text,
      });
    }
  }

  return chapters;
}

/**
 * 获取章节字数统计
 * 优先使用 wordCount 字段（轻量加载时服务端提供），否则回退到 content.length
 */
export function getChapterWordCount(chapter: NovelChapter): number {
  return chapter.wordCount || chapter.content?.length || 0;
}

/**
 * 获取选中章节的总字数
 */
export function getSelectedChaptersWordCount(chapters: NovelChapter[], selectedIds: string[]): number {
  return chapters
    .filter(ch => selectedIds.includes(ch.id))
    .reduce((sum, ch) => sum + (ch.wordCount || ch.content?.length || 0), 0);
}

/**
 * 获取选中章节的合并文本
 */
export function getSelectedChaptersText(chapters: NovelChapter[], selectedIds: string[]): string {
  return chapters
    .filter(ch => selectedIds.includes(ch.id))
    .sort((a, b) => a.index - b.index)
    .map(ch => {
      const header = ch.title ? `第${ch.index}章 ${ch.title}` : `第${ch.index}章`;
      return `${header}\n\n${ch.content}`;
    })
    .join('\n\n');
}

/**
 * 生成章节范围描述
 */
export function getChapterRangeLabel(chapters: NovelChapter[], selectedIds: string[]): string {
  const selected = chapters
    .filter(ch => selectedIds.includes(ch.id))
    .sort((a, b) => a.index - b.index);

  if (selected.length === 0) return '';
  if (selected.length === 1) return `第${selected[0].index}章`;

  const first = selected[0].index;
  const last = selected[selected.length - 1].index;

  // 检查是否连续
  const isContinuous = selected.every((ch, i) => {
    if (i === 0) return true;
    return ch.index === selected[i - 1].index + 1;
  });

  if (isContinuous) {
    return `第${first}-${last}章`;
  }

  return selected.map(ch => `第${ch.index}章`).join('、');
}
