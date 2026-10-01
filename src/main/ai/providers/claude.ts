import { spawn } from 'child_process'
import { getSetting } from '../../database'
import type { AiProvider, ExecutionContext, ModelOption, ProviderResult } from '../types'
import type { McpServer } from '../../../shared/types'

function getHomedir(): string {
  return process.env.HOME || process.env.USERPROFILE || ''
}

export function resolveClaudeCommand(): string {
  const custom = getSetting('claude_cli_path')
  if (custom) return custom
  if (process.platform === 'win32') return 'claude'
  return `${getHomedir()}/.local/bin/claude`
}

export function buildClaudeArgs(ctx: ExecutionContext): string[] {
  const args: string[] = ['--print', '--output-format', 'stream-json', '--verbose']
  if (ctx.skipPermissions) args.push('--dangerously-skip-permissions')
  if (ctx.systemInstruction) args.push('--append-system-prompt', ctx.systemInstruction)
  // "default" follows the CLI's current account and organization setting.
  if (ctx.model && ctx.model !== 'default') args.push('--model', ctx.model)
  if (ctx.mcpTools.length > 0) args.push('--allowedTools', ctx.mcpTools.join(','))
  for (const dir of ctx.addDirs) args.push('--add-dir', dir)
  // On non-Windows, deliver prompt as a -p flag (positional arg mode).
  // On Windows, promptDelivery is 'stdin', so the runner writes ctx.prompt to stdin instead.
  if (process.platform !== 'win32') {
    args.push('-p', ctx.prompt)
  }
  return args
}

// Extracts assistant text messages without duplication.
// stream-json emits overlapping event types for the same content:
//   - content_block_delta: incremental text chunks during streaming
//   - assistant: complete message after each turn (contains same text as deltas)
//   - result: final result (contains same text as assistant message)
// We use assistant messages as the primary source (complete per-turn text),
// and accumulate content_block_delta only for the latest in-progress turn
// (i.e., deltas that arrive after the last assistant message).
export function parseClaudeOutput(raw: string): string {
  const lines = raw.split('\n').filter(line => line.trim())
  const assistantTexts: string[] = []
  const pendingDeltas: string[] = []
  let hasResult = false
  let resultText = ''

  for (const line of lines) {
    try {
      const json = JSON.parse(line)

      if (json.type === 'assistant' && json.message?.content) {
        // Complete assistant message for a turn — use this as primary source
        for (const block of json.message.content) {
          if (block.type === 'text' && block.text) {
            assistantTexts.push(block.text)
          }
        }
        // Clear pending deltas since this assistant message covers them
        pendingDeltas.length = 0
      } else if (json.type === 'result' && json.result) {
        // Final result — only use if no assistant messages were found
        if (typeof json.result === 'string') {
          hasResult = true
          resultText = json.result
        }
      } else if (json.type === 'content_block_delta' && json.delta?.text) {
        // Streaming delta — accumulate for in-progress turn display
        pendingDeltas.push(json.delta.text)
      }
    } catch {
      // Not valid JSON, might be plain text - include it
      if (line.trim() && !line.startsWith('{')) {
        assistantTexts.push(line)
      }
    }
  }

  // Build output: completed turns + any in-progress streaming text
  const parts: string[] = [...assistantTexts]
  if (pendingDeltas.length > 0) {
    parts.push(pendingDeltas.join(''))
  }

  // If no parsed content, try result or raw output as fallback
  if (parts.length === 0) {
    if (hasResult) return resultText.trim()
    return raw.trim()
  }

  return parts.join('\n\n').trim()
}

async function testClaude(): Promise<ProviderResult> {
  const cliPath = resolveClaudeCommand()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const cleanEnv = { ...process.env }
    delete cleanEnv.CLAUDECODE
    const proc = spawn(cliPath, ['--version'], {
      shell: process.platform === 'win32',
      env: cleanEnv,
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
          output: `Claude CLI found: ${stdout.trim()}`
        })
      } else {
        resolve({
          success: false,
          output: '',
          error: stderr.trim() || `Claude CLI not found or failed (exit code: ${code})`
        })
      }
    })

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: `Failed to execute Claude CLI: ${err.message}`
      })
    })
  })
}

