import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { getSetting } from './database'
import { registerProcess } from './process-manager'
import { checkDangerousOperations } from './security-check'
import type { GeminiCliResult, McpServer } from '../shared/types'

function getGeminiCliPath(): string {
  const customPath = getSetting('gemini_cli_path')
  if (customPath) return customPath

  // Default path - try common locations or assume it's in PATH
  return 'gemini'
}

// Callback for streaming output updates
type OutputCallback = (partialOutput: string) => void

export async function executeGeminiCli(
  prompt: string,
  model?: string | null,
  onOutput?: OutputCallback,
  attachments?: string[],
  mcpTools?: string[],
  executionId?: string,
  projectPath?: string | null
): Promise<GeminiCliResult> {
  const cliPath = getGeminiCliPath()

  // Basic args
  const args: string[] = []

  // Auto-approve all tool calls (equivalent to Claude's --dangerously-skip-permissions)
  args.push('--yolo')

  // Add model if specified and not default
  // Currently mapping both gemini-3 and gemini-2.5 to default (no flag) 
  // because specific model aliases are returning 404s with the current CLI version
  // Add model if specified and not default
  if (model) {
    console.log('[Gemini CLI] Received model:', model)
    if (model === 'gemini-2') {
      args.push('--model', 'gemini-2.0-flash-exp')
    } else if (model !== 'gemini-3' && model !== 'gemini-2.5') {
      args.push('--model', model)
    }
  }

  // Log MCP tools configuration (--allowedTools is deprecated, --yolo handles all approvals)
  if (mcpTools && mcpTools.length > 0) {
    console.log('[Gemini CLI] MCP tools configured:', mcpTools)
  }

  // Add attachments
  if (attachments && attachments.length > 0) {
    for (const filePath of attachments) {
      args.push('--file', filePath)
    }
  }

  // Security check: Check prompt before execution
  const promptSecurityCheck = checkDangerousOperations(prompt)
  if (promptSecurityCheck.isDangerous) {
    console.log('[Gemini CLI] Security check failed: Dangerous operation detected in prompt')
    return Promise.resolve({
      success: false,
      output: '',
      error: `🚫 安全檢查失敗: ${promptSecurityCheck.reason}\n\n為了保護您的系統安全，已阻止執行包含危險刪除操作的命令。\n檢測到的命令: ${promptSecurityCheck.detectedCommand || '未知'}\n\n如需執行此操作，請明確授權並確認風險。`
    })
  }

  // Add prompt
  args.push(prompt)

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const apiKey = getSetting('gemini_api_key')
    const env = { ...process.env }
    if (apiKey) {
      env.GEMINI_API_KEY = apiKey
    } else {
      // Remove inherited shell env var so Gemini CLI falls back to OAuth
      delete env.GEMINI_API_KEY
    }
    
    // Add environment variable to trust MCP tools (if supported)
    // Some Gemini CLI versions might check this env var
    if (mcpTools && mcpTools.length > 0) {
      env.GEMINI_TRUST_MCP_TOOLS = 'true'
      env.GEMINI_ALLOWED_TOOLS = mcpTools.join(',')
    }

    console.log('[Gemini CLI] Executing:', cliPath, args.join(' '))
    console.log('[Gemini CLI] Environment vars:', {
      GEMINI_API_KEY: apiKey ? '***' : 'not set',
      GEMINI_TRUST_MCP_TOOLS: env.GEMINI_TRUST_MCP_TOOLS,
      GEMINI_ALLOWED_TOOLS: env.GEMINI_ALLOWED_TOOLS
    })

    // Validate cwd: projectPath may not exist (e.g. removed folder), fall back to home
    const homedir = process.env.HOME || process.env.USERPROFILE || '/'
    const cwd = (projectPath && existsSync(projectPath)) ? projectPath : homedir

    const proc = spawn(cliPath, args, {
      shell: process.platform === 'win32',
      env,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'], // Enable stdin pipe
      windowsHide: true
    })

    if (executionId) {
      registerProcess(executionId, proc)
    }

    // Helper to check and handle auto-replies for permission requests
    let hasRepliedToPermission = false
    let permissionReplyAttempts = 0
    const MAX_PERMISSION_ATTEMPTS = 3
    
    const checkAndReply = (text: string): boolean => {
      // Don't auto-reply multiple times
      if (hasRepliedToPermission) {
        return false
      }

      const lowerText = text.toLowerCase()
      
      // Check for various permission request patterns
      const permissionPatterns = [
        // English patterns
        /\[y\/n\]/i,
        /\(y\/n\)/i,
        /allow\s+.*\s+to\s+access/i,
        /permission\s+to\s+access/i,
        /authorize\s+.*\s+to\s+access/i,
        /connect\s+to\s+.*\?/i,
        /do\s+you\s+want\s+to\s+allow/i,
        /grant\s+.*\s+access/i,
        // Chinese patterns
        /允許.*存取/i,
        /授權.*存取/i,
        /連線.*\?/i,
        /是否允許/i,
        /是否授權/i,
        // MCP/GA4 specific patterns
        /google\s+analytics.*allow/i,
        /ga4.*permission/i,
        /mcp.*tool.*access/i,
        /權限政策限制/i,
        /無法直接存取/i,
        // Security policy restrictions (Chinese)
        /目前的執行環境安全策略限制/i,
        /執行環境安全策略/i,
        /安全策略限制/i,
        /security.*policy.*restriction/i,
        /security.*policy.*limit/i,
        // Policy denied errors
        /denied\s+by\s+policy/i,
        /政策拒絕/i,
        /系統政策/i,
        /操作遭到系統政策拒絕/i,
        /policy.*denied/i,
        // MCP server not started or permission not configured
        /mcp\s+server\s+未正確啟動/i,
        /mcp\s+server.*not.*start/i,
        /權限未配置/i,
        /permission.*not.*config/i,
        /尚未取得.*授權/i
      ]

      // Check if any pattern matches
      const hasPermissionRequest = permissionPatterns.some(pattern => pattern.test(text))
      
      // Also check for common permission-related keywords
      const hasPermissionKeywords = (
        (lowerText.includes('permission') || lowerText.includes('授權') || lowerText.includes('權限')) &&
        (lowerText.includes('access') || lowerText.includes('存取') || lowerText.includes('allow') || lowerText.includes('允許') || lowerText.includes('[y/n]') || lowerText.includes('(y/n)'))
      )

      // Special check for security policy restriction and policy denied (most urgent)
      const hasSecurityPolicyRestriction = (
        text.includes('目前的執行環境安全策略限制') ||
        text.includes('執行環境安全策略') ||
        text.includes('安全策略限制') ||
        lowerText.includes('security policy restriction') ||
        lowerText.includes('security policy limit') ||
        lowerText.includes('denied by policy') ||
        text.includes('操作遭到系統政策拒絕') ||
        text.includes('政策拒絕') ||
        (text.includes('系統政策') && (text.includes('拒絕') || lowerText.includes('denied')))
      )
      
      // Check for MCP server issues
      const hasMcpServerIssue = (
        (lowerText.includes('mcp server') || lowerText.includes('mcp 伺服器')) &&
        (lowerText.includes('not.*start') || text.includes('未正確啟動') || text.includes('未啟動') || 
         lowerText.includes('permission.*not.*config') || text.includes('權限未配置'))
      )

      if (hasPermissionRequest || hasPermissionKeywords || hasSecurityPolicyRestriction || hasMcpServerIssue) {
        const isSecurityPolicy = hasSecurityPolicyRestriction
        permissionReplyAttempts++
        
        if (permissionReplyAttempts <= MAX_PERMISSION_ATTEMPTS) {
          const issueType = hasMcpServerIssue ? 'MCP server issue' : 
                           isSecurityPolicy ? 'security policy restriction' : 
                           'permission request'
          console.log(`[Gemini CLI] Detected ${issueType} (attempt ${permissionReplyAttempts}/${MAX_PERMISSION_ATTEMPTS}), auto-accepting with "y"`)
          console.log('[Gemini CLI] Request text:', text.substring(0, 300))
          
          if (proc.stdin && !proc.stdin.destroyed) {
            // For security policy restrictions, reply immediately
            // For other permissions, small delay to ensure prompt is displayed
            const delay = isSecurityPolicy ? 100 : 200
            
            setTimeout(() => {
              if (proc.stdin && !proc.stdin.destroyed) {
                console.log(`[Gemini CLI] Sending "y" to accept permission/security policy (attempt ${permissionReplyAttempts})`)
                proc.stdin.write('y\n')
                
                // Mark as replied after first successful attempt
                if (permissionReplyAttempts === 1) {
                  hasRepliedToPermission = true
                }
              }
            }, delay)
          }
          return true
        } else {
          console.log('[Gemini CLI] Max permission reply attempts reached, stopping auto-reply')
        }
      }
      
      // Also check for patterns that indicate waiting for input (common with MCP tools)
      if (!hasRepliedToPermission && lowerText.length > 0) {
        // Check if output ends with a question mark or prompt-like text
        const trimmedText = text.trim()
        const endsWithPrompt = trimmedText.endsWith('?') || trimmedText.endsWith(':') || trimmedText.match(/\[y\/n\]$/i)
        
        // Check if it's been a while since last output and we're waiting
        // Also check for security policy restriction keywords
        if (endsWithPrompt && (
          lowerText.includes('mcp') || 
          lowerText.includes('tool') || 
          lowerText.includes('google') ||
          lowerText.includes('analytics') ||
          lowerText.includes('ga4') ||
          lowerText.includes('安全策略') ||
          lowerText.includes('執行環境') ||
          lowerText.includes('security policy')
        )) {
          console.log('[Gemini CLI] Detected potential permission prompt (ending with ?/:), auto-accepting')
          if (proc.stdin && !proc.stdin.destroyed) {
            setTimeout(() => {
              if (proc.stdin && !proc.stdin.destroyed && !hasRepliedToPermission) {
                console.log('[Gemini CLI] Sending "y" to accept potential permission')
                proc.stdin.write('y\n')
                hasRepliedToPermission = true
              }
            }, 300)
          }
          return true
        }
      }

      return false
    }

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString()
      console.log('[Gemini CLI] stdout chunk:', text.substring(0, 200))
      
      // Security check: Check output for dangerous operations
      const securityCheck = checkDangerousOperations(text)
      if (securityCheck.isDangerous) {
        console.log('[Gemini CLI] Security check failed: Dangerous operation detected in output')
        console.log('[Gemini CLI] Killing process due to security violation')
        proc.kill('SIGTERM')
        resolve({
          success: false,
          output: stdout.trim(),
          error: `🚫 安全檢查失敗: ${securityCheck.reason}\n\n為了保護您的系統安全，已自動停止執行。\n檢測到的命令: ${securityCheck.detectedCommand || '未知'}\n\n嚴格禁止在未經使用者授權下主動刪除項目。`
        })
        return
      }
      
      const replied = checkAndReply(text)
      stdout += text
      if (replied) {
        stdout += '\n[System: Auto-accepted permission request]\n'
      }
      if (onOutput) {
        onOutput(stdout)
      }
    })

    // Known stderr noise patterns to filter from streaming output
    const isStderrNoise = (line: string): boolean => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (trimmed.startsWith('Loaded cached credentials')) return true
      if (trimmed.startsWith('Loading extension:')) return true
      if (trimmed.startsWith('Server ')) return true
      if (trimmed.startsWith('Skill conflict detected:')) return true
      if (trimmed.startsWith('Error executing tool')) return true
      if (trimmed.startsWith('Attempt ') && trimmed.includes('Retrying')) return true
      if (trimmed.includes('Tool execution denied by policy')) return true
      if (trimmed.includes('denied by policy')) return true
      if (trimmed.includes('exhausted your capacity')) return true
      if (trimmed.includes('Retrying after')) return true
      return false
    }

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      console.log('[Gemini CLI] stderr chunk:', text.substring(0, 200))

      // Security check: Check stderr for dangerous operations
      const securityCheck = checkDangerousOperations(text)
      if (securityCheck.isDangerous) {
        console.log('[Gemini CLI] Security check failed: Dangerous operation detected in stderr')
        console.log('[Gemini CLI] Killing process due to security violation')
        proc.kill('SIGTERM')
        resolve({
          success: false,
          output: stdout.trim(),
          error: `🚫 安全檢查失敗: ${securityCheck.reason}\n\n為了保護您的系統安全，已自動停止執行。\n檢測到的命令: ${securityCheck.detectedCommand || '未知'}\n\n嚴格禁止在未經使用者授權下主動刪除項目。`
        })
        return
      }

      const replied = checkAndReply(text)
      stderr += text
      if (replied) {
        stderr += '\n[System: Auto-accepted permission request]\n'
      }

      // Stream meaningful stderr content to UI (Gemini CLI often outputs response here)
      const meaningfulLines = text.split('\n').filter(line => !isStderrNoise(line))
      const meaningfulText = meaningfulLines.join('\n').trim()
      if (meaningfulText && onOutput) {
        stdout += meaningfulText + '\n'
        onOutput(stdout)
      }
    })

    proc.on('close', (code) => {
      console.log('[Gemini CLI] Process closed with code:', code)
      console.log('[Gemini CLI] stdout length:', stdout.length, 'stderr length:', stderr.length)

      if (code === 0) {
        // Gemini CLI may output response content to stderr instead of stdout
        // Use stdout if available, otherwise fall back to stderr (excluding noise lines)
        let output = stdout.trim()
        if (!output && stderr.trim()) {
          // Filter out noise lines from stderr (loading messages, warnings, etc.)
          const stderrLines = stderr.split('\n')
          const meaningfulLines = stderrLines.filter(line => !isStderrNoise(line))
          output = meaningfulLines.join('\n').trim()
        }
        resolve({
          success: true,
          output
        })
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Process exited with code ${code}`
        })
      }
    })

    proc.on('error', (err) => {
      console.log('[Gemini CLI] Process error:', err.message)
      resolve({
        success: false,
        output: '',
        error: err.message
      })
    })
  })
}

export async function testGeminiConnection(): Promise<GeminiCliResult> {
  const cliPath = getGeminiCliPath()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    // Assume --version or help is a safe test
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
          output: `Gemini CLI found: ${stdout.trim()}`
        })
      } else {
        resolve({
          success: false,
          output: '',
          error: stderr.trim() || `Gemini CLI not found or failed (exit code: ${code})`
        })
      }
    })

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: `Failed to execute Gemini CLI: ${err.message}`
      })
    })
  })
}

export async function listMcpServers(): Promise<McpServer[]> {
  const cliPath = getGeminiCliPath()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    // Try to run 'mcp list' assuming it supports the standard command
    const proc = spawn(cliPath, ['mcp', 'list'], {
      shell: true,
      env: { ...process.env },
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
      // Gemini CLI outputs mcp list to stderr, not stdout
      const output = stdout || stderr
      console.log('[Gemini CLI] mcp list output:', output.substring(0, 500))

      const servers: McpServer[] = []
      const lines = output.split('\n')

      for (const line of lines) {
        // Clean the line of ANSI codes and whitespace
        // eslint-disable-next-line no-control-regex
        const cleanLine = line.replace(/\x1B\[\d+m/g, '').trim()

        // Skip empty lines or headers
        if (!cleanLine || cleanLine.startsWith('Configured MCP servers') || cleanLine.includes('Checking')) {
          continue
        }

        // Match "✓ name: command" or "name: command"
        const match = cleanLine.match(/^(?:✓\s*)?([^:]+):\s+(.+)$/)

        if (match) {
          const serverName = match[1].trim()
          // Filter out invalid names
          if (serverName && !serverName.includes('MCP') && serverName.length < 50) {
            servers.push({
              name: serverName,
              tools: ['*']
            })
          }
        }
      }

      console.log('[Gemini CLI] Found MCP servers:', servers.map(s => s.name))
      resolve(servers)
    })

    proc.on('error', (err) => {
      console.log('[Gemini CLI] mcp list error:', err.message)
      resolve([])
    })
  })
}
