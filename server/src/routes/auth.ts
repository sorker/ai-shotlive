import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getPool } from '../config/database.js';
import { generateToken, authMiddleware, AuthRequest } from '../middleware/auth.js';
import { RowDataPacket } from 'mysql2';

const router = Router();

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  password_hash: string;
}

/**
 * POST /api/auth/register - 用户注册
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: '用户名和密码不能为空' });
      return;
    }

    if (username.length < 2 || username.length > 50) {
      res.status(400).json({ error: '用户名长度应在 2-50 个字符之间' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: '密码长度不能少于 6 个字符' });
      return;
    }

    // 检查用户名是否已存在
    const [existing] = await getPool().execute<UserRow[]>(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );

    if (existing.length > 0) {
      res.status(409).json({ error: '用户名已存在' });
      return;
    }

    // 加密密码
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 创建用户
    const [result] = await getPool().execute(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username, passwordHash]
    );

    const userId = (result as any).insertId;

    // 生成 token
    const token = generateToken({ userId, username });

    console.log(`✅ 新用户注册: ${username} (ID: ${userId})`);

    res.status(201).json({
      token,
      user: { id: userId, username }
    });
  } catch (err) {
    console.error('注册失败:', err);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

/**
 * POST /api/auth/login - 用户登录
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: '用户名和密码不能为空' });
      return;
    }

    // 查找用户
    const [users] = await getPool().execute<UserRow[]>(
      'SELECT id, username, password_hash FROM users WHERE username = ?',
      [username]
    );

    if (users.length === 0) {
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    const user = users[0];

    // 验证密码
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    // 生成 token
    const token = generateToken({ userId: user.id, username: user.username });

    console.log(`✅ 用户登录: ${username} (ID: ${user.id})`);

    res.json({
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (err) {
    console.error('登录失败:', err);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

/**
 * GET /api/auth/me - 获取当前用户信息（验证 token 有效性）
 */
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  res.json({
    user: { id: req.userId, username: req.username }
  });
});

/**
 * PUT /api/auth/profile - 修改用户名和/或密码
 */
router.put('/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newUsername, newPassword } = req.body;
    const userId = req.userId!;

    if (!currentPassword) {
      res.status(400).json({ error: '请输入当前密码以验证身份' });
      return;
    }

    if (!newUsername && !newPassword) {
      res.status(400).json({ error: '请提供新用户名或新密码' });
      return;
    }

    const [users] = await getPool().execute<UserRow[]>(
      'SELECT id, username, password_hash FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      res.status(401).json({ error: '当前密码错误' });
      return;
    }

    let updatedUsername = user.username;

    if (newUsername) {
      if (newUsername.length < 2 || newUsername.length > 50) {
        res.status(400).json({ error: '用户名长度应在 2-50 个字符之间' });
        return;
      }

      if (newUsername !== user.username) {
        const [existing] = await getPool().execute<UserRow[]>(
          'SELECT id FROM users WHERE username = ? AND id != ?',
          [newUsername, userId]
        );
        if (existing.length > 0) {
          res.status(409).json({ error: '该用户名已被占用' });
          return;
        }
        await getPool().execute('UPDATE users SET username = ? WHERE id = ?', [newUsername, userId]);
        updatedUsername = newUsername;
      }
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        res.status(400).json({ error: '新密码长度不能少于 6 个字符' });
        return;
      }
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(newPassword, salt);
      await getPool().execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
    }

    const token = generateToken({ userId, username: updatedUsername });

    console.log(`✅ 用户资料已更新: ${updatedUsername} (ID: ${userId})`);

    res.json({
      token,
      user: { id: userId, username: updatedUsername }
    });
  } catch (err) {
    console.error('修改资料失败:', err);
    res.status(500).json({ error: '修改失败，请稍后重试' });
  }
});

export default router;
