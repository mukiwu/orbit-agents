import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { checkDangerousOperations } from '../security-check'
import { registerProcess } from '../process-manager'
import type { AiProvider, ExecutionContext, OutputCallback, ProviderResult } from './types'

const IDLE_TIMEOUT = 10 * 60 * 1000 // 10 minutes of no output

function getHomedir(): string {
  return process.env.HOME || process.env.USERPROFILE || ''
}

function resolveCwd(projectPath: string | null): string {
  if (projectPath && existsSync(projectPath)) return projectPath
  const home = getHomedir()
  if (home) return home
  return process.platform === 'win32' ? (process.env.SystemRoot || 'C:\\') : '/'
}

export interface RunProviderOptions {
  executionId?: string
  onOutput?: OutputCallback
}

export async function runProvider(
  provider: AiProvider,
  ctx: ExecutionContext,
  opts: RunProviderOptions = {}
): Promise<ProviderResult> {
  // Security check on prompt before spawning
  const promptCheck = checkDangerousOperations(ctx.prompt)
  if (promptCheck.isDangerous) {
    return {
      success: false,
      output: '',
      error: `🚫 安全檢查失敗: ${promptCheck.reason}\n\n為了保護您的系統安全，已阻止執行包含危險刪除操作的命令。\n檢測到的命令: ${promptCheck.detectedCommand || '未知'}\n\n如需執行此操作，請明確授權並確認風險。`
    }
  }

  const command = provider.resolveCommand()
  const args = provider.buildArgs(ctx)
  const env = provider.buildEnv()
  const cwd = resolveCwd(ctx.projectPath)
  const useStdin = provider.promptDelivery === 'stdin'

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let killed = false
    let lastActivityTime = Date.now()

    const proc = spawn(command, args, {
      shell: process.platform === 'win32',
      env,
      cwd,
      stdio: useStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    // For stdin-delivery providers (claude on Windows): write prompt then close
    if (useStdin && proc.stdin) {
      proc.stdin.write(ctx.prompt)
      proc.stdin.end()
    }

    if (opts.executionId) {
      registerProcess(opts.executionId, proc)
    }

    // Idle timeout checker
    const idleChecker = setInterval(() => {
      const idleTime = Date.now() - lastActivityTime
      if (idleTime > IDLE_TIMEOUT) {
        killed = true
        clearInterval(idleChecker)
        proc.kill('SIGTERM')
        resolve({
          success: false,
          output: provider.parseOutput(stdout),
          error: `Idle timeout: No output received for ${IDLE_TIMEOUT / 1000 / 60} minutes`
        })
      }
    }, 30_000)

    proc.stdout!.on('data', (data: Buffer) => {
      const text = data.toString()

      const securityCheck = checkDangerousOperations(text)
      if (securityCheck.isDangerous) {
        killed = true
        clearInterval(idleChecker)
        proc.kill('SIGTERM')
        resolve({
          success: false,
          output: provider.parseOutput(stdout),
          error: `🚫 安全檢查失敗: ${securityCheck.reason}\n\n為了保護您的系統安全，已自動停止執行。\n檢測到的命令: ${securityCheck.detectedCommand || '未知'}\n\n嚴格禁止在未經使用者授權下主動刪除項目。`
        })
        return
      }

      stdout += text
      lastActivityTime = Date.now()

      if (opts.onOutput) {
        opts.onOutput(provider.parseOutput(stdout))
      }
    })

    proc.stderr!.on('data', (data: Buffer) => {
      const text = data.toString()

      const securityCheck = checkDangerousOperations(text)
      if (securityCheck.isDangerous) {
        killed = true
        clearInterval(idleChecker)
        proc.kill('SIGTERM')
        resolve({
          success: false,
          output: provider.parseOutput(stdout),
          error: `🚫 安全檢查失敗: ${securityCheck.reason}\n\n為了保護您的系統安全，已自動停止執行。\n檢測到的命令: ${securityCheck.detectedCommand || '未知'}\n\n嚴格禁止在未經使用者授權下主動刪除項目。`
        })
        return
      }

      stderr += text
      lastActivityTime = Date.now()
    })

    proc.on('close', (code) => {
      clearInterval(idleChecker)
      if (killed) return

      const output = provider.parseOutput(stdout)

      if (code === 0) {
        resolve({ success: true, output })
      } else {
        resolve({
          success: false,
          output,
          error: stderr.trim() || `Process exited with code ${code}`
        })
      }
    })

    proc.on('error', (err: Error) => {
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
