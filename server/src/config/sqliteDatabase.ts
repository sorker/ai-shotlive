/**
 * SQLite 数据库适配器
 *
 * 提供与 mysql2/promise 兼容的接口，让上层代码无需感知底层数据库类型。
 * 使用 better-sqlite3（同步）包装成 async 接口以保持 API 一致性。
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// ─── 表主键映射（用于 ON CONFLICT 翻译）────────────────────────────

const TABLE_PK_MAP: Record<string, string[]> = {
  users: ['id'],
  projects: ['id', 'user_id'],
  novel_chapters: ['id', 'project_id', 'user_id'],
  novel_episodes: ['id', 'project_id', 'user_id'],
  script_characters: ['id', 'project_id', 'user_id', 'episode_id'],
  character_variations: ['id', 'character_id', 'project_id', 'user_id', 'episode_id'],
  script_scenes: ['id', 'project_id', 'user_id', 'episode_id'],
  script_props: ['id', 'project_id', 'user_id', 'episode_id'],
  story_paragraphs: ['paragraph_id', 'project_id', 'user_id', 'episode_id'],
  shots: ['id', 'project_id', 'user_id', 'episode_id'],
  shot_keyframes: ['id', 'shot_id', 'project_id', 'user_id', 'episode_id'],
  shot_video_intervals: ['id', 'shot_id', 'project_id', 'user_id', 'episode_id'],
  generation_tasks: ['id'],
  render_logs: ['id', 'project_id', 'user_id', 'episode_id'],
  asset_library: ['id', 'user_id'],
  model_registry: ['user_id'],
  user_preferences: ['user_id'],
  visual_styles: ['id'],
};

// visual_styles 有 UNIQUE(user_id, value)，INSERT 时需要用这个作为 conflict target
const TABLE_UPSERT_CONFLICT: Record<string, string[]> = {
  visual_styles: ['user_id', 'value'],
};

// ─── SQL 翻译 ──────────────────────────────────────────────────────

function translateSql(sql: string): string {
  let s = sql.trim();

  // SET GLOBAL → no-op
  if (/^\s*SET\s+GLOBAL/i.test(s)) return 'SELECT 1';

  // SET FOREIGN_KEY_CHECKS = 0/1
  const fkMatch = s.match(/SET\s+FOREIGN_KEY_CHECKS\s*=\s*(\d)/i);
  if (fkMatch) return `PRAGMA foreign_keys = ${fkMatch[1] === '1' ? 'ON' : 'OFF'}`;

  // SELECT @@global.max_allowed_packet
  if (/@@global\.max_allowed_packet/i.test(s)) return 'SELECT 67108864 AS val';

  // INFORMATION_SCHEMA.COLUMNS → pragma_table_info
  if (/INFORMATION_SCHEMA\.COLUMNS/i.test(s)) {
    return s;  // 由 execute 层拦截处理
  }

  // INFORMATION_SCHEMA.STATISTICS → pragma_index_list
  if (/INFORMATION_SCHEMA\.STATISTICS/i.test(s)) {
    return s;  // 由 execute 层拦截处理
  }

  // INFORMATION_SCHEMA.KEY_COLUMN_USAGE → 由 execute 层拦截处理
  if (/INFORMATION_SCHEMA\.KEY_COLUMN_USAGE/i.test(s)) {
    return s;
  }

  // ON DUPLICATE KEY UPDATE → ON CONFLICT DO UPDATE SET
  if (/ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(s)) {
    const tableMatch = s.match(/INSERT\s+INTO\s+[`]?(\w+)[`]?/i);
    if (tableMatch) {
      const tableName = tableMatch[1];
      const conflictCols = TABLE_UPSERT_CONFLICT[tableName] || TABLE_PK_MAP[tableName];
      if (conflictCols) {
        s = s.replace(
          /ON\s+DUPLICATE\s+KEY\s+UPDATE/i,
          `ON CONFLICT(${conflictCols.join(', ')}) DO UPDATE SET`
        );
        // VALUES(col) → excluded.col
        s = s.replace(/VALUES\s*\(\s*(\w+)\s*\)/gi, 'excluded.$1');
      }
    }
  }

  // ALTER TABLE ... MODIFY COLUMN → no-op (SQLite 不支持)
  if (/ALTER\s+TABLE\s+.*MODIFY\s+COLUMN/i.test(s)) return 'SELECT 1';

  // ALTER TABLE ... DROP PRIMARY KEY → no-op
  if (/ALTER\s+TABLE\s+.*DROP\s+PRIMARY\s+KEY/i.test(s)) return 'SELECT 1';

  return s;
}

// ─── 判断是否为读查询 ──────────────────────────────────────────────

function isReadQuery(sql: string): boolean {
  const s = sql.trim().toUpperCase();
  return s.startsWith('SELECT') || s.startsWith('PRAGMA') || s.startsWith('EXPLAIN');
}

// ─── SQLite 适配器 ─────────────────────────────────────────────────

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    const dbPath = process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'data', 'local.db');
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
  }
  return db;
}

/**
 * 处理 INFORMATION_SCHEMA 查询，用 SQLite pragma 模拟
 */
