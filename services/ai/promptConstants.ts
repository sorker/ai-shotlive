/**
 * 视觉风格提示词查询
 * 所有提示词数据统一从数据库获取（通过 visualStyleService 缓存）
 */

import {
  getDynamicStylePrompt,
  getDynamicStylePromptCN,
  getDynamicNegativePrompt,
  getDynamicSceneNegativePrompt,
} from '../visualStyleService';

/**
 * 获取视觉风格的英文提示词
 */
export const getStylePrompt = (visualStyle: string): string => {
  return getDynamicStylePrompt(visualStyle) || visualStyle;
};

/**
 * 获取视觉风格的中文描述
 */
export const getStylePromptCN = (visualStyle: string): string => {
  return getDynamicStylePromptCN(visualStyle) || visualStyle;
};

/**
 * 获取角色负面提示词
 */
export const getNegativePrompt = (visualStyle: string): string => {
  return getDynamicNegativePrompt(visualStyle) || '';
};

/**
 * 获取场景负面提示词
 */
export const getSceneNegativePrompt = (visualStyle: string): string => {
  return getDynamicSceneNegativePrompt(visualStyle) || '';
};
