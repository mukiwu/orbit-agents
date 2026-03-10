import { useState, useCallback, useEffect } from 'react'
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  ExecutionLog,
  ExecutionLogWithTask,
  Settings,
  ClaudeCliResult,
  GeminiCliResult,
  CodexCliResult,
  McpServer,
  ModelOption
} from '../../../shared/types'

const api = window.electronApi

// ============ Task Hooks ============

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.invoke('task:list')
      setTasks(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const createTask = useCallback(async (input: CreateTaskInput): Promise<Task> => {
    const task = await api.invoke('task:create', input)
    setTasks((prev) => [task, ...prev])
    return task
  }, [])

  const updateTask = useCallback(async (input: UpdateTaskInput): Promise<Task> => {
    const task = await api.invoke('task:update', input)
    setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    return task
  }, [])

  const deleteTask = useCallback(async (id: string): Promise<void> => {
    await api.invoke('task:delete', id)
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toggleTask = useCallback(async (id: string): Promise<Task> => {
    const task = await api.invoke('task:toggle', id)
    setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    return task
  }, [])

  const runTaskNow = useCallback(async (id: string): Promise<ExecutionLog> => {
    return api.invoke('task:run-now', id)
  }, [])

  return {
    tasks,
    loading,
    error,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    runTaskNow
  }
}

// ============ Execution Log Hooks ============

export function useExecutionLogs(taskId?: string, limit = 100) {
  const [logs, setLogs] = useState<ExecutionLogWithTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.invoke('log:list', taskId, limit)
      setLogs(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs')
    } finally {
      setLoading(false)
    }
  }, [taskId, limit])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  // Listen for execution updates
  useEffect(() => {
    const handleUpdate = (log: ExecutionLog) => {
      setLogs((prev) => {
        const exists = prev.find((l) => l.id === log.id)
        if (exists) {
          return prev.map((l) => (l.id === log.id ? { ...l, ...log } : l))
        }
        return [log as ExecutionLogWithTask, ...prev]
      })
    }

    api.on('execution:update', handleUpdate as (...args: unknown[]) => void)
    return () => {
      api.off('execution:update', handleUpdate as (...args: unknown[]) => void)
    }
  }, [])

  const deleteLogs = useCallback(async (ids: string[]) => {
    try {
      await api.invoke('log:delete', ids)
      setLogs((prev) => prev.filter((l) => !ids.includes(l.id)))
    } catch (err) {
      console.error('Failed to delete logs:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete logs')
    }
  }, [])

  return { logs, loading, error, fetchLogs, deleteLogs }
}

export function useExecutionLog(id: string) {
  const [log, setLog] = useState<ExecutionLog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLog = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.invoke('log:get', id)
      setLog(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch log')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchLog()
  }, [fetchLog])

  // Listen for updates to this specific log
  useEffect(() => {
    const handleUpdate = (updatedLog: ExecutionLog) => {
      if (updatedLog.id === id) {
        setLog(updatedLog)
      }
    }

    api.on('execution:update', handleUpdate as (...args: unknown[]) => void)
    return () => {
      api.off('execution:update', handleUpdate as (...args: unknown[]) => void)
    }
  }, [id])

  return { log, loading, error, refetch: fetchLog }
}

// ============ Settings Hooks ============

export function useSettings() {
  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.invoke('settings:get')
      setSettings(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const updateSettings = useCallback(async (newSettings: Partial<Settings>): Promise<void> => {
    await api.invoke('settings:update', newSettings)
    setSettings((prev) => ({ ...prev, ...newSettings }))
  }, [])

  const testEmail = useCallback(async (toAddress: string): Promise<void> => {
    await (api.invoke as (channel: string, ...args: unknown[]) => Promise<void>)(
      'settings:test-email',
      toAddress
    )
  }, [])

  return { settings, loading, error, fetchSettings, updateSettings, testEmail }
}

// ============ Claude CLI Hooks ============

export function useClaudeCli() {
  const testConnection = useCallback(async (): Promise<ClaudeCliResult> => {
    return api.invoke('claude:test')
  }, [])

  const listMcps = useCallback(async (): Promise<McpServer[]> => {
    return api.invoke('claude:list-mcps')
  }, [])

  return { testConnection, listMcps }
}

export function useGeminiCli() {
  const testConnection = useCallback(async (): Promise<GeminiCliResult> => {
    return api.invoke('gemini:test')
  }, [])

  const listMcps = useCallback(async (): Promise<McpServer[]> => {
    return api.invoke('gemini:list-mcps')
  }, [])

  return { testConnection, listMcps }
}

export function useCodexCli() {
  const testConnection = useCallback(async (): Promise<CodexCliResult> => {
    return api.invoke('codex:test')
  }, [])

  const listMcps = useCallback(async (): Promise<McpServer[]> => {
    return api.invoke('codex:list-mcps')
  }, [])

  const listModels = useCallback(async (): Promise<ModelOption[]> => {
    return api.invoke('codex:list-models')
  }, [])

  return { testConnection, listMcps, listModels }
}

export function useProcessInput() {
  const sendInput = useCallback(async (executionId: string, input: string): Promise<boolean> => {
    return api.invoke('task:process-input', executionId, input)
  }, [])
  return { sendInput }
}
