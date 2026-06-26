import cron, { ScheduledTask } from 'node-cron'
import { Notification } from 'electron'
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs'
import { basename, extname, dirname } from 'path'
import { getEnabledTasks, getTaskById, createExecutionLog, updateExecutionLog, updateExecutionLogOutput, getExecutionLogWithTask } from './database'

// Text file extensions that can be embedded in prompt
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.css', '.html', '.xml',
  '.yaml', '.yml', '.csv', '.sql', '.sh', '.bash', '.py', '.rb', '.java', '.c',
  '.cpp', '.h', '.hpp', '.go', '.rs', '.swift', '.kt', '.scala', '.php', '.vue',
  '.svelte', '.astro', '.env', '.gitignore', '.dockerfile', '.toml', '.ini', '.cfg'
])

// Binary file extensions that need --file flag (requires session token)
const BINARY_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.tar', '.gz'
])

function isTextFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

function isBinaryFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}
import { getProvider, runProvider } from './ai'
import { buildUnattendedInstruction } from './ai/unattended'
import { wasCancelled, clearCancelled } from './process-manager'
import type { ExecutionContext, ProviderResult } from './ai/types'
import { sendTaskResultEmail } from './email'
import { t, getMainLocale } from './i18n'
import type { Task, ExecutionLog, ExecutionLogWithTask } from '../shared/types'

// Store active cron jobs
const activeJobs: Map<string, ScheduledTask> = new Map()

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

// Retry configuration for network failures
const MAX_RETRIES = 3
const RETRY_DELAYS = [30_000, 60_000, 120_000] // 30s, 1m, 2m

// Patterns that indicate a network/transient error worth retrying
const NETWORK_ERROR_PATTERNS = [
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'EAI_AGAIN',
  'socket hang up',
  'network error',
  'getaddrinfo',
  'connect EHOSTUNREACH',
  'fetch failed',
  'request to .* failed',
  'overloaded',
  '529',  // Anthropic overloaded
  '503',  // Service unavailable
  '502',  // Bad gateway
  '504',  // Gateway timeout
  'rate limit',
  'too many requests',
  '429',
]

function isNetworkError(error: string): boolean {
  const lower = error.toLowerCase()
  return NETWORK_ERROR_PATTERNS.some(pattern => lower.includes(pattern.toLowerCase()))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const KNOWLEDGE_START = '<!-- KNOWLEDGE_START -->'
const KNOWLEDGE_END = '<!-- KNOWLEDGE_END -->'
const KNOWLEDGE_REGEX = /<!-- KNOWLEDGE_START -->([\s\S]*?)<!-- KNOWLEDGE_END -->/g

function extractAndSaveKnowledge(task: Task, output: string): string {
  if (!task.knowledge_file) return output

  const matches = [...output.matchAll(KNOWLEDGE_REGEX)]
  if (matches.length === 0) return output

  try {
    const knowledgeContent = matches.map(m => m[1].trim()).join('\n\n')
    const date = new Date().toISOString().split('T')[0]
    const entry = `\n\n## ${task.name} - ${date}\n\n${knowledgeContent}`

    const filePath = task.knowledge_file.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '')

    if (!existsSync(filePath)) {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, `# Knowledge Base\n${entry}`, 'utf-8')
    } else {
      appendFileSync(filePath, entry, 'utf-8')
    }

    console.log(`[Scheduler] Knowledge saved to ${filePath}`)
  } catch (err) {
    console.error(`[Scheduler] Failed to save knowledge:`, err)
  }

  // Remove knowledge markers from output
  return output.replace(KNOWLEDGE_REGEX, '').trim()
}

function showCompletionNotification(taskName: string, success: boolean): void {
  if (!Notification.isSupported()) return
  try {
    new Notification({
      title: taskName,
      body: success ? t('main.notification.success') : t('main.notification.failure')
    }).show()
  } catch (err) {
    console.error('[Notification] failed:', err)
  }
}

