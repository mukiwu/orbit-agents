import { readFileSync, readdirSync, statSync, lstatSync, realpathSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ProviderId, Skill, SkillScanResult } from '../shared/types'

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }

  const meta: Record<string, string> = {}
  const lines = match[1].split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const idx = line.indexOf(':')
    if (idx > 0) {
      const key = line.slice(0, idx).trim()
      const value = line.slice(idx + 1).trim()
      if (/^[>|][+-]?$/.test(value)) {
        const block: string[] = []
        while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1].trim())) {
          block.push(lines[++i].trim())
        }
        meta[key] = value.startsWith('|') ? block.join('\n').trim() : block.join(' ').replace(/\s+/g, ' ').trim()
      } else {
        meta[key] = value
      }
    }
  }
  return { meta, body: match[2] }
}

function scanSkillsDir(dirPath: string, scope: 'user' | 'project'): { skills: Skill[]; errors: string[] } {
  const skills: Skill[] = []
  const errors: string[] = []

  // Resolve the skills dir itself (could be a symlink)
  let resolvedDir: string
  try {
    resolvedDir = realpathSync(dirPath)
  } catch {
    return { skills, errors }
  }

  let entries: string[]
  try {
    entries = readdirSync(resolvedDir)
  } catch {
    return { skills, errors }
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) continue

    const entryPath = join(resolvedDir, entry)
    let resolvedPath: string

    try {
      // realpathSync resolves all symlinks in the path
      resolvedPath = realpathSync(entryPath)
      const stat = statSync(resolvedPath)
      if (!stat.isDirectory()) continue
    } catch {
      continue
    }

    // Look for SKILL.md
    const skillMdPath = join(resolvedPath, 'SKILL.md')
    try {
      const content = readFileSync(skillMdPath, 'utf-8')
      const { meta } = parseFrontmatter(content)

      const name = meta.name?.replace(/^["']|["']$/g, '') || entry
      if (name) {
        const isSymlink = entryPath !== resolvedPath
        console.log(`[Skills] Found skill: ${name} (${scope}${isSymlink ? ', symlink → ' + resolvedPath : ''})`)
        skills.push({
          name,
          description: meta.description || '',
          filePath: skillMdPath,
          scope
        })
      }
    } catch {
      // No SKILL.md in this directory, skip
    }
  }

  return { skills, errors }
}

export function scanSkills(projectPath?: string, provider: ProviderId = 'claude'): SkillScanResult {
  const allSkills: Skill[] = []
  const allErrors: string[] = []
  const home = homedir()
  const directories: Array<{ path: string; scope: 'user' | 'project' }> = provider === 'claude'
    ? [
        { path: join(home, '.claude', 'skills'), scope: 'user' },
        ...(projectPath ? [{ path: join(projectPath, '.claude', 'skills'), scope: 'project' as const }] : [])
      ]
    : provider === 'codex'
      ? [
          ...(projectPath ? [{ path: join(projectPath, '.agents', 'skills'), scope: 'project' as const }] : []),
          { path: join(home, '.agents', 'skills'), scope: 'user' },
          { path: join(home, '.codex', 'skills'), scope: 'user' }
        ]
      : [
          ...(projectPath ? [{ path: join(projectPath, '.agents', 'skills'), scope: 'project' as const }] : []),
          ...(projectPath ? [{ path: join(projectPath, '.agent', 'skills'), scope: 'project' as const }] : []),
          { path: join(home, '.gemini', 'antigravity-cli', 'skills'), scope: 'user' }
        ]

  // The same skill may be linked into multiple provider directories. Show each command once.
  const seenNames = new Set<string>()
  for (const directory of directories) {
    const result = scanSkillsDir(directory.path, directory.scope)
    for (const skill of result.skills) {
      if (seenNames.has(skill.name)) continue
      seenNames.add(skill.name)
      allSkills.push(skill)
    }
    allErrors.push(...result.errors)
  }

  return {
    skills: allSkills,
    projectPath,
    errors: allErrors.length > 0 ? allErrors : undefined
  }
}
