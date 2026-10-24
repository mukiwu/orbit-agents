import type { AutomationConfig } from './types'

// Returns a fresh copy so callers can modify it without affecting each other
export function defaultAutomationConfig(): AutomationConfig {
  return {
    source: { type: 'schedule' }, result: { type: 'report' },
    require_review: false, fallback_provider: null
  }
}

// Lenient reader for display purposes; unreadable legacy values fall back to the default
export function readAutomationConfig(raw: string | null): AutomationConfig {
  if (!raw) return defaultAutomationConfig()
  try {
    const config = JSON.parse(raw) as Partial<AutomationConfig> | null
    if (config?.source && config.result) return config as AutomationConfig
  } catch { /* fall through to the default */ }
  return defaultAutomationConfig()
}
