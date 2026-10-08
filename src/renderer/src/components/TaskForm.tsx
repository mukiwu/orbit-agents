import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useTasks, useAiProvider, useSkills } from '../hooks/useApi'
import type { ScheduledTask, CreateTaskInput, McpServer, ProviderId, ModelOption, AutomationConfig } from '../../../shared/types'
import { RefreshCw, Sun, Calendar, CalendarDays, FolderOpen, Sparkles, X } from 'lucide-react'
import ModelSelect from './ModelSelect'
import QuickPicker from './QuickPicker'

interface TaskFormProps {
  task: ScheduledTask | null
  nextRun?: string | null
  scheduleEnabled?: boolean
  onClose: () => void
  onSaved?: () => void
  variant?: 'modal' | 'panel'
}

import {
  parseCronToSimple,
  simpleToCron,
  getScheduleDescription,
  WEEKDAYS,
  type ScheduleMode,
  type FrequencyType
} from '../utils/cron'

function normalizeSavedModel(provider: ProviderId | undefined, model: string): string {
  // Older Antigravity builds persisted the full "model-id<TAB>label" row as
  // the selected value. Keep those tasks editable and runnable after ID parsing.
  return provider === 'antigravity' ? model.split('\t', 1)[0].trim() : model
}

function skillInvocation(name: string, provider: ProviderId): string {
  return `${provider === 'codex' ? '$' : '/'}${name}`
}

function removePromptToken(prompt: string, token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return prompt.replace(new RegExp(`(^|\\s)${escaped}([ \\t]?)(?=\\s|$)`, 'g'),
    (match, before: string, _after: string, offset: number) =>
      before === ' ' && offset + match.length === prompt.length ? '' : before
  )
}

function removePromptSnippet(prompt: string, snippet: string): string {
  const index = prompt.indexOf(snippet)
  if (index < 0) return prompt
  const before = prompt.slice(0, index).replace(/\n{1,2}$/, '')
  const after = prompt.slice(index + snippet.length).replace(/^\n{1,2}/, '')
  return before && after ? `${before}\n\n${after}` : before + after
}

const defaultAutomation: AutomationConfig = {
  source: { type: 'schedule' }, result: { type: 'report' },
  require_review: false, fallback_provider: null
}

