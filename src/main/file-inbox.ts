import { readdirSync, statSync } from 'fs'
import { extname, join } from 'path'

const ACCEPTED_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.pdf', '.docx',
  '.png', '.jpg', '.jpeg', '.gif', '.webp'
])

export interface InboxCandidate {
  path: string
  size: number
  modifiedAtMs: number
}

export function listInboxCandidates(
  directory: string,
  options: { createdAtMs: number; nowMs?: number; settleMs?: number; maxBytes?: number }
): InboxCandidate[] {
  const now = options.nowMs ?? Date.now()
  const settleMs = options.settleMs ?? 5_000
  const maxBytes = options.maxBytes ?? 25_000_000
  const files: InboxCandidate[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.') || !ACCEPTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
    const path = join(directory, entry.name)
    try {
      const stat = statSync(path)
      if (stat.size === 0 || stat.size > maxBytes) continue
      if (Math.max(stat.mtimeMs, stat.birthtimeMs) < options.createdAtMs) continue
      if (now - Math.max(stat.mtimeMs, stat.ctimeMs) < settleMs) continue
      files.push({ path, size: stat.size, modifiedAtMs: stat.mtimeMs })
    } catch {
      // A file may disappear while the directory is being scanned.
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path))
}
