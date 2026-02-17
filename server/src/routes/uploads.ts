import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.resolve(__dirname, '../../../uploads');

const router = Router();

router.use(authMiddleware);

/**
 * 确保用户的上传目录存在
 */
const ensureUserDir = (userId: number, subDir?: string): string => {
  const userDir = path.join(UPLOADS_ROOT, String(userId));
  const targetDir = subDir ? path.join(userDir, subDir) : userDir;
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  return targetDir;
};

/**
 * multer 存储配置：按用户隔离文件
 */
const storage = multer.diskStorage({
  destination: (req: any, _file, cb) => {
    const userId = req.userId;
    const dir = ensureUserDir(userId, 'novels');
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    const safeName = baseName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
    cb(null, `${safeName}_${timestamp}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (_req, file, cb) => {
    // 允许文本文件和常见文档格式
    const allowedMimes = [
      'text/plain',
      'application/octet-stream', // .txt 在某些系统上的 MIME 类型
    ];
    const allowedExts = ['.txt'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedExts.includes(ext) || allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 .txt 格式的小说文件'));
    }
  }
});

/**
 * POST /api/uploads/novel - 上传小说文件
 */
router.post('/novel', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '请选择要上传的文件' });
      return;
    }

    const filePath = req.file.path;
    const content = fs.readFileSync(filePath, 'utf-8');

    res.json({
      success: true,
      filename: req.file.originalname,
      savedAs: req.file.filename,
      path: filePath,
      size: req.file.size,
      content, // 返回文件内容供前端解析章节
    });
  } catch (err) {
    console.error('上传小说失败:', err);
    res.status(500).json({ error: '上传失败' });
  }
});

/**
 * GET /api/uploads/novels - 获取当前用户的小说文件列表
 */
router.get('/novels', async (req: AuthRequest, res: Response) => {
  try {
    const dir = ensureUserDir(req.userId!, 'novels');
    const files = fs.readdirSync(dir).map(filename => {
      const filePath = path.join(dir, filename);
      const stat = fs.statSync(filePath);
      return {
        filename,
        size: stat.size,
        uploadedAt: stat.mtime.getTime(),
      };
    });

    files.sort((a, b) => b.uploadedAt - a.uploadedAt);
    res.json(files);
  } catch (err) {
    console.error('获取小说列表失败:', err);
    res.status(500).json({ error: '获取小说列表失败' });
  }
});

/**
 * DELETE /api/uploads/novel/:filename - 删除小说文件
 */
router.delete('/novel/:filename', async (req: AuthRequest, res: Response) => {
  try {
    const dir = ensureUserDir(req.userId!, 'novels');
    const filename = req.params.filename as string;
    const filePath = path.join(dir, filename);

    // 安全检查：确保文件在用户目录内
    if (!filePath.startsWith(dir)) {
      res.status(403).json({ error: '无权访问' });
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: '文件不存在' });
      return;
    }

    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    console.error('删除小说失败:', err);
    res.status(500).json({ error: '删除失败' });
  }
});

export default router;
