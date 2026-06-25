import { describe, it, expect } from 'vitest'
import { resolveLocale } from './resolveLocale'

describe('resolveLocale', () => {
  it('returns the explicit preference when not system', () => {
    expect(resolveLocale('en', 'zh-TW')).toBe('en')
    expect(resolveLocale('zh-TW', 'en-US')).toBe('zh-TW')
  })
  it('maps zh-* system locales to zh-TW', () => {
    expect(resolveLocale('system', 'zh-TW')).toBe('zh-TW')
    expect(resolveLocale('system', 'zh-Hant')).toBe('zh-TW')
    expect(resolveLocale('system', 'zh-Hant-TW')).toBe('zh-TW')
    expect(resolveLocale('system', 'zh')).toBe('zh-TW')
  })
  it('falls back to en for non-zh system locales', () => {
    expect(resolveLocale('system', 'en-US')).toBe('en')
    expect(resolveLocale('system', 'ja-JP')).toBe('en')
    expect(resolveLocale('system', '')).toBe('en')
  })
})
