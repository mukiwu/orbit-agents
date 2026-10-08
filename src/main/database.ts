import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { rmSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { disableLegacyWorkflows, mapLegacyTask } from './migrations'
import { validateAutomationConfig } from './automation-config'
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  ExecutionLog,
  ExecutionLogWithTask,
  LogSearchInput,
  LogSearchResult,
  DashboardData,
  Settings,
  SettingKey
} from '../shared/types'
import type { RunSnapshot, ProviderId } from '../shared/types'

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
      automation TEXT,
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
      exit_code INTEGER,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS inbox_claims (
      task_id TEXT NOT NULL,
      path TEXT NOT NULL,
      modified_at_ms INTEGER NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      log_id TEXT,
      PRIMARY KEY (task_id, path, modified_at_ms, size)
    );

    CREATE TABLE IF NOT EXISTS run_snapshots (
      log_id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      system_instruction TEXT NOT NULL,
      provider TEXT NOT NULL,
      fallback_provider TEXT,
      model TEXT,
      attachment_paths TEXT NOT NULL,
      add_dirs TEXT NOT NULL,
      project_path TEXT,
      skip_permissions INTEGER NOT NULL,
      mcp_tools TEXT NOT NULL,
      source_path TEXT,
      source_size INTEGER,
      source_modified_at_ms REAL,
      source_url TEXT,
      result_type TEXT NOT NULL,
      require_review INTEGER NOT NULL,
      destination TEXT,
      email_to TEXT,
      replay_of TEXT,
      proposed_file_name TEXT,
      review_status TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS website_state (
      task_id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_execution_logs_task_id ON execution_logs(task_id);
    CREATE INDEX IF NOT EXISTS idx_execution_logs_started_at ON execution_logs(started_at);
  `)

  // Preserve development databases created by earlier builds of this feature.
  const snapshotColumns = new Set((db.pragma('table_info(run_snapshots)') as Array<{ name: string }>).map(row => row.name))
  for (const [name, definition] of [
    ['fallback_provider', 'TEXT'], ['source_size', 'INTEGER'], ['source_modified_at_ms', 'REAL'],
    ['result_type', "TEXT NOT NULL DEFAULT 'report'"], ['require_review', 'INTEGER NOT NULL DEFAULT 0'],
    ['destination', 'TEXT'], ['email_to', 'TEXT']
  ] as const) {
    if (!snapshotColumns.has(name)) db.exec(`ALTER TABLE run_snapshots ADD COLUMN ${name} ${definition}`)
  }
  const websiteColumns = new Set((db.pragma('table_info(website_state)') as Array<{ name: string }>).map(row => row.name))
  if (!websiteColumns.has('content')) db.exec("ALTER TABLE website_state ADD COLUMN content TEXT NOT NULL DEFAULT ''")

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

  // Existing logs predate process exit code tracking.
  const logColumns = db.pragma('table_info(execution_logs)') as Array<{ name: string }>
  if (!logColumns.some((column) => column.name === 'exit_code')) {
    db.exec(`ALTER TABLE execution_logs ADD COLUMN exit_code INTEGER`)
  }

  const taskColumns = db.pragma('table_info(tasks)') as Array<{ name: string }>
  if (!taskColumns.some((column) => column.name === 'automation')) {
    db.exec('ALTER TABLE tasks ADD COLUMN automation TEXT')
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

  disableLegacyWorkflows(db)

  // A crash during approval may have completed an external action. Require
  // inspection rather than silently retrying and possibly sending twice.
  db.exec(`
    UPDATE execution_logs SET status = 'failed', finished_at = datetime('now'),
      error = 'Approval was interrupted; inspect external effects before replaying'
      WHERE id IN (SELECT log_id FROM run_snapshots WHERE review_status = 'applying');
    UPDATE run_snapshots SET review_status = 'rejected' WHERE review_status = 'applying';
    UPDATE inbox_claims SET status = 'failed' WHERE status = 'running';
  `)

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
  if (input.automation && (input.automation.require_review || input.automation.source.type !== 'schedule') && input.cli_tool === 'antigravity') {
    throw new Error('File, website and review tasks require Claude or Codex')
  }
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
    automation: input.automation ? JSON.stringify(validateAutomationConfig(input.automation)) : null,
    created_at: now,
    updated_at: now
  }

  db.prepare(`
    INSERT INTO tasks (id, name, description, cron_expression, prompt, cli_tool, model, mcp_tools, attachments, output_type, email_to, knowledge_file, project_path, skip_permissions, week_interval, enabled, needs_review, automation, created_at, updated_at)
    VALUES (@id, @name, @description, @cron_expression, @prompt, @cli_tool, @model, @mcp_tools, @attachments, @output_type, @email_to, @knowledge_file, @project_path, @skip_permissions, @week_interval, @enabled, @needs_review, @automation, @created_at, @updated_at)
  `).run(task)

  return task
}

export function updateTask(input: UpdateTaskInput): Task {
  const db = getDatabase()
  const existing = getTaskById(input.id)

  if (!existing) {
    throw new Error(`Task with id ${input.id} not found`)
  }
  const config = input.automation === undefined
    ? (existing.automation ? validateAutomationConfig(JSON.parse(existing.automation)) : null)
    : input.automation
  if (config && (config.require_review || config.source.type !== 'schedule') && (input.cli_tool ?? existing.cli_tool) === 'antigravity') {
    throw new Error('File, website and review tasks require Claude or Codex')
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
    automation: input.automation !== undefined
      ? (input.automation ? JSON.stringify(validateAutomationConfig(input.automation)) : null)
      : existing.automation,
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
      automation = @automation,
      updated_at = @updated_at
    WHERE id = @id
  `).run(updated)

  // Editing a retired workflow converts it into a regular task. Its original
  // steps remain in archived_workflows for recovery.
  const columns = db.pragma('table_info(tasks)') as Array<{ name: string }>
  if (columns.some((column) => column.name === 'steps')) {
    db.prepare('UPDATE tasks SET steps = NULL WHERE id = ?').run(input.id)
  }

  return updated
}

