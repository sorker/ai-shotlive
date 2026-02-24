import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { RowDataPacket } from 'mysql2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// 单行数据最大 64MB（单张图片或视频），远小于之前需要的 256MB
const TARGET_MAX_PACKET = 64 * 1024 * 1024;

const poolConfig: mysql.PoolOptions = {
  host: process.env.DB_HOST || '192.168.11.125',
  port: parseInt(process.env.DB_PORT || '23306', 10),
  user: process.env.DB_USER || 'banana',
  password: process.env.DB_PASSWORD || 'banana',
  database: process.env.DB_NAME || 'banana',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  maxIdle: 5,
  idleTimeout: 60000,
};

let pool = mysql.createPool(poolConfig);

export const getPool = (): mysql.Pool => pool;

/**
 * 调整 MySQL max_allowed_packet
 */
const adjustMaxAllowedPacket = async (): Promise<void> => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT @@global.max_allowed_packet AS val') as any;
    const current = rows[0]?.val || 0;
    console.log(`📦 当前 max_allowed_packet: ${(current / 1024 / 1024).toFixed(1)}MB`);

    if (current >= TARGET_MAX_PACKET) {
      console.log('📦 max_allowed_packet 已满足要求');
      return;
    }

    try {
      await conn.execute(`SET GLOBAL max_allowed_packet = ${TARGET_MAX_PACKET}`);
      console.log(`📦 已调整 max_allowed_packet 为 ${TARGET_MAX_PACKET / 1024 / 1024}MB`);
      conn.release();
      await pool.end();
      pool = mysql.createPool(poolConfig);
      console.log('📦 已重建连接池以应用新的 max_allowed_packet');
      return;
    } catch (err: any) {
      console.warn('');
      console.warn('⚠️ ═══════════════════════════════════════════════════════════════');
      console.warn(`⚠️  max_allowed_packet 当前为 ${(current / 1024 / 1024).toFixed(0)}MB，建议至少 64MB`);
      console.warn('⚠️  当前数据库用户无 SUPER 权限，无法自动调整');
      console.warn('⚠️  请让数据库管理员执行：');
      console.warn(`⚠️    SET GLOBAL max_allowed_packet = ${TARGET_MAX_PACKET};`);
      console.warn('⚠️ ═══════════════════════════════════════════════════════════════');
      console.warn('');
    }
  } finally {
    try { conn.release(); } catch { /* already released */ }
  }
};

/**
 * 安全地给表添加列（如果不存在）
 */
const addColumnIfNotExists = async (
  conn: mysql.PoolConnection,
  table: string,
  column: string,
  definition: string
): Promise<void> => {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (rows.length === 0) {
    await conn.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`  ➕ 已添加列 ${table}.${column}`);
  }
};

/**
 * 安全地修改列定义
 */
const modifyColumn = async (
  conn: mysql.PoolConnection,
  table: string,
  column: string,
  definition: string
): Promise<void> => {
  try {
    await conn.execute(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${definition}`);
  } catch {
    // 忽略修改失败（可能列不存在或已经是目标类型）
  }
};

/**
 * 安全地给表添加索引（如果不存在）
 */
const addIndexIfNotExists = async (
  conn: mysql.PoolConnection,
  table: string,
  indexName: string,
  columns: string
): Promise<void> => {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  if (rows.length === 0) {
    try {
      await conn.execute(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` ${columns}`);
      console.log(`  ➕ 已添加索引 ${table}.${indexName}`);
    } catch {
      // 忽略：索引可能因其他原因已存在
    }
  }
};

/**
 * 迁移现有数据：将 episode_id = '' 的记录关联到项目当前选中的 selected_episode_id
 */
const migrateExistingEpisodeIds = async (conn: mysql.PoolConnection): Promise<void> => {
  const tables = [
    'script_characters', 'character_variations', 'script_scenes', 'script_props',
    'story_paragraphs', 'shots', 'shot_keyframes', 'shot_video_intervals', 'render_logs',
  ];

  for (const table of tables) {
    try {
      const [needMigration] = await conn.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM \`${table}\` WHERE episode_id = '' OR episode_id IS NULL`,
      );
      if (needMigration[0]?.cnt > 0) {
        await conn.execute(
          `UPDATE \`${table}\` t
           INNER JOIN projects p ON t.project_id = p.id AND t.user_id = p.user_id
           SET t.episode_id = COALESCE(NULLIF(TRIM(p.selected_episode_id), ''), '_default')
           WHERE t.episode_id = '' OR t.episode_id IS NULL`
        );
        console.log(`  🔄 已迁移 ${table} 中 ${needMigration[0].cnt} 条记录的 episode_id`);
      }
    } catch {
      // 表可能不存在或列不存在，忽略
    }
  }
};

