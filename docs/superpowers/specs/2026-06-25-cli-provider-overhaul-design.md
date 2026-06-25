# CLI 供應商大改 設計 (Stream A)

狀態:設計已與使用者確認，待寫實作計畫
日期:2026-06-25
分支:feat/cli-provider-overhaul

## 背景

Orbit Agents 是一個桌面排程軟體，讓使用者用 cron 排程去跑 AI CLI 任務。目前支援 Claude 與 Gemini 兩家，程式上 `claude-cli.ts` 與 `gemini-cli.ts` 各寫一份，spawn、安全檢查、idle timeout、輸出解析大量重複。Gemini 那支還有一大段在硬接互動式權限提示（偵測到提示就往 stdin 灌 `y`），又脆又難維護。

這份設計處理使用者提的其中三項需求（合併為一個工程）:

- 需求 2:簡化 Claude 串接，拿掉手動輸入 token
- 需求 3:加入 Codex 與 Antigravity CLI，移除 Gemini CLI
- 需求 4:這是排程軟體，不需要跟使用者互動，輸出時要避免 AI 丟出需要回應的問題或選項

需求 1（繁體中文 i18n）是獨立的 Stream B，之後另開 spec，順序在本 stream 之後（避免先翻譯到一堆即將被刪的互動相關字串）

## 目標與原則

- 三家 CLI 一律靠「本機已登入的 CLI」認證，Orbit Agents 不儲存任何金鑰或 token。這把需求 2 的精神（不用手動輸 token）一致套用到全部三家
- 所有執行全程非互動、全自動，runner 不存在任何「等待使用者輸入」的路徑
- 三家共用一個執行器，每家只維護一個薄薄的 adapter，新增或移除 provider 成本低
- 非互動的保證集中在單一處，不在每家重複

## 非目標

- 不在這個 stream 做 i18n / 字串翻譯（Stream B）
- 不改 cron 排程引擎、email 報告、knowledge 萃取、auto-updater 等既有功能
- 不新增雲端或 API 直連模式，維持「呼叫本機 CLI」的架構

## 已查證的 CLI 事實

以下用本機各 CLI 的 `--help` 查證（claude 2.1.191、codex-cli 0.141.0、agy 已安裝於 ~/.local/bin/agy）

### Claude (`claude`)
- 非互動:`-p / --print`
- 自動同意:`--dangerously-skip-permissions`
- 模型:`--model <haiku|sonnet|opus>`
- 串流輸出:`--output-format stream-json --verbose`
- 注入非互動指示:`--append-system-prompt <text>`
- 附件:`--add-dir <dir>` 授權目錄，檔案路徑寫進 prompt 讓 Claude 用 Read 自己讀。原本的 `--file file_abc:doc.txt` 是「下載已上傳資源 ID」用的，需要 cookie token，這次移除
- MCP:`claude mcp list`
- 認證:本機 claude 既有登入

### Codex (`codex`)
- 非互動:`codex exec [PROMPT]`（prompt 可用 arg 或 stdin）
- 串流輸出:`--json`（JSONL）
- 模型:`-m / --model`
- 圖片附件:`-i / --image <FILE>...`（原生支援）
- 工作目錄:`-C / --cd <DIR>`
- 非 git 專案:`--skip-git-repo-check`（必加，Codex 預設要 git repo）
- 沙箱:`-s / --sandbox <read-only|workspace-write|danger-full-access>`
- 全自動免確認:`--dangerously-bypass-approvals-and-sandbox`
- 最終訊息寫檔:`-o / --output-last-message <FILE>`
- MCP:`codex mcp`
- 認證:`codex login`

### Antigravity (`agy`)
- 非互動:`-p / --print / --prompt`（單一 prompt 跑完印出回應）
- 自動同意:`--dangerously-skip-permissions`
- 模型:`--model`，清單可用 `agy models` 動態抓
- 附件:`--add-dir`
- print 逾時:`--print-timeout`（預設 5m）
- 認證:本機 agy 既有登入（help 沒有 login 子命令，實作前用 `agy doctor` / 實跑確認確切機制）
- 注意:輸出是純文字（沒有 JSON 格式）；agy 會偵測 stdout 是否為 TTY，非 TTY 下可能不正常吐輸出，實作時先驗證直接 spawn 行為，不行再用 pty（node-pty）或 `script` 包一層

