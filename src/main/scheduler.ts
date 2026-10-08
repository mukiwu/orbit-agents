import cron, { ScheduledTask } from 'node-cron'
import { Notification } from 'electron'
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, copyFileSync, statSync } from 'fs'
import { basename, extname, dirname, join } from 'path'
import { createHash } from 'crypto'
import { app } from 'electron'
import { extractDocumentText } from './document-text'
import { getEnabledTasks, getTaskById, createExecutionLog, updateExecutionLog, finishReviewedLog, updateExecutionLogOutput, getExecutionLogWithTask, claimInboxFile, finishInboxFile, saveRunSnapshot, getRunSnapshot, updateRunReview, claimRunReview, getExecutionLogById, getWebsiteState, setWebsiteState } from './database'
import { parseAutomationConfig } from './automation-config'
import { listInboxCandidates } from './file-inbox'
import { moveReviewedFile, proposedFileName } from './result-actions'

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
import type { Task, ExecutionLog, ExecutionLogWithTask, RunSnapshot, ProviderId } from '../shared/types'

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

function showCompletionNotification(taskName: string, status: 'success' | 'failed' | 'pending_review'): void {
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

interface RunOptions {
  sourceFile?: string
  sourceUrl?: string
  sourceContent?: string
  replay?: RunSnapshot
  provider?: ProviderId
}

async function executeTask(task: Task, options: RunOptions = {}): Promise<ExecutionLog> {
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

    const sourceFile = options.sourceFile
    const snapshotPaths: string[] = []
    if (options.replay || task.attachments || sourceFile) {
      const attachmentPaths = options.replay?.attachment_paths || (task.attachments ? JSON.parse(task.attachments) as string[] : [])
      if (!options.replay && sourceFile && !attachmentPaths.includes(sourceFile)) attachmentPaths.push(sourceFile)
      const textFileContents: string[] = []

      for (const [index, filePath] of attachmentPaths.entries()) {
        if (!existsSync(filePath)) {
          console.log(`[Scheduler] Attachment not found: ${filePath}`)
          continue
        }

        const fileName = basename(filePath)
        const inputCopy = join(app.getPath('userData'), 'run-inputs', log.id, String(index), fileName)
        mkdirSync(dirname(inputCopy), { recursive: true })
        copyFileSync(filePath, inputCopy)
        snapshotPaths.push(inputCopy)

        if (['.pdf', '.docx'].includes(extname(inputCopy).toLowerCase())) {
          try {
            const content = await extractDocumentText(inputCopy)
            if (content) {
              textFileContents.push(`\n--- ${fileName} ---\n${content}`)
            } else {
              binaryFiles.push(inputCopy)
              addDirs.add(dirname(inputCopy))
            }
          } catch (error) {
            console.warn(`[Scheduler] Document extraction failed for ${fileName}:`, error)
            binaryFiles.push(inputCopy)
            addDirs.add(dirname(inputCopy))
          }
        } else if (isTextFile(inputCopy)) {
          // Read text files and embed in prompt
          try {
            const content = readFileSync(inputCopy, 'utf-8')
            textFileContents.push(`\n--- ${fileName} ---\n${content}`)
            console.log(`[Scheduler] Embedded text file: ${fileName}`)
          } catch (err) {
            console.log(`[Scheduler] Failed to read text file ${filePath}:`, err)
          }
        } else if (isBinaryFile(inputCopy)) {
          // Binary/image files: pass as imagePaths, add directory to addDirs
          binaryFiles.push(inputCopy)
          addDirs.add(dirname(inputCopy))
          console.log(`[Scheduler] Binary file will use imagePaths: ${fileName}`)
        } else {
          // Unknown extension - try to read as text
          try {
            const content = readFileSync(inputCopy, 'utf-8')
            // Check if content has too many non-printable characters (likely binary)
            const nonPrintable = content.split('').filter(c => c.charCodeAt(0) < 32 && c !== '\n' && c !== '\r' && c !== '\t').length
            if (nonPrintable / content.length < 0.1) {
              textFileContents.push(`\n--- ${fileName} ---\n${content}`)
              console.log(`[Scheduler] Embedded unknown file as text: ${fileName}`)
            } else {
              binaryFiles.push(inputCopy)
              addDirs.add(dirname(inputCopy))
              console.log(`[Scheduler] Unknown file appears binary, using imagePaths: ${fileName}`)
            }
          } catch {
            binaryFiles.push(inputCopy)
            addDirs.add(dirname(inputCopy))
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
        promptWithTextFiles = `${promptWithTextFiles}\n\n[附件檔案: ${fileNames}]\n${binaryFiles.map(f => `檔案路徑: ${f}`).join('\n')}\n請讀取並分析檔案內容。`
      }
    }

    if (options.sourceContent) promptWithTextFiles += `\n\n[Website content: ${options.sourceUrl}]\n${options.sourceContent}`

    // Inject email report marker instruction if email is configured
    if (task.output_type === 'both' && task.email_to) {
      promptWithTextFiles += '\n\n請將最終報告內容用 <!-- REPORT_START --> 和 <!-- REPORT_END --> 標記包裹。標記之外的思考過程、執行步驟等不會出現在 email 中，只有標記內的內容會被寄送。請確保報告內容完整且格式良好。'
    }

    // Inject knowledge extraction instruction if knowledge_file is configured
    if (task.knowledge_file) {
      promptWithTextFiles += '\n\n在報告最後，請用 <!-- KNOWLEDGE_START --> 和 <!-- KNOWLEDGE_END --> 標記包裹本次分析中值得長期記錄的經驗、查詢技巧、資料陷阱或注意事項。只記錄可複用的知識，不要重複報告內容本身。如果沒有新的經驗值得記錄，就不需要加這個標記。'
    }

    const automation = parseAutomationConfig(task.automation)
    const reviewMode = options.replay?.require_review ?? automation.require_review
    const readOnlyMode = reviewMode || Boolean(options.replay?.source_path || options.replay?.source_url) || automation.source.type !== 'schedule'
    const providerId = options.provider ?? options.replay?.provider ?? task.cli_tool
    if (readOnlyMode && providerId === 'antigravity') throw new Error('File and website automations require Claude or Codex')
    if (options.replay) {
      promptWithTextFiles = options.replay.prompt
      for (const [index, oldPath] of options.replay.attachment_paths.entries()) {
        const newPath = snapshotPaths[index]
        if (newPath) promptWithTextFiles = promptWithTextFiles.replaceAll(oldPath, newPath)
      }
    }
    const resultType = options.replay?.result_type ?? automation.result.type
    if (resultType === 'organize-file' && !options.replay) {
      promptWithTextFiles += '\n\n請在最終回答包含 JSON 物件 {"filename":"建議檔名"}，檔名應包含原始副檔名。請只提出建議，勿移動或更名檔案。'
    }
    if (readOnlyMode && !options.replay) promptWithTextFiles += '\n\n只分析與提出變更建議；不要執行任何寫入、寄信或外部 API 修改。'

    const sourcePath = options.replay?.source_path ?? sourceFile ?? null
    const sourceStat = sourcePath && existsSync(sourcePath) ? statSync(sourcePath) : null
    const systemInstruction = options.replay?.system_instruction ?? buildUnattendedInstruction(getMainLocale())
    const model = options.provider && options.provider !== (options.replay?.provider ?? task.cli_tool)
      ? null : (options.replay?.model ?? task.model)
    const snapshot: RunSnapshot = {
      log_id: log.id, prompt: promptWithTextFiles, system_instruction: systemInstruction,
      provider: providerId, fallback_provider: options.replay?.fallback_provider ?? automation.fallback_provider,
      model, attachment_paths: snapshotPaths, add_dirs: Array.from(addDirs),
      project_path: options.replay?.project_path ?? task.project_path,
      skip_permissions: readOnlyMode ? false : (options.replay?.skip_permissions ?? task.skip_permissions === 1),
      mcp_tools: readOnlyMode ? [] : (options.replay?.mcp_tools ?? mcpTools ?? []),
      source_path: sourcePath,
      source_size: options.replay?.source_size ?? sourceStat?.size ?? null,
      source_modified_at_ms: options.replay?.source_modified_at_ms ?? sourceStat?.mtimeMs ?? null,
      source_url: options.replay?.source_url ?? options.sourceUrl ?? null,
      result_type: resultType,
      require_review: reviewMode,
      destination: options.replay?.destination ?? (automation.result.type === 'organize-file' ? automation.result.destination : null),
      email_to: options.replay?.email_to ?? (task.output_type === 'both' ? task.email_to : null),
      replay_of: options.replay?.log_id ?? null,
      proposed_file_name: null, review_status: 'none', created_at: new Date().toISOString()
    }
    saveRunSnapshot(snapshot)

    console.log(`[Scheduler] Calling ${providerId} CLI with prompt length: ${promptWithTextFiles.length}, model: ${model || 'default'}, binary attachments: ${binaryFiles.length}`)

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
        systemInstruction,
        model,
        mcpTools: snapshot.mcp_tools,
        imagePaths: providerId === 'codex' ? binaryFiles.filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f)) : [],
        addDirs: Array.from(addDirs),
        projectPath: snapshot.project_path,
        skipPermissions: snapshot.skip_permissions,
        reviewMode: readOnlyMode
      }
      result = await runProvider(getProvider(providerId), ctx, { executionId: log.id, onOutput })

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

    console.log(`[Scheduler] ${providerId} CLI result: success=${result!.success}, output length=${result!.output?.length || 0}`)

    // Extract and save knowledge, then clean output
    let cleanOutput = result!.output
    if (result!.success && !reviewMode && task.knowledge_file && result!.output) {
      cleanOutput = extractAndSaveKnowledge(task, result!.output)
    }

    // A user-cancelled run is recorded as 'cancelled' (not 'failed') so the UI
    // can show it distinctly. executeTask is the only writer of the final status,
    // which avoids racing with the cancel handler.
    const cancelled = wasCancelled(log.id)
    if (cancelled) clearCancelled(log.id)

    // Update execution log
    const needsReview = !cancelled && result!.success && reviewMode &&
      (resultType === 'organize-file' || Boolean(snapshot.email_to))
    if (needsReview) updateRunReview(log.id, 'pending',
      resultType === 'organize-file' && sourcePath ? proposedFileName(cleanOutput, sourcePath) : null)
    const updatedLog = updateExecutionLog(log.id, {
      status: cancelled ? 'cancelled' : needsReview ? 'pending_review' : result!.success ? 'success' : 'failed',
      output: cleanOutput,
      error: cancelled ? undefined : result!.error,
      exitCode: cancelled ? null : result!.exitCode
    })

    notifyExecutionUpdate(updatedLog)
    if (!cancelled) {
      showCompletionNotification(task.name, needsReview ? 'pending_review' : result!.success ? 'success' : 'failed')
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
    showCompletionNotification(task.name, 'failed')
    return updatedLog
  }
}

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
