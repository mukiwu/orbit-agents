# CLI 供應商大改 Implementation Plan (Stream A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把執行層從「Claude + Gemini 兩支各寫一份」改成「共用 runner + 各 provider adapter」,移除 Gemini,加入 Codex 與 Antigravity,簡化 Claude 認證,並讓所有執行全程非互動

**Architecture:** 新增 `src/main/ai/` 模組:一個共用 `runner` 負責 spawn、安全檢查、idle timeout、串流、行程註冊;三個薄 adapter（claude / codex / antigravity）各自負責 buildArgs 與 parseOutput;一個 registry 對外提供 `getProvider(id)`。scheduler 透過 registry 派工。採「先 additive 加新 provider、最後一個 task 才移除 Gemini」的順序,讓每個 task 結束時都能 build 過。

**Tech Stack:** Electron 33、TypeScript、better-sqlite3、React、electron-vite、vitest（本計畫新增,只測純函式邏輯）

對應 spec:`docs/superpowers/specs/2026-06-25-cli-provider-overhaul-design.md`

## Global Constraints

- 三家 CLI 一律靠本機已登入的 CLI 認證,Orbit Agents 不儲存任何金鑰或 token
- 所有執行全程非互動,runner 不得有任何等待使用者輸入的路徑
- `ModelType` 維持有限 union,禁止改成純 `string`（呼應使用者對 PR #1 的 review）
- DB migration 沿用既有「冪等 ALTER TABLE / UPDATE in try-catch」慣例,不另建 schema_version runner
- 既有 Gemini 任務採「轉成 Claude + 停用 + 標記需重設」,不得靜默改行為或刪除
- 純函式邏輯（buildArgs、parseOutput、非互動指示、migration 對應）用 TDD;Electron / React UI 用 build + 實跑驗證
- commit 訊息用 conventional commits;不加 Co-Authored-By（使用者全域已關 attribution）
- 文件內文不用破折號、不用引號標詞、句尾不加句號（程式碼區塊不受限）

## File Structure

新增:
- `src/main/ai/types.ts` provider 介面與共用型別
- `src/main/ai/runner.ts` 共用執行器
- `src/main/ai/unattended.ts` 無人值守系統指示產生器（純函式）
- `src/main/ai/providers/claude.ts`
- `src/main/ai/providers/codex.ts`
- `src/main/ai/providers/antigravity.ts`
- `src/main/ai/index.ts` registry
- `vitest.config.ts`
- 對應 `*.test.ts`（與被測檔同目錄）

修改:
- `src/shared/types.ts` 型別
- `src/main/scheduler.ts` 改用 registry 派工、附件處理
- `src/main/index.ts` IPC handlers
- `src/preload/index.ts` channel 白名單
- `src/main/database.ts` migration、needs_review 欄位
- `src/renderer/src/hooks/useApi.ts`
- `src/renderer/src/components/TaskForm.tsx`
- `src/renderer/src/components/Settings.tsx`
- `src/renderer/src/components/ExecutionLog.tsx`
- `src/main/process-manager.ts`

刪除（最後階段）:
- `src/main/gemini-cli.ts`
- `src/main/claude-cli.ts`（功能移進 adapter）

---

## Task 1: 驗證 spike（解除三個未知數）

非 TDD,這是投石問路。動 adapter 前先把外部 CLI 的真實行為釘死,結果寫進 spec 末尾的 Notes 並 commit。

**Files:**
- Modify: `docs/superpowers/specs/2026-06-25-cli-provider-overhaul-design.md`（末尾新增 `## 實作 Notes`）

- [ ] **Step 1: 確認 codex exec --json 的事件結構**

Run:
```bash
cd /tmp && codex exec --json --skip-git-repo-check "Reply with exactly: PONG" 2>&1 | head -40
```
記錄 JSONL 每行的 `type` 與帶有助理文字的欄位路徑（例如 `item.completed` / `agent_message` / `text` 等實際名稱）。這決定 Task 6 codex parseOutput 的解析欄位。

- [ ] **Step 2: 確認 agy 非 TTY 行為與認證**

Run:
```bash
agy doctor 2>&1 | head -30
cd /tmp && agy -p --dangerously-skip-permissions "Reply with exactly: PONG" 2>&1 | head -40
```
記錄:直接 spawn（非 TTY）下是否正常吐出回應;若空白或卡住,代表 Task 7 需要 pty 包裝。記錄認證是否已就緒（doctor 結果）以及是否需要環境變數。

- [ ] **Step 3: 確認 codex 與 antigravity 可用模型**

Run:
```bash
agy models 2>&1 | head -40
codex --help 2>&1 | grep -iE "model" | head
```
記錄 antigravity 模型清單;codex 模型以使用者既有知識為準（gpt-5.3-codex、gpt-5.3-codex-spark,gpt-5.1-codex 已於 2026-03-11 退役）,在 Notes 寫下本次採用清單。

- [ ] **Step 4: 把結果寫進 spec Notes 並 commit**

在 spec 末尾新增 `## 實作 Notes`,逐項記錄上面三點的實際輸出摘要。

```bash
git add docs/superpowers/specs/2026-06-25-cli-provider-overhaul-design.md
git commit -m "docs: record CLI verification spike results for provider overhaul"
```

---

## Task 2: 建立 vitest 測試環境

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/main/ai/sanity.test.ts`（驗證 harness 可跑,之後可留作 smoke）

- [ ] **Step 1: 安裝 vitest**

Run:
```bash
npm install -D vitest
```

- [ ] **Step 2: 建立 vitest 設定**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true
  }
})
```

- [ ] **Step 3: 加 test script**

在 `package.json` 的 `scripts` 加:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: 寫 sanity 測試**

