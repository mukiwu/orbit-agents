import { describe, it, expect, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { disableLegacyWorkflows, mapLegacyTask } from './migrations'

describe('mapLegacyTask', () => {
  it('converts gemini cli_tool tasks to disabled claude tasks needing review', () => {
    const out = mapLegacyTask({ cli_tool: 'gemini', model: 'gemini-3', enabled: 1 })
    expect(out).toEqual({ cli_tool: 'claude', model: 'sonnet', enabled: 0, needs_review: 1 })
  })

  it('converts tasks with gemini model prefix to disabled claude tasks needing review', () => {
    const out = mapLegacyTask({ cli_tool: 'claude', model: 'gemini-2.5', enabled: 1 })
    expect(out).toEqual({ cli_tool: 'claude', model: 'sonnet', enabled: 0, needs_review: 1 })
  })

  it('leaves non-gemini tasks unchanged (returns null)', () => {
    const out = mapLegacyTask({ cli_tool: 'claude', model: 'opus', enabled: 1 })
    expect(out).toBeNull()
  })
})

describe('disableLegacyWorkflows', () => {
  it('keeps old workflow data but disables tasks that can no longer run', () => {
    const exec = vi.fn()
    const db = { pragma: () => [{ name: 'steps' }], exec } as unknown as Database.Database
    disableLegacyWorkflows(db)
    expect(exec).toHaveBeenCalledOnce()
    const sql = exec.mock.calls[0][0] as string
    expect(sql).toContain('INSERT OR IGNORE INTO archived_workflows')
    expect(sql).toContain('SELECT id, steps')
    expect(sql).toContain('UPDATE tasks SET enabled = 0, needs_review = 1 WHERE steps IS NOT NULL')
  })
})