export default function TaskForm({ task, nextRun, scheduleEnabled, onClose, onSaved, variant = 'modal' }: TaskFormProps) {
  const { t, i18n } = useTranslation()
  const savedNextRun = nextRun === undefined ? task?.next_run : nextRun
  const savedScheduleEnabled = scheduleEnabled ?? task?.enabled === 1
  const { createTask, updateTask } = useTasks()
  const { listMcps: listAiMcps, listModels } = useAiProvider()
  const { skills, loading: loadingSkills, projectPath, setProjectPath, selectProject, clearProject, scanSkills, initProject } = useSkills()
  const [dynamicModels, setDynamicModels] = useState<ModelOption[]>([])
  const [modelsProvider, setModelsProvider] = useState<ProviderId | null>(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [modelListNotice, setModelListNotice] = useState<{ text: string; tone: 'success' | 'warning' | 'error' } | null>(null)
  const modelRequestSequence = useRef(0)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const promptSelectionRef = useRef<{ start: number; end: number } | null>(null)
  const insertedMcpReferencesRef = useRef(new Set<string>())
  const insertedSkillTokensRef = useRef(new Set<string>())

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [loadingMcps, setLoadingMcps] = useState(false)
  const [automation, setAutomation] = useState<AutomationConfig>(task?.automation ? JSON.parse(task.automation) : defaultAutomation)

  // Parse existing cron to determine initial schedule mode
  const initialSchedule = useMemo(() => {
    return parseCronToSimple(task?.cron_expression || '0 9 * * *')
  }, [task?.cron_expression])

  // Reset form when task changes
  useEffect(() => {
    promptSelectionRef.current = null
    insertedMcpReferencesRef.current.clear()
    insertedSkillTokensRef.current.clear()
    const parsed = parseCronToSimple(task?.cron_expression || '0 9 * * *')
    setScheduleMode(parsed.mode)
    setFrequency(parsed.frequency)
    setIntervalValue(parsed.intervalValue)
    setIntervalUnit(parsed.intervalUnit)
    setScheduleTime(parsed.time)
    setSelectedWeekdays(parsed.weekdays)
    setWeekInterval(task?.week_interval || parsed.weekInterval)
    setMonthDay(parsed.monthDay)
    setAutomation(task?.automation ? JSON.parse(task.automation) as AutomationConfig : defaultAutomation)

    if (task) {
        setFormData({
            name: task.name || '',
            description: task.description || '',
            cron_expression: task.cron_expression || '0 9 * * *',
            prompt: task.prompt || '',
            cli_tool: (task.cli_tool || 'claude') as 'claude' | 'codex' | 'antigravity',
            model: normalizeSavedModel(task.cli_tool, task.model || ''),
            mcp_tools: task.mcp_tools ? JSON.parse(task.mcp_tools) : [] as string[],
            attachments: task.attachments ? JSON.parse(task.attachments) : [] as string[],
            output_type: (task.output_type || 'log') as 'log' | 'both',
            email_to: task.email_to || '',
            knowledge_file: task.knowledge_file || '',
            week_interval: task.week_interval ?? 1,
            skip_permissions: task.skip_permissions === 1,
            enabled: task.enabled === 1
        })
        // Restore saved project path or clear it (sync only, scan separately)
        if (task.project_path) {
            setProjectPath(task.project_path)
            scanSkills(task.project_path, task.cli_tool)
        } else {
            setProjectPath(null)
            scanSkills(undefined, task.cli_tool)
        }
    } else {
        // Reset to default for new task
        setProjectPath(null)
        scanSkills(undefined, 'claude')
        setFormData({
            name: '',
            description: '',
            cron_expression: '0 9 * * *',
            prompt: '',
            cli_tool: 'claude',
            model: '',
            mcp_tools: [],
            attachments: [],
            output_type: 'log',
            email_to: '',
            knowledge_file: '',
            week_interval: 1,
            skip_permissions: true,
            enabled: true
         })
    }
  }, [task, setProjectPath, scanSkills])

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(initialSchedule.mode)
  const [frequency, setFrequency] = useState<FrequencyType>(initialSchedule.frequency)
  const [intervalValue, setIntervalValue] = useState(initialSchedule.intervalValue)
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours'>(initialSchedule.intervalUnit)
  const [scheduleTime, setScheduleTime] = useState(initialSchedule.time)
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(initialSchedule.weekdays)
  const [weekInterval, setWeekInterval] = useState(task?.week_interval || initialSchedule.weekInterval)
  const [monthDay, setMonthDay] = useState(initialSchedule.monthDay)

  const [formData, setFormData] = useState({
    name: task?.name || '',
    description: task?.description || '',
    cron_expression: task?.cron_expression || '0 9 * * *',
    prompt: task?.prompt || '',
    cli_tool: (task?.cli_tool || 'claude') as 'claude' | 'codex' | 'antigravity',
    model: task ? normalizeSavedModel(task.cli_tool, task.model || '') : '',
    mcp_tools: task?.mcp_tools ? JSON.parse(task.mcp_tools) : [] as string[],
    attachments: task?.attachments ? JSON.parse(task.attachments) : [] as string[],
    output_type: (task?.output_type || 'log') as 'log' | 'both',
    email_to: task?.email_to || '',
    knowledge_file: task?.knowledge_file || '',
    week_interval: task?.week_interval ?? 1,
    skip_permissions: task ? task.skip_permissions === 1 : true,
    enabled: task ? task.enabled === 1 : true
  })

  // Update cron expression when simple schedule changes
  useEffect(() => {
    if (scheduleMode === 'simple') {
      const newCron = simpleToCron(frequency, intervalValue, intervalUnit, scheduleTime, selectedWeekdays, weekInterval, monthDay)
      setFormData(prev => ({ ...prev, cron_expression: newCron, week_interval: weekInterval }))
    }
  }, [scheduleMode, frequency, intervalValue, intervalUnit, scheduleTime, selectedWeekdays, weekInterval, monthDay])

  const scheduleDescription = useMemo(() => {
    return getScheduleDescription(frequency, intervalValue, intervalUnit, scheduleTime, selectedWeekdays, weekInterval, monthDay, t as (key: string, vars?: Record<string, string | number>) => string)
  }, [frequency, intervalValue, intervalUnit, scheduleTime, selectedWeekdays, weekInterval, monthDay, t])

  const toggleWeekday = (day: number) => {
    setSelectedWeekdays(prev => {
      if (prev.includes(day)) {
        // Don't allow removing the last day
        if (prev.length === 1) return prev
        return prev.filter(d => d !== day)
      }
      return [...prev, day].sort((a, b) => a - b)
    })
  }

  const rememberPromptSelection = () => {
    const textarea = promptRef.current
    if (textarea) promptSelectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd }
  }

  const insertPromptText = (snippet: string) => {
    const text = snippet.trim()
    if (!text) return
    const prompt = formData.prompt
    const selection = promptSelectionRef.current
    const start = selection ? Math.min(selection.start, prompt.length) : prompt.length
    const end = selection ? Math.min(selection.end, prompt.length) : prompt.length
    const before = prompt.slice(0, start)
    const after = prompt.slice(end)
    const leading = before && !before.endsWith('\n') ? '\n\n' : ''
    const trailing = after && !after.startsWith('\n') ? '\n\n' : ''
    const nextPrompt = `${before}${leading}${text}${trailing}${after}`
    const caret = before.length + leading.length + text.length

    setFormData((prev) => ({ ...prev, prompt: nextPrompt }))
    promptSelectionRef.current = { start: caret, end: caret }
    requestAnimationFrame(() => {
      promptRef.current?.focus()
      promptRef.current?.setSelectionRange(caret, caret)
    })
  }

  const insertPromptToken = (token: string) => {
    if (formData.cli_tool !== 'codex') {
      // Slash skills are commands in the CLI prompt, so keep the invocation first.
      const prompt = [...insertedSkillTokensRef.current].reduce(removePromptToken, formData.prompt)
      insertedSkillTokensRef.current.clear()
      const nextPrompt = `${token} ${prompt}`
      const caret = token.length + 1
      setFormData((prev) => ({ ...prev, prompt: nextPrompt }))
      promptSelectionRef.current = { start: caret, end: caret }
      requestAnimationFrame(() => {
        promptRef.current?.focus()
        promptRef.current?.setSelectionRange(caret, caret)
      })
      return
    }

    const prompt = formData.prompt
    const selection = promptSelectionRef.current
    const start = selection ? Math.min(selection.start, prompt.length) : prompt.length
    const end = selection ? Math.min(selection.end, prompt.length) : prompt.length
    const before = prompt.slice(0, start)
    const after = prompt.slice(end)
    const leading = before && !/\s$/.test(before) ? ' ' : ''
    const trailing = !after || !/^\s/.test(after) ? ' ' : ''
    const nextPrompt = `${before}${leading}${token}${trailing}${after}`
    const caret = before.length + leading.length + token.length + trailing.length

    setFormData((prev) => ({ ...prev, prompt: nextPrompt }))
    promptSelectionRef.current = { start: caret, end: caret }
    requestAnimationFrame(() => {
      promptRef.current?.focus()
      promptRef.current?.setSelectionRange(caret, caret)
    })
  }

  const skillPickerItems = useMemo(() => [...skills]
    .sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === 'project' ? -1 : 1))
    .map((skill) => ({
      id: skill.filePath,
      name: skillInvocation(skill.name, formData.cli_tool),
      description: skill.description,
      badge: t(skill.scope === 'project' ? 'taskForm.skills.scopeProject' : 'taskForm.skills.scopeUser')
    })), [skills, formData.cli_tool, t])

  const mcpPickerItems = useMemo(() => {
    const availableNames = new Set(mcpServers.map((server) => server.name))
    const missing = formData.mcp_tools
      .filter((pattern: string) => pattern.startsWith('mcp__') && pattern.endsWith('__*'))
      .map((pattern: string) => pattern.slice(5, -3))
      .filter((name: string) => !availableNames.has(name))
      .map((name: string) => ({
        id: name,
        name,
        badge: t('taskForm.mcpTools.unavailable'),
        selected: true
      }))
    const available = [...mcpServers]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((server) => ({
        id: server.name,
        name: server.name,
        description: server.tools.filter((tool) => tool !== '*').join(', ') || undefined,
        selected: formData.mcp_tools.includes(`mcp__${server.name}__*`)
      }))
    return [...missing, ...available]
  }, [mcpServers, formData.mcp_tools, t])

  useEffect(() => {
    const fetchMcps = async () => {
      setLoadingMcps(true)
      try {
        let servers: McpServer[] = []
        if (formData.cli_tool === 'claude' || formData.cli_tool === 'codex') {
          servers = await listAiMcps(formData.cli_tool)
        }
        // antigravity returns [] — skip the call
        setMcpServers(servers)
      } catch (err) {
        setMcpServers([])
      } finally {
        setLoadingMcps(false)
      }
    }

    fetchMcps()
  }, [formData.cli_tool, listAiMcps])

  const refreshModels = useCallback(async (provider: ProviderId) => {
    const requestSequence = ++modelRequestSequence.current
    setLoadingModels(true)
    setModelListNotice(null)

    try {
      const models = await listModels(provider)
      if (requestSequence !== modelRequestSequence.current) return

      setDynamicModels(models)
      setModelsProvider(provider)
      const showingFallback = models.some((model) => model.stale)
      setModelListNotice({
        text: t(showingFallback ? 'taskForm.model.fallbackNotice' : 'taskForm.model.synced'),
        tone: showingFallback ? 'warning' : 'success'
      })

      if (models.length > 0) {
        setFormData((prev) => {
          if (prev.cli_tool !== provider || models.some((model) => model.value === prev.model)) return prev
          // Keep a saved value visible when a provider removes or renames it.
          if (task?.cli_tool === provider && prev.model) return prev
          const defaultModel = models.find((model) => model.isDefault) || models[0]
          return { ...prev, model: defaultModel.value }
        })
      }
    } catch {
      if (requestSequence === modelRequestSequence.current) {
        setModelListNotice({ text: t('taskForm.model.syncError'), tone: 'error' })
      }
    } finally {
      if (requestSequence === modelRequestSequence.current) setLoadingModels(false)
    }
  }, [listModels, t, task])

  useEffect(() => {
    void refreshModels(formData.cli_tool)
    return () => { modelRequestSequence.current += 1 }
  }, [formData.cli_tool, refreshModels])

  const modelOptions = useMemo(() => {
    const providerModels = modelsProvider === formData.cli_tool ? dynamicModels : []
    if (!formData.model || providerModels.some((model) => model.value === formData.model)) return providerModels
    return [
      { value: formData.model, label: formData.model, desc: t('taskForm.model.unavailable') },
      ...providerModels
    ]
  }, [dynamicModels, formData.cli_tool, formData.model, modelsProvider, t])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loadingModels) return
    if ((automation.require_review || automation.source.type !== 'schedule') && formData.cli_tool === 'antigravity') {
      setError(t('automation.reviewProviderError'))
      return
    }
    setLoading(true)
    setError(null)

    try {
      const input: CreateTaskInput = {
        name: formData.name,
        description: formData.description || undefined,
        cron_expression: formData.cron_expression,
        prompt: formData.prompt,
        cli_tool: formData.cli_tool,
        model: formData.model,
        mcp_tools: formData.mcp_tools.length > 0 ? formData.mcp_tools : undefined,
        attachments: formData.attachments.length > 0 ? formData.attachments : undefined,
        output_type: formData.output_type,
        email_to: formData.email_to || undefined,
        knowledge_file: formData.knowledge_file || undefined,
        project_path: projectPath ?? null,
        skip_permissions: formData.skip_permissions,
        week_interval: weekInterval,
        enabled: formData.enabled,
        automation
      }

      if (task) {
        await updateTask({ id: task.id, ...input })
      } else {
        await createTask(input)
      }

      if (onSaved) {
        onSaved()
      } else {
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('taskForm.errorSave'))
    } finally {
      setLoading(false)
    }
  }

  const toggleMcpTool = (serverName: string) => {
    const toolPattern = `mcp__${serverName}__*`
    const reference = t('taskForm.mcpTools.promptReference', { name: serverName })
    if (formData.mcp_tools.includes(toolPattern)) {
      const removeReference = insertedMcpReferencesRef.current.delete(toolPattern)
      setFormData((prev) => ({
        ...prev,
        mcp_tools: prev.mcp_tools.filter((tool: string) => tool !== toolPattern),
        prompt: removeReference ? removePromptSnippet(prev.prompt, reference) : prev.prompt
      }))
      promptSelectionRef.current = null
    } else {
      setFormData((prev) => ({ ...prev, mcp_tools: [...prev.mcp_tools, toolPattern] }))
      if (!formData.prompt.includes(reference)) {
        insertedMcpReferencesRef.current.add(toolPattern)
        insertPromptText(reference)
      }
    }
  }

  const content = (
      <div className={`${variant === 'modal' ? 'bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden' : 'h-full flex flex-col'}`} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={`px-6 py-4 border-b border-gray-100 flex items-center justify-between ${variant === 'panel' ? '' : ''}`}>
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {task ? t('taskForm.editTitle') : t('taskForm.newTitle')}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">{t('taskForm.subtitle')}</p>
          </div>
          {variant === 'modal' && (
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Form */}
        <form id="task-form" onSubmit={handleSubmit} className={`overflow-y-auto ${variant === 'modal' ? 'max-h-[calc(90vh-140px)]' : 'flex-1 min-h-0'}`}>
          <div className="p-6 space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">
                {t('taskForm.name.label')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                placeholder={t('taskForm.name.placeholder')}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">
                {t('taskForm.description.label')} <span className="text-gray-400 font-normal">{t('taskForm.optional')}</span>
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                placeholder={t('taskForm.description.placeholder')}
              />
            </div>

            {/* Outcome templates and trigger */}
            <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
              <div className="text-sm font-semibold text-gray-800">{t('automation.templates')}</div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => {
                  setAutomation({ source: { type: 'folder', path: '' }, result: { type: 'organize-file', destination: '' }, require_review: true, fallback_provider: null })
                  setFormData(prev => ({ ...prev, name: t('automation.fileTemplateName'), prompt: t('automation.fileTemplatePrompt'), skip_permissions: false }))
                }} className="rounded-lg border border-gray-200 bg-white p-3 text-left text-sm hover:border-blue-300 hover:bg-blue-50">
                  <strong className="block text-gray-900">{t('automation.fileTemplate')}</strong>
                  <span className="text-xs text-gray-500">{t('automation.fileTemplateDesc')}</span>
                </button>
                <button type="button" onClick={() => {
                  setAutomation({ source: { type: 'website', url: '' }, result: { type: 'report' }, require_review: false, fallback_provider: null })
                  setFormData(prev => ({ ...prev, name: t('automation.websiteTemplateName'), prompt: t('automation.websiteTemplatePrompt') }))
                }} className="rounded-lg border border-gray-200 bg-white p-3 text-left text-sm hover:border-blue-300 hover:bg-blue-50">
                  <strong className="block text-gray-900">{t('automation.websiteTemplate')}</strong>
                  <span className="text-xs text-gray-500">{t('automation.websiteTemplateDesc')}</span>
                </button>
              </div>
              <div className="flex gap-2" role="group" aria-label={t('automation.trigger')}>
                {(['schedule', 'folder', 'website'] as const).map(type => (
                  <button type="button" key={type} aria-pressed={automation.source.type === type}
                    onClick={() => setAutomation(prev => ({ ...prev,
                      source: type === 'schedule' ? { type } : type === 'folder' ? { type, path: '' } : { type, url: '' },
                      result: type === 'folder' ? prev.result : { type: 'report' }
                    }))}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ${automation.source.type === type ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
                    {t(`automation.source.${type}`)}
                  </button>
                ))}
              </div>
              {automation.source.type === 'folder' && <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-600">{t('automation.watchFolder')}</label>
                <div className="flex gap-2">
                  <input type="text" required value={automation.source.path} onChange={e => setAutomation(prev => ({ ...prev, source: { type: 'folder', path: e.target.value } }))}
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
                  <button type="button" onClick={() => void window.electronApi.invoke('dialog:open-directory').then(path => {
                    if (path) setAutomation(prev => ({ ...prev, source: { type: 'folder', path } }))
                  })} className="rounded-lg border border-gray-200 bg-white px-3 text-sm">{t('automation.browse')}</button>
                </div>
                <div className="flex gap-2" role="group" aria-label={t('automation.resultLabel')}>
                  {(['report', 'organize-file'] as const).map(type => <button key={type} type="button"
                    aria-pressed={automation.result.type === type}
                    onClick={() => setAutomation(prev => ({ ...prev,
                      result: type === 'report' ? { type } : { type, destination: '' },
                      require_review: type === 'organize-file' ? true : prev.require_review
                    }))}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ${automation.result.type === type ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
                    {t(`automation.result.${type}`)}
                  </button>)}
                </div>
                {automation.result.type === 'organize-file' && <div className="flex gap-2">
                  <input type="text" required placeholder={t('automation.destination')} value={automation.result.destination}
                    onChange={e => setAutomation(prev => ({ ...prev, result: { type: 'organize-file', destination: e.target.value } }))}
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
                  <button type="button" onClick={() => void window.electronApi.invoke('dialog:open-directory').then(path => {
                    if (path) setAutomation(prev => ({ ...prev, result: { type: 'organize-file', destination: path } }))
                  })} className="rounded-lg border border-gray-200 bg-white px-3 text-sm">{t('automation.browse')}</button>
                </div>}
              </div>}
              {automation.source.type === 'website' && <input type="url" required placeholder="https://example.com"
                value={automation.source.url} onChange={e => setAutomation(prev => ({ ...prev, source: { type: 'website', url: e.target.value } }))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />}
              <div className="flex items-center gap-3 text-xs text-gray-600">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={automation.require_review} disabled={automation.result.type === 'organize-file'}
                    onChange={e => setAutomation(prev => ({ ...prev, require_review: e.target.checked }))} />
                  {t('automation.requireReview')}
                </label>
                <span>{t('automation.reviewHint')}</span>
              </div>
              <label className="block text-xs text-gray-600">{t('automation.fallbackProvider')}</label>
              <div className="flex gap-2">
                {([null, 'claude', 'codex', 'antigravity'] as const).map(provider => <button type="button" key={provider ?? 'none'}
                  aria-pressed={automation.fallback_provider === provider}
                  onClick={() => setAutomation(prev => ({ ...prev, fallback_provider: provider }))}
                  className={`rounded-md px-2 py-1 text-xs ${automation.fallback_provider === provider ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
                  {provider ?? t('automation.none')}
                </button>)}
              </div>
            </div>

            {/* Schedule */}
            {automation.source.type !== 'folder' && <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-600">
                  {t('taskForm.schedule.label')} <span className="text-red-500">*</span>
                </label>
                <div className="flex bg-gray-100 rounded-md p-0.5">
                  <button
                    type="button"
                    onClick={() => setScheduleMode('simple')}
                    className={`px-2 py-1 text-sm font-medium rounded transition-all ${
                      scheduleMode === 'simple'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t('taskForm.schedule.simple')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleMode('advanced')}
                    className={`px-2 py-1 text-sm font-medium rounded transition-all ${
                      scheduleMode === 'advanced'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {t('taskForm.schedule.advanced')}
                  </button>
                </div>
              </div>

              {scheduleMode === 'simple' ? (
                <div className="space-y-3 bg-gray-50/70 rounded-lg p-3 border border-gray-200/60">
                  {/* Frequency Type */}
                  <div className="flex gap-1.5">
                    {[
                      { value: 'interval' as FrequencyType, labelKey: 'freqInterval', Icon: RefreshCw },
                      { value: 'daily' as FrequencyType, labelKey: 'freqDaily', Icon: Sun },
                      { value: 'weekly' as FrequencyType, labelKey: 'freqWeekly', Icon: Calendar },
                      { value: 'monthly' as FrequencyType, labelKey: 'freqMonthly', Icon: CalendarDays }
                    ].map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setFrequency(f.value)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-sm font-medium rounded-md border transition-all ${
                          frequency === f.value
                            ? 'bg-blue-100 border-blue-300 text-blue-700'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <f.Icon className="w-3.5 h-3.5" />
                        {t(`taskForm.schedule.${f.labelKey}`)}
                      </button>
                    ))}
                  </div>

                  {/* Interval options */}
                  {frequency === 'interval' && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">{t('taskForm.schedule.every')}</span>
                      <input
                        type="number"
                        min={1}
                        max={intervalUnit === 'minutes' ? 59 : 23}
                        value={intervalValue}
                        onChange={(e) => setIntervalValue(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-center"
                      />
                      <div className="flex bg-white border border-gray-200 rounded-md overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setIntervalUnit('minutes')}
                          className={`px-2 py-1.5 text-sm font-medium transition-colors ${
                            intervalUnit === 'minutes' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {t('taskForm.schedule.minutes')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIntervalUnit('hours')}
                          className={`px-2 py-1.5 text-sm font-medium transition-colors ${
                            intervalUnit === 'hours' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {t('taskForm.schedule.hours')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Time picker for daily only */}
                  {frequency === 'daily' && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">{t('taskForm.schedule.at')}</span>
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className="px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>
                  )}

                  {/* Weekday selector for weekly */}
                  {frequency === 'weekly' && (
                    <div className="space-y-3">
                      {/* Time + Week interval in one row */}
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">{t('taskForm.schedule.at')}</span>
                          <input
                            type="time"
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                            className="px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">{t('taskForm.schedule.every')}</span>
                          <select
                            value={weekInterval}
                            onChange={(e) => setWeekInterval(parseInt(e.target.value))}
                            className="px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                          >
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                            <option value={3}>3</option>
                            <option value={4}>4</option>
                          </select>
                          <span className="text-sm text-gray-600">{weekInterval === 1 ? t('taskForm.schedule.week') : t('taskForm.schedule.weeks')}</span>
                        </div>
                      </div>

                      {/* Day selection */}
                      <div>
                        <span className="text-sm text-gray-600 block mb-1.5">{t('taskForm.schedule.on')}</span>
                        <div className="flex gap-1">
                          {WEEKDAYS.map((day) => (
                            <button
                              key={day.value}
                              type="button"
                              onClick={() => toggleWeekday(day.value)}
                              className={`flex-1 py-1.5 text-sm font-medium rounded-md border transition-all ${
                                selectedWeekdays.includes(day.value)
                                  ? 'bg-blue-100 border-blue-300 text-blue-700'
                                  : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                              }`}
                              title={t(day.fullLabelKey)}
                            >
                              {t(day.labelKey)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Day of month for monthly */}
                  {frequency === 'monthly' && (
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">{t('taskForm.schedule.at')}</span>
                        <input
                          type="time"
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value)}
                          className="px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">{t('taskForm.schedule.onDay')}</span>
                        <select
                          value={monthDay}
                          onChange={(e) => setMonthDay(parseInt(e.target.value))}
                          className="px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        >
                          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Schedule description */}
                  <div className="flex items-center gap-1 pt-1 border-t border-gray-200/60">
                    <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm text-blue-600 font-medium">{scheduleDescription}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    required
                    value={formData.cron_expression}
                    onChange={(e) => setFormData((prev) => ({ ...prev, cron_expression: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono transition-colors"
                    placeholder="* * * * *"
                  />
                  <div className="flex items-start gap-2 text-sm text-gray-400">
                    <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="font-medium text-gray-500">{t('taskForm.schedule.cronFormat')}</p>
                      <p className="mt-1">{t('taskForm.schedule.examplesLabel')} <code className="bg-gray-100 px-1 rounded">0 9 * * *</code> {t('taskForm.schedule.exampleDailyDesc')}, <code className="bg-gray-100 px-1 rounded">*/15 * * * *</code> {t('taskForm.schedule.exampleIntervalDesc')}</p>
                    </div>
                  </div>
                </div>
              )}
              {task && (
                <p className="mt-2 text-xs text-gray-500">
                  {t('taskForm.schedule.savedNextRun')}: {' '}
                  <span className="font-medium text-gray-700">
                    {!savedScheduleEnabled ? t('taskList.paused') : savedNextRun
                      ? new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, {
                        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      }).format(new Date(savedNextRun))
                      : t('taskList.unscheduled')}
                  </span>
                </p>
              )}
            </div>}

            {/* Skills */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="block text-sm font-medium text-gray-600">
                  <Sparkles className="w-3.5 h-3.5 inline mr-1" />
                  {t('taskForm.skills.label')} <span className="text-gray-400 font-normal">{t('taskForm.optional')}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void selectProject(formData.cli_tool)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  {projectPath ? t('taskForm.skills.changeProject') : t('taskForm.skills.selectProject')}
                </button>
              </div>

              {projectPath && (
                <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                  <FolderOpen className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                  <span className="text-blue-700 truncate flex-1" title={projectPath}>
                    {projectPath}
                  </span>
                  <button
                    type="button"
                    onClick={() => void clearProject(formData.cli_tool)}
                    aria-label={t('taskForm.skills.clearProject')}
                    className="text-blue-400 hover:text-blue-600 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {loadingSkills ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-600 border-t-transparent"></div>
                  {t('taskForm.skills.scanning')}
                </div>
              ) : skills.length > 0 ? (
                <QuickPicker
                  items={skillPickerItems}
                  triggerLabel={t('taskForm.skills.openPicker', { count: skills.length })}
                  searchLabel={t('taskForm.skills.searchLabel')}
                  searchPlaceholder={t('taskForm.skills.searchPlaceholder')}
                  emptyLabel={t('taskForm.skills.noResults')}
                  resultsLabel={(count) => t('taskForm.skills.results', { count })}
                  onPick={(id) => {
                    const skill = skills.find((candidate) => candidate.filePath === id)
                    if (skill) {
                      const token = skillInvocation(skill.name, formData.cli_tool)
                      insertPromptToken(token)
                      insertedSkillTokensRef.current.add(token)
                    }
                  }}
                />
              ) : (
                <p className="text-sm text-gray-400">
                  {projectPath ? t('taskForm.skills.noneInProject') : t('taskForm.skills.selectProjectHint')}
                </p>
              )}
            </div>

            {/* Prompt */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">
                {t('taskForm.prompt.label')} <span className="text-red-500">*</span>
              </label>
              <textarea
                ref={promptRef}
                required
                value={formData.prompt}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, prompt: e.target.value }))
                  rememberPromptSelection()
                }}
                onSelect={rememberPromptSelection}
                onClick={rememberPromptSelection}
                onKeyUp={rememberPromptSelection}
                onBlur={rememberPromptSelection}
                rows={8}
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors resize-y"
                placeholder={t('taskForm.prompt.placeholder')}
              />
            </div>

            {/* AI Provider & Model */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-2">
                  {t('taskForm.provider.label')}
                </label>
                <div className="flex gap-2 flex-wrap">
                  {(
                    [
                      { value: 'claude' as const, label: 'Claude' },
                      { value: 'codex' as const, label: 'Codex' },
                      { value: 'antigravity' as const, label: 'Antigravity' }
                    ]
                  ).map((tool) => (
                    <button
                      key={tool.value}
                      type="button"
                      onClick={() => {
                        if (formData.cli_tool === tool.value) return
                        const insertedReferences = [...insertedMcpReferencesRef.current].map((pattern) =>
                          t('taskForm.mcpTools.promptReference', { name: pattern.slice(5, -3) })
                        )
                        const insertedSkillTokens = [...insertedSkillTokensRef.current]
                        insertedMcpReferencesRef.current.clear()
                        insertedSkillTokensRef.current.clear()
                        promptSelectionRef.current = null
                        void scanSkills(projectPath ?? undefined, tool.value)
                        setLoadingModels(true)
                        setDynamicModels([])
                        setModelsProvider(null)
                        setModelListNotice(null)
                        setFormData((prev) => ({
                          ...prev,
                          cli_tool: tool.value,
                          model: '',
                          prompt: insertedSkillTokens.reduce(removePromptToken, insertedReferences.reduce(removePromptSnippet, prev.prompt)),
                          mcp_tools: []
                        }))
                      }}
                      className={`flex-1 flex items-center justify-center p-2.5 h-14 border rounded-lg transition-all ${
                        formData.cli_tool === tool.value
                          ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-sm'
                          : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <span className="font-medium text-sm">{tool.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span id="task-model-label" className="block text-sm font-medium text-gray-600">
                    {t('taskForm.model.label')}
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshModels(formData.cli_tool)}
                    disabled={loadingModels}
                    aria-label={t(loadingModels ? 'taskForm.model.refreshing' : 'taskForm.model.refresh')}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:text-gray-400"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingModels ? 'animate-spin' : ''}`} />
                    {t(loadingModels ? 'taskForm.model.refreshing' : 'taskForm.model.refresh')}
                  </button>
                </div>
                {loadingModels ? (
                  <div role="status" aria-live="polite" className="w-full h-14 px-3 flex items-center gap-2 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg">
                    <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                    {t('taskForm.model.loading')}
                  </div>
                ) : (
                  <ModelSelect
                    value={formData.model}
                    options={modelOptions}
                    onChange={(model) => setFormData((prev) => ({ ...prev, model }))}
                    labelId="task-model-label"
                    emptyLabel={t('taskForm.model.empty')}
                    defaultLabel={t('taskForm.model.default')}
                  />
                )}
                {modelListNotice && (
                  <p role="status" className={`mt-1.5 text-xs ${modelListNotice.tone === 'success' ? 'text-emerald-700' : modelListNotice.tone === 'warning' ? 'text-amber-700' : 'text-red-600'}`}>
                    {modelListNotice.text}
                  </p>
                )}
              </div>
            </div>

            {/* MCP Tools */}
            <div>
              <span className="block text-sm font-medium text-gray-600 mb-2">
                {t('taskForm.mcpTools.label')} <span className="text-gray-400 font-normal">{t('taskForm.optional')}</span>
              </span>
              {loadingMcps ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-600 border-t-transparent"></div>
                  {t('taskForm.mcpTools.loading')}
                </div>
              ) : mcpPickerItems.length > 0 ? (
                <QuickPicker
                  items={mcpPickerItems}
                  triggerLabel={t('taskForm.mcpTools.openPicker', { count: mcpPickerItems.length, selected: formData.mcp_tools.length })}
                  searchLabel={t('taskForm.mcpTools.searchLabel')}
                  searchPlaceholder={t('taskForm.mcpTools.searchPlaceholder')}
                  emptyLabel={t('taskForm.mcpTools.noResults')}
                  resultsLabel={(count) => t('taskForm.mcpTools.results', { count })}
                  onPick={toggleMcpTool}
                />
              ) : (
                <p className="text-sm text-gray-400">
                  {t('taskForm.mcpTools.noneConfigured', { tool: formData.cli_tool })}
                </p>
              )}
            </div>

            {/* Attachments */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">
                {t('taskForm.attachments.label')} <span className="text-gray-400 font-normal">{t('taskForm.optional')}</span>
              </label>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={async () => {
                    const files = await (window.electronApi.invoke as (channel: string) => Promise<string[]>)('dialog:open-files')
                    if (files.length > 0) {
                      setFormData((prev) => ({
                        ...prev,
                        attachments: [...prev.attachments, ...files]
                      }))
                    }
                  }}
                  className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 flex items-center gap-1.5 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  {t('taskForm.attachments.addFiles')}
                </button>
                {formData.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {formData.attachments.map((filePath: string, index: number) => (
                      <div key={index} className="flex items-center gap-1.5 bg-gray-100 px-2 py-1 rounded-md text-sm text-gray-700">
                        <span className="truncate max-w-[150px]" title={filePath}>
                          {filePath.split('/').pop()}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              attachments: prev.attachments.filter((_: string, i: number) => i !== index)
                            }))
                          }}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Output Type */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">
                {t('taskForm.output.label')}
              </label>
              <div className="flex gap-2">
                {(['log', 'both'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, output_type: type }))}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border rounded-lg transition-all text-sm font-medium ${
                      formData.output_type === type
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {type === 'log' && t('taskForm.output.logOnly')}
                    {type === 'both' && t('taskForm.output.logAndEmail')}
                  </button>
                ))}
              </div>
            </div>

            {/* Email To (conditional) */}
            {formData.output_type === 'both' && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">
                  {t('taskForm.emailTo.label')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.email_to}
                  onChange={(e) => setFormData((prev) => ({ ...prev, email_to: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                  placeholder={t('taskForm.emailTo.placeholder')}
                />
              </div>
            )}

            {/* Knowledge */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-600">
                  {t('taskForm.knowledge.label')} <span className="text-gray-400 font-normal">{t('taskForm.optional')}</span>
                </label>
                <button
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, knowledge_file: prev.knowledge_file ? '' : `~/knowledge/${formData.name ? formData.name.toLowerCase().replace(/\s+/g, '-') : 'task'}.md` }))}
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    formData.knowledge_file ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      formData.knowledge_file ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {formData.knowledge_file && (
                <div className="space-y-1.5">
                  <p className="text-sm text-gray-500">{t('taskForm.knowledge.description')}</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formData.knowledge_file}
                      onChange={(e) => setFormData((prev) => ({ ...prev, knowledge_file: e.target.value }))}
                      className="flex-1 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono transition-colors"
                      placeholder={t('taskForm.knowledge.placeholder')}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const defaultName = formData.name ? formData.name.toLowerCase().replace(/\s+/g, '-') : 'task'
                        const filePath = await (window.electronApi.invoke as (channel: string, ...args: unknown[]) => Promise<string | null>)('dialog:save-file', `${defaultName}.md`)
                        if (filePath) {
                          setFormData((prev) => ({ ...prev, knowledge_file: filePath }))
                        }
                      }}
                      className="px-3 py-2 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors whitespace-nowrap"
                    >
                      {t('taskForm.knowledge.browse')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Permission mode */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-pressed={automation.require_review || automation.source.type !== 'schedule' ? false : formData.skip_permissions}
                  aria-label={t('taskForm.permissions.label')}
                  disabled={automation.require_review || automation.source.type !== 'schedule'}
                  onClick={() => setFormData((prev) => ({ ...prev, skip_permissions: !prev.skip_permissions }))}
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    formData.skip_permissions ? 'bg-amber-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      formData.skip_permissions ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
                <label className="text-sm font-medium text-gray-700">
                  {t('taskForm.permissions.label')}
                </label>
              </div>
              <p className="text-xs text-amber-800">{automation.require_review || automation.source.type !== 'schedule' ? t('automation.readOnlyMode') : t('taskForm.permissions.description')}</p>
            </div>

            {/* Enabled */}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, enabled: !prev.enabled }))}
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  formData.enabled ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    formData.enabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
              <label className="text-sm text-gray-600">
                {t('taskForm.enable.label')}
              </label>
            </div>
          </div>
        </form>

        {/* Footer - Fixed at bottom */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 bg-white flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="task-form"
            disabled={loading || loadingModels}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading && (
              <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></div>
            )}
            {task ? t('taskForm.saveChanges') : t('taskForm.createTask')}
          </button>
        </div>
      </div>

  )

  if (variant === 'panel') {
    return content
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      {content}
    </div>
  )
}
