import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createRunPipeline, type RunPipelineDeps, type RunStore } from './run-pipeline'
import type { ProviderResult } from './ai/types'
import type { ExecutionLog, RunSnapshot, Task } from '../shared/types'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1', name: 'Daily report', description: null, cron_expression: '0 9 * * *',
    prompt: 'Summarize', cli_tool: 'claude', model: null, mcp_tools: null, attachments: null,
    output_type: 'log', email_to: null, knowledge_file: null, project_path: null,
    skip_permissions: 0, week_interval: 1, enabled: 1, needs_review: 0, automation: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

// In-memory stand-in for the database-backed RunStore
function memoryStore() {
  const logs = new Map<string, ExecutionLog>()
  const snapshots = new Map<string, RunSnapshot>()
  let seq = 0
  const store: RunStore = {
    createExecutionLog: (taskId) => {
      const log: ExecutionLog = { id: `log-${++seq}`, task_id: taskId, started_at: 'now', finished_at: null, status: 'running', output: null, error: null, exit_code: null }
      logs.set(log.id, log)
      return { ...log }
    },
    updateExecutionLog: (id, update) => {
      const log = { ...logs.get(id)!, status: update.status, output: update.output ?? null, error: update.error ?? null, exit_code: update.exitCode ?? null, finished_at: 'now' }
      logs.set(id, log)
      return { ...log }
    },
    updateExecutionLogOutput: (id, output) => {
      const log = { ...logs.get(id)!, output }
      logs.set(id, log)
      return { ...log }
    },
    saveRunSnapshot: (snapshot) => { snapshots.set(snapshot.log_id, { ...snapshot }) },
    updateRunReview: (logId, status, proposed) => {
      const snapshot = snapshots.get(logId)!
      snapshots.set(logId, { ...snapshot, review_status: status, proposed_file_name: proposed ?? snapshot.proposed_file_name })
    }
  }
  return { store, logs, snapshots }
}

