import { spawn } from 'child_process'
import { getSetting } from '../../database'
import type { AiProvider, ExecutionContext, ModelOption, ProviderResult } from '../types'
import type { McpServer } from '../../../shared/types'

export function resolveCodexCommand(): string {
  return getSetting('codex_cli_path') || 'codex'
}

export function buildCodexArgs(ctx: ExecutionContext): string[] {
  const args: string[] = ['exec', '--json', '--skip-git-repo-check']
  if (ctx.skipPermissions) {
    args.push('--dangerously-bypass-approvals-and-sandbox')
  } else {
    args.push('--sandbox', 'workspace-write')
  }
  if (ctx.model) args.push('-m', ctx.model)
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
      shell: true,
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
      shell: true,
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
  listModels: async (): Promise<ModelOption[]> => [
    { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', desc: 'Default' },
    { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', desc: 'Fast' }
  ],
  listMcps: () => listCodexMcps()
}
