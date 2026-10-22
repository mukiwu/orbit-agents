import { describe, it, expect, vi } from 'vitest'
import { registerProcess, cancelProcess, wasCancelled, clearCancelled, beginBackoff, endBackoff } from './process-manager'
import type { ChildProcess } from 'child_process'

function fakeProc(): ChildProcess {
  const handlers: Record<string, () => void> = {}
  return {
    on: (ev: string, cb: () => void) => {
      handlers[ev] = cb
    },
    kill: vi.fn()
  } as unknown as ChildProcess
}

describe('cancelProcess', () => {
  it('kills the registered process with SIGTERM and marks it cancelled', () => {
    const proc = fakeProc()
    registerProcess('exec-1', proc)

    const ok = cancelProcess('exec-1')

    expect(ok).toBe(true)
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
    expect(wasCancelled('exec-1')).toBe(true)
    clearCancelled('exec-1')
  })

  it('returns false and marks nothing when no process is registered for the id', () => {
    expect(cancelProcess('missing')).toBe(false)
    expect(wasCancelled('missing')).toBe(false)
  })

  it('marks an execution in retry backoff as cancelled even while no process is running', () => {
    beginBackoff('exec-3')

    expect(cancelProcess('exec-3')).toBe(true)
    expect(wasCancelled('exec-3')).toBe(true)

    endBackoff('exec-3')
    clearCancelled('exec-3')
  })

  it('does not mark an execution whose backoff has ended', () => {
    beginBackoff('exec-4')
    endBackoff('exec-4')

    expect(cancelProcess('exec-4')).toBe(false)
    expect(wasCancelled('exec-4')).toBe(false)
  })

  it('clearCancelled removes the cancelled flag', () => {
    registerProcess('exec-2', fakeProc())
    cancelProcess('exec-2')

    clearCancelled('exec-2')

    expect(wasCancelled('exec-2')).toBe(false)
  })
})
