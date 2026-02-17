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

export function mountProxy(app: Application) {
  app.use(
    '/api/proxy/dashscope',
    createProxyMiddleware({
      ...proxyOptions,
      target: 'https://dashscope.aliyuncs.com',
      pathRewrite: { '^/api/proxy/dashscope': '' },
      proxyTimeout: 300000,
    })
  );
  app.use(
    '/api/proxy/volcengine-tos',
    createProxyMiddleware({
      ...proxyOptions,
      target: 'https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com',
      pathRewrite: { '^/api/proxy/volcengine-tos': '' },
      proxyTimeout: 120000,
    })
  );
  app.use(
    '/api/proxy/volcengine',
    createProxyMiddleware({
      ...proxyOptions,
      target: 'https://ark.cn-beijing.volces.com',
      pathRewrite: { '^/api/proxy/volcengine': '' },
      proxyTimeout: 300000,
    })
  );
}
