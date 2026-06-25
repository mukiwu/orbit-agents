import { spawn } from 'child_process'
import { getSetting } from '../../database'
import type { AiProvider, ExecutionContext, ModelOption, ProviderResult } from '../types'
import type { McpServer } from '../../../shared/types'

export function resolveAntigravityCommand(): string {
  return getSetting('antigravity_cli_path') || 'agy'
}

export function buildAntigravityArgs(ctx: ExecutionContext): string[] {
  const args: string[] = ['--print']
  if (ctx.skipPermissions) args.push('--dangerously-skip-permissions')
  if (ctx.model) args.push('--model', ctx.model)
  for (const dir of ctx.addDirs) args.push('--add-dir', dir)
  const fullPrompt = ctx.systemInstruction
    ? `${ctx.systemInstruction}\n\n${ctx.prompt}`
    : ctx.prompt
  args.push(fullPrompt)
  return args
}

export function parseAntigravityOutput(raw: string): string {
  return raw.trim()
}

async function testAntigravity(): Promise<ProviderResult> {
  const cliPath = resolveAntigravityCommand()

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
          output: `Antigravity CLI found: ${stdout.trim()}`
        })
      } else {
        resolve({
          success: false,
          output: '',
          error: stderr.trim() || `Antigravity CLI not found or failed (exit code: ${code})`
        })
      }
    })

    proc.on('error', (err: Error) => {
      resolve({
        success: false,
        output: '',
        error: `Failed to execute Antigravity CLI: ${err.message}`
      })
    })
  })
}

const FALLBACK_MODELS = [
  'Gemini 3.5 Flash (Medium)',
  'Gemini 3.1 Pro (High)',
  'Claude Sonnet 4.6 (Thinking)'
]

async function listAntigravityModels(): Promise<ModelOption[]> {
  const cliPath = resolveAntigravityCommand()

  return new Promise((resolve) => {
    let stdout = ''

    const proc = spawn(cliPath, ['models'], {
      shell: true,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve(FALLBACK_MODELS.map(m => ({ value: m, label: m })))
        return
      }

      const models: ModelOption[] = stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => ({ value: line, label: line }))

      if (models.length === 0) {
        resolve(FALLBACK_MODELS.map(m => ({ value: m, label: m })))
      } else {
        resolve(models)
      }
    })

    proc.on('error', () => {
      resolve(FALLBACK_MODELS.map(m => ({ value: m, label: m })))
    })
  })
}

export const antigravityProvider: AiProvider = {
  id: 'antigravity',
  displayName: 'Antigravity',
  capabilities: { mcp: false, attachments: 'native-read', streaming: 'text' },
  resolveCommand: resolveAntigravityCommand,
  buildArgs: buildAntigravityArgs,
  buildEnv: () => ({ ...process.env }),
  promptDelivery: 'arg',
  needsPty: false,
  parseOutput: parseAntigravityOutput,
  test: () => testAntigravity(),
  listModels: () => listAntigravityModels(),
  listMcps: async (): Promise<McpServer[]> => []
}
