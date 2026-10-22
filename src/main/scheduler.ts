import cron, { ScheduledTask } from 'node-cron'
import { Notification } from 'electron'
import { existsSync } from 'fs'
import { createHash } from 'crypto'
import { app } from 'electron'
import { getEnabledTasks, getTaskById, createExecutionLog, updateExecutionLog, finishReviewedLog, updateExecutionLogOutput, getExecutionLogWithTask, claimInboxFile, finishInboxFile, saveRunSnapshot, getRunSnapshot, updateRunReview, claimRunReview, getExecutionLogById, getWebsiteState, setWebsiteState } from './database'
import { parseAutomationConfig } from './automation-config'
import { listInboxCandidates } from './file-inbox'
import { moveReviewedFile } from './result-actions'

import { getProvider, runProvider } from './ai'
import { createRunPipeline, extractAndSaveKnowledge, KNOWLEDGE_REGEX, type CompletionStatus } from './run-pipeline'
import { beginBackoff, endBackoff, wasCancelled, clearCancelled } from './process-manager'
import { sendTaskResultEmail } from './email'
import { t } from './i18n'
import type { Task, ExecutionLog, ExecutionLogWithTask, ProviderId } from '../shared/types'

// Store active cron jobs
const activeJobs: Map<string, ScheduledTask> = new Map()
const activeInboxJobs = new Map<string, NodeJS.Timeout>()
const scanningInboxes = new Set<string>()
const scanningWebsites = new Set<string>()

// Event emitter for execution events
type ExecutionEventCallback = (log: ExecutionLogWithTask) => void
const executionCallbacks: ExecutionEventCallback[] = []

export function onExecutionUpdate(callback: ExecutionEventCallback): void {
  executionCallbacks.push(callback)
}

function notifyExecutionUpdate(log: ExecutionLog): void {
  // Enrich with task_name via JOIN query before sending to frontend
  const enriched = getExecutionLogWithTask(log.id) || (log as ExecutionLogWithTask)
  for (const callback of executionCallbacks) {
    try {
      callback(enriched)
    } catch (err) {
      // Ignore errors if window is destroyed
      console.log('[Scheduler] Failed to notify update (window may be closed):', err)
    }
  }
}

function showCompletionNotification(taskName: string, status: CompletionStatus): void {
  if (!Notification.isSupported()) return
  try {
    new Notification({
      title: taskName,
      body: status === 'pending_review' ? t('main.notification.review')
        : status === 'success' ? t('main.notification.success') : t('main.notification.failure')
    }).show()
  } catch (err) {
    console.error('[Notification] failed:', err)
  }
}

const executeTask = createRunPipeline({
  store: { createExecutionLog, updateExecutionLog, updateExecutionLogOutput, saveRunSnapshot, updateRunReview },
  runProvider: (providerId, ctx, options) => runProvider(getProvider(providerId), ctx, options),
  onUpdate: notifyExecutionUpdate,
  onFinished: showCompletionNotification,
  sendEmail: sendTaskResultEmail,
  get userDataPath() { return app.getPath('userData') },
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  beginBackoff,
  endBackoff,
  wasCancelled,
  clearCancelled
})

export async function scanInboxTask(taskId: string, force = false): Promise<ExecutionLog | null> {
  if (scanningInboxes.has(taskId)) return null
  const task = getTaskById(taskId)
  if (!task || (!task.enabled && !force)) return null
  const source = parseAutomationConfig(task.automation).source
  if (source.type !== 'folder') return null

  scanningInboxes.add(taskId)
  let lastLog: ExecutionLog | null = null
  try {
    const candidates = listInboxCandidates(source.path, {
      createdAtMs: new Date(task.created_at).getTime()
    })
    for (const candidate of candidates) {
      if (!force && !getTaskById(taskId)?.enabled) break
      if (!claimInboxFile(taskId, candidate.path, candidate.modifiedAtMs, candidate.size)) continue
      const log = await executeTask(task, { sourceFile: candidate.path })
      finishInboxFile(taskId, candidate.path, candidate.modifiedAtMs, candidate.size,
        ['success', 'pending_review'].includes(log.status) ? 'success' : 'failed', log.id)
      lastLog = log
    }
  } catch (error) {
    console.error(`[Scheduler] Inbox scan failed for task ${taskId}:`, error)
  } finally {
    scanningInboxes.delete(taskId)
  }
  return lastLog
}

async function fetchWebsite(url: string): Promise<{ hash: string; content: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'follow' })
  if (!response.ok) throw new Error(`Website returned HTTP ${response.status}`)
  const type = response.headers.get('content-type') || ''
  if (type && !/(text\/|application\/json|application\/xml)/i.test(type)) throw new Error('Website response must be text')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Website response is empty')
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > 1_000_000) {
      await reader.cancel()
      throw new Error('Website response exceeds 1 MB')
    }
    chunks.push(value)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const content = type.includes('html')
    ? raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : raw
  return { hash: createHash('sha256').update(raw).digest('hex'), content: content.slice(0, 80_000) }
}