export function deleteTask(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM inbox_claims WHERE task_id = ?').run(id)
  db.prepare('DELETE FROM website_state WHERE task_id = ?').run(id)
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
}

export function getWebsiteState(taskId: string, url: string): { hash: string; content: string } | null {
  const row = getDatabase().prepare('SELECT content_hash, content FROM website_state WHERE task_id = ? AND url = ?')
    .get(taskId, url) as { content_hash: string; content: string } | undefined
  return row ? { hash: row.content_hash, content: row.content } : null
}

export function setWebsiteState(taskId: string, url: string, hash: string, content: string): void {
  getDatabase().prepare(`
    INSERT INTO website_state (task_id, url, content_hash, content, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET url=excluded.url, content_hash=excluded.content_hash,
      content=excluded.content, updated_at=excluded.updated_at
  `).run(taskId, url, hash, content, new Date().toISOString())
}

export function claimInboxFile(taskId: string, path: string, modifiedAtMs: number, size: number): boolean {
  const result = getDatabase().prepare(`
    INSERT OR IGNORE INTO inbox_claims (task_id, path, modified_at_ms, size, status)
    VALUES (?, ?, ?, ?, 'running')
  `).run(taskId, path, Math.trunc(modifiedAtMs), size)
  return result.changes === 1
}

export function finishInboxFile(taskId: string, path: string, modifiedAtMs: number, size: number,
  status: 'success' | 'failed', logId: string): void {
  getDatabase().prepare(`
    UPDATE inbox_claims SET status = ?, log_id = ?
    WHERE task_id = ? AND path = ? AND modified_at_ms = ? AND size = ?
  `).run(status, logId, taskId, path, Math.trunc(modifiedAtMs), size)
}