Create `src/main/ai/sanity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('vitest harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: 跑測試確認 harness 正常**

Run: `npm test`
Expected: PASS,1 test passed

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/main/ai/sanity.test.ts
git commit -m "test: add vitest harness for pure-logic unit tests"
```

---

## Task 3: 共用型別與 AI 模組介面（additive）

此步只「加」不「減」:cli_tool 與 ModelType 先加上 codex / antigravity,保留 gemini,讓既有程式仍可編譯。

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/ai/types.ts`

**Interfaces:**
- Produces:
  - `ProviderId = 'claude' | 'codex' | 'antigravity'`
  - `ExecutionContext`、`AiProvider`、`ModelOption`、`ProviderTestResult`、`ProviderResult`

- [ ] **Step 1: 更新 shared 型別（additive）**

在 `src/shared/types.ts`:

把 `ModelType` 改成（claude/codex 維持嚴格 union;antigravity 模型是動態清單,走 runtime 字串,不進 union；gemini 暫留,Task 13 移除）:
```ts
export type ClaudeModel = 'haiku' | 'sonnet' | 'opus'
export type CodexModel = 'gpt-5.3-codex' | 'gpt-5.3-codex-spark'
export type GeminiModel = 'gemini-3' | 'gemini-2.5' | 'gemini-2' // 待 Task 13 移除
// 嚴格 union 用於 claude/codex 的選項與預設值（編譯期安全,呼應使用者偏好）
// Antigravity 模型由 agy models 動態提供,在執行期驗證,以 string 儲存
export type ModelType = ClaudeModel | CodexModel | GeminiModel
```

把 `Task.model` 與 `CreateTaskInput.model` 的型別改成 `string | null` / `string`（跨 provider 儲存,含 antigravity 的動態字串;claude/codex 的編譯期安全保留在 `ClaudeModel`/`CodexModel` 這兩個 union 被用來建選項與預設值之處）。

把 `cli_tool` 兩處（`Task`、`CreateTaskInput`）改成:
```ts
cli_tool: 'claude' | 'gemini' | 'codex' | 'antigravity'
```
（CreateTaskInput 內為 `cli_tool?: 'claude' | 'gemini' | 'codex' | 'antigravity'`）

在 `Settings` interface 加（先不刪 gemini 欄位）:
```ts
codex_cli_path?: string
antigravity_cli_path?: string
```

- [ ] **Step 2: 建立 AI 模組型別**

Create `src/main/ai/types.ts`:
```ts
import type { McpServer, ModelType } from '../../shared/types'

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
```

- [ ] **Step 3: 驗證型別編譯**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: PASS（gemini 仍在,既有程式不受影響;新檔只是型別宣告）

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/main/ai/types.ts
git commit -m "feat(ai): add provider abstraction types (additive)"
```

---

## Task 4: 無人值守系統指示產生器（TDD,純函式）

**Files:**
- Create: `src/main/ai/unattended.ts`
- Test: `src/main/ai/unattended.test.ts`

**Interfaces:**
- Produces: `buildUnattendedInstruction(): string`、`prefixUnattended(prompt: string): string`

- [ ] **Step 1: 寫失敗測試**

Create `src/main/ai/unattended.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildUnattendedInstruction, prefixUnattended } from './unattended'

describe('unattended instruction', () => {
  it('tells the agent it runs unattended and must not ask questions', () => {
    const text = buildUnattendedInstruction()
    expect(text.toLowerCase()).toContain('unattended')
    expect(text.toLowerCase()).toMatch(/do not ask|never ask/)
  })

  it('prefixes a prompt with the instruction followed by the original prompt', () => {
    const out = prefixUnattended('Summarize the news')
    expect(out.startsWith(buildUnattendedInstruction())).toBe(true)
    expect(out).toContain('Summarize the news')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- unattended`
Expected: FAIL（找不到模組 / 函式）

- [ ] **Step 3: 實作**

Create `src/main/ai/unattended.ts`:
```ts
const INSTRUCTION = [
  'You are running in an unattended, scheduled environment.',
  'No human is available to respond to you at any point during this run.',
  'Do not ask the user questions, do not request confirmation, and do not present',
  'options that require a choice. When something is ambiguous, make a reasonable',
  'assumption, state it briefly, and continue. Always complete the task autonomously',
  'and produce a final result.'
].join(' ')

export function buildUnattendedInstruction(): string {
  return INSTRUCTION
}

export function prefixUnattended(prompt: string): string {
  return `${INSTRUCTION}\n\n${prompt}`
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- unattended`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/unattended.ts src/main/ai/unattended.test.ts
git commit -m "feat(ai): add unattended system instruction builder"
```

---

## Task 5: Claude adapter（TDD buildArgs + parseOutput）

把現有 `claude-cli.ts` 的 `parseStreamJsonOutput` 移植進 adapter,並把 args 組裝抽成純函式。

**Files:**
- Create: `src/main/ai/providers/claude.ts`
- Test: `src/main/ai/providers/claude.test.ts`

**Interfaces:**
- Consumes: `AiProvider`, `ExecutionContext`（Task 3）
- Produces: `claudeProvider: AiProvider`,內部 `buildClaudeArgs(ctx)`、`parseClaudeOutput(raw)` 具名匯出供測試

- [ ] **Step 1: 寫失敗測試**

Create `src/main/ai/providers/claude.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildClaudeArgs, parseClaudeOutput } from './claude'
import type { ExecutionContext } from '../types'

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    prompt: 'do the thing',
    systemInstruction: 'UNATTENDED',
    model: 'sonnet',
    mcpTools: [],
    imagePaths: [],
    addDirs: [],
    projectPath: null,
    skipPermissions: true,
    ...over
  }
}

