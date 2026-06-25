import { ChildProcess } from 'child_process'

const activeProcesses = new Map<string, ChildProcess>()

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
