import { describe, it, expect, beforeEach } from 'vitest'
import { t, setMainLocale } from './i18n'

describe('main translator', () => {
  beforeEach(() => setMainLocale('en'))

  it('translates a key for the active locale', () => {
    setMainLocale('zh-TW')
    expect(t('common.running')).toBe('執行中')
    setMainLocale('en')
    expect(t('common.running')).toBe('Running')
  })
  it('returns the key when missing', () => {
    expect(t('nope.missing')).toBe('nope.missing')
  })
  it('interpolates vars with {{name}} syntax', () => {
    // relies on a key main.test.greeting = "Hi {{name}}" added in en.json by this task
    expect(t('main.test.greeting', { name: 'Mu' })).toBe('Hi Mu')
  })
})