describe('buildClaudeArgs', () => {
  it('always runs non-interactive with stream-json', () => {
    const args = buildClaudeArgs(ctx())
    expect(args).toContain('--print')
    expect(args.join(' ')).toContain('--output-format stream-json')
  })

  it('injects the unattended instruction via append-system-prompt', () => {
    const args = buildClaudeArgs(ctx({ systemInstruction: 'BE-AUTONOMOUS' }))
    const i = args.indexOf('--append-system-prompt')
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe('BE-AUTONOMOUS')
  })

  it('adds skip-permissions only when enabled', () => {
    expect(buildClaudeArgs(ctx({ skipPermissions: true }))).toContain('--dangerously-skip-permissions')
    expect(buildClaudeArgs(ctx({ skipPermissions: false }))).not.toContain('--dangerously-skip-permissions')
  })

  it('passes model and add-dir', () => {
    const args = buildClaudeArgs(ctx({ model: 'opus', addDirs: ['/a', '/b'] }))
    const m = args.indexOf('--model')
    expect(args[m + 1]).toBe('opus')
    expect(args.filter(a => a === '--add-dir')).toHaveLength(2)
  })
})

describe('parseClaudeOutput', () => {
  it('extracts assistant text from stream-json lines', () => {
    const raw = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }),
      JSON.stringify({ type: 'result', result: 'hello' })
    ].join('\n')
    expect(parseClaudeOutput(raw)).toBe('hello')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- claude`
Expected: FAIL

- [ ] **Step 3: 實作 adapter**

Create `src/main/ai/providers/claude.ts`。把 `src/main/claude-cli.ts` 的 `parseStreamJsonOutput` 內容「移動」進來改名 `parseClaudeOutput`（邏輯不變）。為避免過渡期重複,改 `claude-cli.ts` 從 adapter 匯入沿用:在 `claude-cli.ts` 刪掉本地 `parseStreamJsonOutput` 定義,改 `import { parseClaudeOutput as parseStreamJsonOutput } from './ai/providers/claude'`（`claude-cli.ts` 於 Task 13 整個刪除）。adapter 實作:

```ts
import { spawn } from 'child_process'
import { getSetting } from '../../database'
import type { AiProvider, ExecutionContext, ModelOption, ProviderTestResult } from '../types'
import type { McpServer } from '../../../shared/types'

function getHomedir(): string {
  return process.env.HOME || process.env.USERPROFILE || ''
}

export function resolveClaudeCommand(): string {
  const custom = getSetting('claude_cli_path')
  if (custom) return custom
  if (process.platform === 'win32') return 'claude'
  return `${getHomedir()}/.local/bin/claude`
}

export function buildClaudeArgs(ctx: ExecutionContext): string[] {
  const args: string[] = ['--print', '--output-format', 'stream-json', '--verbose']
  if (ctx.skipPermissions) args.push('--dangerously-skip-permissions')
  if (ctx.systemInstruction) args.push('--append-system-prompt', ctx.systemInstruction)
  if (ctx.model) args.push('--model', ctx.model)
  if (ctx.mcpTools.length > 0) args.push('--allowedTools', ctx.mcpTools.join(','))
  for (const dir of ctx.addDirs) args.push('--add-dir', dir)
  // prompt 由 runner 依 promptDelivery 決定用 -p 還是 stdin
  return args
}

export function parseClaudeOutput(raw: string): string {
  // 從 src/main/claude-cli.ts 的 parseStreamJsonOutput 整段移植（邏輯不變）
  // ...（複製既有實作）
}

export const claudeProvider: AiProvider = {
  id: 'claude',
  displayName: 'Claude',
  capabilities: { mcp: true, attachments: 'native-read', streaming: 'json' },
  resolveCommand: resolveClaudeCommand,
  buildArgs: buildClaudeArgs,
  buildEnv: () => {
    const env = { ...process.env }
    delete env.CLAUDECODE
    return env
  },
  promptDelivery: process.platform === 'win32' ? 'stdin' : 'arg',
  needsPty: false,
  parseOutput: parseClaudeOutput,
  test: () => testClaude(),
  listModels: async (): Promise<ModelOption[]> => [
    { value: 'haiku', label: 'Haiku', desc: 'Fast' },
    { value: 'sonnet', label: 'Sonnet', desc: 'Balanced' },
    { value: 'opus', label: 'Opus', desc: 'Powerful' }
  ],
  listMcps: () => listClaudeMcps()
}
```

`testClaude()` 與 `listClaudeMcps()` 直接移植 `claude-cli.ts` 的 `testClaudeConnection` 與 `listMcpServers`（spawn `--version` 與 `mcp list`,邏輯不變,改成本檔內部函式）。

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- claude`
Expected: PASS

- [ ] **Step 5: 編譯檢查並 commit**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: PASS
```bash
git add src/main/ai/providers/claude.ts src/main/ai/providers/claude.test.ts
git commit -m "feat(ai): add claude provider adapter"
```

---

## Task 6: Codex adapter（TDD buildArgs + parseOutput）

parseOutput 的解析欄位以 Task 1 spike 記錄的真實 JSONL 為準。

**Files:**
- Create: `src/main/ai/providers/codex.ts`
- Test: `src/main/ai/providers/codex.test.ts`

**Interfaces:**
- Produces: `codexProvider: AiProvider`、`buildCodexArgs(ctx)`、`parseCodexOutput(raw)`

- [ ] **Step 1: 寫失敗測試**

Create `src/main/ai/providers/codex.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildCodexArgs, parseCodexOutput } from './codex'
import type { ExecutionContext } from '../types'

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    prompt: 'do the thing', systemInstruction: 'UNATTENDED', model: 'gpt-5.3-codex',
    mcpTools: [], imagePaths: [], addDirs: [], projectPath: null, skipPermissions: false, ...over
  }
}

describe('buildCodexArgs', () => {
  it('uses exec subcommand with json streaming and skips git repo check', () => {
    const args = buildCodexArgs(ctx())
    expect(args[0]).toBe('exec')
    expect(args).toContain('--json')
    expect(args).toContain('--skip-git-repo-check')
  })

  it('maps skipPermissions=false to a sandbox and true to full bypass', () => {
    expect(buildCodexArgs(ctx({ skipPermissions: false })).join(' ')).toContain('--sandbox workspace-write')
    expect(buildCodexArgs(ctx({ skipPermissions: true }))).toContain('--dangerously-bypass-approvals-and-sandbox')
  })

  it('passes model, working dir and images', () => {
    const args = buildCodexArgs(ctx({ model: 'gpt-5.3-codex', projectPath: '/proj', imagePaths: ['/a.png', '/b.png'] }))
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-5.3-codex')
    expect(args[args.indexOf('-C') + 1]).toBe('/proj')
    expect(args.filter(a => a === '-i')).toHaveLength(2)
  })

  it('prefixes the unattended instruction into the prompt (no system-prompt flag)', () => {
    const args = buildCodexArgs(ctx({ prompt: 'P', systemInstruction: 'SI' }))
    const prompt = args[args.length - 1]
    expect(prompt.startsWith('SI')).toBe(true)
    expect(prompt).toContain('P')
  })
})

describe('parseCodexOutput', () => {
  it('extracts agent message text from JSONL events', () => {
    // 事件結構以 Task 1 spike 為準,以下為代表性樣本
    const raw = [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'answer' } })
    ].join('\n')
    expect(parseCodexOutput(raw)).toBe('answer')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- codex`
Expected: FAIL

- [ ] **Step 3: 實作**

Create `src/main/ai/providers/codex.ts`:
```ts
import { spawn } from 'child_process'
import { getSetting } from '../../database'
import type { AiProvider, ExecutionContext, ModelOption, ProviderTestResult } from '../types'
import type { McpServer } from '../../../shared/types'
import { prefixUnattended } from '../unattended'

export function resolveCodexCommand(): string {
  return getSetting('codex_cli_path') || 'codex'
}

export function buildCodexArgs(ctx: ExecutionContext): string[] {
  const args: string[] = ['exec', '--json', '--skip-git-repo-check']
  if (ctx.skipPermissions) {
    args.push('--dangerously-bypass-approvals-and-sandbox')
  } else {
    args.push('--sandbox', 'workspace-write')
  }
  if (ctx.model) args.push('-m', ctx.model)
  if (ctx.projectPath) args.push('-C', ctx.projectPath)
  for (const dir of ctx.addDirs) args.push('--add-dir', dir)
  for (const img of ctx.imagePaths) args.push('-i', img)
  // codex 沒有 system-prompt 旗標,把指示 prefix 進 prompt
  const fullPrompt = ctx.systemInstruction ? `${ctx.systemInstruction}\n\n${ctx.prompt}` : ctx.prompt
  args.push(fullPrompt)
  return args
}

export function parseCodexOutput(raw: string): string {
  // 依 Task 1 spike 的實際事件名稱解析。預設假設:逐行 JSON,
  // 取 type 為 item.completed 且 item.type 為 agent_message 的 item.text;
  // 找不到就退回非 JSON 行的純文字。
  const lines = raw.split('\n').filter(l => l.trim())
  const texts: string[] = []
  for (const line of lines) {
    try {
      const ev = JSON.parse(line)
      const item = ev.item ?? ev
      if (item && (item.type === 'agent_message' || item.type === 'assistant') && typeof item.text === 'string') {
        texts.push(item.text)
      } else if (typeof ev.message === 'string') {
        texts.push(ev.message)
      }
    } catch {
      if (line.trim() && !line.startsWith('{')) texts.push(line)
    }
  }
  return texts.join('\n\n').trim() || raw.trim()
}

export const codexProvider: AiProvider = {
  id: 'codex',
  displayName: 'Codex',
  capabilities: { mcp: true, attachments: 'image-flag', streaming: 'json' },
  resolveCommand: resolveCodexCommand,
  buildArgs: buildCodexArgs,
  buildEnv: () => ({ ...process.env }),
  promptDelivery: 'arg',
  needsPty: false,
  parseOutput: parseCodexOutput,
  test: () => testCodex(),
  listModels: async (): Promise<ModelOption[]> => [
    { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', desc: 'Default' },
    { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', desc: 'Fast' }
  ],
  listMcps: () => listCodexMcps()
}
```

`testCodex()`:spawn `codex --version`,回傳 ProviderTestResult。
`listCodexMcps()`:spawn `codex mcp list`（或 spike 確認的子命令）,解析 server 名稱,失敗回 `[]`。兩者參照 claude adapter 的同型作法。

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- codex`
Expected: PASS（若 spike 的事件名稱與樣本不同,同步調整測試樣本與 parseCodexOutput 後再綠）

- [ ] **Step 5: 編譯並 commit**

Run: `npx tsc --noEmit -p tsconfig.node.json`
```bash
git add src/main/ai/providers/codex.ts src/main/ai/providers/codex.test.ts
git commit -m "feat(ai): add codex provider adapter"
```

---

## Task 7: Antigravity adapter（TDD buildArgs）

**Files:**
- Create: `src/main/ai/providers/antigravity.ts`
- Test: `src/main/ai/providers/antigravity.test.ts`

**Interfaces:**
- Produces: `antigravityProvider: AiProvider`、`buildAntigravityArgs(ctx)`、`parseAntigravityOutput(raw)`

- [ ] **Step 1: 寫失敗測試**

Create `src/main/ai/providers/antigravity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildAntigravityArgs, parseAntigravityOutput } from './antigravity'
import type { ExecutionContext } from '../types'

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    prompt: 'do the thing', systemInstruction: 'UNATTENDED', model: 'gemini-3-pro',
    mcpTools: [], imagePaths: [], addDirs: [], projectPath: null, skipPermissions: true, ...over
  }
}

