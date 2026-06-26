import { fileURLToPath } from 'url'
import { extname } from 'path'

// Document/preview file types the agent may legitimately link to. Everything
// else (scripts, apps, archives, …) is refused so a crafted file:// link in
// agent output cannot launch an executable via shell.openPath.
const PREVIEWABLE_EXT = new Set([
  '.html',
  '.htm',
  '.pdf',
  '.md',
  '.txt',
  '.csv',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp'
])

export function isPreviewableFileUrl(url: string): boolean {
  try {
    const ext = extname(fileURLToPath(url)).toLowerCase()
    return PREVIEWABLE_EXT.has(ext)
  } catch {
    return false
  }
}
