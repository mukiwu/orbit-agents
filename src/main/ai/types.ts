import type { McpServer } from '../../shared/types'

export type ProviderId = 'claude' | 'codex' | 'antigravity'

export interface ExecutionContext {
  prompt: string                 // 已嵌入文字附件、email / knowledge 指示後的最終 prompt
  systemInstruction: string      // 無人值守指示（claude 走 --append-system-prompt,其餘 prefix 進 prompt）
  model: string | null           // 跨 provider 儲存（含 antigravity 動態字串）
  mcpTools: string[]
  imagePaths: string[]           // 二進位 / 圖片附件路徑
  addDirs: string[]              // 要授權讀取的目錄（附件所在目錄 + project）
  projectPath: string | null
  skipPermissions: boolean
}

export interface ModelOption {
  value: string   // claude/codex 由 ClaudeModel/CodexModel 字面值帶入;antigravity 為 agy models 動態字串
  label: string
  desc?: string
}

export interface ProviderTestResult {
  success: boolean
  output: string
  error?: string
}

export interface ProviderResult {
  success: boolean
  output: string
  error?: string
}

export type OutputCallback = (partialOutput: string) => void

export interface AiProvider {
  id: ProviderId
  displayName: string
  capabilities: {
    mcp: boolean
    attachments: 'native-read' | 'image-flag'
    streaming: 'json' | 'text'
  }
  resolveCommand(): string
  buildArgs(ctx: ExecutionContext): string[]
  buildEnv(): NodeJS.ProcessEnv
  promptDelivery: 'arg' | 'stdin'
  needsPty: boolean
  parseOutput(raw: string): string
  test(): Promise<ProviderTestResult>
  listModels(): Promise<ModelOption[]>
  listMcps(): Promise<McpServer[]>
}
