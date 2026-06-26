# Orbit Agents

[English Version](./Readme.md)


Orbit Agents 是一個基於 Electron 開發的 AI 驅動桌面端排程管理工具。它結合了現代化的 Cron 排程系統與強大的 AI 整合（Claude、Codex、Antigravity），讓您可以自動化執行各種任務，從簡單的腳本執行到複雜的 AI 輔助工作流。

## 主要功能

- **智能排程系統**
  - 支援標準 Cron 表達式
  - 視覺化任務管理介面
  - 靈活的任務啟用/停用控制
  - 即時執行功能 (Run Now)

- **AI 深度整合**
  - 內建 Anthropic Claude Code CLI 整合
  - 內建 OpenAI Codex CLI 整合
  - 內建 Google Antigravity CLI 整合
  - 支援 MCP (Model Context Protocol) 伺服器
  - 讓 AI 成為您的自動化助手

- **完整執行紀錄**
  - 詳細的任務執行歷史
  - 成功/失敗狀態追蹤
  - 完整的輸出日誌查看

- **通知系統**
  - 內建 Email 通知功能 (Nodemailer)
  - 任務執行狀態即時推播

- **跨平台支援**
  - macOS (Apple Silicon & Intel)
  - Windows
  - Linux

## 安裝說明

### 下載檔案
您可以在 [Releases](https://github.com/mukiwu/orbit-agents/releases) 頁面下載最新版本：
- **macOS**: `Orbit-Agents-1.0.8-arm64.dmg` (Apple Silicon) 或 `zip` 檔案
- **Windows**: `Orbit-Agents-Setup-1.0.8.exe` 安裝檔或 `zip` 檔案
- **Linux**: `.AppImage` 或 `.deb`

### macOS 安裝注意事項
由於目前的版本尚未包含 Apple 開發者憑證，macOS Gatekeeper 可能會阻止 App 開啟。

**方法一：移除隔離屬性（推薦）**

打開終端機執行：
```bash
xattr -cr /Applications/Orbit\ Agents.app
```

**方法二：右鍵開啟**
1. 在 Finder 中，按住 **Control 鍵** 並點擊 App 圖示（或點擊右鍵）。
2. 在選單中選擇 **「打開」(Open)**。
3. 在跳出的警告視窗中，再次點擊 **「打開」**。

> 提示：這個步驟只需要在第一次執行時操作，之後就可以直接點擊 App 開啟。

## 開發指南

### 環境需求
- Node.js (建議 v18 或以上)
- npm 或 yarn

### 快速開始

1. **安裝依賴**
   ```bash
   npm install
   ```

2. **啟動開發模式**
   ```bash
   npm run dev
   ```

3. **打包應用程式**
   ```bash
   # 建置所有平台
   npm run build

   # 僅建置 macOS
   npm run build:mac

   # 僅建置 Windows
   npm run build:win

   # 僅建置 Linux
   npm run build:linux
   ```

   > 註:`npm run build:mac` 會自動把 better-sqlite3 原生模組重編成對應架構,各平台請在各自的作業系統上打包,native 模組才會對到目標架構

## 技術架構

- **核心框架**: [Electron](https://www.electronjs.org/)
- **前端介面**: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [TailwindCSS](https://tailwindcss.com/)
- **資料儲存**: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **排程核心**: [node-cron](https://github.com/node-cron/node-cron)
- **構建工具**: [Electron Vite](https://electron-vite.org/)

## 授權

MIT License

---
Created by Muki Wu
