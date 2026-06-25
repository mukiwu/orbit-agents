import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { mapLegacyTask } from './migrations'
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  ExecutionLog,
  ExecutionLogWithTask,
  Settings,
  SettingKey
} from '../shared/types'

let db: Database.Database | null = null

export function initDatabase(): Database.Database {
  if (db) return db

  const userDataPath = app.getPath('userData')
  const dbPath = join(userDataPath, 'orbit.db')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      cron_expression TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT DEFAULT 'sonnet',
      mcp_tools TEXT,
      attachments TEXT,
      output_type TEXT DEFAULT 'log',
      email_to TEXT,
      week_interval INTEGER DEFAULT 1,
      enabled INTEGER DEFAULT 1,
      needs_review INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS execution_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      status TEXT,
      output TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_execution_logs_task_id ON execution_logs(task_id);
    CREATE INDEX IF NOT EXISTS idx_execution_logs_started_at ON execution_logs(started_at);
  `)

  // Migration: Add attachments column if not exists
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN attachments TEXT`)
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add model column if not exists
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN model TEXT DEFAULT 'sonnet'`)
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add cli_tool column if not exists
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN cli_tool TEXT DEFAULT 'claude'`)
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add week_interval column if not exists
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN week_interval INTEGER DEFAULT 1`)
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add knowledge_file column if not exists
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN knowledge_file TEXT`)
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add project_path column if not exists
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN project_path TEXT`)
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add skip_permissions column if not exists (default 1 = skip)
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN skip_permissions INTEGER DEFAULT 1`)
  } catch {
    // Column already exists, ignore
  }

  // Migration: Add needs_review flag for tasks requiring manual reconfiguration
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN needs_review INTEGER DEFAULT 0`)
  } catch {
    // Column already exists, ignore
  }

  // Migration: Gemini removed -> convert to disabled Claude tasks needing review (idempotent).
  // Uses mapLegacyTask (single source of truth tested in migrations.test.ts) row-by-row so
  // the unit-tested logic is exactly what runs in production. Re-running is a no-op because
  // converted rows have cli_tool='claude' and model='sonnet', so mapLegacyTask returns null.
  {
    const legacyRows = db.prepare('SELECT id, cli_tool, model, enabled FROM tasks').all() as
      Array<{ id: string; cli_tool: string; model: string | null; enabled: number }>
    const patchStmt = db.prepare(
      `UPDATE tasks SET cli_tool=@cli_tool, model=@model, enabled=@enabled, needs_review=@needs_review WHERE id=@id`
    )
    for (const row of legacyRows) {
      const patch = mapLegacyTask(row)
      if (patch) {
        patchStmt.run({ ...patch, id: row.id })
      }
    }
  }

  // Migration: drop obsolete credential settings
  db.exec(`DELETE FROM settings WHERE key IN ('gemini_api_key','gemini_cli_path','claude_session_token')`)

  return db
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

// ============ Task Operations ============

export function getAllTasks(): Task[] {
  const db = getDatabase()
  return db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as Task[]
}

export function getTaskById(id: string): Task | null {
  const db = getDatabase()
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | null
}

export function getEnabledTasks(): Task[] {
  const db = getDatabase()
  return db.prepare('SELECT * FROM tasks WHERE enabled = 1').all() as Task[]
}

export function createTask(input: CreateTaskInput): Task {
  const db = getDatabase()
  const id = uuidv4()
  const now = new Date().toISOString()

  const task: Task = {
    id,
    name: input.name,
    description: input.description ?? null,
    cron_expression: input.cron_expression,
    prompt: input.prompt,
    cli_tool: input.cli_tool ?? 'claude',
    model: input.model ?? 'sonnet',
    mcp_tools: input.mcp_tools ? JSON.stringify(input.mcp_tools) : null,
    attachments: input.attachments ? JSON.stringify(input.attachments) : null,
    output_type: input.output_type ?? 'log',
    email_to: input.email_to ?? null,
    knowledge_file: input.knowledge_file ?? null,
    project_path: input.project_path ?? null,
    skip_permissions: input.skip_permissions !== false ? 1 : 0,
    week_interval: input.week_interval ?? 1,
    enabled: input.enabled !== false ? 1 : 0,
    needs_review: 0,
    created_at: now,
    updated_at: now
  }

  db.prepare(`
    INSERT INTO tasks (id, name, description, cron_expression, prompt, cli_tool, model, mcp_tools, attachments, output_type, email_to, knowledge_file, project_path, skip_permissions, week_interval, enabled, needs_review, created_at, updated_at)
    VALUES (@id, @name, @description, @cron_expression, @prompt, @cli_tool, @model, @mcp_tools, @attachments, @output_type, @email_to, @knowledge_file, @project_path, @skip_permissions, @week_interval, @enabled, @needs_review, @created_at, @updated_at)
  `).run(task)

  return task
}

export function updateTask(input: UpdateTaskInput): Task {
  const db = getDatabase()
  const existing = getTaskById(input.id)

  if (!existing) {
    throw new Error(`Task with id ${input.id} not found`)
  }

  const now = new Date().toISOString()

  const updated: Task = {
    ...existing,
    name: input.name ?? existing.name,
    description: input.description !== undefined ? (input.description ?? null) : existing.description,
    cron_expression: input.cron_expression ?? existing.cron_expression,
    prompt: input.prompt ?? existing.prompt,
    cli_tool: input.cli_tool ?? existing.cli_tool,
    model: input.model ?? existing.model,
    mcp_tools: input.mcp_tools !== undefined
      ? (input.mcp_tools ? JSON.stringify(input.mcp_tools) : null)
      : existing.mcp_tools,
    attachments: input.attachments !== undefined
      ? (input.attachments ? JSON.stringify(input.attachments) : null)
      : existing.attachments,
    output_type: input.output_type ?? existing.output_type,
    email_to: input.email_to !== undefined ? (input.email_to ?? null) : existing.email_to,
    knowledge_file: input.knowledge_file !== undefined ? (input.knowledge_file ?? null) : existing.knowledge_file,
    project_path: input.project_path !== undefined ? (input.project_path ?? null) : existing.project_path,
    skip_permissions: input.skip_permissions !== undefined ? (input.skip_permissions ? 1 : 0) : existing.skip_permissions,
    week_interval: input.week_interval !== undefined ? input.week_interval : existing.week_interval,
    enabled: input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled,
    needs_review: 0,
    updated_at: now
  }

  db.prepare(`
    UPDATE tasks SET
      name = @name,
      description = @description,
      cron_expression = @cron_expression,
      prompt = @prompt,
      cli_tool = @cli_tool,
      model = @model,
      mcp_tools = @mcp_tools,
      attachments = @attachments,
      output_type = @output_type,
      email_to = @email_to,
      knowledge_file = @knowledge_file,
      project_path = @project_path,
      skip_permissions = @skip_permissions,
      week_interval = @week_interval,
      enabled = @enabled,
      needs_review = @needs_review,
      updated_at = @updated_at
    WHERE id = @id
  `).run(updated)

  return updated
}

export function deleteTask(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
}

export function toggleTask(id: string): Task {
  const db = getDatabase()
  const task = getTaskById(id)

  if (!task) {
    throw new Error(`Task with id ${id} not found`)
  }

  const newEnabled = task.enabled === 1 ? 0 : 1
  const now = new Date().toISOString()

  db.prepare('UPDATE tasks SET enabled = ?, updated_at = ? WHERE id = ?').run(
    newEnabled,
    now,
    id
  )

  return { ...task, enabled: newEnabled, updated_at: now }
}

// ============ Execution Log Operations ============

export function createExecutionLog(taskId: string): ExecutionLog {
  const db = getDatabase()
  const id = uuidv4()
  const now = new Date().toISOString()

  const log: ExecutionLog = {
    id,
    task_id: taskId,
    started_at: now,
    finished_at: null,
    status: 'running',
    output: null,
    error: null
  }

  db.prepare(`
    INSERT INTO execution_logs (id, task_id, started_at, finished_at, status, output, error)
    VALUES (@id, @task_id, @started_at, @finished_at, @status, @output, @error)
  `).run(log)

  return log
}

export function updateExecutionLog(
  id: string,
  update: { status: 'success' | 'failed'; output?: string; error?: string }
): ExecutionLog {
  const db = getDatabase()
  const now = new Date().toISOString()

  db.prepare(`
    UPDATE execution_logs SET
      finished_at = ?,
      status = ?,
      output = ?,
      error = ?
    WHERE id = ?
  `).run(now, update.status, update.output ?? null, update.error ?? null, id)

  return db.prepare('SELECT * FROM execution_logs WHERE id = ?').get(id) as ExecutionLog
}

// Update output while task is still running (for streaming)
export function updateExecutionLogOutput(id: string, output: string): ExecutionLog {
  const db = getDatabase()

  db.prepare(`
    UPDATE execution_logs SET output = ? WHERE id = ?
  `).run(output, id)

  return db.prepare('SELECT * FROM execution_logs WHERE id = ?').get(id) as ExecutionLog
}

export function getExecutionLogs(taskId?: string, limit = 100): ExecutionLogWithTask[] {
  const db = getDatabase()

  if (taskId) {
    return db.prepare(`
      SELECT el.*, t.name as task_name
      FROM execution_logs el
      LEFT JOIN tasks t ON el.task_id = t.id
      WHERE el.task_id = ?
      ORDER BY el.started_at DESC
      LIMIT ?
    `).all(taskId, limit) as ExecutionLogWithTask[]
  }

  return db.prepare(`
    SELECT el.*, t.name as task_name
    FROM execution_logs el
    LEFT JOIN tasks t ON el.task_id = t.id
    ORDER BY el.started_at DESC
    LIMIT ?
  `).all(limit) as ExecutionLogWithTask[]
}

export function getExecutionLogById(id: string): ExecutionLog | null {
  const db = getDatabase()
  return db.prepare('SELECT * FROM execution_logs WHERE id = ?').get(id) as ExecutionLog | null
}

export function getExecutionLogWithTask(id: string): ExecutionLogWithTask | null {
  const db = getDatabase()
  return db.prepare(`
    SELECT el.*, t.name as task_name
    FROM execution_logs el
    LEFT JOIN tasks t ON el.task_id = t.id
    WHERE el.id = ?
  `).get(id) as ExecutionLogWithTask | null
}

export function deleteExecutionLogs(ids: string[]): void {
  const db = getDatabase()
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`DELETE FROM execution_logs WHERE id IN (${placeholders})`).run(...ids)
}

// ============ Settings Operations ============

export function getSetting(key: SettingKey): string | null {
  const db = getDatabase()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function getAllSettings(): Settings {
  const db = getDatabase()
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]

  const settings: Settings = {}
  for (const row of rows) {
    // All settings values are stored as raw strings in SQLite; narrower union
    // types (e.g. language) are validated at the call sites, not here.
    ;(settings as Record<string, string>)[row.key] = row.value
  }
  return settings
}

export function setSetting(key: SettingKey, value: string | null): void {
  const db = getDatabase()

  if (value === null) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  } else {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }
}

export function updateSettings(settings: Partial<Settings>): void {
  for (const [key, value] of Object.entries(settings)) {
    setSetting(key as SettingKey, value ?? null)
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