async function listClaudeMcps(): Promise<McpServer[]> {
  const cliPath = resolveClaudeCommand()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const cleanEnv = { ...process.env }
    delete cleanEnv.CLAUDECODE
    const proc = spawn(cliPath, ['mcp', 'list'], {
      shell: process.platform === 'win32',
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      // Parse text output to extract server names
      // Format: "servername: command... - ✓ Connected" or similar
      const servers: McpServer[] = []
      const lines = stdout.split('\n')

      for (const line of lines) {
        // Match lines like "context7: npx..." or "Sentry: npx..."
        const match = line.match(/^([^:]+):\s+.+/)
        if (match && !line.includes('Checking') && !line.startsWith(' ')) {
          const serverName = match[1].trim()
          // Skip header lines
          if (serverName && !serverName.includes('MCP') && serverName.length < 50) {
            servers.push({
              name: serverName,
              tools: ['*'] // We don't have individual tools, so use wildcard
            })
          }
        }
      }

      resolve(servers)
    })

    proc.on('error', (err) => {
      resolve([])
    })
  })
}

interface ClaudeCliModel {
  value?: string
  resolvedModel?: string
  displayName?: string
  description?: string
}

const FALLBACK_CLAUDE_MODELS: ModelOption[] = [
  { value: 'default', label: 'Default', desc: 'Offline fallback', isDefault: true, stale: true },
  { value: 'sonnet', label: 'Sonnet', desc: 'Offline fallback', stale: true },
  { value: 'opus', label: 'Opus', desc: 'Offline fallback', stale: true },
  { value: 'haiku', label: 'Haiku', desc: 'Offline fallback', stale: true }
]

export function parseClaudeModelList(models: ClaudeCliModel[]): ModelOption[] {
  return models.flatMap((model) => {
    const value = model.value?.trim()
    if (!value) return []
    const isDefault = value === 'default'
    // The default row's displayName omits the resolved model version. Claude's
    // description starts with that version (for example "Sonnet 5.5 · ...").
    const resolvedName = model.description?.match(/^(?:Claude )?(?:Opus|Sonnet|Haiku|Fable)\s+\d+(?:\.\d+)?/i)?.[0]
      || model.resolvedModel
    const label = isDefault
      ? `Default${resolvedName ? ` · ${resolvedName}` : ''}`
      : model.displayName?.trim() || model.resolvedModel || value
    return [{ value, label, isDefault }]
  })
}

async function listClaudeModels(): Promise<ModelOption[]> {
  const cliPath = resolveClaudeCommand()
  const cleanEnv: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }
  delete cleanEnv.CLAUDECODE

  // Claude Agent SDK exposes this catalog as supportedModels(). Query the same
  // CLI initialize response so the app uses the installed Claude version and
  // does not bundle the SDK's large optional Claude binary.
  return new Promise((resolve) => {
    let settled = false
    let buffer = ''
    const requestId = 'orbit-model-list'
    const proc = spawn(cliPath, [
      '--output-format', 'stream-json', '--verbose',
      '--input-format', 'stream-json', '--setting-sources=user'
    ], {
      shell: process.platform === 'win32',
      env: cleanEnv,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true
    })

    const finish = (models: ModelOption[]) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      proc.kill()
      resolve(models.length > 0 ? models : FALLBACK_CLAUDE_MODELS)
    }

    const timeout = setTimeout(() => finish(FALLBACK_CLAUDE_MODELS), 20_000)

    proc.stdout.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        let message: {
          type?: string
          response?: {
            request_id?: string
            subtype?: string
            response?: { models?: ClaudeCliModel[] }
          }
        }
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }

        if (message.type !== 'control_response' || message.response?.request_id !== requestId) continue
        if (message.response.subtype !== 'success') {
          finish(FALLBACK_CLAUDE_MODELS)
          return
        }
        finish(parseClaudeModelList(message.response.response?.models || []))
        return
      }
    })

    proc.on('error', () => finish(FALLBACK_CLAUDE_MODELS))
    proc.stdin.on('error', () => finish(FALLBACK_CLAUDE_MODELS))
    proc.on('close', () => finish(FALLBACK_CLAUDE_MODELS))
    proc.stdin.write(`${JSON.stringify({
      type: 'control_request',
      request_id: requestId,
      request: { subtype: 'initialize' }
    })}\n`)
  })
}

export const claudeProvider: AiProvider = {
  id: 'claude',
  displayName: 'Claude',
  capabilities: { mcp: true, attachments: 'native-read', streaming: 'json' },
  resolveCommand: resolveClaudeCommand,
  buildArgs: buildClaudeArgs,
  buildEnv: () => {
    const env = { ...process.env }
    delete env.CLAUDECODE
    return env
  },
  promptDelivery: process.platform === 'win32' ? 'stdin' : 'arg',
  needsPty: false,
  parseOutput: parseClaudeOutput,
  test: () => testClaude(),
  listModels: () => listClaudeModels(),
  listMcps: () => listClaudeMcps()
}