function handleInfoSchemaQuery(sql: string, params: any[]): any[] | null {
  // INFORMATION_SCHEMA.COLUMNS: 检查列是否存在
  const colMatch = sql.match(
    /SELECT\s+COLUMN_NAME\s+FROM\s+INFORMATION_SCHEMA\.COLUMNS\s+WHERE\s+TABLE_SCHEMA\s*=\s*DATABASE\(\)\s+AND\s+TABLE_NAME\s*=\s*\?\s+AND\s+COLUMN_NAME\s*=\s*\?/i
  );
  if (colMatch) {
    const tableName = params[0];
    const columnName = params[1];
    const cols = getDb().pragma(`table_info(${tableName})`) as any[];
    const found = cols.find((c: any) => c.name === columnName);
    return found ? [{ COLUMN_NAME: columnName }] : [];
  }

  // INFORMATION_SCHEMA.STATISTICS: 检查索引是否存在
  const idxMatch = sql.match(
    /SELECT\s+INDEX_NAME\s+FROM\s+INFORMATION_SCHEMA\.STATISTICS\s+WHERE\s+TABLE_SCHEMA\s*=\s*DATABASE\(\)\s+AND\s+TABLE_NAME\s*=\s*\?\s+AND\s+INDEX_NAME\s*=\s*\?/i
  );
  if (idxMatch) {
    const tableName = params[0];
    const indexName = params[1];
    const indexes = getDb().pragma(`index_list(${tableName})`) as any[];
    const found = indexes.find((i: any) => i.name === indexName);
    return found ? [{ INDEX_NAME: indexName }] : [];
  }

  // KEY_COLUMN_USAGE: 检查主键中是否包含某列
  const pkMatch = sql.match(
    /SELECT\s+COLUMN_NAME\s+FROM\s+INFORMATION_SCHEMA\.KEY_COLUMN_USAGE\s+WHERE\s+TABLE_SCHEMA\s*=\s*DATABASE\(\)\s+AND\s+TABLE_NAME\s*=\s*\?\s+AND\s+CONSTRAINT_NAME\s*=\s*'PRIMARY'\s+AND\s+COLUMN_NAME\s*=\s*'(\w+)'/i
  );
  if (pkMatch) {
    const tableName = params[0];
    const targetCol = pkMatch[1];
    const cols = getDb().pragma(`table_info(${tableName})`) as any[];
    const found = cols.find((c: any) => c.pk > 0 && c.name === targetCol);
    return found ? [{ COLUMN_NAME: targetCol }] : [];
  }

  return null;
}

/**
 * 执行 SQL，返回 mysql2 兼容格式 [rows, fields]
 */
