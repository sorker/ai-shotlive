import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          // 第三方 API 代理（更具体的路径优先匹配）
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
          // 后端 API 代理（匹配所有其他 /api 路由）
          '/api': {
            target: `http://localhost:${env.SERVER_PORT || 3001}`,
            changeOrigin: true,
          },
        },
      },
      plugins: [react()],
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
