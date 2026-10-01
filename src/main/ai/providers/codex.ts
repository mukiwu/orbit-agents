import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getSetting } from '../../database'
import type { AiProvider, ExecutionContext, ModelOption, ProviderResult } from '../types'
import type { McpServer } from '../../../shared/types'

export function resolveCodexCommand(): string {
  return getSetting('codex_cli_path') || 'codex'
}

function readConfiguredReasoningEffort(): string | null {
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  try {
    // model_reasoning_effort is a top-level Codex setting. Stop before tables
    // so a profile or model-specific setting cannot be mistaken for the default.
    const rootSettings = readFileSync(join(codexHome, 'config.toml'), 'utf8').split(/^\s*\[/m, 1)[0]
    const match = rootSettings.match(/^\s*model_reasoning_effort\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/m)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export function buildCodexArgs(
  ctx: ExecutionContext,
  configuredReasoningEffort = readConfiguredReasoningEffort()
): string[] {
  const args: string[] = ['exec', '--json', '--skip-git-repo-check']
  if (ctx.skipPermissions) {
    args.push('--dangerously-bypass-approvals-and-sandbox')
  } else {
    args.push('--sandbox', 'workspace-write')
  }
  if (ctx.model) args.push('-m', ctx.model)
  // The Codex API rejects max/ultra for GPT-5.5 even if the local CLI config
  // enables those values for newer models. xhigh is GPT-5.5's highest accepted
  // effort, so preserve the user's intent without overriding lower settings.
  if (ctx.model === 'gpt-5.5' && ['max', 'ultra'].includes(configuredReasoningEffort ?? '')) {
    args.push('-c', 'model_reasoning_effort=xhigh')
  }
  if (ctx.projectPath) args.push('-C', ctx.projectPath)
  for (const dir of ctx.addDirs) args.push('--add-dir', dir)
  for (const img of ctx.imagePaths) args.push('-i', img)
  // codex 沒有 system-prompt 旗標,把指示 prefix 進 prompt
  const fullPrompt = ctx.systemInstruction
    ? `${ctx.systemInstruction}\n\n${ctx.prompt}`
    : ctx.prompt
  args.push('--')
  args.push(fullPrompt)
  return args
}

const FALLBACK_CODEX_MODELS: ModelOption[] = [
  { value: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', desc: 'Offline fallback', stale: true },
  { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', desc: 'Offline fallback', stale: true },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', desc: 'Offline fallback', stale: true },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', desc: 'Offline fallback', stale: true },
  { value: 'gpt-5.5', label: 'GPT-5.5', desc: 'Offline fallback', stale: true },
  { value: 'gpt-5.4', label: 'GPT-5.4', desc: 'Offline fallback', stale: true }
]

interface CodexAppServerModel {
  id?: string
  model?: string
  displayName?: string
  isDefault?: boolean
}

interface CodexModelListResult {
  data?: CodexAppServerModel[]
  nextCursor?: string | null
}

export function parseCodexModelList(entries: CodexAppServerModel[]): ModelOption[] {
  return entries.flatMap((model) => {
    const value = model.model || model.id
    if (!value) return []
    const option: ModelOption = {
      value,
      label: model.displayName?.trim() || value
    }
    if (model.isDefault !== undefined) option.isDefault = model.isDefault
    return [option]
  })
}

async function listCodexModels(): Promise<ModelOption[]> {
  const cliPath = resolveCodexCommand()

  return new Promise((resolve) => {
    let settled = false
    let buffer = ''
    let currentRequestId = 1
    let nextRequestId = 2
    let timeout: NodeJS.Timeout
    const models: ModelOption[] = []

    const proc = spawn(cliPath, ['app-server'], {
      shell: process.platform === 'win32',
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true
    })

    const finish = (result: ModelOption[]) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      proc.kill()
      resolve(result.length > 0 ? result : FALLBACK_CODEX_MODELS)
    }

    const send = (message: Record<string, unknown>) => {
      if (settled || proc.stdin.destroyed) return
      try {
        proc.stdin.write(`${JSON.stringify(message)}\n`)
      } catch {
        finish(FALLBACK_CODEX_MODELS)
      }
    }

    const requestPage = (cursor?: string) => {
      currentRequestId = nextRequestId++
      const params: Record<string, unknown> = { includeHidden: false, limit: 100 }
      if (cursor) params.cursor = cursor
      send({ method: 'model/list', id: currentRequestId, params })
    }

    timeout = setTimeout(() => finish(FALLBACK_CODEX_MODELS), 20_000)

    proc.stdout.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        let message: {
          id?: number
          result?: CodexModelListResult
          error?: { message?: string }
        }
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }

        if (message.id === 1) {
          if (message.error) {
            finish(FALLBACK_CODEX_MODELS)
            return
          }
          send({ method: 'initialized', params: {} })
          if (settled) return
          requestPage()
          continue
        }

        if (message.id !== currentRequestId) continue
        if (message.error || !message.result) {
          finish(FALLBACK_CODEX_MODELS)
          return
        }

        for (const model of parseCodexModelList(message.result.data || [])) {
          const value = model.value
          if (!value || models.some((existing) => existing.value === value)) continue
          models.push(model)
        }

        if (message.result.nextCursor) {
          requestPage(message.result.nextCursor)
        } else {
          finish(models)
        }
      }
    })

    proc.on('error', () => finish(FALLBACK_CODEX_MODELS))
    proc.stdin.on('error', () => finish(FALLBACK_CODEX_MODELS))
    proc.on('close', () => {
      if (!settled) finish(FALLBACK_CODEX_MODELS)
    })

    send({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: {
          name: 'orbit-agents',
          title: 'Orbit Agents',
          version: '1.1.1'
        }
      }
    })
  })
}

