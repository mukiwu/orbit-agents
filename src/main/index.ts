import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import fixPath from 'fix-path'
import { initAutoUpdater, registerAutoUpdaterIpcHandlers } from './auto-updater'
import { checkAndRollbackIfNeeded, markAsarUpdateSuccess } from './asar-updater'

fixPath()
import {
  initDatabase,
  closeDatabase,
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  toggleTask,
  getExecutionLogs,
  getExecutionLogById,
  deleteExecutionLogs,
  getAllSettings,
  updateSettings
} from './database'
import {
  initScheduler,
  stopScheduler,
  scheduleTask,
  unscheduleTask,
  runTaskNow,
  onExecutionUpdate
} from './scheduler'
import { writeToProcess } from './process-manager'
import { testClaudeConnection, listMcpServers } from './claude-cli'
import { testGeminiConnection, listMcpServers as listGeminiMcpServers } from './gemini-cli'
import { testCodexConnection, listCodexMcpServers, listCodexModels } from './codex-cli'

import { resetTransporter, sendTestEmail } from './email'
import type {
  CreateTaskInput,
  UpdateTaskInput,
  Settings,
  ExecutionLog
} from '../shared/types'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Orbit Agents',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // Mark asar update as successful after window is ready
    markAsarUpdateSuccess()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load the remote URL for development or the local html file for production
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Register IPC handlers
function registerIpcHandlers(): void {
  // Task handlers
  ipcMain.handle('task:list', () => {
    return getAllTasks()
  })

  ipcMain.handle('task:get', (_, id: string) => {
    return getTaskById(id)
  })

  ipcMain.handle('task:create', (_, input: CreateTaskInput) => {
    const task = createTask(input)
    scheduleTask(task)
    return task
  })

  ipcMain.handle('task:update', (_, input: UpdateTaskInput) => {
    const task = updateTask(input)
    scheduleTask(task)
    return task
  })

  ipcMain.handle('task:delete', (_, id: string) => {
    unscheduleTask(id)
    deleteTask(id)
  })

  ipcMain.handle('task:toggle', (_, id: string) => {
    const task = toggleTask(id)
    if (task.enabled) {
      scheduleTask(task)
    } else {
      unscheduleTask(id)
    }
    return task
  })

  ipcMain.handle('task:run-now', async (_, id: string) => {
    return runTaskNow(id)
  })

  // Process input handler
  ipcMain.handle('task:process-input', (_, executionId: string, input: string) => {
    return writeToProcess(executionId, input)
  })

  // Log handlers
  ipcMain.handle('log:list', (_, taskId?: string, limit?: number) => {
    return getExecutionLogs(taskId, limit)
  })

  ipcMain.handle('log:get', (_, id: string) => {
    return getExecutionLogById(id)
  })

  ipcMain.handle('log:delete', (_, ids: string[]) => {
    return deleteExecutionLogs(ids)
  })

  // Settings handlers
  ipcMain.handle('settings:get', () => {
    return getAllSettings()
  })

  ipcMain.handle('settings:update', (_, settings: Partial<Settings>) => {
    updateSettings(settings)

    // Handle auto launch
    if (settings.auto_launch !== undefined) {
      const enable = settings.auto_launch === 'true'
      app.setLoginItemSettings({
        openAtLogin: enable,
        openAsHidden: false
      })
    }

    resetTransporter() // Reset transporter so new settings take effect
  })

  ipcMain.handle('settings:test-email', async (_, toAddress: string) => {
    await sendTestEmail(toAddress)
  })

  // Claude CLI handlers
  ipcMain.handle('claude:test', async () => {
    return testClaudeConnection()
  })

  ipcMain.handle('claude:list-mcps', async () => {
    return listMcpServers()
  })

  // Gemini CLI handlers
  ipcMain.handle('gemini:test', async () => {
    return testGeminiConnection()
  })

  ipcMain.handle('gemini:list-mcps', async () => {
    return listGeminiMcpServers()
  })

  // Codex CLI handlers
  ipcMain.handle('codex:test', async () => {
    return testCodexConnection()
  })

  ipcMain.handle('codex:list-mcps', async () => {
    return listCodexMcpServers()
  })

  ipcMain.handle('codex:list-models', async () => {
    return listCodexModels()
  })


  // File dialog handler
  ipcMain.handle('dialog:open-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Text Files', extensions: ['txt', 'md', 'json', 'csv', 'log'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: 'Documents', extensions: ['pdf', 'doc', 'docx'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  // Save file dialog handler (for knowledge file path selection)
  ipcMain.handle('dialog:save-file', async (_event, defaultPath?: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: defaultPath || undefined,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePath
  })
}

// App lifecycle
app.whenReady().then(() => {
  // Check if asar update needs rollback (before anything else)
  const rolledBack = checkAndRollbackIfNeeded()
  if (rolledBack) {
    console.log('Asar update was rolled back to previous version')
  }

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.orbit')

  // Set app name for macOS since it might default to "Electron" in dev
  app.setName('Orbit Agents')

  // Set dock icon for macOS in development
  if (process.platform === 'darwin' && is.dev) {
    app.dock.setIcon(join(__dirname, '../../resources/icon.png'))
    app.setName('Orbit Agents') // Ensure name is set again just in case
  }

  // Default open or close DevTools by F12 in development
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize database
  initDatabase()

  // Apply auto-launch setting
  const settings = getAllSettings()
  const autoLaunch = settings.auto_launch === 'true'
  // Only set if explicitly enabled/disabled to avoid overwriting OS state if not set
  if (settings.auto_launch) {
    app.setLoginItemSettings({
      openAtLogin: autoLaunch,
      openAsHidden: false
    })
  }

  // Register IPC handlers
  registerIpcHandlers()
  registerAutoUpdaterIpcHandlers()

  // Initialize scheduler
  initScheduler()

  // Listen for execution updates and send to renderer
  onExecutionUpdate((log: ExecutionLog) => {
    mainWindow?.webContents.send('execution:update', log)
  })

  // Create window
  createWindow()

  // Initialize auto-updater after window is created
  initAutoUpdater(mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopScheduler()
  closeDatabase()
})
