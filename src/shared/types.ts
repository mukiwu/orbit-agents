// Task Types
export type ModelType = string

export interface ModelOption {
  value: string
  label: string
  desc: string
  deprecated?: boolean
}

export interface Task {
  id: string
  name: string
  description: string | null
  cron_expression: string
  prompt: string
  cli_tool: 'claude' | 'gemini' | 'codex'
  model: ModelType | null // AI model to use
  mcp_tools: string | null // JSON array of tool patterns
  attachments: string | null // JSON array of file paths
  output_type: 'log' | 'both'
  email_to: string | null
  knowledge_file: string | null
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
  cli_tool?: 'claude' | 'gemini' | 'codex'
  model?: ModelType
  mcp_tools?: string[]
  attachments?: string[] // Array of file paths
  output_type?: 'log' | 'both'
  email_to?: string
  knowledge_file?: string
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
  codex_default_model?: string
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

export interface CodexCliResult {
  success: boolean
  output: string
  error?: string
}

export interface McpServer {
  name: string
  tools: string[]
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

  // Codex CLI operations
  'codex:test': () => Promise<CodexCliResult>
  'codex:list-mcps': () => Promise<McpServer[]>
  'codex:list-models': () => Promise<ModelOption[]>

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
