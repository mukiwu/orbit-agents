import { ChildProcess } from 'child_process'

const activeProcesses = new Map<string, ChildProcess>()
// Execution ids the user explicitly cancelled, so executeTask can record them as
// 'cancelled' instead of 'failed' once the killed process closes.
const cancelledIds = new Set<string>()
// Execution ids waiting out a retry backoff, when no provider process is running.
const backoffIds = new Set<string>()

export function beginBackoff(executionId: string): void {
  backoffIds.add(executionId)
}

export function endBackoff(executionId: string): void {
  backoffIds.delete(executionId)
}

export function registerProcess(executionId: string, process: ChildProcess): void {
  activeProcesses.set(executionId, process)

  // Auto-cleanup when process exits
  process.on('close', () => {
    activeProcesses.delete(executionId)
  })
}

export function getProcess(executionId: string): ChildProcess | undefined {
  return activeProcesses.get(executionId)
}

export function unregisterProcess(executionId: string): void {
  activeProcesses.delete(executionId)
}

// Stop a running execution: flag it as cancelled and terminate its process, if any.
// Returns false when the execution has no running process and is not in a retry backoff.
export function cancelProcess(executionId: string): boolean {
  const proc = activeProcesses.get(executionId)
  if (!proc && !backoffIds.has(executionId)) return false

  cancelledIds.add(executionId)
  proc?.kill('SIGTERM')
  return true
}

export function wasCancelled(executionId: string): boolean {
  return cancelledIds.has(executionId)
}

export function clearCancelled(executionId: string): void {
  cancelledIds.delete(executionId)
}
