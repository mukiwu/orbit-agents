# 繁體中文 i18n 設計 (Stream B)

狀態:設計已與使用者確認，待寫實作計畫
日期:2026-06-25
分支:feat/i18n-zh-tw

## 背景

Orbit Agents 目前 UI 主要是英文硬寫字串，只有 `ExecutionLog` 與部分 main process 訊息（系統通知、安全檢查/政策錯誤）是中文，整體沒有 i18n 框架、也沒有語言設定。使用者要做繁體中文版本。

這是使用者最初 4 項需求的第 1 項（繁中語系），與已完成的 Stream A（CLI 供應商大改）獨立。

## 目標

- 雙語 English + 繁體中文（zh-TW），可在 app 內切換，預設跟隨系統語言
- 整個 app 只有一份翻譯來源，renderer 與 main process 共用
- 切換語言即時生效，不需重啟
- 使用者可見的字串都在地化，包含 main process 的通知與錯誤訊息

## 非目標

- 不翻譯塞給 AI 的 prompt 指示（email/knowledge 標記、unattended 指示）。那是給 AI 的功能性指令，不是 UI，維持原樣
- 不改動 Stream A 的執行層、排程、provider 邏輯
- 第一版只做 en 與 zh-TW 兩個語系（架構要讓之後加語系容易）

## 函式庫與架構

- renderer 用 `react-i18next` + `i18next`（React i18n 事實標準，支援即時切換）
- 翻譯資源為共用 JSON：`src/shared/locales/en.json`、`src/shared/locales/zh-TW.json`
  - renderer 透過 react-i18next 載入這兩份
  - main process 用一個極輕量的 translator（`src/main/i18n.ts`）讀同一份 JSON + 當前語系做 `t(key)`
  - 單一翻譯來源，不會兩邊各維護一份
- key 以英文為基準（現在 UI 大多英文），用命名空間分組：`common.*`、`app.*`、`taskForm.*`、`settings.*`、`executionLog.*`、`taskList.*`、`welcome.*`

## 語言偵測與設定

- `Settings` 新增欄位 `language`:`'system' | 'en' | 'zh-TW'`，預設 `'system'`
- 純函式 `resolveLocale(pref, systemLocale): 'en' | 'zh-TW'`（共用、可單測）：
  - pref 為 `'en'` 或 `'zh-TW'` 直接回傳
  - pref 為 `'system'` 時看 systemLocale：開頭是 `zh-Hant` / `zh-TW` / `zh` → `zh-TW`，其餘 → `en`
- main 用 `app.getLocale()` 當 systemLocale；renderer 用 `navigator.language` 當 systemLocale（兩者在 system 模式下通常一致，邊緣差異可接受）
- 流程：
  - 啟動：renderer 讀 `settings:get` 拿 `language` pref → `resolveLocale(pref, navigator.language)` → `i18next.changeLanguage`
  - 切換：Settings 的語言下拉改值 → `settings:update({ language })` + renderer 立刻 `i18next.changeLanguage(resolved)`
  - main 在地化訊息時，讀當前 `settings.language` → `resolveLocale(pref, app.getLocale())` → 用 main translator 翻譯

## 字串抽取

- renderer 各 component 把硬寫字串改成 `t('namespace.key')`
- `ExecutionLog` 現有中文字串反向抽成英文 key + 繁中值
- 動態/插值字串用 i18next 的 interpolation（例如 `t('executionLog.retry', { attempt, max })`），不要用字串拼接
- 涵蓋的 renderer 檔：`App.tsx`、`TaskForm.tsx`、`Settings.tsx`、`TaskList.tsx`、`ExecutionLog.tsx`、`WelcomePage.tsx`

## main process 在地化

- 對象：系統通知（執行成功/失敗）、安全檢查訊息、政策拒絕訊息、DB 啟動失敗對話框、Gemini 遷移提示等使用者可見字串
- 作法：`src/main/i18n.ts` 提供 `t(key, vars?)`，讀同一份 locale JSON；語系來自 settings + `app.getLocale()`
- 這些訊息的 key 也放進共用 JSON 的命名空間（例如 `main.notification.*`、`main.security.*`）

## WelcomePage

- 一起翻譯（使用者確認）。它約 600 行、多為行銷文案，字串量較大，計畫會獨立成一個 task

## 測試 / 驗證策略

- 純函式用 vitest 單測：`resolveLocale`（各種 systemLocale 與 pref 組合）、main translator 的 `t()`（命中 key、缺 key 的 fallback、interpolation）
- locale JSON 完整性檢查：寫一個測試確認 `en.json` 與 `zh-TW.json` 的 key 集合一致（避免漏翻或多餘 key）
- UI 字串替換用 build + 實跑驗證：切語言看畫面、確認沒有殘留英文/中文硬字串
- 完工後 grep 抽查確認硬寫的使用者字串都已換成 `t()`

## 風險與緩解

- 字串量大、容易漏：用「key 集合一致性測試」+ 完工 grep 抽查接住
- main 與 renderer 對 `'system'` 的解析來源不同（`app.getLocale()` vs `navigator.language`）：用同一個 `resolveLocale` 純函式，邏輯一致，只有來源不同，邊緣差異可接受
- 即時切換：react-i18next 原生支援；main 端每次翻譯時讀當前語系即可，不需重啟

## 流程

開新 branch `feat/i18n-zh-tw`，spec → plan → subagent 逐 task 實作 → 每 task review → 整支 branch review → PR
