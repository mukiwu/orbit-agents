import { describe, it, expect } from 'vitest'
import { buildAntigravityArgs, parseAntigravityOutput } from './antigravity'
import type { ExecutionContext } from '../types'

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    prompt: 'do the thing', systemInstruction: 'UNATTENDED', model: 'gemini-3-pro',
    mcpTools: [], imagePaths: [], addDirs: [], projectPath: null, skipPermissions: true, ...over
  }
}

describe('buildAntigravityArgs', () => {
  it('runs non-interactive with --print', () => {
    expect(buildAntigravityArgs(ctx())).toContain('--print')
  })
  it('adds skip-permissions only when enabled', () => {
    expect(buildAntigravityArgs(ctx({ skipPermissions: true }))).toContain('--dangerously-skip-permissions')
    expect(buildAntigravityArgs(ctx({ skipPermissions: false }))).not.toContain('--dangerously-skip-permissions')
  })
  it('passes model and add-dir', () => {
    const args = buildAntigravityArgs(ctx({ model: 'gemini-3-pro', addDirs: ['/a'] }))
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-3-pro')
    expect(args).toContain('--add-dir')
  })
  it('prefixes unattended instruction into the prompt', () => {
    const args = buildAntigravityArgs(ctx({ prompt: 'P', systemInstruction: 'SI' }))
    expect(args[args.length - 1].startsWith('SI')).toBe(true)
  })
})

describe('parseAntigravityOutput', () => {
  it('passes plain text through trimmed', () => {
    expect(parseAntigravityOutput('  hello  ')).toBe('hello')
  })
})