export function parseCodexOutput(raw: string): string {
  // 依 Task 1 spike 的實際事件名稱解析。
  // 取 type 為 item.completed 且 item.type 為 agent_message 的 item.text;
  // 找不到就退回非 JSON 行的純文字。
  const lines = raw.split('\n').filter(l => l.trim())
  const texts: string[] = []
  for (const line of lines) {
    try {
      const ev = JSON.parse(line)
      const item = ev.item ?? ev
      if (
        item &&
        (item.type === 'agent_message' || item.type === 'assistant') &&
        typeof item.text === 'string'
      ) {
        texts.push(item.text)
      } else if (typeof ev.message === 'string') {
        texts.push(ev.message)
      }
    } catch {
      if (line.trim() && !line.startsWith('{')) texts.push(line)
    }
  }
  return texts.join('\n\n').trim() || raw.trim()
}

async function testCodex(): Promise<ProviderResult> {
  const cliPath = resolveCodexCommand()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const proc = spawn(cliPath, ['--version'], {
      shell: process.platform === 'win32',
      env: { ...process.env },
      windowsHide: true
    })

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          output: `Codex CLI found: ${stdout.trim()}`
        })
      } else {
        resolve({
          success: false,
          output: '',
          error: stderr.trim() || `Codex CLI not found or failed (exit code: ${code})`
        })
      }
    })

    proc.on('error', (err: Error) => {
      resolve({
        success: false,
        output: '',
        error: `Failed to execute Codex CLI: ${err.message}`
      })
    })
  })
}

async function listCodexMcps(): Promise<McpServer[]> {
  const cliPath = resolveCodexCommand()

  return new Promise((resolve) => {
    let stdout = ''

    const proc = spawn(cliPath, ['mcp', 'list'], {
      shell: process.platform === 'win32',
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.on('close', () => {
      const servers: McpServer[] = []
      const lines = stdout.split('\n')

      for (const line of lines) {
        const match = line.match(/^([^:]+):\s+.+/)
        if (match && !line.includes('Checking') && !line.startsWith(' ')) {
          const serverName = match[1].trim()
          if (serverName && !serverName.includes('MCP') && serverName.length < 50) {
            servers.push({
              name: serverName,
              tools: ['*']
            })
          }
        }
      }

      resolve(servers)
    })

    proc.on('error', () => {
      resolve([])
    })
  })
}

export const codexProvider: AiProvider = {
  id: 'codex',
  displayName: 'Codex',
  capabilities: { mcp: true, attachments: 'image-flag', streaming: 'json' },
  resolveCommand: resolveCodexCommand,
  buildArgs: buildCodexArgs,
  buildEnv: () => ({ ...process.env }),
  promptDelivery: 'arg',
  needsPty: false,
  parseOutput: parseCodexOutput,
  test: () => testCodex(),
  listModels: () => listCodexModels(),
  listMcps: () => listCodexMcps()
}
