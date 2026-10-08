import type Database from 'better-sqlite3'

interface LegacyTaskRow {
  cli_tool: string
  model: string | null
  enabled: number
}

interface LegacyTaskPatch {
  cli_tool: 'claude'
  model: 'sonnet'
  enabled: 0
  needs_review: 1
}

export function mapLegacyTask(row: LegacyTaskRow): LegacyTaskPatch | null {
  if (row.cli_tool === 'gemini' || (row.model ?? '').startsWith('gemini')) {
    return { cli_tool: 'claude', model: 'sonnet', enabled: 0, needs_review: 1 }
  }
  return null
}

export function disableLegacyWorkflows(db: Database.Database): void {
  const columns = db.pragma('table_info(tasks)') as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'steps')) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS archived_workflows (
      task_id TEXT PRIMARY KEY,
      steps TEXT NOT NULL,
      archived_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO archived_workflows (task_id, steps, archived_at)
      SELECT id, steps, datetime('now') FROM tasks WHERE steps IS NOT NULL;
    UPDATE tasks SET enabled = 0, needs_review = 1 WHERE steps IS NOT NULL;
  `)
}