export function toggleTask(id: string): Task {
  const db = getDatabase()
  const task = getTaskById(id)

  if (!task) {
    throw new Error(`Task with id ${id} not found`)
  }

  const columns = db.pragma('table_info(tasks)') as Array<{ name: string }>
  if (columns.some((column) => column.name === 'steps')) {
    const legacy = db.prepare('SELECT steps FROM tasks WHERE id = ?').get(id) as { steps: string | null }
    if (legacy.steps !== null) throw new Error('Edit this retired workflow before enabling it')
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
    error: null,
    exit_code: null
  }

  db.prepare(`
    INSERT INTO execution_logs (id, task_id, started_at, finished_at, status, output, error, exit_code)
    VALUES (@id, @task_id, @started_at, @finished_at, @status, @output, @error, @exit_code)
  `).run(log)

  return log
}

export function updateExecutionLog(
  id: string,
  update: { status: 'success' | 'failed' | 'cancelled' | 'pending_review'; output?: string; error?: string; exitCode?: number | null }
): ExecutionLog {
  const db = getDatabase()
  const now = new Date().toISOString()

  db.prepare(`
    UPDATE execution_logs SET
      finished_at = ?,
      status = ?,
      output = ?,
      error = ?,
      exit_code = ?
    WHERE id = ?
  `).run(now, update.status, update.output ?? null, update.error ?? null, update.exitCode ?? null, id)

  return db.prepare('SELECT * FROM execution_logs WHERE id = ?').get(id) as ExecutionLog
}

export function finishReviewedLog(id: string, status: 'success' | 'failed' | 'cancelled', output: string | null, error: string | null = null): ExecutionLog {
  getDatabase().prepare(`UPDATE execution_logs SET status = ?, output = ?, error = ? WHERE id = ?`)
    .run(status, output, error, id)
  return getExecutionLogById(id) as ExecutionLog
}

export function saveRunSnapshot(snapshot: RunSnapshot): void {
  getDatabase().prepare(`
    INSERT INTO run_snapshots (log_id, prompt, system_instruction, provider, fallback_provider, model, attachment_paths,
      add_dirs, project_path, skip_permissions, mcp_tools, source_path, source_size, source_modified_at_ms, source_url,
      result_type, require_review, destination, email_to, replay_of, proposed_file_name, review_status, created_at)
    VALUES (@log_id, @prompt, @system_instruction, @provider, @fallback_provider, @model, @attachment_paths,
      @add_dirs, @project_path, @skip_permissions, @mcp_tools, @source_path, @source_size, @source_modified_at_ms, @source_url,
      @result_type, @require_review, @destination, @email_to, @replay_of, @proposed_file_name, @review_status, @created_at)
    ON CONFLICT(log_id) DO UPDATE SET
      provider=excluded.provider, model=excluded.model, proposed_file_name=excluded.proposed_file_name,
      review_status=excluded.review_status
  `).run({
    ...snapshot,
    attachment_paths: JSON.stringify(snapshot.attachment_paths),
    add_dirs: JSON.stringify(snapshot.add_dirs),
    skip_permissions: snapshot.skip_permissions ? 1 : 0,
    require_review: snapshot.require_review ? 1 : 0,
    mcp_tools: JSON.stringify(snapshot.mcp_tools)
  })
}

export function getRunSnapshot(logId: string): RunSnapshot | null {
  const row = getDatabase().prepare('SELECT * FROM run_snapshots WHERE log_id = ?').get(logId) as
    (Omit<RunSnapshot, 'attachment_paths' | 'add_dirs' | 'mcp_tools' | 'skip_permissions' | 'require_review'> & {
      attachment_paths: string; add_dirs: string; mcp_tools: string; skip_permissions: number; require_review: number
    }) | undefined
  if (!row) return null
  return {
    ...row,
    provider: row.provider as ProviderId,
    attachment_paths: JSON.parse(row.attachment_paths) as string[],
    add_dirs: JSON.parse(row.add_dirs) as string[],
    mcp_tools: JSON.parse(row.mcp_tools) as string[],
    skip_permissions: row.skip_permissions === 1,
    require_review: row.require_review === 1
  }
}

export function updateRunReview(logId: string, status: RunSnapshot['review_status'], proposedFileName?: string | null): void {
  getDatabase().prepare(`UPDATE run_snapshots SET review_status = ?, proposed_file_name = COALESCE(?, proposed_file_name) WHERE log_id = ?`)
    .run(status, proposedFileName ?? null, logId)
}