describe('createRunPipeline', () => {
  let userDataPath: string
  let mem: ReturnType<typeof memoryStore>
  let cancelled: Set<string>
  let deps: RunPipelineDeps & {
    runProvider: Mock<RunPipelineDeps['runProvider']>
    sendEmail: Mock<RunPipelineDeps['sendEmail']>
  }

  function providerReturns(...results: ProviderResult[]): void {
    for (const result of results) deps.runProvider.mockResolvedValueOnce(result)
  }

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orbit-run-'))
    mem = memoryStore()
    cancelled = new Set()
    deps = {
      store: mem.store,
      runProvider: vi.fn<RunPipelineDeps['runProvider']>(),
      onUpdate: vi.fn(),
      onFinished: vi.fn(),
      sendEmail: vi.fn<RunPipelineDeps['sendEmail']>().mockResolvedValue(undefined),
      userDataPath,
      sleep: vi.fn().mockResolvedValue(undefined),
      wasCancelled: (id) => cancelled.has(id),
      clearCancelled: (id) => { cancelled.delete(id) }
    }
  })

  afterEach(() => rmSync(userDataPath, { recursive: true, force: true }))

  it('records a successful run and notifies completion', async () => {
    providerReturns({ success: true, output: 'done', exitCode: 0 })
    const log = await createRunPipeline(deps)(task())

    expect(log.status).toBe('success')
    expect(log.output).toBe('done')
    expect(deps.runProvider).toHaveBeenCalledOnce()
    expect(deps.runProvider.mock.calls[0][0]).toBe('claude')
    expect(deps.runProvider.mock.calls[0][1].prompt).toContain('Summarize')
    expect(mem.snapshots.get(log.id)?.provider).toBe('claude')
    expect(deps.onFinished).toHaveBeenCalledWith('Daily report', 'success')
  })

  it('retries network errors with backoff before succeeding', async () => {
    providerReturns(
      { success: false, output: '', error: 'getaddrinfo ENOTFOUND api.anthropic.com' },
      { success: true, output: 'ok' }
    )
    const log = await createRunPipeline(deps)(task())

    expect(log.status).toBe('success')
    expect(deps.runProvider).toHaveBeenCalledTimes(2)
    expect(deps.sleep).toHaveBeenCalledWith(30_000)
  })

  it('does not retry non-network failures', async () => {
    providerReturns({ success: false, output: '', error: 'Invalid model', exitCode: 1 })
    const log = await createRunPipeline(deps)(task())

    expect(log.status).toBe('failed')
    expect(log.error).toBe('Invalid model')
    expect(deps.runProvider).toHaveBeenCalledOnce()
    expect(deps.sleep).not.toHaveBeenCalled()
  })

  it('rejects review automations on antigravity without calling the provider', async () => {
    const automation = JSON.stringify({ source: { type: 'schedule' }, result: { type: 'report' }, require_review: true, fallback_provider: null })
    const log = await createRunPipeline(deps)(task({ cli_tool: 'antigravity', automation }))

    expect(log.status).toBe('failed')
    expect(log.error).toContain('require Claude or Codex')
    expect(deps.runProvider).not.toHaveBeenCalled()
    expect(deps.onFinished).toHaveBeenCalledWith('Daily report', 'failed')
  })

  it('copies text attachments into the run inputs and embeds them in the prompt', async () => {
    const source = join(userDataPath, 'notes.md')
    writeFileSync(source, '# Meeting notes')
    providerReturns({ success: true, output: 'ok' })
    const log = await createRunPipeline(deps)(task({ attachments: JSON.stringify([source]) }))

    const prompt = deps.runProvider.mock.calls[0][1].prompt
    expect(prompt).toContain('--- notes.md ---\n# Meeting notes')
    const copied = mem.snapshots.get(log.id)!.attachment_paths[0]
    expect(copied).toBe(join(userDataPath, 'run-inputs', log.id, '0', 'notes.md'))
    expect(existsSync(copied)).toBe(true)
  })

  it('holds emailed results for review instead of sending them', async () => {
    const automation = JSON.stringify({ source: { type: 'schedule' }, result: { type: 'report' }, require_review: true, fallback_provider: null })
    providerReturns({ success: true, output: 'report' })
    const log = await createRunPipeline(deps)(task({ automation, output_type: 'both', email_to: 'a@example.com' }))

    expect(log.status).toBe('pending_review')
    expect(mem.snapshots.get(log.id)?.review_status).toBe('pending')
    expect(deps.runProvider.mock.calls[0][1].reviewMode).toBe(true)
    expect(deps.sendEmail).not.toHaveBeenCalled()
    expect(deps.onFinished).toHaveBeenCalledWith('Daily report', 'pending_review')
  })

  it('sends the result email after a successful run', async () => {
    providerReturns({ success: true, output: 'report' })
    const log = await createRunPipeline(deps)(task({ output_type: 'both', email_to: 'a@example.com' }))

    expect(deps.sendEmail).toHaveBeenCalledOnce()
    expect(deps.sendEmail.mock.calls[0][1].id).toBe(log.id)
  })

  it('records a cancelled run without retrying or notifying completion', async () => {
    deps.runProvider.mockImplementationOnce(async (_provider, _ctx, options) => {
      cancelled.add(options.executionId!)
      return { success: false, output: '', error: 'socket hang up' }
    })
    const log = await createRunPipeline(deps)(task())

    expect(log.status).toBe('cancelled')
    expect(log.error).toBeNull()
    expect(deps.runProvider).toHaveBeenCalledOnce()
    expect(deps.onFinished).not.toHaveBeenCalled()
    expect(cancelled.has(log.id)).toBe(false)
  })

  it('runs file-sourced automations read-only', async () => {
    const source = join(userDataPath, 'invoice.txt')
    writeFileSync(source, 'total 100')
    const automation = JSON.stringify({ source: { type: 'folder', path: userDataPath }, result: { type: 'report' }, require_review: false, fallback_provider: null })
    providerReturns({ success: true, output: 'ok' })
    await createRunPipeline(deps)(
      task({ automation, skip_permissions: 1, mcp_tools: JSON.stringify(['mcp__gmail']) }),
      { sourceFile: source }
    )

    const ctx = deps.runProvider.mock.calls[0][1]
    expect(ctx.reviewMode).toBe(true)
    expect(ctx.skipPermissions).toBe(false)
    expect(ctx.mcpTools).toEqual([])
    expect(ctx.prompt).toContain('只分析與提出變更建議')
  })
})
