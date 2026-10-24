import { describe, it, expect } from 'vitest'
import { readAutomationConfig } from './automation'

const scheduleReport = {
  source: { type: 'schedule' }, result: { type: 'report' },
  require_review: false, fallback_provider: null
}

describe('readAutomationConfig', () => {
  it('returns the default configuration for a task without automation', () => {
    expect(readAutomationConfig(null)).toEqual(scheduleReport)
  })

  it('reads a stored configuration', () => {
    const folder = {
      source: { type: 'folder', path: '/inbox' }, result: { type: 'report' },
      require_review: true, fallback_provider: 'codex'
    }
    expect(readAutomationConfig(JSON.stringify(folder))).toEqual(folder)
  })

  it('falls back to the default configuration when the stored JSON is unreadable', () => {
    expect(readAutomationConfig('{not json')).toEqual(scheduleReport)
  })

  it('falls back to the default configuration when the stored value has no source or result', () => {
    expect(readAutomationConfig('{}')).toEqual(scheduleReport)
    expect(readAutomationConfig('null')).toEqual(scheduleReport)
  })
})
