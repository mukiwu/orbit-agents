// Task Types
export type ClaudeModel = 'haiku' | 'sonnet' | 'opus'
export type CodexModel = 'gpt-5.3-codex' | 'gpt-5.3-codex-spark'
export type GeminiModel = 'gemini-3' | 'gemini-2.5' | 'gemini-2' // 待 Task 13 移除
// 嚴格 union 用於 claude/codex 的選項與預設值（編譯期安全,呼應使用者偏好）
// Antigravity 模型由 agy models 動態提供,在執行期驗證,以 string 儲存
export type ModelType = ClaudeModel | CodexModel | GeminiModel

export interface Task {
  id: string
  name: string
  description: string | null
  cron_expression: string
  prompt: string
  cli_tool: 'claude' | 'gemini' | 'codex' | 'antigravity'
  model: string | null // AI model to use (cross-provider, including antigravity dynamic strings)
  mcp_tools: string | null // JSON array of tool patterns
  attachments: string | null // JSON array of file paths
  output_type: 'log' | 'both'
  email_to: string | null
  knowledge_file: string | null
  project_path: string | null
  skip_permissions: number // 0 or 1, whether to use --dangerously-skip-permissions
  week_interval: number // Default 1
  enabled: number // 0 or 1
  created_at: string
  updated_at: string
}

export interface CreateTaskInput {
  name: string
  description?: string
  cron_expression: string
  prompt: string
  cli_tool?: 'claude' | 'gemini' | 'codex' | 'antigravity'
  model?: string
  mcp_tools?: string[]
  attachments?: string[] // Array of file paths
  output_type?: 'log' | 'both'
  email_to?: string
  knowledge_file?: string
  project_path?: string | null
  skip_permissions?: boolean
  week_interval?: number
  enabled?: boolean
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {
  id: string
}

// Execution Log Types
export interface ExecutionLog {
  id: string
  task_id: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'success' | 'failed'
  output: string | null
  error: string | null
}

export interface ExecutionLogWithTask extends ExecutionLog {
  task_name?: string
}

// Settings Types
export interface Settings {
  email_smtp_host?: string
  email_smtp_port?: string
  email_smtp_user?: string
  email_smtp_pass?: string
  email_from?: string
  claude_cli_path?: string
  claude_session_token?: string
  gemini_cli_path?: string
  gemini_api_key?: string
  codex_cli_path?: string
  antigravity_cli_path?: string
  auto_launch?: string
  auto_update?: string
}

export type SettingKey = keyof Settings

// Auto-updater Types
export interface UpdateStatus {
  checking: boolean
  available: boolean
  downloaded: boolean
  downloading: boolean
  progress: number
  version: string | null
  error: string | null
  releaseUrl?: string
  platform?: 'darwin' | 'win32' | 'linux'
  updateMethod?: 'asar' | 'full' | null
}

// Claude CLI Types
export interface ClaudeCliResult {
  success: boolean
  output: string
  error?: string
}

export interface GeminiCliResult {
  success: boolean
  output: string
  error?: string
}

export interface McpServer {
  name: string
  tools: string[]
}

// Skill Types
export interface Skill {
  name: string
  description: string
  invocation?: string
  filePath: string
  content: string
  scope: 'user' | 'project'
}

export interface SkillScanResult {
  skills: Skill[]
  projectPath?: string
  errors?: string[]
}

// AI Provider Types (mirrored from src/main/ai/types.ts to avoid main-process imports)
export type ProviderId = 'claude' | 'codex' | 'antigravity'

export interface ProviderTestResult {
  success: boolean
  output: string
  error?: string
}

export interface ModelOption {
  value: string
  label: string
  desc?: string
}

// IPC API Types
export interface IpcApi {
  // Task operations
  'task:list': () => Promise<Task[]>
  'task:get': (id: string) => Promise<Task | null>
  'task:create': (input: CreateTaskInput) => Promise<Task>
  'task:update': (input: UpdateTaskInput) => Promise<Task>
  'task:delete': (id: string) => Promise<void>
  'task:toggle': (id: string) => Promise<Task>
  'task:run-now': (id: string) => Promise<ExecutionLog>
  'task:process-input': (executionId: string, input: string) => Promise<boolean>

  // Log operations
  'log:list': (taskId?: string, limit?: number) => Promise<ExecutionLogWithTask[]>
  'log:get': (id: string) => Promise<ExecutionLog | null>
  'log:delete': (ids: string[]) => Promise<void>

  // Settings operations
  'settings:get': () => Promise<Settings>
  'settings:update': (settings: Partial<Settings>) => Promise<void>

  // Claude CLI operations
  'claude:test': () => Promise<ClaudeCliResult>
  'claude:list-mcps': () => Promise<McpServer[]>

  // Gemini CLI operations
  'gemini:test': () => Promise<GeminiCliResult>
  'gemini:list-mcps': () => Promise<McpServer[]>

  // Generalized AI provider operations
  'ai:test': (provider: ProviderId) => Promise<ProviderTestResult>
  'ai:list-mcps': (provider: ProviderId) => Promise<McpServer[]>
  'ai:list-models': (provider: ProviderId) => Promise<ModelOption[]>

  // Skill operations
  'skill:scan': (projectPath?: string) => Promise<SkillScanResult>
  'dialog:open-directory': () => Promise<string | null>

  // Auto-updater operations
  'updater:check': () => Promise<UpdateStatus>
  'updater:download': () => Promise<boolean>
  'updater:install': () => Promise<void>
  'updater:status': () => Promise<UpdateStatus>
}

// For preload
export interface ElectronApi {
  invoke: <K extends keyof IpcApi>(
    channel: K,
    ...args: Parameters<IpcApi[K]>
  ) => ReturnType<IpcApi[K]>
  on: (channel: string, callback: (...args: unknown[]) => void) => void
  off: (channel: string, callback: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    electronApi: ElectronApi
  }
}
