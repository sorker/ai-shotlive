import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const isProd = mode === 'production';

    return {
      plugins: [
        react(),
        tailwindcss(),
        // Sentry 插件 - 生产环境上传 Source Map
        isProd && env.SENTRY_AUTH_TOKEN && sentryVitePlugin({
          org: 'your-org', // 替换为你的 Sentry 组织
          project: 'ai-shotlive', // 替换为你的项目名称
          authToken: env.SENTRY_AUTH_TOKEN,
        }),
      ].filter(Boolean),
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          // 第三方 API 代理（更具体的路径优先匹配，解决浏览器 CORS 限制）
          '/api/proxy/dashscope': {
            target: 'https://dashscope.aliyuncs.com',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api\/proxy\/dashscope/, ''),
          },
          '/api/proxy/volcengine-tos': {
            target: 'https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api\/proxy\/volcengine-tos/, ''),
          },
          '/api/proxy/volcengine': {
            target: 'https://ark.cn-beijing.volces.com',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api\/proxy\/volcengine/, ''),
          },
          '/api/proxy/openai': {
            target: 'https://api.openai.com',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api\/proxy\/openai/, ''),
          },
          '/api/proxy/anthropic': {
            target: 'https://api.anthropic.com',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api\/proxy\/anthropic/, ''),
          },
          '/api/proxy/deepseek': {
            target: 'https://api.deepseek.com',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api\/proxy\/deepseek/, ''),
          },
          '/api/proxy/zhipu': {
            target: 'https://open.bigmodel.cn',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api\/proxy\/zhipu/, ''),
          },
          '/api/proxy/google': {
            target: 'https://generativelanguage.googleapis.com',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api\/proxy\/google/, ''),
          },
          '/api/proxy/xai': {
            target: 'https://api.x.ai',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api\/proxy\/xai/, ''),
          },
          '/api/proxy/siliconflow': {
            target: 'https://api.siliconflow.cn',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api\/proxy\/siliconflow/, ''),
          },
          '/api/proxy/moonshot': {
            target: 'https://api.moonshot.cn',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api\/proxy\/moonshot/, ''),
          },
          '/api/proxy/openrouter': {
            target: 'https://openrouter.ai',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/api\/proxy\/openrouter/, '/api'),
          },
          // 后端 API 代理（匹配所有其他 /api 路由）
          '/api': {
            target: `http://localhost:${env.SERVER_PORT || 3001}`,
            changeOrigin: true,
          },
        },
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.ANTSK_API_KEY),
        'process.env.ANTSK_API_KEY': JSON.stringify(env.ANTSK_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
