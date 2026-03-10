import { execFile, spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { extname } from 'path'
import { getSetting } from './database'
import { checkDangerousOperations } from './security-check'
import type { CodexCliResult, McpServer, ModelOption, ModelType } from '../shared/types'

const CODEX_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp'
])

const OFFICIAL_CODEX_MODELS: ModelOption[] = [
  { value: 'gpt-5.4', label: 'GPT-5.4', desc: 'Current local Codex config default on this system' },
  { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', desc: 'Current flagship Codex model' },
  { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', desc: 'Balanced coding model' },
  { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max', desc: 'Higher-reasoning coding model' },
  { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini', desc: 'Faster lower-cost coding model' },
  { value: 'gpt-5-codex', label: 'GPT-5 Codex', desc: 'Older GPT-5 Codex model' },
  { value: 'codex-mini-latest', label: 'Codex Mini Latest', desc: 'Legacy Codex mini alias', deprecated: true }
]

type OutputCallback = (partialOutput: string) => void

function getCodexCliPath(): string {
  const customPath = getSetting('codex_cli_path')
  if (customPath) return customPath
  return 'codex'
}

function getCodexConfigModel(): string | null {
  const configPath = `${homedir()}/.codex/config.toml`
  if (!existsSync(configPath)) return null

  try {
    const content = readFileSync(configPath, 'utf-8')
    const match = content.match(/^\s*model\s*=\s*["']([^"']+)["']/m)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

function extractAgentText(item: unknown): string {
  if (!item || typeof item !== 'object') return ''

  const candidate = item as {
    text?: unknown
    message?: { content?: Array<{ type?: string; text?: string }> }
    content?: Array<{ type?: string; text?: string }>
  }

  if (typeof candidate.text === 'string') {
    return candidate.text.trim()
  }

  const blocks = candidate.message?.content || candidate.content
  if (!Array.isArray(blocks)) return ''

  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

function parseCodexExecOutput(rawOutput: string): string {
  const lines = rawOutput.split('\n').filter((line) => line.trim())
  const messages: string[] = []

  for (const line of lines) {
    try {
      const json = JSON.parse(line) as {
        type?: string
        item?: unknown
      }

      if (json.type === 'item.completed' || json.type === 'item.updated') {
        const item = json.item as { type?: string } | undefined
        if (item?.type === 'agent_message') {
          const text = extractAgentText(json.item)
          if (text) {
            messages.push(text)
          }
        }
      }
    } catch {
      if (!line.startsWith('{')) {
        messages.push(line.trim())
      }
    }
  }

  if (messages.length === 0) {
    return rawOutput.trim()
  }

  return messages.join('\n\n').trim()
}

function buildCodexExecArgs(
  model?: ModelType | null,
  attachments?: string[],
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access' = 'danger-full-access'
): string[] {
  const args = [
    '--ask-for-approval',
    'never',
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    sandboxMode,
    '--json'
  ]

  if (model) {
    args.push('--model', model)
  }

  if (attachments && attachments.length > 0) {
    for (const filePath of attachments) {
      if (CODEX_IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
        args.push('--image', filePath)
      }
    }
  }

  args.push('-')

  return args
}

export async function executeCodexCli(
  prompt: string,
  model?: ModelType | null,
  onOutput?: OutputCallback,
  attachments?: string[],
  mcpTools?: string[]
): Promise<CodexCliResult> {
  const cliPath = getCodexCliPath()
  const args = buildCodexExecArgs(model, attachments)

  const promptSecurityCheck = checkDangerousOperations(prompt)
  if (promptSecurityCheck.isDangerous) {
    return Promise.resolve({
      success: false,
      output: '',
      error: `🚫 安全檢查失敗: ${promptSecurityCheck.reason}\n\n為了保護您的系統安全，已阻止執行包含危險刪除操作的命令。\n檢測到的命令: ${promptSecurityCheck.detectedCommand || '未知'}\n\n如需執行此操作，請明確授權並確認風險。`
    })
  }

  if (mcpTools && mcpTools.length > 0) {
    console.log('[Codex CLI] Task-level MCP filtering is not supported; using Codex global MCP config')
  }

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let resolved = false

    console.log('[Codex CLI] Executing:', cliPath, args.join(' '))

    const proc = spawn(cliPath, args, {
      shell: false,
      env: { ...process.env },
      cwd: process.env.HOME || '/',
      stdio: ['pipe', 'pipe', 'pipe']
    })

    proc.stdout.on('data', (data: Buffer) => {
      if (resolved) return
      const text = data.toString()

      const securityCheck = checkDangerousOperations(text)
      if (securityCheck.isDangerous) {
        resolved = true
        proc.kill('SIGTERM')
        resolve({
          success: false,
          output: parseCodexExecOutput(stdout),
          error: `🚫 安全檢查失敗: ${securityCheck.reason}\n\n為了保護您的系統安全，已自動停止執行。\n檢測到的命令: ${securityCheck.detectedCommand || '未知'}\n\n嚴格禁止在未經使用者授權下主動刪除項目。`
        })
        return
      }

      stdout += text

      if (onOutput) {
        onOutput(parseCodexExecOutput(stdout))
      }
    })

    proc.stderr.on('data', (data: Buffer) => {
      if (resolved) return
      const text = data.toString()

      const securityCheck = checkDangerousOperations(text)
      if (securityCheck.isDangerous) {
        resolved = true
        proc.kill('SIGTERM')
        resolve({
          success: false,
          output: parseCodexExecOutput(stdout),
          error: `🚫 安全檢查失敗: ${securityCheck.reason}\n\n為了保護您的系統安全，已自動停止執行。\n檢測到的命令: ${securityCheck.detectedCommand || '未知'}\n\n嚴格禁止在未經使用者授權下主動刪除項目。`
        })
        return
      }

      stderr += text
      console.log('[Codex CLI] stderr:', text.substring(0, 200))
    })

    proc.on('close', (code) => {
      if (resolved) return
      const parsedOutput = parseCodexExecOutput(stdout)

      if (code === 0) {
        resolve({
          success: true,
          output: parsedOutput
        })
        return
      }

      resolve({
        success: false,
        output: parsedOutput,
        error: stderr.trim() || `Process exited with code ${code}`
      })
    })

    proc.on('error', (err) => {
      if (resolved) return
      resolve({
        success: false,
        output: '',
        error: err.message
      })
    })

    proc.stdin.write(prompt)
    proc.stdin.end()
  })
}

export async function testCodexConnection(): Promise<CodexCliResult> {
  const cliPath = getCodexCliPath()
  const args = buildCodexExecArgs(undefined, undefined, 'read-only')

  return new Promise((resolve) => {
    const proc = spawn(cliPath, args, {
      shell: false,
      env: { ...process.env },
      cwd: process.env.HOME || '/',
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      const parsedOutput = parseCodexExecOutput(stdout)
      if (code === 0 && parsedOutput) {
        resolve({
          success: true,
          output: `Codex CLI ready: ${parsedOutput}`
        })
        return
      }

      execFile(cliPath, ['--version'], (versionError, versionStdout, versionStderr) => {
        if (versionError) {
          resolve({
            success: false,
            output: '',
            error: stderr.trim() || versionStderr.trim() || versionError.message
          })
          return
        }

        resolve({
          success: false,
          output: versionStdout.trim(),
          error: stderr.trim() || `Codex CLI is installed (${versionStdout.trim()}) but the non-interactive test failed. Check \`codex login\`.`
        })
      })
    })

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message
      })
    })

    proc.stdin.write('Reply with exactly "ok" and nothing else.')
    proc.stdin.end()
  })
}

export async function listCodexModels(): Promise<ModelOption[]> {
  const savedDefault = getSetting('codex_default_model')
  const configDefault = getCodexConfigModel()
  const options = new Map<string, ModelOption>()

  for (const model of OFFICIAL_CODEX_MODELS) {
    options.set(model.value, { ...model })
  }

  if (configDefault && !options.has(configDefault)) {
    options.set(configDefault, {
      value: configDefault,
      label: configDefault,
      desc: 'Configured in ~/.codex/config.toml'
    })
  }

  if (savedDefault && !options.has(savedDefault)) {
    options.set(savedDefault, {
      value: savedDefault,
      label: savedDefault,
      desc: 'Saved default in Orbit Agents'
    })
  }

  const orderedValues = [
    savedDefault,
    configDefault,
    ...OFFICIAL_CODEX_MODELS.map((model) => model.value)
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)

  return orderedValues
    .map((value) => options.get(value))
    .filter((value): value is ModelOption => Boolean(value))
}

export async function listCodexMcpServers(): Promise<McpServer[]> {
  const cliPath = getCodexCliPath()

  return new Promise((resolve) => {
    execFile(cliPath, ['mcp', 'list'], (error, stdout, stderr) => {
      if (error) {
        console.log('[Codex CLI] mcp list error:', error.message)
        resolve([])
        return
      }

      const output = `${stdout}\n${stderr}`
      const serverNames = new Set<string>()

      for (const line of output.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('Name ')) continue

        const match = trimmed.match(/^([A-Za-z0-9._-]+)\s{2,}/)
        if (match) {
          serverNames.add(match[1])
        }
      }

      resolve(
        Array.from(serverNames).map((name) => ({
          name,
          tools: []
        }))
      )
    })
  })
}
