import type { AiProvider, ProviderId } from './types'
import { claudeProvider } from './providers/claude'
import { codexProvider } from './providers/codex'
import { antigravityProvider } from './providers/antigravity'

const PROVIDERS: Record<ProviderId, AiProvider> = {
  claude: claudeProvider,
  codex: codexProvider,
  antigravity: antigravityProvider
}

export function getProvider(id: ProviderId): AiProvider {
  const p = PROVIDERS[id]
  if (!p) throw new Error(`Unknown provider: ${id}`)
  return p
}

export function listProviders(): AiProvider[] {
  return Object.values(PROVIDERS)
}

export { runProvider } from './runner'
export type { AiProvider, ProviderId, ExecutionContext } from './types'