describe('buildAntigravityArgs', () => {
  it('runs non-interactive with --print', () => {
    expect(buildAntigravityArgs(ctx())).toContain('--print')
  })
  it('adds skip-permissions only when enabled', () => {
    expect(buildAntigravityArgs(ctx({ skipPermissions: true }))).toContain('--dangerously-skip-permissions')
    expect(buildAntigravityArgs(ctx({ skipPermissions: false }))).not.toContain('--dangerously-skip-permissions')
  })
  it('passes model and add-dir', () => {
    const args = buildAntigravityArgs(ctx({ model: 'gemini-3-pro', addDirs: ['/a'] }))
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-3-pro')
    expect(args).toContain('--add-dir')
  })
  it('prefixes unattended instruction into the prompt', () => {
    const args = buildAntigravityArgs(ctx({ prompt: 'P', systemInstruction: 'SI' }))
    expect(args[args.length - 1].startsWith('SI')).toBe(true)
  })
})

describe('parseAntigravityOutput', () => {
  it('passes plain text through trimmed', () => {
    expect(parseAntigravityOutput('  hello  ')).toBe('hello')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- antigravity`
Expected: FAIL

- [ ] **Step 3: 實作**

Create `src/main/ai/providers/antigravity.ts`。Task 1 spike 已確認 `agy -p` 直接 spawn（非 TTY）正常輸出,故 `needsPty = false`,不需 pty。注意:互動 TUI（例如 `agy doctor`）在非 TTY 會炸,test() 不可用 doctor。

```ts
import { spawn } from 'child_process'
import { getSetting } from '../../database'
import type { AiProvider, ExecutionContext, ModelOption, ProviderTestResult } from '../types'
import type { McpServer } from '../../../shared/types'

export function resolveAntigravityCommand(): string {
  return getSetting('antigravity_cli_path') || 'agy'
}

export function buildAntigravityArgs(ctx: ExecutionContext): string[] {
  const args: string[] = ['--print']
  if (ctx.skipPermissions) args.push('--dangerously-skip-permissions')
  if (ctx.model) args.push('--model', ctx.model)
  for (const dir of ctx.addDirs) args.push('--add-dir', dir)
  const fullPrompt = ctx.systemInstruction ? `${ctx.systemInstruction}\n\n${ctx.prompt}` : ctx.prompt
  args.push(fullPrompt)
  return args
}

export function parseAntigravityOutput(raw: string): string {
  return raw.trim()
}

export const antigravityProvider: AiProvider = {
  id: 'antigravity',
  displayName: 'Antigravity',
  capabilities: { mcp: false, attachments: 'native-read', streaming: 'text' },
  resolveCommand: resolveAntigravityCommand,
  buildArgs: buildAntigravityArgs,
  buildEnv: () => ({ ...process.env }),
  promptDelivery: 'arg',
  needsPty: false,
  parseOutput: parseAntigravityOutput,
  test: () => testAntigravity(),
  listModels: () => listAntigravityModels(),
  listMcps: async (): Promise<McpServer[]> => []
}
```

`testAntigravity()`:spawn `agy --version`（不可用 `agy doctor`,它是互動 TUI,非 TTY 會炸）。
`listAntigravityModels()`:spawn `agy models`,逐行解析成 ModelOption[]（value 與 label 皆用該行字串,因為 agy 沒有提供 slug;`--model` 接受的確切格式在本 task 用 `agy -p --model "<行字串>" "ping"` 實測確認後採用）。解析失敗回退到 spike 觀察到的靜態清單:`['Gemini 3.5 Flash (Medium)', 'Gemini 3.1 Pro (High)', 'Claude Sonnet 4.6 (Thinking)']` 之類,各包成 `{ value, label }`。

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- antigravity`
Expected: PASS

- [ ] **Step 5: 編譯並 commit**

Run: `npx tsc --noEmit -p tsconfig.node.json`
```bash
git add src/main/ai/providers/antigravity.ts src/main/ai/providers/antigravity.test.ts
git commit -m "feat(ai): add antigravity provider adapter"
```

---

## Task 8: 共用 runner 與 registry

整合 spawn / 安全檢查 / idle timeout / 串流 / 行程註冊。spawn 整合行為用 build + 實跑驗證,不強制單元測。

**Files:**
- Create: `src/main/ai/runner.ts`
- Create: `src/main/ai/index.ts`

**Interfaces:**
- Consumes: 三個 provider、`checkDangerousOperations`、`registerProcess`
- Produces:
  - `runProvider(provider: AiProvider, ctx: ExecutionContext, opts: { executionId?: string; onOutput?: OutputCallback }): Promise<ProviderResult>`
  - `getProvider(id: ProviderId): AiProvider`、`listProviders(): AiProvider[]`

- [ ] **Step 1: 實作 runner**

Create `src/main/ai/runner.ts`。把 `claude-cli.ts` 的 spawn 主迴圈邏輯一般化:
- 用 `provider.resolveCommand()`、`provider.buildArgs(ctx)`、`provider.buildEnv()`
- cwd:`ctx.projectPath` 存在才用,否則 home
- `promptDelivery === 'stdin'` 時 stdio 第一個為 `pipe`,spawn 後寫入 prompt 並 end;否則（`'arg'`）stdin 設為 `'ignore'`（spike 發現 `codex exec` 會讀 stdin,不 ignore 會卡等待）
- idle timeout:沿用 10 分鐘無輸出即 kill（IDLE_TIMEOUT 常數移過來）
- 安全檢查:對 prompt 先檢查;stdout / stderr 每段 `checkDangerousOperations`,命中即 kill 並回失敗（沿用既有錯誤文案）
- 串流:累積 stdout,呼叫 `provider.parseOutput`,丟給 `onOutput`
- `executionId` 有給就 `registerProcess`
- 不接受任何使用者輸入,沒有 stdin 等待路徑
- 備註:`provider.needsPty === true` 時改用 pty 執行（spike 確認 antigravity 需要才實作;node-pty 為選用相依,可延後到實跑發現需要時再加,先以一般 spawn 實作並在 needsPty 為 true 時記錄警告）

- [ ] **Step 2: 實作 registry**

Create `src/main/ai/index.ts`:
```ts
import type { AiProvider, ProviderId } from './types'
import { claudeProvider } from './providers/claude'
import { codexProvider } from './providers/codex'
import { antigravityProvider } from './providers/antigravity'

const PROVIDERS: Record<ProviderId, AiProvider> = {
  claude: claudeProvider,
  codex: codexProvider,
  antigravity: antigravityProvider
}

export function getProvider(id: ProviderId): AiProvider {
  const p = PROVIDERS[id]
  if (!p) throw new Error(`Unknown provider: ${id}`)
  return p
}

export function listProviders(): AiProvider[] {
  return Object.values(PROVIDERS)
}

export { runProvider } from './runner'
export type { AiProvider, ProviderId, ExecutionContext } from './types'
```

- [ ] **Step 3: 編譯檢查**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/ai/runner.ts src/main/ai/index.ts
git commit -m "feat(ai): add shared runner and provider registry"
```

---

## Task 9: scheduler 改用 registry 派工 + 附件處理

讓 claude / codex / antigravity 走新 runner;gemini 暫時保留舊路徑（Task 13 才移除）。附件改成:文字檔嵌 prompt（不變）;非文字檔放 imagePaths,並把所在目錄加進 addDirs（native-read 用）。

**Files:**
- Modify: `src/main/scheduler.ts:30-33`（imports）、`141-323`（executeTask）、`242-261`（dispatch）

**Interfaces:**
- Consumes: `getProvider`, `runProvider`, `buildUnattendedInstruction`, `ExecutionContext`

- [ ] **Step 1: 改 imports**

把 `import { executeClaudeCli } from './claude-cli'` 與 `executeGeminiCli` 換成:
```ts
import { getProvider, runProvider } from './ai'
import { buildUnattendedInstruction } from './ai/unattended'
import { executeGeminiCli } from './gemini-cli' // 暫留,Task 13 移除
import type { ExecutionContext } from './ai/types'
```

- [ ] **Step 2: 附件分流改寫**

在 `executeTask` 內,把目前用 `binaryAttachments` 的段落改為同時收集 `imagePaths` 與 `addDirs`:
- 文字檔:維持嵌入 prompt
- 非文字檔:`imagePaths.push(filePath)`,並 `addDirs.add(dirname(filePath))`
- `project_path` 存在時也加入 addDirs
- prompt 內保留附件清單提示（沿用既有 `[附件檔案: ...]` 文案）

- [ ] **Step 3: dispatch 改用 registry**

把 `for` 迴圈內 `if (task.cli_tool === 'gemini') ... else ...` 改成:
```ts
if (task.cli_tool === 'gemini') {
  result = await executeGeminiCli(promptWithTextFiles, task.model, onOutput, binaryAttachmentsLegacy, mcpTools, log.id, task.project_path)
} else {
  const ctx: ExecutionContext = {
    prompt: promptWithTextFiles,
    systemInstruction: buildUnattendedInstruction(),
    model: task.model,
    mcpTools: mcpTools ?? [],
    imagePaths,
    addDirs: Array.from(addDirs),
    projectPath: task.project_path,
    skipPermissions: task.skip_permissions === 1
  }
  result = await runProvider(getProvider(task.cli_tool), ctx, { executionId: log.id, onOutput })
}
```
（`ClaudeCliResult | GeminiCliResult` 型別改為 `ProviderResult | GeminiCliResult`,或統一成 `{ success; output; error? }`）

- [ ] **Step 4: 編譯 + build + 實跑驗證**

Run: `npx tsc --noEmit -p tsconfig.node.json` 然後 `npm run build`
Expected: PASS
實跑:`npm run dev`,建一個 Claude 任務按「立即執行」,確認非互動跑完、即時輸出正常、視窗無誤。再建一個 Codex 任務驗證同上（需本機已 `codex login`）。

- [ ] **Step 5: Commit**

```bash
git add src/main/scheduler.ts src/shared/types.ts
git commit -m "feat(ai): dispatch scheduler through provider registry"
```

---

## Task 10: IPC 泛化 + preload + useApi

新增 `ai:test` / `ai:list-mcps` / `ai:list-models`（吃 provider 參數）;保留 claude / gemini 舊 channel 直到 Task 13。

**Files:**
- Modify: `src/main/index.ts`（新增 handlers）、`src/preload/index.ts`（白名單）、`src/renderer/src/hooks/useApi.ts`、`src/shared/types.ts`（IpcApi）

**Interfaces:**
- Produces:`ai:test(provider)`, `ai:list-mcps(provider)`, `ai:list-models(provider)`;`useAiProvider()` 回 `{ test, listMcps, listModels }`

- [ ] **Step 1: 加 IPC handlers**

`src/main/index.ts` 加:
```ts
ipcMain.handle('ai:test', (_e, provider: ProviderId) => getProvider(provider).test())
ipcMain.handle('ai:list-mcps', (_e, provider: ProviderId) => getProvider(provider).listMcps())
ipcMain.handle('ai:list-models', (_e, provider: ProviderId) => getProvider(provider).listModels())
```
import `getProvider`、`ProviderId`。

- [ ] **Step 2: preload 白名單**

`src/preload/index.ts` 把 `ai:test`、`ai:list-mcps`、`ai:list-models` 加入允許的 channel 清單。

- [ ] **Step 3: IpcApi 型別**

`src/shared/types.ts` 的 `IpcApi` 加上三個新 channel 的簽章。

- [ ] **Step 4: useApi 新增 hook**

`src/renderer/src/hooks/useApi.ts` 新增:
```ts
export function useAiProvider() {
  const test = useCallback((provider: string) => api.invoke('ai:test', provider), [])
  const listMcps = useCallback((provider: string) => api.invoke('ai:list-mcps', provider), [])
  const listModels = useCallback((provider: string) => api.invoke('ai:list-models', provider), [])
  return { test, listMcps, listModels }
}
```

- [ ] **Step 5: 編譯 + commit**

Run: `npx tsc --noEmit -p tsconfig.node.json` 與 `npm run build`
```bash
git add src/main/index.ts src/preload/index.ts src/renderer/src/hooks/useApi.ts src/shared/types.ts
git commit -m "feat(ai): generalize provider IPC channels"
```

---

## Task 11: UI provider 三選 + 模型清單 + Settings 分頁

加入 Codex / Antigravity 選項與設定分頁;Claude 拿掉 session token 欄位。Gemini 暫留（Task 13 移除）。字串不翻。

**Files:**
- Modify: `src/renderer/src/components/TaskForm.tsx:609-684`、`src/renderer/src/components/Settings.tsx`

- [ ] **Step 1: TaskForm provider 選擇**

把 provider 按鈕清單由 claude / gemini 擴充為 claude / codex / antigravity / gemini;切換時用 `useAiProvider().listModels(provider)` 抓模型填下拉,並重設 model 與 mcp_tools。每家預設 model:claude=sonnet、codex=gpt-5.3-codex、antigravity=gemini-3-pro。

- [ ] **Step 2: TaskForm 模型清單改動態**

把目前寫死的 models 陣列改成依選定 provider 從 `listModels` 取得（claude / codex 回常數、antigravity 回 `agy models`）。

- [ ] **Step 3: Settings 分頁**

- 移除 Claude session token 欄位（`Settings.tsx:517-529`）與其說明
- Claude tab 只剩 CLI path + 測試（測試改呼叫 `ai:test('claude')`）
- 新增 Codex tab:`codex_cli_path` 選填 + 測試（`ai:test('codex')`）
- 新增 Antigravity tab:`antigravity_cli_path` 選填 + 測試（`ai:test('antigravity')`）
- Gemini tab 暫留

- [ ] **Step 4: build + 實跑驗證**

Run: `npm run build` 然後 `npm run dev`
確認:TaskForm 三家可選、切換時模型清單正確更新;Settings 三個 tab 測試連線可用、Claude 不再要求 token。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TaskForm.tsx src/renderer/src/components/Settings.tsx
git commit -m "feat(ui): add codex and antigravity provider selection and settings"
```

---

## Task 12: 移除互動設施（非互動落實）

**Files:**
- Modify: `src/main/process-manager.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/shared/types.ts`、`src/renderer/src/components/ExecutionLog.tsx`、`src/renderer/src/hooks/useApi.ts`

- [ ] **Step 1: 移除 writeToProcess**

`src/main/process-manager.ts` 刪除 `writeToProcess`,保留 `registerProcess` / `getProcess` / `unregisterProcess`。

- [ ] **Step 2: 移除 task:process-input**

`src/main/index.ts` 刪 `ipcMain.handle('task:process-input', ...)`;`src/preload/index.ts` 移除該 channel;`src/shared/types.ts` 的 IpcApi 移除 `'task:process-input'`。

- [ ] **Step 3: ExecutionLog 拿掉互動元件**

`src/renderer/src/components/ExecutionLog.tsx` 移除 `LogInput`、`McpPermissionOptions`、`PermissionConfirmButton` 以及它們的 render（`{log.status === 'running' && <LogInput .../>}` 等）,保留唯讀即時輸出串流。`src/renderer/src/hooks/useApi.ts` 移除 `useProcessInput`。

- [ ] **Step 4: build + 實跑驗證**

Run: `npm run build` 然後 `npm run dev`
確認:執行中只顯示唯讀輸出,沒有輸入框 / 權限對話框;任務仍能跑完。

- [ ] **Step 5: Commit**

```bash
git add src/main/process-manager.ts src/main/index.ts src/preload/index.ts src/shared/types.ts src/renderer/src/components/ExecutionLog.tsx src/renderer/src/hooks/useApi.ts
git commit -m "feat: remove interactive input relay for unattended execution"
```

---

## Task 13: 移除 Gemini + DB migration + 清掉 token（收尾）

最後一步,移除所有 gemini 痕跡,跑資料遷移,刪掉 claude_session_token 與舊 CLI 檔。

**Files:**
- Modify: `src/main/database.ts`（migration + needs_review 欄位）、`src/shared/types.ts`、`src/main/scheduler.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/components/{TaskForm,Settings,TaskList}.tsx`、`src/renderer/src/hooks/useApi.ts`
- Delete: `src/main/gemini-cli.ts`、`src/main/claude-cli.ts`
- Test: `src/main/migrations.test.ts`（純對應函式）

- [ ] **Step 1: 寫 migration 對應的失敗測試**

把「gemini 任務該怎麼轉」抽成純函式 `mapLegacyTask`。Create `src/main/migrations.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mapLegacyTask } from './migrations'

describe('mapLegacyTask', () => {
  it('converts gemini tasks to disabled claude tasks needing review', () => {
    const out = mapLegacyTask({ cli_tool: 'gemini', model: 'gemini-3', enabled: 1 })
    expect(out).toEqual({ cli_tool: 'claude', model: 'sonnet', enabled: 0, needs_review: 1 })
  })
  it('leaves non-gemini tasks unchanged', () => {
    const out = mapLegacyTask({ cli_tool: 'claude', model: 'opus', enabled: 1 })
    expect(out).toBeNull()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test -- migrations`
Expected: FAIL

- [ ] **Step 3: 實作 mapLegacyTask**

Create `src/main/migrations.ts`:
```ts
interface LegacyTaskRow { cli_tool: string; model: string | null; enabled: number }
interface LegacyTaskPatch { cli_tool: 'claude'; model: 'sonnet'; enabled: 0; needs_review: 1 }

export function mapLegacyTask(row: LegacyTaskRow): LegacyTaskPatch | null {
  if (row.cli_tool === 'gemini' || (row.model ?? '').startsWith('gemini')) {
    return { cli_tool: 'claude', model: 'sonnet', enabled: 0, needs_review: 1 }
  }
  return null
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test -- migrations`
Expected: PASS

- [ ] **Step 5: 在 database.ts 套用 migration**

`src/main/database.ts` 的 `initDatabase` 末尾（既有 ALTER 區塊之後）加入:
```ts
// Migration: needs_review flag for tasks that need manual reconfiguration
try { db.exec(`ALTER TABLE tasks ADD COLUMN needs_review INTEGER DEFAULT 0`) } catch { /* exists */ }

// Migration: Gemini removed -> convert to disabled Claude tasks needing review (idempotent)
db.exec(`UPDATE tasks SET cli_tool='claude', model='sonnet', enabled=0, needs_review=1 WHERE cli_tool='gemini' OR model LIKE 'gemini%'`)

// Migration: drop obsolete credential settings
db.exec(`DELETE FROM settings WHERE key IN ('gemini_api_key','gemini_cli_path','claude_session_token')`)
```
並在 `Task` 型別加 `needs_review: number`,`createTask` INSERT 補 `needs_review`（預設 0）。`updateTask` 在使用者更新 task 時把 `needs_review` 設 0。

- [ ] **Step 6: 移除 gemini 型別與程式**

- `src/shared/types.ts`:`cli_tool` 改回 `'claude' | 'codex' | 'antigravity'`;`ModelType` 移除 `GeminiModel`;`Settings` 移除 `claude_session_token` / `gemini_api_key` / `gemini_cli_path`;IpcApi 移除 `gemini:test` / `gemini:list-mcps`;移除 `GeminiCliResult`
- `src/main/scheduler.ts`:移除 gemini 分支與 `executeGeminiCli` import、legacy 二進位變數
- `src/main/index.ts`、`src/preload/index.ts`:移除 gemini channel
- `src/renderer`:TaskForm 移除 gemini 選項;Settings 移除 Gemini tab;useApi 移除 `useGeminiCli`
- Delete `src/main/gemini-cli.ts`、`src/main/claude-cli.ts`

- [ ] **Step 7: TaskList 顯示 needs_review 提示**

`src/renderer/src/components/TaskList.tsx`:對 `needs_review === 1` 的任務顯示一個徽章 / 提示文字（例如 Needs review: Gemini removed, please reconfigure provider）。

- [ ] **Step 8: 全面驗證**

Run: `npm test`（純函式測試全綠）、`npx tsc --noEmit -p tsconfig.node.json`、`npm run build`
Expected: PASS,專案內已無 gemini 參照（`grep -ri gemini src/` 只剩無關字串或全無）
實跑:`npm run dev`,確認舊 gemini 任務（若有）變成停用 + 顯示需重設徽章;三家 provider 都能跑。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: remove gemini provider, migrate legacy tasks, drop session token"
```

---

## Self-Review

針對 spec 逐節對照:

- 目標與原則:Task 3 至 13 覆蓋 provider 抽象、三家認證靠本機登入（adapter buildEnv 不注入金鑰）、非互動（Task 4/8/12）
- provider adapter 架構:Task 3（types）、5/6/7（adapters）、8（runner+registry）
- 非互動落實:Task 4（指示）、8（runner 無輸入路徑）、12（移除互動 UI/IPC）
- 移除互動設施:Task 12
- 型別與資料:Task 3（additive union）、13（移除 gemini、migration、needs_review）
- IPC / UI:Task 10（IPC）、11（TaskForm/Settings）、13（清 gemini）
- 待驗證項:Task 1 spike
- 測試策略:純函式 TDD（Task 4/5/6/7/13）+ build/實跑（Task 9/11/12）

Placeholder 檢查:codex parseOutput 與 antigravity needsPty 標明依 Task 1 spike 結果調整,屬有意的前置驗證,非空白占位;claude parseOutput 指明整段移植既有 `parseStreamJsonOutput`。

型別一致性:`ExecutionContext`、`AiProvider`、`getProvider`、`runProvider`、`mapLegacyTask` 在定義與使用處名稱一致。

風險:Antigravity 非 TTY 與 codex 事件結構在 Task 1 釘死後才寫 adapter;DB migration 為冪等 UPDATE/DELETE,可重複執行。
