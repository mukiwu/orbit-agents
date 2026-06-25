import { describe, it, expect } from 'vitest'
import { buildUnattendedInstruction, prefixUnattended } from './unattended'

describe('unattended instruction', () => {
  it('tells the agent it runs unattended and must not ask questions', () => {
    const text = buildUnattendedInstruction()
    expect(text.toLowerCase()).toContain('unattended')
    expect(text.toLowerCase()).toMatch(/do not ask|never ask/)
  })

  it('prefixes a prompt with the instruction followed by the original prompt', () => {
    const out = prefixUnattended('Summarize the news')
    expect(out.startsWith(buildUnattendedInstruction())).toBe(true)
    expect(out).toContain('Summarize the news')
  })
})
