import { isAbsolute, relative, resolve } from 'path'
import type { AutomationConfig, ProviderId } from '../shared/types'

const providers = new Set<ProviderId>(['claude', 'codex', 'antigravity'])

export function validateAutomationConfig(value: unknown): AutomationConfig {
  if (!value || typeof value !== 'object') throw new Error('Invalid automation configuration')
  const config = value as Partial<AutomationConfig>
  const source = config.source
  const result = config.result
  if (!source || !result) throw new Error('Automation source and result are required')

  if (source.type === 'folder') {
    if (typeof source.path !== 'string' || !isAbsolute(source.path)) {
      throw new Error('Folder source requires an absolute path')
    }
  } else if (source.type === 'website') {
    try {
      const url = new URL(source.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
    } catch {
      throw new Error('Website source requires an HTTP or HTTPS URL')
    }
  } else if (source.type !== 'schedule') {
    throw new Error('Unknown automation source')
  }

  if (result.type === 'organize-file') {
    if (source.type !== 'folder' || typeof result.destination !== 'string' || !isAbsolute(result.destination)) {
      throw new Error('File destination requires a folder source and absolute path')
    }
    const from = resolve(source.path)
    const to = resolve(result.destination)
    const nested = relative(from, to)
    if (!nested || (!nested.startsWith('..') && !isAbsolute(nested))) {
      throw new Error('File destination must be outside the watched folder')
    }
    if (config.require_review !== true) throw new Error('Organized files require review')
  } else if (result.type !== 'report') {
    throw new Error('Unknown automation result')
  }

  if (typeof config.require_review !== 'boolean') throw new Error('Review setting is required')
  if (config.fallback_provider !== null && !providers.has(config.fallback_provider as ProviderId)) {
    throw new Error('Invalid fallback provider')
  }
  return config as AutomationConfig
}

export function parseAutomationConfig(raw: string | null): AutomationConfig {
  return raw ? validateAutomationConfig(JSON.parse(raw)) : {
    source: { type: 'schedule' }, result: { type: 'report' },
    require_review: false, fallback_provider: null
  }
}
