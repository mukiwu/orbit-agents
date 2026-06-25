interface LegacyTaskRow {
  cli_tool: string
  model: string | null
  enabled: number
}

interface LegacyTaskPatch {
  cli_tool: 'claude'
  model: 'sonnet'
  enabled: 0
  needs_review: 1
}

export function mapLegacyTask(row: LegacyTaskRow): LegacyTaskPatch | null {
  if (row.cli_tool === 'gemini' || (row.model ?? '').startsWith('gemini')) {
    return { cli_tool: 'claude', model: 'sonnet', enabled: 0, needs_review: 1 }
  }
  return null
}
