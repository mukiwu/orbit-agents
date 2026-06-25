import { contextBridge, ipcRenderer } from 'electron'
import type { IpcApi, ElectronApi } from '../shared/types'

type IpcChannel = keyof IpcApi | 'settings:test-email' | 'dialog:open-files' | 'dialog:save-file' | 'dialog:open-directory' | 'updater:check' | 'updater:download' | 'updater:install' | 'updater:status'

const api: ElectronApi = {
  invoke: <K extends keyof IpcApi>(
    channel: K,
    ...args: Parameters<IpcApi[K]>
  ): ReturnType<IpcApi[K]> => {
    const validChannels: IpcChannel[] = [
      'task:list',
      'task:get',
      'task:create',
      'task:update',
      'task:delete',
      'task:toggle',
      'task:run-now',
      'log:list',
      'log:get',
      'log:delete',
      'settings:get',
      'settings:update',
      'settings:test-email',
      'ai:test',
      'ai:list-mcps',
      'ai:list-models',
      'skill:scan',
      'dialog:open-files',
      'dialog:save-file',
      'dialog:open-directory',
      'updater:check',
      'updater:download',
      'updater:install',
      'updater:status'
    ]

    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args) as ReturnType<IpcApi[K]>
    }

    throw new Error(`Invalid IPC channel: ${channel}`)
  },

  on: (channel: string, callback: (...args: unknown[]) => void): void => {
    const validChannels = ['execution:update', 'updater:status']

    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args))
    }
  },

  off: (channel: string, callback: (...args: unknown[]) => void): void => {
    const validChannels = ['execution:update', 'updater:status']

    if (validChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, callback)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronApi', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electronApi = api
}
