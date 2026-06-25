import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { getSetting } from './database'
import { checkDangerousOperations } from './security-check'
import { parseClaudeOutput as parseStreamJsonOutput } from './ai/providers/claude'
import type { ClaudeCliResult, McpServer } from '../shared/types'

function getHomedir(): string {
  return process.env.HOME || process.env.USERPROFILE || ''
}

function getClaudeCliPath(): string {
  // Return full path for execFile (which doesn't use shell)
  const customPath = getSetting('claude_cli_path')
  if (customPath) return customPath

  // Windows: use 'claude' and rely on shell PATH resolution
  if (process.platform === 'win32') return 'claude'

  // macOS/Linux: default path
  return `${getHomedir()}/.local/bin/claude`
}

const IDLE_TIMEOUT = 10 * 60 * 1000 // 10 minutes of no output = timeout

// Callback for streaming output updates
type OutputCallback = (partialOutput: string) => void

export async function executeClaudeCli(
  prompt: string,
  mcpTools?: string[],
  model?: string | null,
  onOutput?: OutputCallback,
  attachments?: string[],
  projectPath?: string | null,
  skipPermissions?: boolean
): Promise<ClaudeCliResult> {
  const cliPath = getClaudeCliPath()

  // Use --print for non-interactive mode
  // Use stream-json to capture the full conversation including tool calls and intermediate results
  const args: string[] = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose'
  ]

  // Add --dangerously-skip-permissions if enabled (default: true for backward compatibility)
  if (skipPermissions !== false) {
    args.push('--dangerously-skip-permissions')
  }

  // Add model if specified
  if (model) {
    args.push('--model', model)
  }

  // Add allowed tools if specified
  if (mcpTools && mcpTools.length > 0) {
    args.push('--allowedTools', mcpTools.join(','))
  }

  // Add file attachments using Claude CLI's native --file flag
  if (attachments && attachments.length > 0) {
    for (const filePath of attachments) {
      args.push('--file', filePath)
    }
  }

  // Security check: Check prompt before execution
  const promptSecurityCheck = checkDangerousOperations(prompt)
  if (promptSecurityCheck.isDangerous) {
    console.log('[Claude CLI] Security check failed: Dangerous operation detected in prompt')
    return Promise.resolve({
      success: false,
      output: '',
      error: `🚫 安全檢查失敗: ${promptSecurityCheck.reason}\n\n為了保護您的系統安全，已阻止執行包含危險刪除操作的命令。\n檢測到的命令: ${promptSecurityCheck.detectedCommand || '未知'}\n\n如需執行此操作，請明確授權並確認風險。`
    })
  }

  // Windows: pass prompt via stdin to avoid cmd.exe mangling arguments
  // (cmd.exe can misinterpret "/" as switch prefix, splitting the prompt)
  // macOS/Linux: pass prompt via -p flag (shell:false, no escaping issues)
  const useStdinPrompt = process.platform === 'win32'
  if (!useStdinPrompt) {
    args.push('-p', prompt)
  }

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let killed = false
    let lastActivityTime = Date.now()

    const fullCommand = `${cliPath} ${args.map(a => `"${a}"`).join(' ')}`
    console.log('[Claude CLI] Executing:', fullCommand)
    if (useStdinPrompt) {
      console.log('[Claude CLI] Prompt will be sent via stdin (Windows mode)')
    }

    // Get session token from settings
    const sessionToken = getSetting('claude_session_token')
    const env = { ...process.env }
    // Remove CLAUDECODE to avoid "nested session" error when launched from Claude Code
    delete env.CLAUDECODE
    if (sessionToken) {
      env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = sessionToken
    }

    // Windows: shell:true required because claude.cmd can't be spawned directly
    // macOS: shell:false to properly handle Unicode/Chinese characters
    const proc = spawn(cliPath, args, {
      shell: process.platform === 'win32',
      env,
      cwd: (projectPath && existsSync(projectPath)) ? projectPath : (getHomedir() || (process.platform === 'win32' ? process.env.SystemRoot || 'C:\\' : '/')),
      stdio: [useStdinPrompt ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true
    })

    // Windows: write prompt to stdin to avoid cmd.exe argument escaping issues
    if (useStdinPrompt && proc.stdin) {
      proc.stdin.write(prompt)
      proc.stdin.end()
    }

    console.log('[Claude CLI] Process spawned with PID:', proc.pid)

    // Check for idle timeout periodically (only timeout if no activity)
    const idleChecker = setInterval(() => {
      const idleTime = Date.now() - lastActivityTime
      if (idleTime > IDLE_TIMEOUT) {
        console.log(`[Claude CLI] Idle timeout: no output for ${IDLE_TIMEOUT / 1000} seconds`)
        killed = true
        clearInterval(idleChecker)
        proc.kill('SIGTERM')
        resolve({
          success: false,
          output: parseStreamJsonOutput(stdout),
          error: `Idle timeout: No output received for ${IDLE_TIMEOUT / 1000 / 60} minutes`
        })
      }
    }, 30000) // Check every 30 seconds

    proc.stdout!.on('data', (data: Buffer) => {
      const text = data.toString()
      console.log('[Claude CLI] stdout chunk received, length:', text.length)

      // Security check: Check output for dangerous operations
      const securityCheck = checkDangerousOperations(text)
      if (securityCheck.isDangerous) {
        console.log('[Claude CLI] Security check failed: Dangerous operation detected in output')
        console.log('[Claude CLI] Killing process due to security violation')
        killed = true
        clearInterval(idleChecker)
        proc.kill('SIGTERM')
        resolve({
          success: false,
          output: parseStreamJsonOutput(stdout),
          error: `🚫 安全檢查失敗: ${securityCheck.reason}\n\n為了保護您的系統安全，已自動停止執行。\n檢測到的命令: ${securityCheck.detectedCommand || '未知'}\n\n嚴格禁止在未經使用者授權下主動刪除項目。`
        })
        return
      }
      
      stdout += text
      lastActivityTime = Date.now() // Reset activity timer

      // Parse stream-json and extract assistant messages for display
      if (onOutput) {
        const parsedOutput = parseStreamJsonOutput(stdout)
        onOutput(parsedOutput)
      }
    })

    proc.stderr!.on('data', (data: Buffer) => {
      const text = data.toString()
      console.log('[Claude CLI] stderr:', text.substring(0, 200))

      // Security check: Check stderr for dangerous operations
      const securityCheck = checkDangerousOperations(text)
      if (securityCheck.isDangerous) {
        console.log('[Claude CLI] Security check failed: Dangerous operation detected in stderr')
        console.log('[Claude CLI] Killing process due to security violation')
        killed = true
        clearInterval(idleChecker)
        proc.kill('SIGTERM')
        resolve({
          success: false,
          output: parseStreamJsonOutput(stdout),
          error: `🚫 安全檢查失敗: ${securityCheck.reason}\n\n為了保護您的系統安全，已自動停止執行。\n檢測到的命令: ${securityCheck.detectedCommand || '未知'}\n\n嚴格禁止在未經使用者授權下主動刪除項目。`
        })
        return
      }
      
      stderr += text
      lastActivityTime = Date.now() // Reset activity timer
    })

    proc.on('close', (code) => {
      console.log('[Claude CLI] Process closed with code:', code)
      clearInterval(idleChecker)
      if (killed) return // Already resolved by timeout

      // Parse the stream-json output to get the full conversation
      const parsedOutput = parseStreamJsonOutput(stdout)

      if (code === 0) {
        resolve({
          success: true,
          output: parsedOutput
        })
      } else {
        resolve({
          success: false,
          output: parsedOutput,
          error: stderr.trim() || `Process exited with code ${code}`
        })
      }
    })

    proc.on('error', (err) => {
      console.log('[Claude CLI] Process error:', err.message)
      clearInterval(idleChecker)
      if (killed) return

      resolve({
        success: false,
        output: '',
        error: err.message
      })
    })
  })
}

export async function testClaudeConnection(): Promise<ClaudeCliResult> {
  const cliPath = getClaudeCliPath()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const cleanEnv = { ...process.env }
    delete cleanEnv.CLAUDECODE
    const proc = spawn(cliPath, ['--version'], {
      shell: true,
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

export async function listMcpServers(): Promise<McpServer[]> {
  const cliPath = getClaudeCliPath()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const cleanEnv = { ...process.env }
    delete cleanEnv.CLAUDECODE
    const proc = spawn(cliPath, ['mcp', 'list'], {
      shell: true,
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
      console.log('[Claude CLI] mcp list output:', stdout.substring(0, 500))
      if (stderr) console.log('[Claude CLI] mcp list stderr:', stderr.substring(0, 200))

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

      console.log('[Claude CLI] Found MCP servers:', servers.map(s => s.name))
      resolve(servers)
    })

    proc.on('error', (err) => {
      console.log('[Claude CLI] mcp list error:', err.message)
      resolve([])
    })
  })
}
