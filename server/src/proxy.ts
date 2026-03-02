/**
 * 生产环境第三方 API 代理，与 Vite dev proxy / nginx 行为一致，避免浏览器 CORS
 */
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Application } from 'express';

const proxyOptions = {
  changeOrigin: true,
  secure: true,
  onProxyReq(proxyReq: any, req: any) {
    if (req.headers['content-type']) {
      proxyReq.setHeader('Content-Type', req.headers['content-type']);
    }
  },
};

/** 所有需要代理的第三方 API（路径前缀 → 目标 + pathRewrite） */
const proxyRoutes: Array<{
  path: string;
  target: string;
  rewrite: Record<string, string>;
  timeout?: number;
}> = [
  { path: '/api/proxy/dashscope',       target: 'https://dashscope.aliyuncs.com',       rewrite: { '^/api/proxy/dashscope': '' },       timeout: 300000 },
  { path: '/api/proxy/volcengine-tos',   target: 'https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com', rewrite: { '^/api/proxy/volcengine-tos': '' }, timeout: 120000 },
  { path: '/api/proxy/volcengine',       target: 'https://ark.cn-beijing.volces.com',    rewrite: { '^/api/proxy/volcengine': '' },       timeout: 300000 },
  { path: '/api/proxy/openai',           target: 'https://api.openai.com',               rewrite: { '^/api/proxy/openai': '' },           timeout: 300000 },
  { path: '/api/proxy/anthropic',        target: 'https://api.anthropic.com',             rewrite: { '^/api/proxy/anthropic': '' },         timeout: 300000 },
  { path: '/api/proxy/deepseek',         target: 'https://api.deepseek.com',              rewrite: { '^/api/proxy/deepseek': '' },          timeout: 300000 },
  { path: '/api/proxy/zhipu',            target: 'https://open.bigmodel.cn',              rewrite: { '^/api/proxy/zhipu': '' },             timeout: 300000 },
  { path: '/api/proxy/google',           target: 'https://generativelanguage.googleapis.com', rewrite: { '^/api/proxy/google': '' },        timeout: 300000 },
  { path: '/api/proxy/xai',              target: 'https://api.x.ai',                      rewrite: { '^/api/proxy/xai': '' },               timeout: 300000 },
  { path: '/api/proxy/siliconflow',      target: 'https://api.siliconflow.cn',             rewrite: { '^/api/proxy/siliconflow': '' },       timeout: 300000 },
  { path: '/api/proxy/moonshot',         target: 'https://api.moonshot.cn',                rewrite: { '^/api/proxy/moonshot': '' },          timeout: 300000 },
  { path: '/api/proxy/openrouter',       target: 'https://openrouter.ai',                  rewrite: { '^/api/proxy/openrouter': '/api' },    timeout: 300000 },
];

export function mountProxy(app: Application) {
  for (const route of proxyRoutes) {
    app.use(
      route.path,
      createProxyMiddleware({
        ...proxyOptions,
        target: route.target,
        pathRewrite: route.rewrite,
        proxyTimeout: route.timeout || 300000,
      })
    );
  }
}
