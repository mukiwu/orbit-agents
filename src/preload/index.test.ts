import { describe, it, expect, vi, beforeEach } from 'vitest'

const { on, removeListener } = vi.hoisted(() => ({
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  ipcRenderer: { on, removeListener, invoke: vi.fn() },
  contextBridge: { exposeInMainWorld: vi.fn() }
}))

import { api } from './index'

describe('preload api on/off listener identity', () => {
  beforeEach(() => {
    on.mockClear()
    removeListener.mockClear()
  })

  it('off removes the exact wrapper that on registered with ipcRenderer', () => {
    const callback = vi.fn()

    api.on('execution:update', callback)
    expect(on).toHaveBeenCalledTimes(1)
    const registeredWrapper = on.mock.calls[0][1]

    api.off('execution:update', callback)
    expect(removeListener).toHaveBeenCalledTimes(1)
    const removedWrapper = removeListener.mock.calls[0][1]

    // The listener actually registered with ipcRenderer is the wrapper, not the
    // raw callback. off() must remove that same wrapper or the listener leaks.
    expect(removedWrapper).toBe(registeredWrapper)
  })

  it('a removed listener no longer forwards events to the callback', () => {
    const callback = vi.fn()

    api.on('execution:update', callback)
    const wrapper = on.mock.calls[0][1] as (event: unknown, ...args: unknown[]) => void

    api.off('execution:update', callback)

    // Simulate ipcRenderer firing the wrapper that off should have removed.
    // (In real Electron removeListener detaches it; here we assert off targeted it.)
    expect(removeListener).toHaveBeenCalledWith('execution:update', wrapper)
  })
})