export function claimRunReview(logId: string): boolean {
  return getDatabase().prepare(`UPDATE run_snapshots SET review_status = 'applying'
    WHERE log_id = ? AND review_status = 'pending'`).run(logId).changes === 1
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

export function searchExecutionLogs(input: LogSearchInput): LogSearchResult {
  const db = getDatabase()
  const query = typeof input?.query === 'string' ? input.query.trim().slice(0, 120) : ''
  const status = input?.status
  const requestedLimit = typeof input?.limit === 'number' && Number.isFinite(input.limit) ? input.limit : 50
  const requestedOffset = typeof input?.offset === 'number' && Number.isFinite(input.offset) ? input.offset : 0
  const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
  const offset = Math.max(0, Math.trunc(requestedOffset))
  const conditions: string[] = []
  const params: Array<string> = []

  if (query) {
    conditions.push("instr(lower(COALESCE(t.name, '')), lower(?)) > 0")
    params.push(query)
  }
  if (status && status !== 'all' && ['running', 'success', 'failed', 'cancelled', 'pending_review'].includes(status)) {
    conditions.push('el.status = ?')
    params.push(status)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const total = (db.prepare(`
    SELECT COUNT(*) AS total FROM execution_logs el
    LEFT JOIN tasks t ON t.id = el.task_id ${where}
  `).get(...params) as { total: number }).total
  const logs = db.prepare(`
    SELECT el.id, el.task_id, el.started_at, el.finished_at, el.status, el.exit_code,
      NULL AS output, NULL AS error, t.name AS task_name
    FROM execution_logs el LEFT JOIN tasks t ON t.id = el.task_id
    ${where} ORDER BY el.started_at DESC, el.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as ExecutionLogWithTask[]

  return { logs, total }
}

export function getDashboardLogData(now: Date): Pick<DashboardData, 'executions24h' | 'activity24h' | 'recent_runs' | 'recent_failures' | 'pending_reviews' | 'top_tasks' | 'duration14d'> {
  const db = getDatabase()
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const since14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const executions24h = db.prepare(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(status = 'success'), 0) AS success,
      COALESCE(SUM(status = 'failed'), 0) AS failed,
      COALESCE(SUM(status = 'running'), 0) AS running,
      COALESCE(SUM(status = 'cancelled'), 0) AS cancelled,
      COALESCE(SUM(status = 'pending_review'), 0) AS pending_review
    FROM execution_logs WHERE started_at >= ?
  `).get(since24h) as DashboardData['executions24h']
  const activity24h = db.prepare(`
    SELECT substr(started_at, 1, 13) AS hour,
      COALESCE(SUM(status = 'success'), 0) AS success,
      COALESCE(SUM(status = 'failed'), 0) AS failed,
      COALESCE(SUM(status = 'running'), 0) AS running,
      COALESCE(SUM(status = 'cancelled'), 0) AS cancelled,
      COALESCE(SUM(status = 'pending_review'), 0) AS pending_review
    FROM execution_logs WHERE started_at >= ?
    GROUP BY substr(started_at, 1, 13) ORDER BY hour
  `).all(since24h) as DashboardData['activity24h']
  const recent_runs = db.prepare(`
    SELECT el.id, el.task_id, t.name AS task_name, el.started_at, el.finished_at,
      el.status, substr(el.error, 1, 180) AS error
    FROM execution_logs el LEFT JOIN tasks t ON t.id = el.task_id
    ORDER BY el.started_at DESC LIMIT 6
  `).all() as DashboardData['recent_runs']
  const recent_failures = db.prepare(`
    SELECT el.id, el.task_id, t.name AS task_name, el.started_at, el.finished_at,
      el.status, substr(el.error, 1, 180) AS error
    FROM execution_logs el LEFT JOIN tasks t ON t.id = el.task_id
    WHERE el.status = 'failed' AND el.started_at >= ?
    ORDER BY el.started_at DESC LIMIT 3
  `).all(since7d) as DashboardData['recent_failures']
  const pending_reviews = db.prepare(`
    SELECT el.id, el.task_id, t.name AS task_name, el.started_at, el.finished_at,
      el.status, NULL AS error
    FROM execution_logs el LEFT JOIN tasks t ON t.id = el.task_id
    WHERE el.status = 'pending_review'
    ORDER BY el.started_at DESC LIMIT 3
  `).all() as DashboardData['pending_reviews']
  const top_tasks = db.prepare(`
    SELECT el.task_id, t.name AS task_name, COUNT(*) AS total,
      COALESCE(SUM(el.status = 'failed'), 0) AS failed
    FROM execution_logs el LEFT JOIN tasks t ON t.id = el.task_id
    WHERE el.started_at >= ?
    GROUP BY el.task_id ORDER BY total DESC, el.task_id LIMIT 4
  `).all(since7d) as DashboardData['top_tasks']
  const completedRuns = db.prepare(`
    SELECT el.id, el.task_id, t.name AS task_name, el.started_at, el.finished_at
    FROM execution_logs el LEFT JOIN tasks t ON t.id = el.task_id
    WHERE el.started_at >= ? AND el.finished_at IS NOT NULL
      AND el.status IN ('success', 'failed')
  `).all(since14d) as Array<{ id: string; task_id: string; task_name: string | null; started_at: string; finished_at: string }>
  const durations = completedRuns.map((run) => ({
    id: run.id,
    task_id: run.task_id,
    task_name: run.task_name,
    started_at: run.started_at,
    duration_ms: new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
  })).filter((run) => Number.isFinite(run.duration_ms) && run.duration_ms >= 0)
  durations.sort((a, b) => a.duration_ms - b.duration_ms)
  const percentile = (fraction: number): number | null => {
    if (durations.length === 0) return null
    const position = fraction * (durations.length - 1)
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    return Math.round(durations[lower].duration_ms +
      (durations[upper].duration_ms - durations[lower].duration_ms) * (position - lower))
  }
  const byTask = new Map<string, typeof durations>()
  for (const run of durations) {
    const runs = byTask.get(run.task_id) ?? []
    runs.push(run)
    byTask.set(run.task_id, runs)
  }
  const anomalies: DashboardData['duration14d']['anomalies'] = []
  for (const runs of byTask.values()) {
    if (runs.length < 4) continue
    const latest = [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at))[0]
    const prior = runs.filter((run) => run.id !== latest.id).map((run) => run.duration_ms).sort((a, b) => a - b)
    const middle = Math.floor(prior.length / 2)
    const baseline = prior.length % 2 === 0 ? (prior[middle - 1] + prior[middle]) / 2 : prior[middle]
    if (latest.duration_ms >= baseline * 2 && latest.duration_ms - baseline >= 60_000) {
      anomalies.push({ ...latest, baseline_ms: Math.round(baseline) })
    }
  }
  anomalies.sort((a, b) => (b.duration_ms - b.baseline_ms) - (a.duration_ms - a.baseline_ms))
  const duration14d: DashboardData['duration14d'] = {
    count: durations.length,
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    slowest: durations.slice(-3).reverse(),
    anomalies: anomalies.slice(0, 3)
  }
  return { executions24h, activity24h, recent_runs, recent_failures, pending_reviews, top_tasks, duration14d }
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
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  const busy = db.prepare(`SELECT COUNT(*) AS count FROM execution_logs WHERE id IN (${placeholders}) AND status IN ('running', 'pending_review')`)
    .get(...ids) as { count: number }
  if (busy.count > 0) throw new Error('Running or pending review logs cannot be deleted')
  db.transaction(() => {
    db.prepare(`DELETE FROM run_snapshots WHERE log_id IN (${placeholders})`).run(...ids)
    db.prepare(`DELETE FROM execution_logs WHERE id IN (${placeholders})`).run(...ids)
  })()
  for (const id of ids) {
    if (/^[0-9a-f-]{36}$/i.test(id)) rmSync(join(app.getPath('userData'), 'run-inputs', id), { recursive: true, force: true })
  }
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
