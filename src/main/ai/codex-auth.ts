import { spawn } from 'child_process'
import { resolveCodexCommand } from './providers/codex'
import type { CodexAuthStatus } from '../../shared/types'

const LOGIN_TIMEOUT_MS = 15 * 60 * 1000
const COMMAND_TIMEOUT_MS = 30 * 1000
const MAX_OUTPUT_LENGTH = 32 * 1024

interface CodexCommandResult {
  code: number
  stdout: string
  stderr: string
}

function appendOutput(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8')
  return next.length > MAX_OUTPUT_LENGTH ? next.slice(-MAX_OUTPUT_LENGTH) : next
}

function runCodexCommand(args: string[], timeoutMs: number): Promise<CodexCommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveCodexCommand(), args, {
      shell: process.platform === 'win32',
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      finishWithError(new Error(`Codex command timed out after ${Math.round(timeoutMs / 1000)} seconds`))
    }, timeoutMs)

    function finishWithError(error: Error): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk)
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk)
    })

    proc.once('error', (error: Error) => {
      finishWithError(new Error(`Failed to run Codex CLI: ${error.message}`))
    })

    proc.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function commandError(result: CodexCommandResult, action: string): Error {
  const details = result.stderr.trim() || result.stdout.trim()
  return new Error(details || `Codex ${action} failed (exit code: ${result.code})`)
}

export function parseCodexAuthStatus(output: string): CodexAuthStatus {
  const normalized = output.toLowerCase()

  if (/\bnot logged in\b|\blogged out\b|\bsigned out\b|\bnot signed in\b|\bnot authenticated\b|\bno credentials\b/.test(normalized)) {
    return { authenticated: false, method: 'signed-out' }
  }

  if (/\blogged in using chatgpt\b|\bsigned in with chatgpt\b|\bauthenticated with chatgpt\b/.test(normalized)) {
    return { authenticated: true, method: 'chatgpt' }
  }

  if (/\blogged in using (?:an? )?api key\b|\bsigned in with an? api key\b|\bapi key authentication\b/.test(normalized)) {
    return { authenticated: true, method: 'api-key' }
  }

  if (/\b(logged in|authenticated)\b/.test(normalized)) {
    return { authenticated: true, method: 'other' }
  }

  return { authenticated: false, method: 'unknown' }
}

export async function getCodexAuthStatus(): Promise<CodexAuthStatus> {
  const result = await runCodexCommand(['login', 'status'], COMMAND_TIMEOUT_MS)
  const status = parseCodexAuthStatus(`${result.stdout}\n${result.stderr}`)

  if (status.method !== 'unknown') return status
  if (result.code !== 0) throw commandError(result, 'login status check')
  return status
}

export async function loginWithChatGPT(): Promise<void> {
  const result = await runCodexCommand(['login'], LOGIN_TIMEOUT_MS)
  if (result.code !== 0) throw commandError(result, 'login')
}

export async function logoutCodex(): Promise<void> {
  const result = await runCodexCommand(['logout'], COMMAND_TIMEOUT_MS)
  if (result.code !== 0) throw commandError(result, 'logout')
}
