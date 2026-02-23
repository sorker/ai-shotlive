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
let fetchPromise: Promise<VisualStyle[]> | null = null;

export const fetchVisualStyles = async (): Promise<VisualStyle[]> => {
  const styles = await apiGet<VisualStyle[]>('/api/visual-styles');
  cachedStyles = styles;
  fetchPromise = null;
  return styles;
};

/**
 * 确保缓存已加载。若缓存为空则触发请求（并发安全：多次调用共享同一个 Promise）
 */
export const ensureStylesLoaded = async (): Promise<VisualStyle[]> => {
  if (cachedStyles) return cachedStyles;
  if (!fetchPromise) {
    fetchPromise = fetchVisualStyles().catch((err) => {
      fetchPromise = null;
      throw err;
    });
  }
  return fetchPromise;
};

export const createVisualStyle = async (data: Partial<VisualStyleInput>): Promise<{ success: boolean; id: number }> => {
  const result = await apiPost<{ success: boolean; id: number }>('/api/visual-styles', data);
  await fetchVisualStyles();
  return result;
};

export const updateVisualStyle = async (id: number, data: Partial<VisualStyleInput>): Promise<{ success: boolean }> => {
  const result = await apiPatch<{ success: boolean }>(`/api/visual-styles/${id}`, data);
  await fetchVisualStyles();
  return result;
};

export const deleteVisualStyle = async (id: number): Promise<{ success: boolean }> => {
  const result = await apiDelete<{ success: boolean }>(`/api/visual-styles/${id}`);
  await fetchVisualStyles();
  return result;
};

/**
 * 获取缓存中的视觉风格，无缓存时返回空数组（不发请求）
 */
export const getCachedStyles = (): VisualStyle[] => {
  return cachedStyles || [];
};

const findStyle = (value: string): VisualStyle | undefined => {
  return cachedStyles?.find(s => s.value === value);
};

/**
 * 根据 value 从缓存中查找风格的英文提示词
 */
export const getDynamicStylePrompt = (value: string): string | null => {
  const style = findStyle(value);
  if (!style) return null;
  return style.prompt || null;
};

/**
 * 根据 value 从缓存中查找风格的中文提示词
 */
export const getDynamicStylePromptCN = (value: string): string | null => {
  const style = findStyle(value);
  if (!style) return null;
  return style.promptCn || null;
};

/**
 * 根据 value 从缓存中查找角色负面提示词
 */
export const getDynamicNegativePrompt = (value: string): string | null => {
  const style = findStyle(value);
  if (!style) return null;
  return style.negativePrompt || null;
};

/**
 * 根据 value 从缓存中查找场景负面提示词
 */
export const getDynamicSceneNegativePrompt = (value: string): string | null => {
  const style = findStyle(value);
  if (!style) return null;
  return style.sceneNegativePrompt || null;
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
