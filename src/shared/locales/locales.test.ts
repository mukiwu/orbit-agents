import { describe, it, expect } from 'vitest'
import en from './en.json'
import zhTW from './zh-TW.json'

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    return v && typeof v === 'object' && !Array.isArray(v)
      ? flattenKeys(v as Record<string, unknown>, key)
      : [key]
  })
}

describe('locale resource parity', () => {
  it('en and zh-TW have identical key sets', () => {
    const enKeys = flattenKeys(en).sort()
    const zhKeys = flattenKeys(zhTW).sort()
    expect(zhKeys).toEqual(enKeys)
  })
})
