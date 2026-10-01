// Provider models can change independently from the app's release cycle.
export type ModelType = string

export interface Task {
  id: string
  name: string
  description: string | null
  cron_expression: string
  prompt: string
  cli_tool: 'claude' | 'codex' | 'antigravity'
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
  needs_review: number // 0 or 1, set when migrated from a removed provider (e.g. Gemini)
  created_at: string
  updated_at: string
}

export interface CreateTaskInput {
  name: string
  description?: string
  cron_expression: string
  prompt: string
  cli_tool?: 'claude' | 'codex' | 'antigravity'
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
  status: 'running' | 'success' | 'failed' | 'cancelled'
  output: string | null
  error: string | null
}

export interface ExecutionLogWithTask extends ExecutionLog {
  task_name?: string
}

export interface DashboardRun {
  id: string
  task_id: string
  task_name: string | null
  started_at: string
  finished_at: string | null
  status: ExecutionLog['status']
  error: string | null
}

export interface DashboardData {
  tasks: Array<{
    id: string
    name: string
    cli_tool: Task['cli_tool']
    enabled: number
    needs_review: number
    cron_expression: string
    week_interval: number
    next_run: string | null
  }>
  executions24h: { total: number; success: number; failed: number; running: number; cancelled: number }
  activity24h: Array<{ hour: string; success: number; failed: number; running: number; cancelled: number }>
  recent_runs: DashboardRun[]
  recent_failures: DashboardRun[]
  top_tasks: Array<{ task_id: string; task_name: string | null; total: number; failed: number }>
}

// Settings Types
export interface Settings {
  email_smtp_host?: string
  email_smtp_port?: string
  email_smtp_user?: string
  email_smtp_pass?: string
  email_from?: string
  claude_cli_path?: string
  codex_cli_path?: string
  antigravity_cli_path?: string
  auto_launch?: string
  auto_update?: string
  language?: 'system' | 'en' | 'zh-TW'
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

export interface McpServer {
  name: string
  tools: string[]
}

// Skill Types
export interface Skill {
  name: string
  description: string
  filePath: string
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

export type CodexAuthMethod = 'chatgpt' | 'api-key' | 'other' | 'signed-out' | 'unknown'

export interface CodexAuthStatus {
  authenticated: boolean
  method: CodexAuthMethod
}

export interface ModelOption {
  value: string
  label: string
  desc?: string
  isDefault?: boolean
  stale?: boolean
}

// IPC API Types
export interface IpcApi {
  'dashboard:get': () => Promise<DashboardData>
  // Task operations
  'task:list': () => Promise<Task[]>
  'task:get': (id: string) => Promise<Task | null>
  'task:create': (input: CreateTaskInput) => Promise<Task>
  'task:update': (input: UpdateTaskInput) => Promise<Task>
  'task:delete': (id: string) => Promise<void>
  'task:toggle': (id: string) => Promise<Task>
  'task:run-now': (id: string) => Promise<ExecutionLog>

  // Log operations
  'log:list': (taskId?: string, limit?: number) => Promise<ExecutionLogWithTask[]>
  'log:get': (id: string) => Promise<ExecutionLogWithTask | null>
  'log:delete': (ids: string[]) => Promise<void>
  'log:cancel': (id: string) => Promise<boolean>

  // Open a link from log output externally (browser / default app), safely
  'link:open': (url: string) => Promise<void>

  // Settings operations
  'settings:get': () => Promise<Settings>
  'settings:update': (settings: Partial<Settings>) => Promise<void>

  // Generalized AI provider operations
  'ai:test': (provider: ProviderId) => Promise<ProviderTestResult>
  'ai:list-mcps': (provider: ProviderId) => Promise<McpServer[]>
  'ai:list-models': (provider: ProviderId) => Promise<ModelOption[]>

  // Codex CLI account operations; credentials remain managed by Codex CLI.
  'codex:auth-status': () => Promise<CodexAuthStatus>
  'codex:login': () => Promise<void>
  'codex:logout': () => Promise<void>

  // Skill operations
  'skill:scan': (projectPath?: string, provider?: ProviderId) => Promise<SkillScanResult>
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
