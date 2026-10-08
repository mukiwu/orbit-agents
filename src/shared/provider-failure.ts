export type ProviderFailureKind = 'auth' | 'model' | 'cli' | 'rate' | 'network' | 'other'

export function classifyProviderFailure(message: string): ProviderFailureKind {
  const text = message.toLowerCase()
  if (/\b(401|403|unauthori[sz]ed|sign.?in|log.?in|authentication|invalid.api.key|subscription)\b/.test(text)) return 'auth'
  if (/\b(model.*(not found|unsupported|unavailable|access|does not exist)|unknown model|invalid model|404)\b/.test(text)) return 'model'
  if (/\b(enoent|command not found|failed to execute|spawn.*failed|executable not found)\b/.test(text)) return 'cli'
  if (/\b(429|rate limit|too many requests|quota exceeded)\b/.test(text)) return 'rate'
  if (/\b(etimedout|econnreset|enotfound|network error|fetch failed)\b/.test(text)) return 'network'
  return 'other'
}
