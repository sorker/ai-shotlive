/**
 * 项目增量保存服务
 *
 * 替代旧的「全量 JSON 保存」方式，每个实体使用独立的 PATCH/POST/DELETE 接口。
 * 只在用户主动编辑时调用，任务结果由服务端 TaskRunner 直接写入 DB。
 *
 * 所有函数都是 fire-and-forget 风格（返回 Promise，内部 catch 打印错误），
 * 调用方无需 await，除非需要等待确认。
 */

import { apiPatch, apiPost, apiDelete } from './apiClient';
import { Character, Scene, Prop, Shot, Keyframe, VideoInterval, CharacterVariation, NovelChapter, NovelEpisode, ScriptData } from '../types';

const BASE = '/api/projects';

const _catch = (label: string) => (err: any) => {
  console.error(`[PatchService] ${label} failed:`, err?.message || err);
};

// ============================================
// 项目元数据
// ============================================

export const patchProject = (projectId: string, updates: Record<string, any>): Promise<any> =>
  apiPatch(`${BASE}/${projectId}`, updates).catch(_catch('patchProject'));

// ============================================
// 角色
// ============================================

export const addCharacter = (projectId: string, character: Character): Promise<any> =>
  apiPost(`${BASE}/${projectId}/characters`, character).catch(_catch('addCharacter'));

export const patchCharacter = (projectId: string, charId: string, updates: Record<string, any>): Promise<any> =>
  apiPatch(`${BASE}/${projectId}/characters/${charId}`, updates).catch(_catch('patchCharacter'));

export const removeCharacter = (projectId: string, charId: string): Promise<any> =>
  apiDelete(`${BASE}/${projectId}/characters/${charId}`).catch(_catch('removeCharacter'));

// ============================================
// 角色变体
// ============================================

export const addVariation = (projectId: string, charId: string, variation: CharacterVariation): Promise<any> =>
  apiPost(`${BASE}/${projectId}/characters/${charId}/variations`, variation).catch(_catch('addVariation'));

export const patchVariation = (projectId: string, charId: string, varId: string, updates: Record<string, any>): Promise<any> =>
  apiPatch(`${BASE}/${projectId}/characters/${charId}/variations/${varId}`, updates).catch(_catch('patchVariation'));

export const removeVariation = (projectId: string, charId: string, varId: string): Promise<any> =>
  apiDelete(`${BASE}/${projectId}/characters/${charId}/variations/${varId}`).catch(_catch('removeVariation'));

// ============================================
// 场景
// ============================================

export const addScene = (projectId: string, scene: Scene): Promise<any> =>
  apiPost(`${BASE}/${projectId}/scenes`, scene).catch(_catch('addScene'));

export const patchScene = (projectId: string, sceneId: string, updates: Record<string, any>): Promise<any> =>
  apiPatch(`${BASE}/${projectId}/scenes/${sceneId}`, updates).catch(_catch('patchScene'));

export const removeScene = (projectId: string, sceneId: string): Promise<any> =>
  apiDelete(`${BASE}/${projectId}/scenes/${sceneId}`).catch(_catch('removeScene'));

// ============================================
// 道具
// ============================================

export const addProp = (projectId: string, prop: Prop): Promise<any> =>
  apiPost(`${BASE}/${projectId}/props`, prop).catch(_catch('addProp'));

export const patchProp = (projectId: string, propId: string, updates: Record<string, any>): Promise<any> =>
  apiPatch(`${BASE}/${projectId}/props/${propId}`, updates).catch(_catch('patchProp'));

export const removeProp = (projectId: string, propId: string): Promise<any> =>
  apiDelete(`${BASE}/${projectId}/props/${propId}`).catch(_catch('removeProp'));

// ============================================
// 镜头
// ============================================

export const addShot = (projectId: string, shot: Shot, insertAfterSortOrder?: number): Promise<any> =>
  apiPost(`${BASE}/${projectId}/shots`, { ...shot, _insertAfterSortOrder: insertAfterSortOrder }).catch(_catch('addShot'));

export const patchShot = (projectId: string, shotId: string, updates: Record<string, any>): Promise<any> =>
  apiPatch(`${BASE}/${projectId}/shots/${shotId}`, updates).catch(_catch('patchShot'));

export const removeShot = (projectId: string, shotId: string): Promise<any> =>
  apiDelete(`${BASE}/${projectId}/shots/${shotId}`).catch(_catch('removeShot'));

export const splitShot = (projectId: string, shotId: string, newShots: Shot[]): Promise<any> =>
  apiPost(`${BASE}/${projectId}/shots/${shotId}/split`, { newShots }).catch(_catch('splitShot'));

// ============================================
// 关键帧
// ============================================

export const patchKeyframe = (projectId: string, shotId: string, kfId: string, updates: Record<string, any>): Promise<any> =>
  apiPatch(`${BASE}/${projectId}/shots/${shotId}/keyframes/${kfId}`, updates).catch(_catch('patchKeyframe'));

// ============================================
// 视频片段
// ============================================

export const patchVideoInterval = (projectId: string, shotId: string, videoId: string, updates: Record<string, any>): Promise<any> =>
  apiPatch(`${BASE}/${projectId}/shots/${shotId}/videos/${videoId}`, updates).catch(_catch('patchVideoInterval'));

// ============================================
// 小说章节
// ============================================

export const addChapters = (projectId: string, chapters: NovelChapter[]): Promise<any> =>
  apiPost(`${BASE}/${projectId}/chapters`, { chapters }).catch(_catch('addChapters'));

export const patchChapter = (projectId: string, chapterId: string, updates: Record<string, any>): Promise<any> =>
  apiPatch(`${BASE}/${projectId}/chapters/${chapterId}`, updates).catch(_catch('patchChapter'));

export const removeChapter = (projectId: string, chapterId: string): Promise<any> =>
  apiDelete(`${BASE}/${projectId}/chapters/${chapterId}`).catch(_catch('removeChapter'));

export const removeAllChapters = (projectId: string): Promise<any> =>
  apiDelete(`${BASE}/${projectId}/chapters`).catch(_catch('removeAllChapters'));

// ============================================
// 剧集
// ============================================

export const addEpisode = (projectId: string, episode: NovelEpisode): Promise<any> =>
  apiPost(`${BASE}/${projectId}/episodes`, episode).catch(_catch('addEpisode'));

export const patchEpisode = (projectId: string, episodeId: string, updates: Record<string, any>): Promise<any> =>
  apiPatch(`${BASE}/${projectId}/episodes/${episodeId}`, updates).catch(_catch('patchEpisode'));

export const removeEpisode = (projectId: string, episodeId: string): Promise<any> =>
  apiDelete(`${BASE}/${projectId}/episodes/${episodeId}`).catch(_catch('removeEpisode'));

// ============================================
// 批量操作: 剧本解析结果
// ============================================

export const saveParseResult = (
  projectId: string,
  scriptData: ScriptData,
  shots: Shot[],
  projectUpdates?: Record<string, any>
): Promise<any> =>
  apiPost(`${BASE}/${projectId}/parse-result`, { scriptData, shots, projectUpdates }).catch(_catch('saveParseResult'));