async function runWebsiteTask(task: Task): Promise<ExecutionLog | null> {
  const source = parseAutomationConfig(task.automation).source
  if (source.type !== 'website') return null
  if (scanningWebsites.has(task.id)) return null
  scanningWebsites.add(task.id)
  try {
    const page = await fetchWebsite(source.url)
    const prior = getWebsiteState(task.id, source.url)
    if (prior?.hash === page.hash) return null
    const sourceContent = prior?.content
      ? `[Previous content]\n${prior.content}\n\n[Current content]\n${page.content}`
      : `[Current content]\n${page.content}`
    const log = await executeTask(task, { sourceUrl: source.url, sourceContent })
    if (log.status === 'success' || log.status === 'pending_review') setWebsiteState(task.id, source.url, page.hash, page.content)
    return log
  } catch (error) {
    const log = createExecutionLog(task.id)
    const failed = updateExecutionLog(log.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
    notifyExecutionUpdate(failed)
    return failed
  } finally {
    scanningWebsites.delete(task.id)
  }
}

export async function reviewRun(logId: string, approve: boolean): Promise<ExecutionLog> {
  const snapshot = getRunSnapshot(logId)
  const log = getExecutionLogById(logId)
  if (!snapshot || !log || log.status !== 'pending_review' || !claimRunReview(logId)) {
    throw new Error('This run is no longer awaiting review')
  }
  if (!approve) {
    updateRunReview(logId, 'rejected')
    const rejected = finishReviewedLog(logId, 'cancelled', log.output)
    notifyExecutionUpdate(rejected)
    return rejected
  }
  try {
    let resultText = log.output ?? ''
    if (snapshot.result_type === 'organize-file') {
      if (!snapshot.source_path || !snapshot.destination || !snapshot.proposed_file_name ||
        snapshot.source_size === null || snapshot.source_modified_at_ms === null) throw new Error('File proposal is incomplete')
      const path = moveReviewedFile(snapshot.source_path, snapshot.destination, snapshot.proposed_file_name,
        { size: snapshot.source_size, modifiedAtMs: snapshot.source_modified_at_ms })
      resultText += `\n\nMoved file to: ${path}`
    }
    const cleanResultText = resultText.replace(KNOWLEDGE_REGEX, '').trim()
    const task = getTaskById(log.task_id)
    if (snapshot.email_to && !task) throw new Error('Task was deleted before email approval')
    if (snapshot.email_to && task) {
      await sendTaskResultEmail({ ...task, output_type: 'both', email_to: snapshot.email_to }, { ...log, status: 'success', output: cleanResultText })
    }
    if (task?.knowledge_file) extractAndSaveKnowledge(task, resultText)
    updateRunReview(logId, 'approved')
    const approved = finishReviewedLog(logId, 'success', cleanResultText)
    notifyExecutionUpdate(approved)
    if (task) showCompletionNotification(task.name, 'success')
    return approved
  } catch (error) {
    updateRunReview(logId, 'rejected')
    const failed = finishReviewedLog(logId, 'failed', log.output,
      `${error instanceof Error ? error.message : String(error)}; inspect external effects before replaying`)
    notifyExecutionUpdate(failed)
    throw error
  }
}

export async function replayRun(logId: string, provider?: ProviderId): Promise<ExecutionLog> {
  const snapshot = getRunSnapshot(logId)
  const previous = getExecutionLogById(logId)
  if (!snapshot || !previous || previous.status === 'running' || previous.status === 'pending_review') {
    throw new Error('This run cannot be replayed')
  }
  const task = getTaskById(previous.task_id)
  if (!task) throw new Error('The original task no longer exists')
  if (snapshot.result_type === 'organize-file' && previous.status === 'success') {
    throw new Error('File organization has already been applied')
  }
  if (provider && !['claude', 'codex', 'antigravity'].includes(provider)) throw new Error('Unknown provider')
  return executeTask(task, { replay: snapshot, provider })
}

export function resumeDeliveryRun(logId: string): ExecutionLog {
  const snapshot = getRunSnapshot(logId)
  const previous = getExecutionLogById(logId)
  if (!snapshot || !previous || previous.status !== 'failed' ||
    snapshot.review_status !== 'rejected' || !snapshot.require_review || !previous.output) {
    throw new Error('No failed delivery stage is available to resume')
  }
  if (snapshot.result_type === 'organize-file' && (!snapshot.source_path || !existsSync(snapshot.source_path))) {
    throw new Error('The source file is no longer present; inspect the previous delivery before retrying')
  }
  const next = createExecutionLog(previous.task_id)
  saveRunSnapshot({ ...snapshot, log_id: next.id, replay_of: logId,
    review_status: 'pending', created_at: new Date().toISOString() })
  const pending = updateExecutionLog(next.id, {
    status: 'pending_review', output: previous.output, exitCode: previous.exit_code
  })
  notifyExecutionUpdate(pending)
  return pending
}

export function scheduleTask(task: Task): void {
  // Remove existing job if any
  unscheduleTask(task.id)

  if (!task.enabled) {
    return
  }

  const automation = parseAutomationConfig(task.automation)
  if (automation.source.type === 'folder') {
    const timer = setInterval(() => { void scanInboxTask(task.id) }, 10_000)
    activeInboxJobs.set(task.id, timer)
    void scanInboxTask(task.id)
    return
  }

  // Validate cron expression
  if (!cron.validate(task.cron_expression)) {
    console.error(`Invalid cron expression for task ${task.id}: ${task.cron_expression}`)
    return
  }

  const job = cron.schedule(task.cron_expression, () => {
    // Re-fetch task to ensure we have latest data
    const currentTask = getTaskById(task.id)
    if (currentTask && currentTask.enabled) {
      // Check week interval
      if (currentTask.week_interval && currentTask.week_interval > 1) {
        const createdAt = new Date(currentTask.created_at)
        const now = new Date()
        const oneWeek = 7 * 24 * 60 * 60 * 1000
        // Calculate weeks difference
        const weeksDiff = Math.floor((now.getTime() - createdAt.getTime()) / oneWeek)

        if (weeksDiff % currentTask.week_interval !== 0) {
          console.log(`[Scheduler] Skipping task ${currentTask.name} (${currentTask.id}) due to week interval ${currentTask.week_interval} (weeks diff: ${weeksDiff})`)
          return
        }
      }

      if (parseAutomationConfig(currentTask.automation).source.type === 'website') {
        void runWebsiteTask(currentTask)
      } else {
        void executeTask(currentTask)
      }
    }
  })

  activeJobs.set(task.id, job)
  console.log(`Scheduled task ${task.id} (${task.name}) with cron: ${task.cron_expression}`)
}

export function unscheduleTask(taskId: string): void {
  const inboxJob = activeInboxJobs.get(taskId)
  if (inboxJob) {
    clearInterval(inboxJob)
    activeInboxJobs.delete(taskId)
  }
  const job = activeJobs.get(taskId)
  if (job) {
    job.stop()
    activeJobs.delete(taskId)
    console.log(`Unscheduled task ${taskId}`)
  }
}

export function initScheduler(): void {
  const tasks = getEnabledTasks()

  for (const task of tasks) {
    scheduleTask(task)
  }

  console.log(`Scheduler initialized with ${tasks.length} tasks`)
}

export function stopScheduler(): void {
  for (const timer of activeInboxJobs.values()) clearInterval(timer)
  activeInboxJobs.clear()
  for (const [taskId, job] of activeJobs) {
    job.stop()
    console.log(`Stopped task ${taskId}`)
  }
  activeJobs.clear()
}

export async function runTaskNow(taskId: string): Promise<ExecutionLog> {
  const task = getTaskById(taskId)

  if (!task) {
    throw new Error(`Task with id ${taskId} not found`)
  }

  if (parseAutomationConfig(task.automation).source.type === 'folder') {
    const log = await scanInboxTask(taskId, true)
    if (!log) throw new Error('No new files in the inbox')
    return log
  }

  if (parseAutomationConfig(task.automation).source.type === 'website') {
    const log = await runWebsiteTask(task)
    if (!log) throw new Error('Website has not changed since the last run')
    return log
  }
  return executeTask(task)
}

export function getNextExecutionTime(task: Task): Date | null {
  const job = activeJobs.get(task.id)
  if (!job) return null

  try {
    if (!task.week_interval || task.week_interval <= 1) return job.getNextRun()

    // The scheduler skips weeks relative to task creation. Inspect upcoming cron
    // matches so the dashboard does not display a run that would be skipped.
    const createdAt = new Date(task.created_at).getTime()
    if (!Number.isFinite(createdAt)) return null
    const weekMs = 7 * 24 * 60 * 60 * 1000
    const candidates = job.getNextRuns(500)
    const nextEligible = candidates.find((date) => {
      const weeksDiff = Math.floor((date.getTime() - createdAt) / weekMs)
      return weeksDiff >= 0 && weeksDiff % task.week_interval === 0
    })
    if (nextEligible) return nextEligible

    // A minute-level cron can have more than 500 matches in a skipped week.
    // Jump to the next eligible week and inspect its first day instead of
    // returning a skipped run as the next execution.
    const lastCandidate = candidates[candidates.length - 1]
    if (!lastCandidate) return null
    const lastWeek = Math.floor((lastCandidate.getTime() - createdAt) / weekMs)
    const remainder = ((lastWeek % task.week_interval) + task.week_interval) % task.week_interval
    const nextWeek = lastWeek + (task.week_interval - remainder)
    const eligibleStart = createdAt + nextWeek * weekMs
    const start = Math.ceil(Math.max(Date.now(), eligibleStart) / 60_000) * 60_000
    const end = Math.min(eligibleStart + weekMs, start + 24 * 60 * 60 * 1000)
    for (let time = start; time < end; time += 60_000) {
      const date = new Date(time)
      if (job.match(date)) return date
    }
    return null
  } catch {
    return null
  }
}

export function isTaskScheduled(taskId: string): boolean {
  return activeJobs.has(taskId) || activeInboxJobs.has(taskId)
}

export function getScheduledTaskIds(): string[] {
  return [...activeJobs.keys(), ...activeInboxJobs.keys()]
}
