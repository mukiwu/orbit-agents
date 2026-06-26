import en from '../shared/locales/en.json'
import zhTW from '../shared/locales/zh-TW.json'
import type { ResolvedLocale } from '../shared/i18n/resolveLocale'

const resources: Record<ResolvedLocale, Record<string, unknown>> = { en, 'zh-TW': zhTW }
let current: ResolvedLocale = 'en'

export function setMainLocale(locale: ResolvedLocale): void {
  current = locale
}

export function getMainLocale(): ResolvedLocale {
  return current
}

function lookup(obj: Record<string, unknown>, key: string): string | undefined {
  const val = key.split('.').reduce<unknown>(
    (acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
    obj
  )
  return typeof val === 'string' ? val : undefined
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const template = lookup(resources[current], key) ?? lookup(resources.en, key) ?? key
  if (!vars) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`
  )
}