## 架構:Provider Adapter

新增 `src/main/ai/` 模組

### `src/main/ai/types.ts`
- `ProviderId = 'claude' | 'codex' | 'antigravity'`
- `AiProvider` 介面，每家 adapter 實作:
  - `id: ProviderId`
  - `displayName: string`
  - `resolveCommand(): string` 解析 CLI 路徑（讀 settings 的 `*_cli_path`，否則用預設 / PATH）
  - `buildArgs(ctx: ExecutionContext): string[]` 組非互動旗標、model、add-dir、附件、sandbox/approval 對應
  - `buildEnv(): NodeJS.ProcessEnv` 主要是清掉會干擾的變數（例如 CLAUDECODE），不注入金鑰
  - `promptDelivery: 'arg' | 'stdin'` 平台 / provider 差異（例如 Windows 用 stdin 避免 cmd.exe 拆參數）
  - `parseOutput(raw: string): string` claude=stream-json、codex=JSONL、antigravity=純文字
  - `needsPty?: boolean` antigravity 視驗證結果決定
  - `test(): Promise<ProviderTestResult>` 連線 / 登入檢查
  - `listModels(): Promise<ModelOption[]>` claude/codex 用常數，antigravity 用 `agy models` 動態 + fallback
  - `listMcps(): Promise<McpServer[]>`
  - `capabilities: { mcp: boolean; attachments: 'native-read' | 'image-flag'; streaming: 'json' | 'text' }`

### `src/main/ai/runner.ts`
共用執行器，集中所有共通邏輯:
- spawn（cwd 用 project_path 存在才用、否則 home；windowsHide；非互動 stdio）
- idle timeout（沿用現有 10 分鐘無輸出即 kill 的機制）
- 安全檢查:對 prompt、stdout、stderr 跑 `checkDangerousOperations`，命中即 kill
- 串流:把 adapter 的 `parseOutput` 套到累積輸出，呼叫 `onOutput`
- 行程註冊:沿用 process-manager 註冊，支援取消 / kill（但移除 stdin 寫入）
- 統一以非互動方式啟動，沒有任何等待輸入的分支

### `src/main/ai/providers/{claude,codex,antigravity}.ts`
各家 adapter，只負責該家差異

### `src/main/ai/index.ts`
registry:`getProvider(id)`、`listProviders()`

### scheduler 變更
`scheduler.ts` 改成透過 registry 派工:`getProvider(task.cli_tool).` 經由 runner 執行，移除目前的 `if (task.cli_tool === 'gemini') ... else ...` 分支

## 非互動落實（需求 4）

集中在 runner 與 adapter 的 buildArgs:

- Claude / Antigravity:一律 `--print`，`skip_permissions` 控制要不要帶 `--dangerously-skip-permissions`。不帶時在 print 模式下需要權限的動作會被直接拒絕而非卡住，這仍是非互動行為
- Codex:`codex exec --json --skip-git-repo-check`；`skip_permissions=1` 帶 `--dangerously-bypass-approvals-and-sandbox`，`=0` 帶 `--sandbox workspace-write`（仍非互動，只是受沙箱限制）
- runner 不接受使用者 stdin 輸入，prompt 以 arg 或一次性 stdin 後立即 end

### 無人值守系統指示
prompt 組裝層（scheduler）在送出前加一段「無人值守」指示:

- Claude 用 `--append-system-prompt` 帶
- Codex / Antigravity 沒有等價旗標，prefix 進 prompt 本文

指示內容大意（最終文案實作時定）:你正在無人值守的排程環境中執行，沒有任何人能即時回應你；不要向使用者提問、不要要求確認、不要丟出需要使用者選擇的選項；遇到不確定時用合理預設繼續；直接完成任務並產出最終結果

## 移除互動設施（需求 4）