async function executeTask(task: Task): Promise<ExecutionLog> {
  console.log(`[Scheduler] Executing task: ${task.name} (${task.id})`)

  // Create execution log
  const log = createExecutionLog(task.id)
  notifyExecutionUpdate(log)

  try {
    // Parse MCP tools
    const mcpTools = task.mcp_tools ? JSON.parse(task.mcp_tools) as string[] : undefined

    // Parse attachments - separate text files (embed in prompt) from binary files (pass as imagePaths)
    const binaryFiles: string[] = []
    const addDirs: Set<string> = new Set()
    let promptWithTextFiles = task.prompt

    if (task.project_path) {
      addDirs.add(task.project_path)
    }

    if (task.attachments) {
      const attachmentPaths = JSON.parse(task.attachments) as string[]
      const textFileContents: string[] = []

      for (const filePath of attachmentPaths) {
        if (!existsSync(filePath)) {
          console.log(`[Scheduler] Attachment not found: ${filePath}`)
          continue
        }

        const fileName = basename(filePath)

        if (isTextFile(filePath)) {
          // Read text files and embed in prompt
          try {
            const content = readFileSync(filePath, 'utf-8')
            textFileContents.push(`\n--- ${fileName} ---\n${content}`)
            console.log(`[Scheduler] Embedded text file: ${fileName}`)
          } catch (err) {
            console.log(`[Scheduler] Failed to read text file ${filePath}:`, err)
          }
        } else if (isBinaryFile(filePath)) {
          // Binary/image files: pass as imagePaths, add directory to addDirs
          binaryFiles.push(filePath)
          addDirs.add(dirname(filePath))
          console.log(`[Scheduler] Binary file will use imagePaths: ${fileName}`)
        } else {
          // Unknown extension - try to read as text
          try {
            const content = readFileSync(filePath, 'utf-8')
            // Check if content has too many non-printable characters (likely binary)
            const nonPrintable = content.split('').filter(c => c.charCodeAt(0) < 32 && c !== '\n' && c !== '\r' && c !== '\t').length
            if (nonPrintable / content.length < 0.1) {
              textFileContents.push(`\n--- ${fileName} ---\n${content}`)
              console.log(`[Scheduler] Embedded unknown file as text: ${fileName}`)
            } else {
              binaryFiles.push(filePath)
              addDirs.add(dirname(filePath))
              console.log(`[Scheduler] Unknown file appears binary, using imagePaths: ${fileName}`)
            }
          } catch {
            binaryFiles.push(filePath)
            addDirs.add(dirname(filePath))
            console.log(`[Scheduler] Could not read as text, using imagePaths: ${fileName}`)
          }
        }
      }

      // Add text file contents to prompt
      if (textFileContents.length > 0) {
        promptWithTextFiles = `${task.prompt}\n\n[Attached Files]${textFileContents.join('\n')}`
      }

      // Add attachment info to prompt so the AI knows about the binary files
      if (binaryFiles.length > 0) {
        const fileNames = binaryFiles.map(f => basename(f)).join(', ')
        promptWithTextFiles = `${promptWithTextFiles}\n\n[附件檔案: ${fileNames}] - 請直接分析這些已附加的檔案內容。`
      }
    }

    // Inject email report marker instruction if email is configured
    if (task.output_type === 'both' && task.email_to) {
      promptWithTextFiles += '\n\n請將最終報告內容用 <!-- REPORT_START --> 和 <!-- REPORT_END --> 標記包裹。標記之外的思考過程、執行步驟等不會出現在 email 中，只有標記內的內容會被寄送。請確保報告內容完整且格式良好。'
    }

    // Inject knowledge extraction instruction if knowledge_file is configured
    if (task.knowledge_file) {
      promptWithTextFiles += '\n\n在報告最後，請用 <!-- KNOWLEDGE_START --> 和 <!-- KNOWLEDGE_END --> 標記包裹本次分析中值得長期記錄的經驗、查詢技巧、資料陷阱或注意事項。只記錄可複用的知識，不要重複報告內容本身。如果沒有新的經驗值得記錄，就不需要加這個標記。'
    }

    console.log(`[Scheduler] Calling ${task.cli_tool || 'claude'} CLI with prompt length: ${promptWithTextFiles.length}, model: ${task.model || 'default'}, binary attachments: ${binaryFiles.length}`)

    // Throttle output updates to avoid too many DB writes
    let lastUpdateTime = 0
    const UPDATE_INTERVAL = 2000 // Update every 2 seconds max

    const onOutput = (partialOutput: string) => {
      const now = Date.now()
      if (now - lastUpdateTime > UPDATE_INTERVAL) {
        lastUpdateTime = now
        // Update the log with partial output
        const updatedLog = updateExecutionLogOutput(log.id, partialOutput)
        notifyExecutionUpdate(updatedLog)
      }
    }

    let result: ProviderResult
    let lastError = ''

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS[attempt - 1]
        console.log(`[Scheduler] Retry ${attempt}/${MAX_RETRIES} for task ${task.name} after ${delay / 1000}s delay (error: ${lastError})`)

        // Update log to show retry status
        const retryLog = updateExecutionLogOutput(log.id, t('main.retry.networkError', { delay: delay / 1000, attempt, max: MAX_RETRIES, error: lastError }))
        notifyExecutionUpdate(retryLog)

        await sleep(delay)
      }

      const ctx: ExecutionContext = {
        prompt: promptWithTextFiles,
        systemInstruction: buildUnattendedInstruction(getMainLocale()),
        model: task.model,
        mcpTools: mcpTools ?? [],
        imagePaths: binaryFiles,
        addDirs: Array.from(addDirs),
        projectPath: task.project_path,
        skipPermissions: task.skip_permissions === 1
      }
      result = await runProvider(getProvider(task.cli_tool), ctx, { executionId: log.id, onOutput })

      // User cancelled this execution — stop immediately, do not retry
      if (wasCancelled(log.id)) {
        break
      }

      // If success or non-network error, stop retrying
      if (result.success) {
        if (attempt > 0) {
          console.log(`[Scheduler] Task ${task.name} succeeded on retry ${attempt}`)
        }
        break
      }

      const errorText = result.error || result.output || ''
      if (!isNetworkError(errorText)) {
        console.log(`[Scheduler] Task ${task.name} failed with non-network error, not retrying`)
        break
      }

      lastError = errorText
      if (attempt === MAX_RETRIES) {
        console.log(`[Scheduler] Task ${task.name} failed after ${MAX_RETRIES} retries`)
        result.error = `${result.error}\n\n${t('main.retry.exhausted', { max: MAX_RETRIES })}`
      }
    }

    console.log(`[Scheduler] ${task.cli_tool || 'claude'} CLI result: success=${result!.success}, output length=${result!.output?.length || 0}`)

    // Extract and save knowledge, then clean output
    let cleanOutput = result!.output
    if (result!.success && task.knowledge_file && result!.output) {
      cleanOutput = extractAndSaveKnowledge(task, result!.output)
    }

    // A user-cancelled run is recorded as 'cancelled' (not 'failed') so the UI
    // can show it distinctly. executeTask is the only writer of the final status,
    // which avoids racing with the cancel handler.
    const cancelled = wasCancelled(log.id)
    if (cancelled) clearCancelled(log.id)

    // Update execution log
    const updatedLog = updateExecutionLog(log.id, {
      status: cancelled ? 'cancelled' : result!.success ? 'success' : 'failed',
      output: cleanOutput,
      error: cancelled ? undefined : result!.error
    })

    notifyExecutionUpdate(updatedLog)
    if (!cancelled) {
      showCompletionNotification(task.name, result!.success)
    }

    // Send email if configured (only on success — failures stay in logs)
    if (task.output_type === 'both' && task.email_to && updatedLog.status === 'success') {
      try {
        await sendTaskResultEmail(task, updatedLog)
      } catch (emailError) {
        console.error('Failed to send email:', emailError)
      }
    }

    return updatedLog
  } catch (error) {
    clearCancelled(log.id)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const updatedLog = updateExecutionLog(log.id, {
      status: 'failed',
      error: errorMessage
    })

    notifyExecutionUpdate(updatedLog)
    showCompletionNotification(task.name, false)
    return updatedLog
  }
}

export function scheduleTask(task: Task): void {
  // Remove existing job if any
  unscheduleTask(task.id)

  if (!task.enabled) {
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

      executeTask(currentTask)
    }
  })

  activeJobs.set(task.id, job)
  console.log(`Scheduled task ${task.id} (${task.name}) with cron: ${task.cron_expression}`)
}

export function unscheduleTask(taskId: string): void {
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

  return executeTask(task)
}

export function getNextExecutionTime(cronExpression: string): Date | null {
  if (!cron.validate(cronExpression)) {
    return null
  }

  // node-cron doesn't provide next execution time directly
  // We'll use a simple calculation based on common patterns
  // For more accurate results, consider using cron-parser package
  return null
}

export function isTaskScheduled(taskId: string): boolean {
  return activeJobs.has(taskId)
}

export function getScheduledTaskIds(): string[] {
  return Array.from(activeJobs.keys())
}
