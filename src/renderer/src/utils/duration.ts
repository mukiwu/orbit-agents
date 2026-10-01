export function formatDurationMs(diffMs: number): string {
  if (!Number.isFinite(diffMs) || diffMs < 0) return '—'
  if (diffMs < 1000) return `${Math.round(diffMs)}ms`
  if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`

  const totalSeconds = Math.round(diffMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
}

export function formatDuration(start: string, end: string): string {
  return formatDurationMs(new Date(end).getTime() - new Date(start).getTime())
}
