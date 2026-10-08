import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { moveReviewedFile, proposedFileName } from './result-actions'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('reviewed file actions', () => {
  it('sanitizes proposed names while preserving the source extension', () => {
    expect(proposedFileName('```json\n{"filename":"../Q4: report.pdf"}\n```', '/inbox/scan.pdf'))
      .toBe('Q4 report.pdf')
  })

  it('moves an unchanged file only after approval and avoids overwriting', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-result-'))
    dirs.push(dir)
    const source = join(dir, 'scan.pdf')
    const destination = join(dir, 'out')
    writeFileSync(source, 'original')
    mkdirSync(destination)
    writeFileSync(join(destination, 'invoice.pdf'), 'keep')
    const info = statSync(source)
    const target = moveReviewedFile(source, destination, 'invoice.pdf', { size: info.size, modifiedAtMs: info.mtimeMs })
    expect(target).toBe(join(destination, 'invoice (2).pdf'))
    expect(readFileSync(join(destination, 'invoice.pdf'), 'utf8')).toBe('keep')
    expect(readFileSync(target, 'utf8')).toBe('original')
  })

  it('refuses to move a changed source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-result-'))
    dirs.push(dir)
    const source = join(dir, 'scan.pdf')
    writeFileSync(source, 'changed')
    expect(() => moveReviewedFile(source, join(dir, 'out'), 'invoice.pdf', { size: 1, modifiedAtMs: 0 })).toThrow(/changed/)
  })
})
