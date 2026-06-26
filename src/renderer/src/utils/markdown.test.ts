import { describe, it, expect } from 'vitest'
import { safeMarkdownUrl, linkifyIframes } from './markdown'

describe('safeMarkdownUrl', () => {
  it('keeps file:// urls so the agent local previews stay clickable', () => {
    expect(safeMarkdownUrl('file:///Users/muki/weekly.html')).toBe('file:///Users/muki/weekly.html')
  })

  it('keeps http(s) and relative urls', () => {
    expect(safeMarkdownUrl('https://muki.tw')).toBe('https://muki.tw')
    expect(safeMarkdownUrl('./a.html')).toBe('./a.html')
    expect(safeMarkdownUrl('#top')).toBe('#top')
  })

  it('drops script-y schemes', () => {
    expect(safeMarkdownUrl('javascript:alert(1)')).toBe('')
    expect(safeMarkdownUrl('data:text/html,<script>')).toBe('')
  })
})

describe('linkifyIframes', () => {
  it('turns an <iframe src> into a markdown link so it opens externally', () => {
    const md = '前言\n<iframe src="file:///x/weekly.html" width="100%"></iframe>\n後語'
    expect(linkifyIframes(md, '開啟預覽')).toBe('前言\n[開啟預覽](file:///x/weekly.html)\n後語')
  })

  it('leaves content without iframes unchanged', () => {
    expect(linkifyIframes('just text', '開啟預覽')).toBe('just text')
  })
})
