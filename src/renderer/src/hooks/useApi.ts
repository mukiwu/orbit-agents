import { useState, useCallback, useEffect } from 'react'
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  ExecutionLog,
  ExecutionLogWithTask,
  Settings,
  McpServer,
  Skill,
  SkillScanResult,
  ProviderId,
  ProviderTestResult,
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

  // Stop a running execution. The final 'cancelled' status arrives via the
  // execution:update push once the killed process closes.
  const cancel = useCallback((): Promise<boolean> => api.invoke('log:cancel', id), [id])

  return { log, loading, error, refetch: fetchLog, cancel }
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

export function useAiProvider() {
  const test = useCallback(
    (provider: ProviderId): Promise<ProviderTestResult> => api.invoke('ai:test', provider),
    []
  )
  const listMcps = useCallback(
    (provider: ProviderId): Promise<McpServer[]> => api.invoke('ai:list-mcps', provider),
    []
  )
  const listModels = useCallback(
    (provider: ProviderId): Promise<ModelOption[]> => api.invoke('ai:list-models', provider),
    []
  )
  return { test, listMcps, listModels }
}

// ============ Skills Hooks ============

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(false)
  const [projectPath, setProjectPath] = useState<string | null>(null)

  const scanSkills = useCallback(async (path?: string) => {
    setLoading(true)
    try {
      const result: SkillScanResult = await api.invoke('skill:scan', path)
      setSkills(result.skills)
      if (result.projectPath) setProjectPath(result.projectPath)
      return result
    } catch (err) {
      console.error('Failed to scan skills:', err)
      return { skills: [], errors: [String(err)] }
    } finally {
      setLoading(false)
    }
  }, [])

  const selectProject = useCallback(async () => {
    const dirPath = await (api.invoke as (channel: string) => Promise<string | null>)('dialog:open-directory')
    if (dirPath) {
      setProjectPath(dirPath)
      await scanSkills(dirPath)
      return dirPath
    }
    return null
  }, [scanSkills])

  const clearProject = useCallback(async () => {
    setProjectPath(null)
    await scanSkills()
  }, [scanSkills])

  const initProject = useCallback(async (path: string) => {
    setProjectPath(path)
    await scanSkills(path)
  }, [scanSkills])

  return { skills, loading, projectPath, setProjectPath, scanSkills, selectProject, clearProject, initProject }
}
