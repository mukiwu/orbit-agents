import { describe, it, expect } from 'vitest'
import { mapLegacyTask } from './migrations'

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
