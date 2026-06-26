# Orbit Agents

> 🚀 **[We're launching on Product Hunt — March 24!](https://www.producthunt.com/products/orbit-agents?launch=orbit-agents)** Come support us!

### Your AI tasks, on autopilot.

Schedule Claude, Codex, or Antigravity to run automatically on your desktop. No servers, no cloud fees, no node wiring — just write a prompt, pick a schedule, and let it work for you.

[中文說明 (Traditional Chinese)](./Readme_zh-tw.md)

![Orbit Agents Screenshot](src/renderer/src/assets/screenshot.png)

## Get Started in 3 Steps

1. **Pick your AI** → Claude (Sonnet / Opus / Haiku), Codex (GPT-5.5 / GPT-5.4), or Antigravity (Gemini / Claude / GPT-OSS)
2. **Write your prompt** → Tell the AI what to do in plain language
3. **Set a schedule** → Daily, weekly, monthly, or custom cron expression

That's it. Orbit handles the rest.

## Why Orbit Agents?

| | n8n / Zapier | Orbit Agents |
|--|--|--|
| Cost | Cloud hosting fees | **Free**, runs locally |
| Setup | Visual node wiring | **Write a prompt** |
| AI | Requires extra integration | **Claude, Codex & Antigravity built-in** |
| Data | Stored in the cloud | **100% on your machine** |
| Source | Proprietary / limited | **Open source (MIT)** |

## Key Features

- **Smart Scheduling System**
  - Supports standard Cron expressions
  - Visual task management interface
  - Flexible task enabling/disabling control
  - Instant execution (Run Now)

- **Deep AI Integration**
  - Built-in Anthropic Claude Code CLI integration
  - Built-in OpenAI Codex CLI integration
  - Built-in Google Antigravity CLI integration
  - Supports MCP (Model Context Protocol) servers
  - Turn AI into your automation assistant

- **Comprehensive Execution Logs**
  - Detailed task execution history
  - Success/Failure status tracking
  - Complete output log viewing

- **Notification System**
  - Built-in Email notification (Nodemailer)
  - Instant push notifications for task execution status

- **Cross-Platform Support**
  - macOS (Apple Silicon & Intel)
  - Windows
  - Linux

## Installation Guide

### Download
You can download the latest version from the [Releases](https://github.com/mukiwu/orbit-agents/releases) page:
- **macOS**: `Orbit-Agents-1.0.15-arm64.dmg` (Apple Silicon) or `zip` file
- **Windows**: `Orbit-Agents-Setup-1.0.15.exe` installer or `zip` file
- **Linux**: `.AppImage` or `.deb`

### macOS Installation Note
Since the current version does not include an Apple Developer certificate, macOS Gatekeeper may block the app from opening.

**Option 1: Remove quarantine attribute (Recommended)**

Open Terminal and run:
```bash
xattr -cr /Applications/Orbit\ Agents.app
```

**Option 2: Right-click to open**
1. In Finder, hold the **Control key** and click the App icon (or right-click).
2. Select **"Open"** from the menu.
3. In the warning window that appears, click **"Open"** again.

> Tip: You only need to do this the first time you run the app. Afterwards, you can open it normally.

## Development Guide

### Prerequisites
- Node.js (v18+ recommended)
- npm or yarn

### Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start Development Mode**
   ```bash
   npm run dev
   ```

3. **Build Application**
   ```bash
   # Build for all platforms
   npm run build

   # Build for macOS only
   npm run build:mac

   # Build for Windows only
   npm run build:win

   # Build for Linux only
   npm run build:linux
   ```

   > Note: `npm run build:mac` rebuilds the native `better-sqlite3` binary for the correct architecture, and each platform should be built on its own OS so the native module matches the target

## Technical Architecture

- **Core Framework**: [Electron](https://www.electronjs.org/)
- **Frontend**: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [TailwindCSS](https://tailwindcss.com/)
- **Data Storage**: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Scheduling Core**: [node-cron](https://github.com/node-cron/node-cron)
- **Build Tool**: [Electron Vite](https://electron-vite.org/)

## License

MIT License

---
Created by Muki Wu
