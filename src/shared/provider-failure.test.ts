import { describe, expect, it } from 'vitest'
import { classifyProviderFailure } from './provider-failure'

describe('classifyProviderFailure', () => {
  it('identifies login and model problems for handoff guidance', () => {
    expect(classifyProviderFailure('Unauthorized (401): sign in')).toBe('auth')
    expect(classifyProviderFailure('Model gpt-x not found')).toBe('model')
    expect(classifyProviderFailure('spawn codex ENOENT')).toBe('cli')
  })
})
