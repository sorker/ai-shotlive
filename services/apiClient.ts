/**
 * 统一 HTTP 客户端
 * 自动附加 JWT Token，处理认证过期
 */

const TOKEN_KEY = 'bigbanana_auth_token';
const USER_KEY = 'bigbanana_auth_user';

// 认证过期回调（由 AuthContext 设置）
let onAuthExpired: (() => void) | null = null;

export const setAuthExpiredCallback = (cb: () => void) => {
  onAuthExpired = cb;
};

/**
 * 获取存储的 token
 */
export const getToken = (): string | null => {
  return localStorage.getItem(TOKEN_KEY);
};

/**
 * 保存 token 和用户信息
 */
export const saveAuth = (token: string, user: { id: number; username: string }) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

/**
 * 获取存储的用户信息
 */
export const getSavedUser = (): { id: number; username: string } | null => {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * 清除认证信息
 */
export const clearAuth = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

/**
 * 获取 API 基础 URL
 * 开发环境通过 Vite proxy 转发，生产环境同源
 */
const getBaseUrl = (): string => {
  return '';
};

/**
 * 发起带认证的 API 请求
 */
export const apiFetch = async (
  path: string,
  options: RequestInit = {}
): Promise<Response> => {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // 如果 body 不是 FormData，默认设置 JSON content type
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers,
  });

  // 处理认证过期
  if (response.status === 401) {
    clearAuth();
    if (onAuthExpired) {
      onAuthExpired();
    }
    throw new Error('登录已过期，请重新登录');
  }

  return response;
};

/**
 * GET 请求
 */
export const apiGet = async <T = any>(path: string): Promise<T> => {
  const res = await apiFetch(path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || `请求失败 (${res.status})`);
  }
  return res.json();
};

/**
 * POST 请求
 */
export const apiPost = async <T = any>(path: string, body?: any): Promise<T> => {
  const res = await apiFetch(path, {
    method: 'POST',
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || `请求失败 (${res.status})`);
  }
  return res.json();
};

/**
 * PUT 请求
 */
export const apiPut = async <T = any>(path: string, body?: any): Promise<T> => {
  const res = await apiFetch(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || `请求失败 (${res.status})`);
  }
  return res.json();
};

/**
 * PATCH 请求
 */
export const apiPatch = async <T = any>(path: string, body?: any): Promise<T> => {
  const res = await apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || `请求失败 (${res.status})`);
  }
  return res.json();
};

/**
 * DELETE 请求
 */
export const apiDelete = async <T = any>(path: string): Promise<T> => {
  const res = await apiFetch(path, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || `请求失败 (${res.status})`);
  }
  return res.json();
};