function executeSql(sql: string, params: any[] = []): [any, any] {
  const translated = translateSql(sql);

  // 处理 INFORMATION_SCHEMA 查询
  if (/INFORMATION_SCHEMA/i.test(sql)) {
    const result = handleInfoSchemaQuery(sql, params);
    if (result !== null) return [result, []];
  }

  const d = getDb();

  // 将 undefined 参数转为 null（better-sqlite3 不接受 undefined）
  const safeParams = params.map(p => (p === undefined ? null : p));

  if (isReadQuery(translated)) {
    try {
      const stmt = d.prepare(translated);
      const rows = stmt.all(...safeParams);
      return [rows, []];
    } catch (err: any) {
      // PRAGMA 语句不需要 prepare
      if (/PRAGMA/i.test(translated)) {
        d.exec(translated);
        return [[], []];
      }
      throw err;
    }
  }

  // 写操作
  try {
    const stmt = d.prepare(translated);
    const info = stmt.run(...safeParams);
    const result = {
      insertId: Number(info.lastInsertRowid),
      affectedRows: info.changes,
      changedRows: info.changes,
      fieldCount: 0,
      serverStatus: 2,
      warningStatus: 0,
      info: '',
    };
    return [result, undefined];
  } catch (err: any) {
    // CREATE INDEX 等 DDL 有些不支持 prepare，用 exec
    if (err.message?.includes('This statement does not return data')) {
      d.exec(translated);
      return [{ insertId: 0, affectedRows: 0, changedRows: 0 }, undefined];
    }
    throw err;
  }
}

// ─── Pool / Connection 适配器 ──────────────────────────────────────

class SqliteConnection {
  private inTransaction = false;

  async execute<T = any>(sql: string, params?: any[]): Promise<[T, any]> {
    return executeSql(sql, params || []) as [T, any];
  }

  async beginTransaction(): Promise<void> {
    if (!this.inTransaction) {
      getDb().exec('BEGIN');
      this.inTransaction = true;
    }
  }

  async commit(): Promise<void> {
    if (this.inTransaction) {
      getDb().exec('COMMIT');
      this.inTransaction = false;
    }
  }

  async rollback(): Promise<void> {
    if (this.inTransaction) {
      try { getDb().exec('ROLLBACK'); } catch { /* might already be rolled back */ }
      this.inTransaction = false;
    }
  }

  release(): void {
    // SQLite 单连接，release 是 no-op
    // 但如果事务没有提交/回滚，自动回滚
    if (this.inTransaction) {
      try { getDb().exec('ROLLBACK'); } catch { /* */ }
      this.inTransaction = false;
    }
  }
}

class SqlitePool {
  async execute<T = any>(sql: string, params?: any[]): Promise<[T, any]> {
    return executeSql(sql, params || []) as [T, any];
  }

  async getConnection(): Promise<SqliteConnection> {
    return new SqliteConnection();
  }

  async end(): Promise<void> {
    if (db) {
      db.close();
    }
  }
}

export function createSqlitePool(): SqlitePool {
  return new SqlitePool();
}

// ─── 初始化 SQLite 数据库表 ────────────────────────────────────────

