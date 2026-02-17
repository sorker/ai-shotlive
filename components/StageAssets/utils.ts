import { REGIONAL_FEATURES, LANGUAGE_MAP, DEFAULTS } from './constants';
import { convertImageToBase64 } from '../../services/storageService';

/**
 * 根据语言获取地域特征前缀
 */
export const getRegionalPrefix = (
  language: string,
  type: 'character' | 'scene'
): string => {
  const mappedLanguage = LANGUAGE_MAP[language];
  if (!mappedLanguage) return '';
  
  const features = REGIONAL_FEATURES[mappedLanguage];
  return features ? features[type] : '';
};

/**
 * 通用图片上传处理函数
 */
export const handleImageUpload = async (file: File): Promise<string> => {
  try {
    return await convertImageToBase64(file);
  } catch (e: any) {
    console.error('图片上传失败:', e);
    throw new Error(e.message || '图片上传失败');
  }
};

/**
 * 获取项目语言配置
 */
export const getProjectLanguage = (
  projectLanguage?: string,
  scriptLanguage?: string
): string => {
  return projectLanguage || scriptLanguage || DEFAULTS.language;
};

/**
 * 获取项目视觉风格
 */
export const getProjectVisualStyle = (
  projectVisualStyle?: string,
  scriptVisualStyle?: string
): string => {
  return projectVisualStyle || scriptVisualStyle || DEFAULTS.visualStyle;
};

/**
 * 延迟执行
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * 生成唯一ID
 */
export const generateId = (prefix: string = 'id'): string => {
  return `${prefix}-${Date.now()}`;
};

/**
 * 比较ID（统一转换为字符串比较）
 */
export const compareIds = (id1: string | number, id2: string | number): boolean => {
  return String(id1) === String(id2);
};
