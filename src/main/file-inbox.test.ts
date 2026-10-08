import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listInboxCandidates } from './file-inbox'

describe('listInboxCandidates', () => {
  it('finds settled files in the inbox without following links or subfolders', () => {
    const root = mkdtempSync(join(tmpdir(), 'orbit-inbox-'))
    try {
      writeFileSync(join(root, 'invoice.pdf'), 'pdf')
      writeFileSync(join(root, '.temporary.txt'), 'draft')
      writeFileSync(join(root, 'program.exe'), 'binary')
      mkdirSync(join(root, 'Processed'))
      writeFileSync(join(root, 'Processed', 'old.pdf'), 'old')
      symlinkSync(join(root, 'invoice.pdf'), join(root, 'linked.pdf'))

      const files = listInboxCandidates(root, { createdAtMs: 0, nowMs: Date.now() + 10_000 })
      expect(files.map((file) => file.path)).toEqual([join(root, 'invoice.pdf')])
      expect(files[0].size).toBe(3)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