export async function initDatabaseSqlite(): Promise<void> {
  const d = getDb();

  // 用户表
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 项目表（含所有结构化列）
  d.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT DEFAULT '未命名项目',
      data TEXT,
      stage TEXT DEFAULT 'script',
      novel_genre TEXT DEFAULT '',
      novel_synopsis TEXT,
      target_duration TEXT DEFAULT '60s',
      language TEXT DEFAULT '中文',
      visual_style TEXT DEFAULT 'live-action',
      shot_generation_model TEXT,
      raw_script TEXT,
      selected_episode_id TEXT,
      is_parsing_script INTEGER DEFAULT 0,
      has_script_data INTEGER DEFAULT 0,
      script_title TEXT,
      script_genre TEXT,
      script_logline TEXT,
      art_direction TEXT,
      created_at_ms INTEGER,
      last_modified_ms INTEGER,
      is_normalized INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at)`);

  // 小说章节表
  d.exec(`
    CREATE TABLE IF NOT EXISTS novel_chapters (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      chapter_index INTEGER NOT NULL DEFAULT 0,
      reel TEXT DEFAULT '',
      title TEXT DEFAULT '',
      content TEXT,
      PRIMARY KEY (id, project_id, user_id),
      FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_novel_chapters_project ON novel_chapters(project_id, user_id)`);

  // 小说剧集表
  d.exec(`
    CREATE TABLE IF NOT EXISTS novel_episodes (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      name TEXT DEFAULT '',
      chapter_ids TEXT,
      chapter_range TEXT DEFAULT '',
      script TEXT,
      status TEXT DEFAULT 'pending',
      episode_created_at INTEGER,
      episode_updated_at INTEGER,
      PRIMARY KEY (id, project_id, user_id),
      FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_novel_episodes_project ON novel_episodes(project_id, user_id)`);

  // 角色表
  d.exec(`
    CREATE TABLE IF NOT EXISTS script_characters (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      episode_id TEXT NOT NULL DEFAULT '',
      name TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      age TEXT DEFAULT '',
      personality TEXT,
      visual_prompt TEXT,
      negative_prompt TEXT,
      core_features TEXT,
      reference_image TEXT,
      reference_image_url TEXT,
      turnaround_data TEXT,
      turnaround_image TEXT,
      status TEXT,
      sort_order INTEGER DEFAULT 0,
      PRIMARY KEY (id, project_id, user_id, episode_id),
      FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_script_characters_project ON script_characters(project_id, user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_script_characters_episode ON script_characters(episode_id)`);

  // 角色变体表
  d.exec(`
    CREATE TABLE IF NOT EXISTS character_variations (
      id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      episode_id TEXT NOT NULL DEFAULT '',
      name TEXT DEFAULT '',
      visual_prompt TEXT,
      negative_prompt TEXT,
      reference_image TEXT,
      reference_image_url TEXT,
      status TEXT,
      sort_order INTEGER DEFAULT 0,
      PRIMARY KEY (id, character_id, project_id, user_id, episode_id),
      FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_character_variations_project ON character_variations(project_id, user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_character_variations_character ON character_variations(character_id, project_id, user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_character_variations_episode ON character_variations(episode_id)`);

  // 场景表
  d.exec(`
    CREATE TABLE IF NOT EXISTS script_scenes (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      episode_id TEXT NOT NULL DEFAULT '',
      location TEXT DEFAULT '',
      time_period TEXT DEFAULT '',
      atmosphere TEXT,
      visual_prompt TEXT,
      negative_prompt TEXT,
      reference_image TEXT,
      reference_image_url TEXT,
      status TEXT,
      sort_order INTEGER DEFAULT 0,
      PRIMARY KEY (id, project_id, user_id, episode_id),
      FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_script_scenes_project ON script_scenes(project_id, user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_script_scenes_episode ON script_scenes(episode_id)`);

  // 道具表
  d.exec(`
    CREATE TABLE IF NOT EXISTS script_props (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      episode_id TEXT NOT NULL DEFAULT '',
      name TEXT DEFAULT '',
      category TEXT DEFAULT '',
      description TEXT,
      visual_prompt TEXT,
      negative_prompt TEXT,
      reference_image TEXT,
      reference_image_url TEXT,
      status TEXT,
      sort_order INTEGER DEFAULT 0,
      PRIMARY KEY (id, project_id, user_id, episode_id),
      FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_script_props_project ON script_props(project_id, user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_script_props_episode ON script_props(episode_id)`);

  // 故事段落表
  d.exec(`
    CREATE TABLE IF NOT EXISTS story_paragraphs (
      paragraph_id INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      episode_id TEXT NOT NULL DEFAULT '',
      text TEXT,
      scene_ref_id TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      PRIMARY KEY (paragraph_id, project_id, user_id, episode_id),
      FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_story_paragraphs_project ON story_paragraphs(project_id, user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_story_paragraphs_episode ON story_paragraphs(episode_id)`);

  // 镜头表
  d.exec(`
    CREATE TABLE IF NOT EXISTS shots (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      episode_id TEXT NOT NULL DEFAULT '',
      scene_id TEXT DEFAULT '',
      action_summary TEXT,
      dialogue TEXT,
      camera_movement TEXT DEFAULT '',
      shot_size TEXT DEFAULT '',
      characters_json TEXT,
      character_variations_json TEXT,
      props_json TEXT,
      video_model TEXT,
      nine_grid_panels TEXT,
      nine_grid_image TEXT,
      nine_grid_prompt TEXT,
      nine_grid_status TEXT,
      sort_order INTEGER DEFAULT 0,
      PRIMARY KEY (id, project_id, user_id, episode_id),
      FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_shots_project ON shots(project_id, user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_shots_episode ON shots(episode_id)`);

  // 关键帧表
  d.exec(`
    CREATE TABLE IF NOT EXISTS shot_keyframes (
      id TEXT NOT NULL,
      shot_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      episode_id TEXT NOT NULL DEFAULT '',
      type TEXT DEFAULT 'start',
      visual_prompt TEXT,
      image_url TEXT,
      status TEXT DEFAULT 'pending',
      PRIMARY KEY (id, shot_id, project_id, user_id, episode_id),
      FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_shot_keyframes_shot ON shot_keyframes(shot_id, project_id, user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_shot_keyframes_project ON shot_keyframes(project_id, user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_shot_keyframes_episode ON shot_keyframes(episode_id)`);

  // 视频片段表
  d.exec(`
    CREATE TABLE IF NOT EXISTS shot_video_intervals (
      id TEXT NOT NULL,
      shot_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      episode_id TEXT NOT NULL DEFAULT '',
      start_keyframe_id TEXT DEFAULT '',
      end_keyframe_id TEXT DEFAULT '',
      duration INTEGER DEFAULT 0,
      motion_strength INTEGER DEFAULT 5,
      video_url TEXT,
      video_prompt TEXT,
      status TEXT DEFAULT 'pending',
      PRIMARY KEY (id, shot_id, project_id, user_id, episode_id),
      FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_shot_video_intervals_shot ON shot_video_intervals(shot_id, project_id, user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_shot_video_intervals_project ON shot_video_intervals(project_id, user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_shot_video_intervals_episode ON shot_video_intervals(episode_id)`);

  // 后台生成任务表
  d.exec(`
    CREATE TABLE IF NOT EXISTS generation_tasks (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      params TEXT NOT NULL,
      provider_task_id TEXT,
      provider TEXT,
      model_id TEXT,
      result TEXT,
      error TEXT,
      progress INTEGER DEFAULT 0,
      target_type TEXT,
      target_shot_id TEXT,
      target_entity_id TEXT,
      target_episode_id TEXT NOT NULL DEFAULT '',
      status_message TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_generation_tasks_user_status ON generation_tasks(user_id, status)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_generation_tasks_project ON generation_tasks(project_id, user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_generation_tasks_status ON generation_tasks(status)`);

  // 渲染日志表
  d.exec(`
    CREATE TABLE IF NOT EXISTS render_logs (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      episode_id TEXT NOT NULL DEFAULT '',
      timestamp_ms INTEGER,
      type TEXT DEFAULT '',
      resource_id TEXT DEFAULT '',
      resource_name TEXT DEFAULT '',
      status TEXT DEFAULT '',
      model TEXT DEFAULT '',
      prompt TEXT,
      error TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      duration_ms INTEGER,
      PRIMARY KEY (id, project_id, user_id, episode_id),
      FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_render_logs_project ON render_logs(project_id, user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_render_logs_timestamp ON render_logs(timestamp_ms)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_render_logs_episode ON render_logs(episode_id)`);

  // 资产库
  d.exec(`
    CREATE TABLE IF NOT EXISTS asset_library (
      id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      name TEXT DEFAULT '',
      type TEXT DEFAULT '',
      data TEXT NOT NULL,
      project_id TEXT,
      project_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_asset_library_user_id ON asset_library(user_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_asset_library_type ON asset_library(type)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_asset_library_project ON asset_library(project_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_asset_library_user_updated ON asset_library(user_id, updated_at)`);

  // 模型注册表
  d.exec(`
    CREATE TABLE IF NOT EXISTS model_registry (
      user_id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 用户偏好
  d.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER PRIMARY KEY,
      theme TEXT DEFAULT 'dark',
      onboarding_completed INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 视觉风格表
  d.exec(`
    CREATE TABLE IF NOT EXISTS visual_styles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      value TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      "desc" TEXT DEFAULT '',
      prompt TEXT,
      prompt_cn TEXT,
      negative_prompt TEXT,
      scene_negative_prompt TEXT,
      sort_order INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE (user_id, value),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_visual_styles_user_id ON visual_styles(user_id)`);

  console.log('✅ SQLite 数据库表初始化完成');
}
