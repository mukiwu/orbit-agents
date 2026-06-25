export type LanguagePreference = 'system' | 'en' | 'zh-TW'
export type ResolvedLocale = 'en' | 'zh-TW'

export function resolveLocale(pref: LanguagePreference, systemLocale: string): ResolvedLocale {
  if (pref === 'en' || pref === 'zh-TW') return pref
  const lc = (systemLocale || '').toLowerCase()
  if (lc.startsWith('zh')) return 'zh-TW'
  return 'en'
}
