import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTasks, useAiProvider, useSkills } from '../hooks/useApi'
import type { Task, CreateTaskInput, McpServer, ModelType, Skill, ModelOption } from '../../../shared/types'
import { RefreshCw, Sun, Calendar, CalendarDays, FolderOpen, Sparkles, X } from 'lucide-react'

interface TaskFormProps {
  task: Task | null
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

export default function TaskForm({ task, onClose, onSaved, variant = 'modal' }: TaskFormProps) {
  const { t } = useTranslation()
  const { createTask, updateTask } = useTasks()
  const { listMcps: listAiMcps, listModels } = useAiProvider()
  const { skills, loading: loadingSkills, projectPath, setProjectPath, selectProject, clearProject, scanSkills, initProject } = useSkills()
  const [dynamicModels, setDynamicModels] = useState<ModelOption[]>([])
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [loadingMcps, setLoadingMcps] = useState(false)

  // Parse existing cron to determine initial schedule mode
  const initialSchedule = useMemo(() => {
    return parseCronToSimple(task?.cron_expression || '0 9 * * *')
  }, [task?.cron_expression])

  // Reset form when task changes
  useEffect(() => {
    const parsed = parseCronToSimple(task?.cron_expression || '0 9 * * *')
    setScheduleMode(parsed.mode)
    setFrequency(parsed.frequency)
    setIntervalValue(parsed.intervalValue)
    setIntervalUnit(parsed.intervalUnit)
    setScheduleTime(parsed.time)
    setSelectedWeekdays(parsed.weekdays)
    setWeekInterval(task?.week_interval || parsed.weekInterval)
    setMonthDay(parsed.monthDay)

    if (task) {
        setFormData({
            name: task.name || '',
            description: task.description || '',
            cron_expression: task.cron_expression || '0 9 * * *',
            prompt: task.prompt || '',
            cli_tool: (task.cli_tool || 'claude') as 'claude' | 'codex' | 'antigravity',
            model: (task.model || 'sonnet') as ModelType,
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
            scanSkills(task.project_path)
        } else {
            setProjectPath(null)
            scanSkills()
        }
    } else {
        // Reset to default for new task
        setProjectPath(null)
        scanSkills()
        setFormData({
            name: '',
            description: '',
            cron_expression: '0 9 * * *',
            prompt: '',
            cli_tool: 'claude',
            model: 'sonnet',
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
    model: (task?.model || 'sonnet') as ModelType,
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
    return getScheduleDescription(frequency, intervalValue, intervalUnit, scheduleTime, selectedWeekdays, weekInterval, monthDay)
  }, [frequency, intervalValue, intervalUnit, scheduleTime, selectedWeekdays, weekInterval, monthDay])

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

  // Load user scope skills on mount
  useEffect(() => {
    scanSkills()
  }, [scanSkills])

  const handleSelectSkill = (skill: Skill) => {
    setSelectedSkill(skill)
    setFormData(prev => ({
      ...prev,
      prompt: skill.content
    }))
  }

  const handleClearSkill = () => {
    setSelectedSkill(null)
  }

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

  useEffect(() => {
    const fetchModels = async () => {
      const tool = formData.cli_tool
      try {
        const models = await listModels(tool)
        setDynamicModels(models)
        if (models.length > 0) {
          setFormData((prev) => {
            const isValid = models.some((m) => m.value === prev.model)
            if (!prev.model || !isValid) {
              return { ...prev, model: models[0].value as ModelType }
            }
            return prev
          })
        }
      } catch (err) {
        setDynamicModels([])
      }
    }

    fetchModels()
  }, [formData.cli_tool, listModels])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
        enabled: formData.enabled
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

  const toggleMcpTool = (toolPattern: string) => {
    setFormData((prev) => ({
      ...prev,
      mcp_tools: prev.mcp_tools.includes(toolPattern)
        ? prev.mcp_tools.filter((t: string) => t !== toolPattern)
        : [...prev.mcp_tools, toolPattern]
    }))
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

            {/* Schedule */}
            <div>
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
                              title={day.fullLabel}
                            >
                              {day.label}
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
            </div>

            {/* Skills */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-600">
                  <Sparkles className="w-3.5 h-3.5 inline mr-1" />
                  {t('taskForm.skills.label')} <span className="text-gray-400 font-normal">{t('taskForm.optional')}</span>
                </label>
                <button
                  type="button"
                  onClick={selectProject}
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
                    onClick={clearProject}
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
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((skill) => {
                    const isSelected = selectedSkill?.filePath === skill.filePath
                    return (
                      <button
                        key={skill.filePath}
                        type="button"
                        onClick={() => isSelected ? handleClearSkill() : handleSelectSkill(skill)}
                        title={`${skill.description}${skill.scope === 'project' ? t('taskForm.skills.scopeProject') : t('taskForm.skills.scopeUser')}`}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-all ${
                          isSelected
                            ? 'bg-purple-100 border-purple-300 text-purple-700'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {isSelected && (
                          <svg className="w-3 h-3 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                        {skill.name}
                        {skill.scope === 'project' && (
                          <span className="ml-1 text-xs opacity-60">P</span>
                        )}
                      </button>
                    )
                  })}
                </div>
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
                required
                value={formData.prompt}
                onChange={(e) => setFormData((prev) => ({ ...prev, prompt: e.target.value }))}
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
                      { value: 'claude' as const, label: 'Claude', defaultModel: 'sonnet' as ModelType },
                      { value: 'codex' as const, label: 'Codex', defaultModel: 'gpt-5.3-codex' as ModelType },
                      { value: 'antigravity' as const, label: 'Antigravity', defaultModel: '' as ModelType }
                    ]
                  ).map((tool) => (
                    <button
                      key={tool.value}
                      type="button"
                      onClick={() => {
                        setFormData((prev) => ({
                          ...prev,
                          cli_tool: tool.value,
                          model: tool.defaultModel,
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
                <label className="block text-sm font-medium text-gray-600 mb-2">
                  {t('taskForm.model.label')}
                </label>
                <div className="flex gap-2 flex-wrap">
                  {(() => {
                    return dynamicModels.map((model) => (
                      <button
                        key={model.value}
                        type="button"
                        onClick={() => setFormData((prev) => ({ ...prev, model: model.value as ModelType }))}
                        className={`flex-1 flex flex-col items-center justify-center p-2.5 h-14 border rounded-lg transition-all ${
                          formData.model === model.value
                            ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-sm'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <span className="font-medium text-sm">{model.label}</span>
                        {model.desc && <span className="text-sm opacity-70">{model.desc}</span>}
                      </button>
                    ))
                  })()}
                </div>
              </div>
            </div>

            {/* MCP Tools */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">
                {t('taskForm.mcpTools.label')} <span className="text-gray-400 font-normal">{t('taskForm.optional')}</span>
              </label>
              {loadingMcps ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-600 border-t-transparent"></div>
                  {t('taskForm.mcpTools.loading')}
                </div>
              ) : mcpServers.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {mcpServers.map((server) => {
                    const toolPattern = `mcp__${server.name}__*`
                    const isSelected = formData.mcp_tools.includes(toolPattern)
                    return (
                      <button
                        key={server.name}
                        type="button"
                        onClick={() => toggleMcpTool(toolPattern)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-all ${
                          isSelected
                            ? 'bg-blue-100 border-blue-300 text-blue-700'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {isSelected && (
                          <svg className="w-3 h-3 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                        {server.name}
                      </button>
                    )
                  })}
                </div>
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
            disabled={loading}
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
