import { describe, expect, it } from 'vitest'
import { validateAutomationConfig } from './automation-config'

describe('validateAutomationConfig', () => {
  it('accepts a folder inbox with review before moving files', () => {
    const config = {
      source: { type: 'folder', path: '/tmp/inbox' },
      result: { type: 'organize-file', destination: '/tmp/sorted' },
      require_review: true,
      fallback_provider: 'codex'
    }
    expect(validateAutomationConfig(config)).toEqual(config)
  })

  it('rejects an output directory equal to the watched inbox', () => {
    expect(() => validateAutomationConfig({
      source: { type: 'folder', path: '/tmp/inbox' },
      result: { type: 'organize-file', destination: '/tmp/inbox' },
      require_review: true,
      fallback_provider: null
    })).toThrow(/destination/i)
  })

  it('rejects non-HTTP website sources', () => {
    expect(() => validateAutomationConfig({
      source: { type: 'website', url: 'file:///tmp/private' },
      result: { type: 'report' },
      require_review: false,
      fallback_provider: null
    })).toThrow(/website/i)
  })
})
