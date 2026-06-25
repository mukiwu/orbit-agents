import { describe, it, expect } from 'vitest'
import { buildCodexArgs, parseCodexOutput, codexProvider } from './codex'
import type { ExecutionContext } from '../types'

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    prompt: 'do the thing', systemInstruction: 'UNATTENDED', model: 'gpt-5.5',
    mcpTools: [], imagePaths: [], addDirs: [], projectPath: null, skipPermissions: false, ...over
  }
}

describe('buildCodexArgs', () => {
  it('uses exec subcommand with json streaming and skips git repo check', () => {
    const args = buildCodexArgs(ctx())
    expect(args[0]).toBe('exec')
    expect(args).toContain('--json')
    expect(args).toContain('--skip-git-repo-check')
  })

  it('maps skipPermissions=false to a sandbox and true to full bypass', () => {
    expect(buildCodexArgs(ctx({ skipPermissions: false })).join(' ')).toContain('--sandbox workspace-write')
    expect(buildCodexArgs(ctx({ skipPermissions: true }))).toContain('--dangerously-bypass-approvals-and-sandbox')
  })

  it('passes model, working dir and images', () => {
    const args = buildCodexArgs(ctx({ model: 'gpt-5.5', projectPath: '/proj', imagePaths: ['/a.png', '/b.png'] }))
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-5.5')
    expect(args[args.indexOf('-C') + 1]).toBe('/proj')
    expect(args.filter(a => a === '-i')).toHaveLength(2)
  })

  it('prefixes the unattended instruction into the prompt (no system-prompt flag)', () => {
    const args = buildCodexArgs(ctx({ prompt: 'P', systemInstruction: 'SI' }))
    const prompt = args[args.length - 1]
    expect(prompt.startsWith('SI')).toBe(true)
    expect(prompt).toContain('P')
    expect(args[args.length - 2]).toBe('--')
  })
})

describe('codexProvider.listModels', () => {
  it('offers the supported gpt-5.5 and gpt-5.4 models and not the deprecated gpt-5.3-codex', async () => {
    const values = (await codexProvider.listModels()).map(m => m.value)
    expect(values).toContain('gpt-5.5')
    expect(values).toContain('gpt-5.4')
    expect(values).not.toContain('gpt-5.3-codex')
  })
})

describe('parseCodexOutput', () => {
  it('extracts agent message text from JSONL events', () => {
    // 事件結構以 Task 1 spike 為準,以下為代表性樣本
    const raw = [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'answer' } })
    ].join('\n')
    expect(parseCodexOutput(raw)).toBe('answer')
  })
})
