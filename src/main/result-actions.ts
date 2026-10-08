import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { basename, extname, join } from 'path'

export function proposedFileName(output: string, originalPath: string): string {
  const json = output.match(/"filename"\s*:\s*"((?:\\.|[^"\\])*)"/)
  let raw: string | undefined
  if (json) {
    try { raw = JSON.parse(`"${json[1]}"`) as string } catch { /* use original name */ }
  }
  const ext = extname(originalPath)
  const originalStem = basename(originalPath, ext)
  const requested = raw || originalStem
  const requestedStem = ext && requested.toLowerCase().endsWith(ext.toLowerCase())
    ? requested.slice(0, -ext.length) : requested
  const stem = requestedStem
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').trim().slice(0, 100)
  const safeStem = stem && !['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1'].includes(stem.toUpperCase()) ? stem : 'file'
  return `${safeStem}${ext}`
}

export function moveReviewedFile(
  sourcePath: string, destination: string, fileName: string,
  expected: { size: number; modifiedAtMs: number }
): string {
  const source = lstatSync(sourcePath)
  if (!source.isFile() || source.size !== expected.size || Math.trunc(source.mtimeMs) !== Math.trunc(expected.modifiedAtMs)) {
    throw new Error('Source file changed since review; run the task again')
  }
  if (basename(fileName) !== fileName || fileName === '.' || fileName === '..') throw new Error('Invalid file name')
  mkdirSync(destination, { recursive: true })
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  let target = join(destination, fileName)
  for (let i = 2; existsSync(target); i++) target = join(destination, `${stem} (${i})${ext}`)
  copyFileSync(sourcePath, target, constants.COPYFILE_EXCL)
  try {
    const afterCopy = statSync(sourcePath)
    if (afterCopy.size !== expected.size || Math.trunc(afterCopy.mtimeMs) !== Math.trunc(expected.modifiedAtMs)) {
      throw new Error('Source file changed during approval; run the task again')
    }
    unlinkSync(sourcePath)
  } catch (error) {
    unlinkSync(target)
    throw error
  }
  return target
}
