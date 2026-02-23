import { apiGet, apiPost, apiPatch, apiDelete } from './apiClient';

export interface VisualStyle {
  id: number;
  value: string;
  label: string;
  desc: string;
  prompt: string;
  promptCn: string;
  negativePrompt: string;
  sceneNegativePrompt: string;
  sortOrder: number;
  isDefault: boolean;
}

export type VisualStyleInput = Omit<VisualStyle, 'id' | 'isDefault'>;

let cachedStyles: VisualStyle[] | null = null;

export const fetchVisualStyles = async (): Promise<VisualStyle[]> => {
  const styles = await apiGet<VisualStyle[]>('/api/visual-styles');
  cachedStyles = styles;
  return styles;
};

export const createVisualStyle = async (data: Partial<VisualStyleInput>): Promise<{ success: boolean; id: number }> => {
  cachedStyles = null;
  return apiPost('/api/visual-styles', data);
};

export const updateVisualStyle = async (id: number, data: Partial<VisualStyleInput>): Promise<{ success: boolean }> => {
  cachedStyles = null;
  return apiPatch(`/api/visual-styles/${id}`, data);
};

export const deleteVisualStyle = async (id: number): Promise<{ success: boolean }> => {
  cachedStyles = null;
  return apiDelete(`/api/visual-styles/${id}`);
};

/**
 * 获取缓存中的视觉风格，优先返回缓存，无缓存时返回空数组（不发请求）
 */
export const getCachedStyles = (): VisualStyle[] => {
  return cachedStyles || [];
};

/**
 * 根据 value 从缓存中查找风格的英文提示词
 */
export const getDynamicStylePrompt = (value: string): string | null => {
  const style = cachedStyles?.find(s => s.value === value);
  return style?.prompt || null;
};

/**
 * 根据 value 从缓存中查找风格的中文提示词
 */
export const getDynamicStylePromptCN = (value: string): string | null => {
  const style = cachedStyles?.find(s => s.value === value);
  return style?.promptCn || null;
};

/**
 * 根据 value 从缓存中查找角色负面提示词
 */
export const getDynamicNegativePrompt = (value: string): string | null => {
  const style = cachedStyles?.find(s => s.value === value);
  return style?.negativePrompt || null;
};

/**
 * 根据 value 从缓存中查找场景负面提示词
 */
export const getDynamicSceneNegativePrompt = (value: string): string | null => {
  const style = cachedStyles?.find(s => s.value === value);
  return style?.sceneNegativePrompt || null;
};

/**
 * 将视觉风格列表转换为 OptionSelector 所需的格式
 */
export const stylesToOptions = (styles: VisualStyle[]): { label: string; value: string; desc?: string }[] => {
  const options = styles.map(s => ({
    label: s.label,
    value: s.value,
    desc: s.desc || undefined,
  }));
  options.push({ label: '✨ 其他 (自定义)', value: 'custom', desc: '手动输入风格' });
  return options;
};
