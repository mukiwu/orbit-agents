import { describe, it, expect } from 'vitest'
import { buildClaudeArgs, parseClaudeOutput } from './claude'
import type { ExecutionContext } from '../types'

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    prompt: 'do the thing',
    systemInstruction: 'UNATTENDED',
    model: 'sonnet',
    mcpTools: [],
    imagePaths: [],
    addDirs: [],
    projectPath: null,
    skipPermissions: true,
    ...over
  }
}

describe('buildClaudeArgs', () => {
  it('always runs non-interactive with stream-json', () => {
    const args = buildClaudeArgs(ctx())
    expect(args).toContain('--print')
    expect(args.join(' ')).toContain('--output-format stream-json')
  })

  it('injects the unattended instruction via append-system-prompt', () => {
    const args = buildClaudeArgs(ctx({ systemInstruction: 'BE-AUTONOMOUS' }))
    const i = args.indexOf('--append-system-prompt')
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe('BE-AUTONOMOUS')
  })

  it('adds skip-permissions only when enabled', () => {
    expect(buildClaudeArgs(ctx({ skipPermissions: true }))).toContain('--dangerously-skip-permissions')
    expect(buildClaudeArgs(ctx({ skipPermissions: false }))).not.toContain('--dangerously-skip-permissions')
  })

  it('passes model and add-dir', () => {
    const args = buildClaudeArgs(ctx({ model: 'opus', addDirs: ['/a', '/b'] }))
    const m = args.indexOf('--model')
    expect(args[m + 1]).toBe('opus')
    expect(args.filter(a => a === '--add-dir')).toHaveLength(2)
  })
})

describe('parseClaudeOutput', () => {
  it('extracts assistant text from stream-json lines', () => {
    const raw = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }),
      JSON.stringify({ type: 'result', result: 'hello' })
    ].join('\n')
    expect(parseClaudeOutput(raw)).toBe('hello')
  })
})
