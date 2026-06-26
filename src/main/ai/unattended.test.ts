import { describe, it, expect } from 'vitest'
import { buildUnattendedInstruction, prefixUnattended } from './unattended'

describe('unattended instruction', () => {
  it('tells the agent it runs unattended and must not ask questions', () => {
    const text = buildUnattendedInstruction('en')
    expect(text.toLowerCase()).toContain('unattended')
    expect(text.toLowerCase()).toMatch(/do not ask|never ask/)
  })

  it('prefixes a prompt with the instruction followed by the original prompt', () => {
    const out = prefixUnattended('Summarize the news', 'en')
    expect(out.startsWith(buildUnattendedInstruction('en'))).toBe(true)
    expect(out).toContain('Summarize the news')
  })

  it('directs the agent to reply in Traditional Chinese for the zh-TW locale', () => {
    const text = buildUnattendedInstruction('zh-TW')
    expect(text).toMatch(/繁體中文|Traditional Chinese/)
  })

  it('directs the agent to reply in English for the en locale', () => {
    const text = buildUnattendedInstruction('en')
    expect(text.toLowerCase()).toContain('english')
  })

  it('asks for readable Markdown with paragraphs separated by blank lines', () => {
    const text = buildUnattendedInstruction('zh-TW').toLowerCase()
    expect(text).toContain('markdown')
    expect(text).toMatch(/blank line|paragraph/)
  })
})
