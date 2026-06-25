import { contextBridge, ipcRenderer } from 'electron'
import type { IpcApi, ElectronApi } from '../shared/types'

type IpcChannel = keyof IpcApi | 'settings:test-email' | 'dialog:open-files' | 'dialog:save-file' | 'dialog:open-directory' | 'updater:check' | 'updater:download' | 'updater:install' | 'updater:status'

type RendererListener = (event: unknown, ...args: unknown[]) => void

// Map each caller-provided callback to the wrapper actually registered with
// ipcRenderer, so off() can remove the exact same function reference. Without
// this, on() registers an anonymous wrapper that off() can never remove, so
// listeners leak and stale subscriptions keep firing (e.g. one running task's
// execution:update overwriting another task's log view).
const listenerWrappers = new WeakMap<(...args: unknown[]) => void, RendererListener>()

export const api: ElectronApi = {
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
      const wrapper: RendererListener = (_event, ...args) => callback(...args)
      listenerWrappers.set(callback, wrapper)
      ipcRenderer.on(channel, wrapper)
    }
  },

  off: (channel: string, callback: (...args: unknown[]) => void): void => {
    const validChannels = ['execution:update', 'updater:status']

    if (validChannels.includes(channel)) {
      const wrapper = listenerWrappers.get(callback)
      if (wrapper) {
        ipcRenderer.removeListener(channel, wrapper)
        listenerWrappers.delete(callback)
      }
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronApi', api)
  } catch (error) {
    console.error(error)
  }
} else if (typeof window !== 'undefined') {
  // @ts-ignore (define in dts)
  window.electronApi = api
}
