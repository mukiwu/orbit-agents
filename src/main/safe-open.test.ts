import { describe, it, expect } from 'vitest'
import { isPreviewableFileUrl } from './safe-open'

describe('isPreviewableFileUrl', () => {
  it('allows document/preview file types', () => {
    expect(isPreviewableFileUrl('file:///Users/muki/weekly.html')).toBe(true)
    expect(isPreviewableFileUrl('file:///Users/muki/report.pdf')).toBe(true)
    expect(isPreviewableFileUrl('file:///Users/muki/cover.png')).toBe(true)
  })

  it('is case-insensitive on the extension', () => {
    expect(isPreviewableFileUrl('file:///Users/muki/WEEKLY.HTML')).toBe(true)
  })

  it('decodes percent-encoded paths with spaces', () => {
    expect(isPreviewableFileUrl('file:///Users/muki/Mobile%20Documents/weekly.html')).toBe(true)
  })

  it('rejects executables and scripts that would run code', () => {
    expect(isPreviewableFileUrl('file:///Users/muki/evil.command')).toBe(false)
    expect(isPreviewableFileUrl('file:///Applications/Calculator.app')).toBe(false)
    expect(isPreviewableFileUrl('file:///Users/muki/run.sh')).toBe(false)
  })

  it('rejects files with no extension and non-file urls', () => {
    expect(isPreviewableFileUrl('file:///Users/muki/noext')).toBe(false)
    expect(isPreviewableFileUrl('https://muki.tw')).toBe(false)
  })
})
