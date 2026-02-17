import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  getToken,
  getSavedUser,
  saveAuth,
  clearAuth,
  setAuthExpiredCallback,
  apiPost,
  apiGet,
  apiPut,
} from '../services/apiClient';

interface User {
  id: number;
  username: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};

/**
 * 从服务器同步用户偏好到 localStorage
 */
const syncPreferencesFromServer = async () => {
  try {
    const prefs = await apiGet<{ theme: string; onboarding_completed: boolean }>('/api/preferences');
    if (prefs.theme) {
      localStorage.setItem('bigbanana_theme', prefs.theme);
      document.documentElement.setAttribute('data-theme', prefs.theme);
    }
    if (prefs.onboarding_completed) {
      localStorage.setItem('bigbanana_onboarding_completed', 'true');
    } else {
      localStorage.removeItem('bigbanana_onboarding_completed');
    }
  } catch {
    // 同步失败使用本地默认值
  }
};

/**
 * 将当前 localStorage 中的偏好上传到服务器
 */
const syncPreferencesToServer = async () => {
  try {
    const theme = localStorage.getItem('bigbanana_theme') || 'dark';
    const onboardingCompleted = localStorage.getItem('bigbanana_onboarding_completed') === 'true';
    await apiPut('/api/preferences', {
      theme,
      onboarding_completed: onboardingCompleted,
    });
  } catch {
    // 同步失败不影响使用
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const handleLogout = useCallback(() => {
    // 退出前先把当前偏好同步到服务器
    syncPreferencesToServer();

    clearAuth();
    // 清除用户级别的 localStorage 缓存
    localStorage.removeItem('bigbanana_model_registry');
    localStorage.removeItem('bigbanana_onboarding_completed');
    setUser(null);
  }, []);

  // 设置认证过期回调
  useEffect(() => {
    setAuthExpiredCallback(handleLogout);
  }, [handleLogout]);

  // 启动时验证已存在的 token
  useEffect(() => {
    const checkAuth = async () => {
      const token = getToken();
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        // 先尝试使用本地存储的用户信息
        const savedUser = getSavedUser();
        if (savedUser) {
          setUser(savedUser);
        }

        // 再异步验证 token 有效性
        const data = await apiGet<{ user: User }>('/api/auth/me');
        setUser(data.user);

        // token 有效，同步用户偏好
        await syncPreferencesFromServer();
      } catch {
        // token 无效，清除
        clearAuth();
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (username: string, password: string) => {
    const data = await apiPost<{ token: string; user: User }>('/api/auth/login', {
      username,
      password,
    });
    saveAuth(data.token, data.user);
    setUser(data.user);

    // 登录后从服务器同步数据到 localStorage
    try {
      // 同步模型注册表
      const registry = await apiGet('/api/models/registry');
      if (registry) {
        localStorage.setItem('bigbanana_model_registry', JSON.stringify(registry));
      }
      // 同步用户偏好（主题、引导状态）
      await syncPreferencesFromServer();
    } catch {
      // 同步失败不影响登录
    }
  };

  const register = async (username: string, password: string) => {
    const data = await apiPost<{ token: string; user: User }>('/api/auth/register', {
      username,
      password,
    });
    saveAuth(data.token, data.user);
    setUser(data.user);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout: handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