/**
 * 修改主键：将 episode_id 纳入主键，支持不同剧本中存在相同实体 ID
 *
 * MariaDB/MySQL InnoDB 最大主键长度 = 3072 bytes（16KB 页）。
 * utf8mb4 下 VARCHAR(255) = 1020 bytes，4 个 VARCHAR(255) + INT 就会超限。
 * 对于包含 4+ VARCHAR 列的主键，先将 ID 列缩短为 VARCHAR(100)（UUID 仅 36 字符）。
 */
const migrateEpisodeIdIntoPrimaryKeys = async (conn: mysql.PoolConnection): Promise<void> => {
  const pkMigrations: { table: string; newPk: string; shrinkCols?: { name: string; def: string }[] }[] = [
    { table: 'script_characters', newPk: '(id, project_id, user_id, episode_id)' },
    {
      table: 'character_variations',
      newPk: '(id, character_id, project_id, user_id, episode_id)',
      shrinkCols: [
        { name: 'id', def: 'VARCHAR(100) NOT NULL' },
        { name: 'character_id', def: 'VARCHAR(100) NOT NULL' },
        { name: 'project_id', def: 'VARCHAR(100) NOT NULL' },
        { name: 'episode_id', def: "VARCHAR(100) NOT NULL DEFAULT ''" },
      ]
    },
    { table: 'script_scenes', newPk: '(id, project_id, user_id, episode_id)' },
    { table: 'script_props', newPk: '(id, project_id, user_id, episode_id)' },
    { table: 'story_paragraphs', newPk: '(paragraph_id, project_id, user_id, episode_id)' },
    { table: 'shots', newPk: '(id, project_id, user_id, episode_id)' },
    {
      table: 'shot_keyframes',
      newPk: '(id, shot_id, project_id, user_id, episode_id)',
      shrinkCols: [
        { name: 'id', def: 'VARCHAR(100) NOT NULL' },
        { name: 'shot_id', def: 'VARCHAR(100) NOT NULL' },
        { name: 'project_id', def: 'VARCHAR(100) NOT NULL' },
        { name: 'episode_id', def: "VARCHAR(100) NOT NULL DEFAULT ''" },
      ]
    },
    {
      table: 'shot_video_intervals',
      newPk: '(id, shot_id, project_id, user_id, episode_id)',
      shrinkCols: [
        { name: 'id', def: 'VARCHAR(100) NOT NULL' },
        { name: 'shot_id', def: 'VARCHAR(100) NOT NULL' },
        { name: 'project_id', def: 'VARCHAR(100) NOT NULL' },
        { name: 'episode_id', def: "VARCHAR(100) NOT NULL DEFAULT ''" },
      ]
    },
    { table: 'render_logs', newPk: '(id, project_id, user_id, episode_id)' },
  ];

  for (const { table, newPk, shrinkCols } of pkMigrations) {
    try {
      const [pkCols] = await conn.execute<RowDataPacket[]>(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' AND COLUMN_NAME = 'episode_id'`,
        [table]
      );
      if (pkCols.length === 0) {
        if (shrinkCols) {
          await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
          try {
            for (const { name, def } of shrinkCols) {
              await conn.execute(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${name}\` ${def}`);
            }
          } finally {
            await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
          }
        }
        await conn.execute(`ALTER TABLE \`${table}\` DROP PRIMARY KEY, ADD PRIMARY KEY ${newPk}`);
        console.log(`  🔑 已更新 ${table} 主键，纳入 episode_id`);
      }
    } catch (err: any) {
      console.warn(`  ⚠️ 更新 ${table} 主键失败: ${err.message}`);
      try { await conn.execute('SET FOREIGN_KEY_CHECKS = 1'); } catch {}
    }
  }
};

