# Orbit Agents

[中文說明 (Traditional Chinese)](./Readme_zh-tw.md)

![Orbit Agents Screenshot](src/renderer/src/assets/screenshot.png)

Orbit Agents is an AI-powered desktop cron scheduler built with Electron. It combines a modern Cron scheduling system with powerful AI integration (Claude, Gemini, and Codex), allowing you to automate various tasks from simple script execution to complex AI-assisted workflows.

## Key Features

- **Smart Scheduling System**
  - Supports standard Cron expressions
  - Visual task management interface
  - Flexible task enabling/disabling control
  - Instant execution (Run Now)

- **Deep AI Integration**
  - Built-in Anthropic Claude CLI integration
  - Built-in Google Gemini CLI integration
  - Built-in OpenAI Codex CLI integration
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
- **macOS**: `Orbit-Agents-1.0.8-arm64.dmg` (Apple Silicon) or `zip` file
- **Windows**: `Orbit-Agents-Setup-1.0.8.exe` installer or `zip` file
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