- ExecutionLog.tsx:移除 LogInput、McpPermissionOptions、PermissionConfirmButton 等互動元件，保留唯讀即時輸出串流
- 移除 IPC `task:process-input`
- process-manager:移除 `writeToProcess`（往 stdin 灌輸入），保留行程註冊以支援取消 / kill 與 idle timeout
- 移除 gemini-cli.ts 內整段 `checkAndReply` 自動回 `y` 的 hack（隨 Gemini 一起移除）

## 型別與資料層

### types.ts
- `Task.cli_tool` / `CreateTaskInput.cli_tool`:`'claude' | 'codex' | 'antigravity'`
- `ModelType`:維持有限 union（呼應使用者對 PR #1 反對純 `string` 的 review）
  - claude:`haiku | sonnet | opus`
  - codex:`gpt-5.3-codex | gpt-5.3-codex-spark`（以實作時實查為準）
  - antigravity:已知模型 union，下拉選單用 `agy models` 動態呈現，但儲存值對應已知 union。新增模型即修改 union，保留編譯期檢查
- `Settings`:移除 `claude_session_token`、`gemini_api_key`、`gemini_cli_path`；新增 `codex_cli_path?`、`antigravity_cli_path?`（皆選填，預設靠 PATH / login）；保留 `claude_cli_path`
- 移除 `GeminiCliResult`，新增或泛化 provider 結果型別

### DB migration
database.ts 目前沒有 migration runner，這次加一個簡單的版本化 migration 機制（schema_version 表 + 依序套用）。本次 migration 內容:
- 既有 `cli_tool='gemini'` 的任務 → 改 `cli_tool='claude'`、`model='sonnet'`、`enabled=0`（停用），避免靜默改變行為
- 既有 `model` 為 `gemini-*` 的值 → 對應 `sonnet`
- 清除 settings 內的 `gemini_api_key`、`gemini_cli_path`、`claude_session_token`
- UI 對被遷移的任務顯示提示:Gemini 已移除，請重設此任務的 provider 與 model

## IPC / API

- 移除:`gemini:test`、`gemini:list-mcps`、`task:process-input`
- 泛化:`ai:test(provider)`、`ai:list-mcps(provider)`、`ai:list-models(provider)` 取代各家專屬 channel，對應 registry
- preload 白名單同步調整
- useApi.ts:移除 `useGeminiCli`、`useProcessInput`；新增 `useAiProvider`（test / listMcps / listModels，吃 provider 參數）

## Renderer / UI

- TaskForm.tsx:provider 三選（Claude / Codex / Antigravity）；model 清單依 provider（claude/codex 常數、antigravity 動態）；切換 provider 時重設 model 與 mcp_tools
- Settings.tsx:移除 Gemini tab 與 Claude session token 欄位；新增 Codex / Antigravity tab（只有 CLI path 選填 + 連線 / 登入測試，無金鑰欄）；Claude tab 只剩 CLI path + 測試
- ExecutionLog.tsx:如上移除互動元件，保留唯讀即時輸出
- 字串維持現狀不翻，留給 Stream B

## 實作前仍需驗證

- `agy -p` 在非 TTY（直接 spawn）下是否正常吐輸出，不行則上 pty 包裝
- `agy` 認證的確切機制（用 `agy doctor` / 實跑確認）
- Codex 實際可用的模型名稱

## 測試 / 驗證策略

依使用者先前選擇:不另建測試框架，用實際 build + 跑 App 驗證

- runner / adapter 的 `buildArgs` 是純函式，若要可加極輕量單元測試驗證旗標組裝，實作時再與使用者確認
- 實跑驗證:三家各跑一個簡單排程任務，確認非互動執行、輸出正常、附件可讀、取消可用、Gemini 既有任務出現遷移提示

## 風險與緩解

- Antigravity 非 TTY 輸出問題:先驗證再決定是否引入 node-pty（跨平台 pty）
- DB migration 改到既有任務:採「停用 + 提示」而非靜默改行為或刪除，使用者資料不流失
- Codex 沙箱與全自動旗標的危險性:沿用既有 `skip_permissions` 任務開關 + 既有 security-check 守門，行為與目前 Claude 的 skip-permissions 一致