/**
 * 初始化数据库 - 创建规范化表结构
 */
export const initDatabase = async (): Promise<void> => {
  await adjustMaxAllowedPacket();

  const conn = await pool.getConnection();
  try {
    // ========== 基础表 ==========

    // 用户表（不变）
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 项目表 - 保留旧 data 列用于向后兼容迁移，新增结构化列
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        title VARCHAR(255) DEFAULT '未命名项目',
        data LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id, user_id),
        INDEX idx_user_id (user_id),
        INDEX idx_updated_at (updated_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 让 data 列可为 NULL（迁移后清空）
    await modifyColumn(conn, 'projects', 'data', 'LONGTEXT DEFAULT NULL');

    // 给 projects 表添加结构化元数据列
    await addColumnIfNotExists(conn, 'projects', 'stage', "VARCHAR(50) DEFAULT 'script'");
    await addColumnIfNotExists(conn, 'projects', 'target_duration', "VARCHAR(50) DEFAULT '60s'");
    await addColumnIfNotExists(conn, 'projects', 'language', "VARCHAR(50) DEFAULT '中文'");
    await addColumnIfNotExists(conn, 'projects', 'visual_style', "VARCHAR(100) DEFAULT 'live-action'");
    await addColumnIfNotExists(conn, 'projects', 'shot_generation_model', 'VARCHAR(100)');
    await addColumnIfNotExists(conn, 'projects', 'raw_script', 'LONGTEXT');
    await addColumnIfNotExists(conn, 'projects', 'selected_episode_id', 'VARCHAR(255)');
    await addColumnIfNotExists(conn, 'projects', 'is_parsing_script', 'TINYINT(1) DEFAULT 0');
    await addColumnIfNotExists(conn, 'projects', 'has_script_data', 'TINYINT(1) DEFAULT 0');
    await addColumnIfNotExists(conn, 'projects', 'script_title', 'VARCHAR(500)');
    await addColumnIfNotExists(conn, 'projects', 'script_genre', 'VARCHAR(255)');
    await addColumnIfNotExists(conn, 'projects', 'script_logline', 'TEXT');
    await addColumnIfNotExists(conn, 'projects', 'art_direction', 'JSON');
    await addColumnIfNotExists(conn, 'projects', 'created_at_ms', 'BIGINT');
    await addColumnIfNotExists(conn, 'projects', 'last_modified_ms', 'BIGINT');
    await addColumnIfNotExists(conn, 'projects', 'novel_genre', "VARCHAR(100) DEFAULT '' COMMENT '小说类型'");
    await addColumnIfNotExists(conn, 'projects', 'novel_synopsis', "TEXT COMMENT '小说简介'");
    await addColumnIfNotExists(conn, 'projects', 'is_normalized', "TINYINT(1) DEFAULT 0");

    // ========== 小说章节表 ==========
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS novel_chapters (
        id VARCHAR(255) NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        chapter_index INT NOT NULL DEFAULT 0,
        reel VARCHAR(500) DEFAULT '',
        title VARCHAR(500) DEFAULT '',
        content LONGTEXT,
        PRIMARY KEY (id, project_id, user_id),
        INDEX idx_project (project_id, user_id),
        FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 小说剧集表 ==========
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS novel_episodes (
        id VARCHAR(255) NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        name VARCHAR(255) DEFAULT '',
        chapter_ids JSON,
        chapter_range VARCHAR(500) DEFAULT '',
        script LONGTEXT,
        status VARCHAR(50) DEFAULT 'pending',
        episode_created_at BIGINT,
        episode_updated_at BIGINT,
        PRIMARY KEY (id, project_id, user_id),
        INDEX idx_project (project_id, user_id),
        FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 角色表 ==========
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS script_characters (
        id VARCHAR(255) NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        name VARCHAR(255) DEFAULT '',
        gender VARCHAR(50) DEFAULT '',
        age VARCHAR(50) DEFAULT '',
        personality TEXT,
        visual_prompt TEXT,
        negative_prompt TEXT,
        core_features TEXT,
        reference_image LONGTEXT,
        turnaround_data JSON,
        turnaround_image LONGTEXT,
        status VARCHAR(50),
        sort_order INT DEFAULT 0,
        PRIMARY KEY (id, project_id, user_id),
        INDEX idx_project (project_id, user_id),
        FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 角色变体表 ==========
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS character_variations (
        id VARCHAR(255) NOT NULL,
        character_id VARCHAR(255) NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        name VARCHAR(255) DEFAULT '',
        visual_prompt TEXT,
        negative_prompt TEXT,
        reference_image LONGTEXT,
        status VARCHAR(50),
        sort_order INT DEFAULT 0,
        PRIMARY KEY (id, character_id, project_id, user_id),
        INDEX idx_project (project_id, user_id),
        INDEX idx_character (character_id, project_id, user_id),
        FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 场景表 ==========
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS script_scenes (
        id VARCHAR(255) NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        location VARCHAR(500) DEFAULT '',
        time_period VARCHAR(255) DEFAULT '',
        atmosphere TEXT,
        visual_prompt TEXT,
        negative_prompt TEXT,
        reference_image LONGTEXT,
        status VARCHAR(50),
        sort_order INT DEFAULT 0,
        PRIMARY KEY (id, project_id, user_id),
        INDEX idx_project (project_id, user_id),
        FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 道具表 ==========
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS script_props (
        id VARCHAR(255) NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        name VARCHAR(255) DEFAULT '',
        category VARCHAR(100) DEFAULT '',
        description TEXT,
        visual_prompt TEXT,
        negative_prompt TEXT,
        reference_image LONGTEXT,
        status VARCHAR(50),
        sort_order INT DEFAULT 0,
        PRIMARY KEY (id, project_id, user_id),
        INDEX idx_project (project_id, user_id),
        FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 故事段落表 ==========
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS story_paragraphs (
        paragraph_id INT NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        text TEXT,
        scene_ref_id VARCHAR(255) DEFAULT '',
        sort_order INT DEFAULT 0,
        PRIMARY KEY (paragraph_id, project_id, user_id),
        INDEX idx_project (project_id, user_id),
        FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 镜头表 ==========
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS shots (
        id VARCHAR(255) NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        scene_id VARCHAR(255) DEFAULT '',
        action_summary TEXT,
        dialogue TEXT,
        camera_movement VARCHAR(500) DEFAULT '',
        shot_size VARCHAR(100) DEFAULT '',
        characters_json JSON,
        character_variations_json JSON,
        props_json JSON,
        video_model VARCHAR(100),
        nine_grid_panels JSON,
        nine_grid_image LONGTEXT,
        nine_grid_prompt TEXT,
        nine_grid_status VARCHAR(50),
        sort_order INT DEFAULT 0,
        PRIMARY KEY (id, project_id, user_id),
        INDEX idx_project (project_id, user_id),
        FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 关键帧表 ==========
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS shot_keyframes (
        id VARCHAR(255) NOT NULL,
        shot_id VARCHAR(255) NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        type VARCHAR(10) DEFAULT 'start',
        visual_prompt TEXT,
        image_url LONGTEXT,
        status VARCHAR(50) DEFAULT 'pending',
        PRIMARY KEY (id, shot_id, project_id, user_id),
        INDEX idx_shot (shot_id, project_id, user_id),
        INDEX idx_project (project_id, user_id),
        FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 视频片段表 ==========
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS shot_video_intervals (
        id VARCHAR(255) NOT NULL,
        shot_id VARCHAR(255) NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        start_keyframe_id VARCHAR(255) DEFAULT '',
        end_keyframe_id VARCHAR(255) DEFAULT '',
        duration INT DEFAULT 0,
        motion_strength INT DEFAULT 5,
        video_url LONGTEXT,
        video_prompt TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        PRIMARY KEY (id, shot_id, project_id, user_id),
        INDEX idx_shot (shot_id, project_id, user_id),
        INDEX idx_project (project_id, user_id),
        FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 后台生成任务表 ==========
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS generation_tasks (
        id VARCHAR(255) PRIMARY KEY,
        user_id INT NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        type VARCHAR(20) NOT NULL COMMENT 'video | image | chat',
        status VARCHAR(20) DEFAULT 'pending' COMMENT 'pending | running | polling | completed | failed | cancelled',
        params LONGTEXT NOT NULL COMMENT 'JSON: prompt, modelId, images, etc.',
        provider_task_id VARCHAR(500) COMMENT 'taskId from async provider (Sora/DashScope/Seedance)',
        provider VARCHAR(100) COMMENT 'provider identifier',
        model_id VARCHAR(255) COMMENT 'model used',
        result LONGTEXT COMMENT 'base64 data or URL',
        error TEXT COMMENT 'error message if failed',
        progress INT DEFAULT 0 COMMENT '0-100',
        target_type VARCHAR(50) COMMENT 'keyframe | video_interval | character_image | scene_image | turnaround',
        target_shot_id VARCHAR(255),
        target_entity_id VARCHAR(255) COMMENT 'keyframe/interval/character ID',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        INDEX idx_user_status (user_id, status),
        INDEX idx_project (project_id, user_id),
        INDEX idx_status (status),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 渲染日志表 ==========
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS render_logs (
        id VARCHAR(255) NOT NULL,
        project_id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        timestamp_ms BIGINT,
        type VARCHAR(50) DEFAULT '',
        resource_id VARCHAR(255) DEFAULT '',
        resource_name VARCHAR(500) DEFAULT '',
        status VARCHAR(50) DEFAULT '',
        model VARCHAR(255) DEFAULT '',
        prompt TEXT,
        error TEXT,
        input_tokens INT,
        output_tokens INT,
        total_tokens INT,
        duration_ms INT,
        PRIMARY KEY (id, project_id, user_id),
        INDEX idx_project (project_id, user_id),
        INDEX idx_timestamp (timestamp_ms),
        FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 其他表（不变） ==========

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS asset_library (
        id VARCHAR(255) NOT NULL,
        user_id INT NOT NULL,
        name VARCHAR(255) DEFAULT '',
        type VARCHAR(50) DEFAULT '',
        data LONGTEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id, user_id),
        INDEX idx_user_id (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS model_registry (
        user_id INT PRIMARY KEY,
        data LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id INT PRIMARY KEY,
        theme VARCHAR(20) DEFAULT 'dark',
        onboarding_completed TINYINT(1) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 视觉风格表 ==========
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS visual_styles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        value VARCHAR(100) NOT NULL COMMENT '风格键值，如 anime, live-action',
        label VARCHAR(255) NOT NULL DEFAULT '' COMMENT '显示标签，如 🌟 日式动漫',
        \`desc\` VARCHAR(500) DEFAULT '' COMMENT '简短描述',
        prompt TEXT COMMENT '英文视觉提示词（用于AI图像生成）',
        prompt_cn TEXT COMMENT '中文视觉描述',
        negative_prompt TEXT COMMENT '角色负面提示词',
        scene_negative_prompt TEXT COMMENT '场景负面提示词',
        sort_order INT DEFAULT 0,
        is_default TINYINT(1) DEFAULT 0 COMMENT '是否为系统预置风格',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_user_value (user_id, value),
        INDEX idx_user_id (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ========== 迁移：为参考图增加原始 URL 列 ==========
    // Seedream 等 API 生成图片时返回 URL，保存后可在后续生成关键帧时直接传 URL
    await addColumnIfNotExists(conn, 'script_characters', 'reference_image_url', 'TEXT COMMENT "角色参考图原始URL（CDN地址）"');
    await addColumnIfNotExists(conn, 'character_variations', 'reference_image_url', 'TEXT COMMENT "角色变体参考图原始URL"');
    await addColumnIfNotExists(conn, 'script_scenes', 'reference_image_url', 'TEXT COMMENT "场景参考图原始URL"');
    await addColumnIfNotExists(conn, 'script_props', 'reference_image_url', 'TEXT COMMENT "道具参考图原始URL"');

    // ========== 迁移：为任务表添加 episode_id ==========
    await addColumnIfNotExists(conn, 'generation_tasks', 'target_episode_id', "VARCHAR(255) NOT NULL DEFAULT '' COMMENT '任务关联的剧本ID'");

    // ========== 迁移：为任务表添加 status_message（详细进度描述） ==========
    await addColumnIfNotExists(conn, 'generation_tasks', 'status_message', "VARCHAR(500) DEFAULT '' COMMENT '详细进度描述，如：生成场景视觉提示词：xxx'");

    // ========== 迁移：为下游数据表添加 episode_id 列，实现剧本级数据隔离 ==========
    const episodeScopedTables = [
      'script_characters', 'character_variations', 'script_scenes', 'script_props',
      'story_paragraphs', 'shots', 'shot_keyframes', 'shot_video_intervals', 'render_logs',
    ];
    for (const table of episodeScopedTables) {
      await addColumnIfNotExists(conn, table, 'episode_id', "VARCHAR(255) NOT NULL DEFAULT '' COMMENT '关联的剧本/剧集ID，用于数据隔离'");
    }

    // 为 episode_id 添加索引（加速按剧本查询）
    for (const table of episodeScopedTables) {
      await addIndexIfNotExists(conn, table, `idx_episode`, '(episode_id)');
    }

    // 迁移现有数据：将没有 episode_id 的记录关联到项目当前选中的剧集
    await migrateExistingEpisodeIds(conn);

    // 修改主键：在主键中加入 episode_id 以支持不同剧本中相同 ID 的实体
    await migrateEpisodeIdIntoPrimaryKeys(conn);

    // ========== 数据修复：清理 JSON 脏数据 ==========
    // 历史 bug：executeImageTask 曾将 {"base64":"...","url":"..."} 存入 image_url/reference_image
    // 需要提取 base64 和 url，修复为正确格式
    const jsonCleanupTables = [
      { table: 'shot_keyframes', imgCol: 'image_url', urlCol: null },
      { table: 'script_characters', imgCol: 'reference_image', urlCol: 'reference_image_url' },
      { table: 'script_scenes', imgCol: 'reference_image', urlCol: 'reference_image_url' },
      { table: 'script_props', imgCol: 'reference_image', urlCol: 'reference_image_url' },
      { table: 'character_variations', imgCol: 'reference_image', urlCol: 'reference_image_url' },
    ];
    for (const { table, imgCol, urlCol } of jsonCleanupTables) {
      try {
        const [dirtyRows] = await conn.execute<RowDataPacket[]>(
          `SELECT * FROM \`${table}\` WHERE \`${imgCol}\` LIKE '{%' LIMIT 500`
        );
        if (dirtyRows.length > 0) {
          console.log(`  🧹 修复 ${table} 中 ${dirtyRows.length} 条 JSON 脏数据...`);
          for (const row of dirtyRows) {
            try {
              const parsed = JSON.parse(row[imgCol]);
              const base64 = parsed.base64 || null;
              const url = parsed.url || null;
              if (urlCol && url) {
                await conn.execute(
                  `UPDATE \`${table}\` SET \`${imgCol}\` = ?, \`${urlCol}\` = ? WHERE \`${imgCol}\` = ?`,
                  [base64, url, row[imgCol]]
                );
              } else {
                await conn.execute(
                  `UPDATE \`${table}\` SET \`${imgCol}\` = ? WHERE \`${imgCol}\` = ?`,
                  [base64, row[imgCol]]
                );
              }
            } catch { /* 单行解析失败，跳过 */ }
          }
          console.log(`  ✅ ${table} JSON 脏数据修复完成`);
        }
      } catch { /* 表可能不存在，忽略 */ }
    }

    console.log('✅ 数据库表初始化完成（规范化存储）');
  } finally {
    conn.release();
  }
};
