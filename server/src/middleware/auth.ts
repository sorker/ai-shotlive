import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'bigbanana_jwt_secret_change_me_in_production';

export interface AuthRequest extends Request {
  userId?: number;
  username?: string;
}

export interface JwtPayload {
  userId: number;
  username: string;
}

/**
 * 生成 JWT Token
 */
export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

/**
 * 验证 JWT Token
 */
export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
};

/**
 * JWT 认证中间件
 * 优先从 Authorization header 提取 token，
 * 其次从 URL query 参数 ?token=xxx 提取（用于 <img src> / <video src> 等浏览器直接请求）
 */
export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query.token && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    res.status(401).json({ error: '未登录，请先登录' });
    return;
  }

  try {
    const decoded = verifyToken(token);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (err) {
    res.status(401).json({ error: '登录已过期，请重新登录' });
  }
};
