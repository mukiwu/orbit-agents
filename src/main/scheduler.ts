import cron, { ScheduledTask } from 'node-cron'
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs'
import { basename, extname, dirname } from 'path'
import { getEnabledTasks, getTaskById, createExecutionLog, updateExecutionLog, updateExecutionLogOutput } from './database'

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
function isCodexNativeImage(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)
}
import { executeClaudeCli } from './claude-cli'
import { executeCodexCli } from './codex-cli'
import { executeGeminiCli } from './gemini-cli'
import { sendTaskResultEmail } from './email'
import type { Task, ExecutionLog, ClaudeCliResult, GeminiCliResult, CodexCliResult } from '../shared/types'

// Store active cron jobs
const activeJobs: Map<string, ScheduledTask> = new Map()

// Event emitter for execution events
type ExecutionEventCallback = (log: ExecutionLog) => void
const executionCallbacks: ExecutionEventCallback[] = []

export function onExecutionUpdate(callback: ExecutionEventCallback): void {
  executionCallbacks.push(callback)
}

function notifyExecutionUpdate(log: ExecutionLog): void {
  for (const callback of executionCallbacks) {
    try {
      callback(log)
    } catch (err) {
      // Ignore errors if window is destroyed
      console.log('[Scheduler] Failed to notify update (window may be closed):', err)
    }
  }
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

    const filePath = task.knowledge_file.replace(/^~/, process.env.HOME || '')

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

async function executeTask(task: Task): Promise<ExecutionLog> {
  console.log(`[Scheduler] Executing task: ${task.name} (${task.id})`)

  // Create execution log
  const log = createExecutionLog(task.id)
  notifyExecutionUpdate(log)

  try {
    // Parse MCP tools
    const mcpTools = task.mcp_tools ? JSON.parse(task.mcp_tools) as string[] : undefined

    // Parse attachments - separate text files (embed in prompt) from binary files (use --file)
    let binaryAttachments: string[] | undefined
    let promptWithTextFiles = task.prompt

    if (task.attachments) {
      const attachmentPaths = JSON.parse(task.attachments) as string[]
      const textFileContents: string[] = []
      const binaryFiles: string[] = []

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
          // Binary files need --file flag (requires session token)
          binaryFiles.push(filePath)
          console.log(`[Scheduler] Binary file will use --file: ${fileName}`)
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
              console.log(`[Scheduler] Unknown file appears binary, using --file: ${fileName}`)
            }
          } catch {
            binaryFiles.push(filePath)
            console.log(`[Scheduler] Could not read as text, using --file: ${fileName}`)
          }
        }
      }

      // Add text file contents to prompt
      if (textFileContents.length > 0) {
        promptWithTextFiles = `${task.prompt}\n\n[Attached Files]${textFileContents.join('\n')}`
      }

      // Set binary attachments for --file flag
      if (binaryFiles.length > 0) {
        if (task.cli_tool === 'codex') {
          const codexImageAttachments = binaryFiles.filter(isCodexNativeImage)
          const skippedFiles = binaryFiles.filter((filePath) => !isCodexNativeImage(filePath))

          if (codexImageAttachments.length > 0) {
            binaryAttachments = codexImageAttachments
            const fileNames = codexImageAttachments.map(f => basename(f)).join(', ')
            promptWithTextFiles = `${promptWithTextFiles}\n\n[已附加圖片檔案: ${fileNames}] - 請一併參考這些圖片內容。`
          }

          if (skippedFiles.length > 0) {
            const fileNames = skippedFiles.map(f => basename(f)).join(', ')
            promptWithTextFiles = `${promptWithTextFiles}\n\n[未直接附加的二進位檔案: ${fileNames}] - Codex CLI 目前只能直接接收圖片附件，若需要分析請改附上文字內容或圖片檔。`
          }
        } else {
          binaryAttachments = binaryFiles
          const fileNames = binaryFiles.map(f => basename(f)).join(', ')
          promptWithTextFiles = `${promptWithTextFiles}\n\n[附件檔案: ${fileNames}] - 請直接分析這些已附加的檔案內容。`
        }
      }
    }

    // Inject knowledge extraction instruction if knowledge_file is configured
    if (task.knowledge_file) {
      promptWithTextFiles += '\n\n在報告最後，請用 <!-- KNOWLEDGE_START --> 和 <!-- KNOWLEDGE_END --> 標記包裹本次分析中值得長期記錄的經驗、查詢技巧、資料陷阱或注意事項。只記錄可複用的知識，不要重複報告內容本身。如果沒有新的經驗值得記錄，就不需要加這個標記。'
    }

    console.log(`[Scheduler] Calling ${task.cli_tool || 'claude'} CLI with prompt length: ${promptWithTextFiles.length}, model: ${task.model || 'default'}, binary attachments: ${binaryAttachments?.length || 0}`)

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

    let result: ClaudeCliResult | GeminiCliResult | CodexCliResult

    if (task.cli_tool === 'gemini') {
      result = await executeGeminiCli(promptWithTextFiles, task.model, onOutput, binaryAttachments, mcpTools, log.id)
    } else if (task.cli_tool === 'codex') {
      result = await executeCodexCli(promptWithTextFiles, task.model, onOutput, binaryAttachments, mcpTools)
    } else {
      // Default to Claude
      result = await executeClaudeCli(promptWithTextFiles, mcpTools, task.model, onOutput, binaryAttachments)
    }

    console.log(`[Scheduler] ${task.cli_tool || 'claude'} CLI result: success=${result.success}, output length=${result.output?.length || 0}`)

    // Extract and save knowledge, then clean output
    let cleanOutput = result.output
    if (result.success && task.knowledge_file && result.output) {
      cleanOutput = extractAndSaveKnowledge(task, result.output)
    }

    // Update execution log
    const updatedLog = updateExecutionLog(log.id, {
      status: result.success ? 'success' : 'failed',
      output: cleanOutput,
      error: result.error
    })

    notifyExecutionUpdate(updatedLog)

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
    const errorMessage = error instanceof Error ? error.message : String(error)
    const updatedLog = updateExecutionLog(log.id, {
      status: 'failed',
      error: errorMessage
    })

    notifyExecutionUpdate(updatedLog)
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
