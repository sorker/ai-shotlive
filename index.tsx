import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import { AlertProvider } from './components/GlobalAlert';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';

// 环境变量辅助函数
const getEnv = (key: string, defaultValue?: string) => {
  if (typeof window !== 'undefined' && (window as any).__ENV__) {
    return (window as any).__ENV__[key] ?? defaultValue;
  }
  return import.meta.env?.[key] ?? defaultValue;
};

// 初始化 Sentry - 本地部署
Sentry.init({
  // DSN 配置
  dsn: getEnv('VITE_SENTRY_DSN', 'http://0a2273dee595cb24b2de6cd1c8c9f445@192.168.11.138:9000/4'),
  
  // 环境配置
  environment: getEnv('VITE_SENTRY_ENVIRONMENT', 'production'),
  release: getEnv('npm_package_version', '0.0.1'),
  
  // 发送 PII 数据（如 IP 地址）
  sendDefaultPii: true,

  // 性能监控采样率
  tracesSampleRate: parseFloat(getEnv('VITE_SENTRY_TRACES_SAMPLE_RATE', '0.1')),

  // 会话回放配置
  replaysSessionSampleRate: parseFloat(getEnv('VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE', '0.1')),
  replaysOnErrorSampleRate: parseFloat(getEnv('VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE', '1.0')),

  // 集成
  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
    Sentry.browserTracingIntegration(),
  ],

  // 忽略特定错误
  beforeSend(event, hint) {
    // 忽略常见的网络错误
    if (hint.originalException instanceof Error) {
      const msg = hint.originalException.message;
      if (msg.includes('NetworkError') || msg.includes('AbortError')) {
        return null;
      }
    }
    return event;
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <AlertProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </AlertProvider>
    </ThemeProvider>
  </React.StrictMode>
);
