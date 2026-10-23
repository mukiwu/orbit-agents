import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, copyFileSync, statSync } from 'fs'
import { basename, extname, dirname, join } from 'path'
import { extractDocumentText } from './document-text'
import { parseAutomationConfig } from './automation-config'
import { proposedFileName } from './result-actions'
import { buildUnattendedInstruction } from './ai/unattended'
import type { ExecutionContext, ProviderResult } from './ai/types'
import type { RunProviderOptions } from './ai/runner'
import { t, getMainLocale } from './i18n'
import type { Task, ExecutionLog, RunSnapshot, ProviderId } from '../shared/types'

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

export const KNOWLEDGE_REGEX = /<!-- KNOWLEDGE_START -->([\s\S]*?)<!-- KNOWLEDGE_END -->/g

export function extractAndSaveKnowledge(task: Task, output: string): string {
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

export type CompletionStatus = 'success' | 'failed' | 'pending_review'

// Storage operations the run needs; database.ts backs them in production, tests pass an in-memory store
export interface RunStore {
  createExecutionLog(taskId: string): ExecutionLog
  updateExecutionLog(id: string, update: { status: 'success' | 'failed' | 'cancelled' | 'pending_review'; output?: string; error?: string; exitCode?: number | null }): ExecutionLog
  updateExecutionLogOutput(id: string, output: string): ExecutionLog
  saveRunSnapshot(snapshot: RunSnapshot): void
  updateRunReview(logId: string, status: RunSnapshot['review_status'], proposedFileName?: string | null): void
}

export interface RunPipelineDeps {
  store: RunStore
  runProvider(providerId: ProviderId, ctx: ExecutionContext, options: RunProviderOptions): Promise<ProviderResult>
  onUpdate(log: ExecutionLog): void
  onFinished(taskName: string, status: CompletionStatus): void
  sendEmail(task: Task, log: ExecutionLog): Promise<void>
  userDataPath: string
  sleep(ms: number): Promise<void>
  beginBackoff(executionId: string): void
  endBackoff(executionId: string): void
  wasCancelled(executionId: string): boolean
  clearCancelled(executionId: string): void
}

export interface RunOptions {
  sourceFile?: string
  sourceUrl?: string
  sourceContent?: string
  replay?: RunSnapshot
  provider?: ProviderId
}

export function createRunPipeline(deps: RunPipelineDeps): (task: Task, options?: RunOptions) => Promise<ExecutionLog> {
  const { store } = deps

  return async function executeTask(task: Task, options: RunOptions = {}): Promise<ExecutionLog> {
    console.log(`[Scheduler] Executing task: ${task.name} (${task.id})`)

    // Create execution log
    const log = store.createExecutionLog(task.id)
    deps.onUpdate(log)

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
      // Original attachment path -> its copy for this run; missing attachments have no entry
      const copiedPaths = new Map<string, string>()
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
          const inputCopy = join(deps.userDataPath, 'run-inputs', log.id, String(index), fileName)
          mkdirSync(dirname(inputCopy), { recursive: true })
          copyFileSync(filePath, inputCopy)
          snapshotPaths.push(inputCopy)
          copiedPaths.set(filePath, inputCopy)

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
        // Longest paths first, so a path that prefixes another is not replaced inside it
        const oldPaths = [...options.replay.attachment_paths].sort((a, b) => b.length - a.length)
        for (const oldPath of oldPaths) {
          const newPath = copiedPaths.get(oldPath)
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
      store.saveRunSnapshot(snapshot)

      console.log(`[Scheduler] Calling ${providerId} CLI with prompt length: ${promptWithTextFiles.length}, model: ${model || 'default'}, binary attachments: ${binaryFiles.length}`)

      // Throttle output updates to avoid too many DB writes
      let lastUpdateTime = 0
      const UPDATE_INTERVAL = 2000 // Update every 2 seconds max

      const onOutput = (partialOutput: string) => {
        const now = Date.now()
        if (now - lastUpdateTime > UPDATE_INTERVAL) {
          lastUpdateTime = now
          // Update the log with partial output
          const updatedLog = store.updateExecutionLogOutput(log.id, partialOutput)
          deps.onUpdate(updatedLog)
        }
      }

      let result: ProviderResult
      let lastError = ''

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delay = RETRY_DELAYS[attempt - 1]
          console.log(`[Scheduler] Retry ${attempt}/${MAX_RETRIES} for task ${task.name} after ${delay / 1000}s delay (error: ${lastError})`)

          // Update log to show retry status
          const retryLog = store.updateExecutionLogOutput(log.id, t('main.retry.networkError', { delay: delay / 1000, attempt, max: MAX_RETRIES, error: lastError }))
          deps.onUpdate(retryLog)

          deps.beginBackoff(log.id)
          try {
            await deps.sleep(delay)
          } finally {
            deps.endBackoff(log.id)
          }
          if (deps.wasCancelled(log.id)) break
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
        result = await deps.runProvider(providerId, ctx, { executionId: log.id, onOutput })

        // User cancelled this execution — stop immediately, do not retry
        if (deps.wasCancelled(log.id)) {
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
      const cancelled = deps.wasCancelled(log.id)

      // Update execution log
      const needsReview = !cancelled && result!.success && reviewMode &&
        (resultType === 'organize-file' || Boolean(snapshot.email_to))
      if (needsReview) store.updateRunReview(log.id, 'pending',
        resultType === 'organize-file' && sourcePath ? proposedFileName(cleanOutput, sourcePath) : null)
      const updatedLog = store.updateExecutionLog(log.id, {
        status: cancelled ? 'cancelled' : needsReview ? 'pending_review' : result!.success ? 'success' : 'failed',
        output: cleanOutput,
        error: cancelled ? undefined : result!.error,
        exitCode: cancelled ? null : result!.exitCode
      })

      deps.onUpdate(updatedLog)
      if (!cancelled) {
        deps.onFinished(task.name, needsReview ? 'pending_review' : result!.success ? 'success' : 'failed')
      }

      // Send email if configured (only on success — failures stay in logs)
      if (task.output_type === 'both' && task.email_to && updatedLog.status === 'success') {
        try {
          await deps.sendEmail(task, updatedLog)
        } catch (emailError) {
          console.error('Failed to send email:', emailError)
        }
      }

      return updatedLog
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const updatedLog = store.updateExecutionLog(log.id, {
        status: 'failed',
        error: errorMessage
      })

      deps.onUpdate(updatedLog)
      deps.onFinished(task.name, 'failed')
      return updatedLog
    } finally {
      deps.clearCancelled(log.id)
    }
  }
}
