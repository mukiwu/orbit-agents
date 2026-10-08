import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { useTranslation } from 'react-i18next'
import { useExecutionLog } from '../hooks/useApi'
import { linkifyIframes, safeMarkdownUrl } from '../utils/markdown'
import { formatDuration } from '../utils/duration'
import { classifyProviderFailure } from '../../../shared/provider-failure'
import type { ExecutionLog, ExecutionLogWithTask, RunSnapshot, ProviderId } from '../../../shared/types'

const pageSize = 50
type StatusFilter = ExecutionLog['status'] | 'all'

export default function ExecutionLog({ initialLogId = null }: { initialLogId?: string | null }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage || i18n.language
  const [logs, setLogs] = useState<ExecutionLogWithTask[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedLogId, setSelectedLogId] = useState<string | null>(initialLogId)
  const [selectedLogFallback, setSelectedLogFallback] = useState<ExecutionLogWithTask | null>(null)
  const [checkedLogIds, setCheckedLogIds] = useState<Set<string>>(new Set())
  const requestId = useRef(0)
  const loadedCount = useRef(pageSize)
  const hasMounted = useRef(false)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const checkedVisibleCount = logs.filter((log) => checkedLogIds.has(log.id)).length

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = checkedVisibleCount > 0 && checkedVisibleCount < logs.length
    }
  }, [checkedVisibleCount, logs.length])

  useEffect(() => {
    setCheckedLogIds((previous) => {
      const visible = new Set(logs.map((log) => log.id))
      const next = new Set([...previous].filter((id) => visible.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [logs])

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const fetchLogs = useCallback(async (offset: number, limit: number, append = false, quiet = false) => {
    const currentRequest = ++requestId.current
    if (append) setLoadingMore(true)
    else if (!quiet) setLoading(true)
    try {
      const result = await window.electronApi.invoke('log:search', {
        query, status: statusFilter, offset, limit
      })
      if (currentRequest !== requestId.current) return
      setLogs((previous) => append
        ? [...new Map([...previous, ...result.logs].map((log) => [log.id, log])).values()]
        : result.logs)
      setTotal(result.total)
      loadedCount.current = offset + result.logs.length
      setError(null)
    } catch (cause) {
      if (currentRequest === requestId.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [query, statusFilter])

  useEffect(() => {
    loadedCount.current = pageSize
    setCheckedLogIds(new Set())
    if (hasMounted.current) {
      setSelectedLogId(null)
      setSelectedLogFallback(null)
    } else {
      hasMounted.current = true
    }
    void fetchLogs(0, pageSize)
  }, [fetchLogs])

  useEffect(() => {
    let pending: number | null = null
    const onExecutionUpdate = () => {
      if (pending !== null) return
      pending = window.setTimeout(() => {
        pending = null
        void fetchLogs(0, Math.max(pageSize, loadedCount.current), false, true)
      }, 1200)
    }
    window.electronApi.on('execution:update', onExecutionUpdate)
    return () => {
      if (pending !== null) window.clearTimeout(pending)
      window.electronApi.off('execution:update', onExecutionUpdate)
    }
  }, [fetchLogs])

  useEffect(() => {
    if (!loading && logs.length > 0 && !selectedLogId) setSelectedLogId(logs[0].id)
  }, [logs, loading, selectedLogId])

  useEffect(() => {
    if (!initialLogId || selectedLogId !== initialLogId || logs.some((log) => log.id === initialLogId) || selectedLogFallback?.id === initialLogId) return
    let cancelled = false
    void window.electronApi.invoke('log:get', initialLogId).then((log) => {
      if (!cancelled) setSelectedLogFallback(log)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [initialLogId, logs, selectedLogFallback, selectedLogId])

  const dateGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; logs: ExecutionLogWithTask[] }> = []
    for (const log of logs) {
      const date = new Date(log.started_at)
      const key = `${date.getFullYear()}-${date.getMonth()}`
      if (groups[groups.length - 1]?.key !== key) {
        const label = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(date)
        groups.push({ key, label, logs: [] })
      }
      groups[groups.length - 1].logs.push(log)
    }
    return groups
  }, [logs, locale])

  const selectedLog = logs.find(l => l.id === selectedLogId)
    || (selectedLogFallback?.id === selectedLogId ? selectedLogFallback : null)

  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: t('executionLog.filter.all') },
    { value: 'running', label: t('common.running') },
    { value: 'failed', label: t('common.failed') },
    { value: 'success', label: t('common.done') },
    { value: 'pending_review', label: t('automation.pendingReview') },
    { value: 'cancelled', label: t('common.cancelled') }
  ]

  const handleCheck = (id: string, checked: boolean) => {
    const newChecked = new Set(checkedLogIds)
    if (checked) {
      newChecked.add(id)
    } else {
      newChecked.delete(id)
    }
    setCheckedLogIds(newChecked)
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setCheckedLogIds(new Set(logs.map(l => l.id)))
    } else {
      setCheckedLogIds(new Set())
    }
  }

  const handleDeleteSelected = async () => {
    if (checkedLogIds.size === 0) return
    if (!confirm(t('executionLog.confirmDelete', { count: checkedLogIds.size }))) return

    const idsToDelete = Array.from(checkedLogIds)
    try {
      await window.electronApi.invoke('log:delete', idsToDelete)
      setCheckedLogIds(new Set())
      if (selectedLogId && idsToDelete.includes(selectedLogId)) {
        setSelectedLogId(null)
        setSelectedLogFallback(null)
      }
      await fetchLogs(0, Math.max(pageSize, loadedCount.current), false, true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="flex h-full gap-6">
      {/* Left Panel - Log List */}
      <div className="w-[clamp(290px,32vw,380px)] flex-shrink-0 flex flex-col min-h-0">
        {/* List Header */}
        <div className="shrink-0 space-y-3 pb-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900">{t('executionLog.listTitle')}</h2>
            <span className="text-xs tabular-nums text-gray-400">{t('executionLog.shown', { shown: logs.length, total })}</span>
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)}
              aria-label={t('executionLog.searchPlaceholder')} placeholder={t('executionLog.searchPlaceholder')}
              className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100" />
          </label>
          <div className="flex gap-1 overflow-x-auto pb-0.5" role="group" aria-label={t('executionLog.filter.label')}>
            {statusOptions.map((option) => <button key={option.value} type="button" onClick={() => setStatusFilter(option.value)}
              aria-pressed={statusFilter === option.value}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${statusFilter === option.value ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}>
              {option.label}
            </button>)}
          </div>
          <div className="flex min-h-7 items-center justify-between gap-2 text-xs">
            <label className="inline-flex items-center gap-2 text-gray-500">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                ref={selectAllRef}
                checked={logs.length > 0 && checkedVisibleCount === logs.length}
                onChange={(event) => handleSelectAll(event.target.checked)} disabled={logs.length === 0} />
              {t('executionLog.selectVisible')}
            </label>
            {checkedLogIds.size > 0 && <button type="button" onClick={() => void handleDeleteSelected()}
              className="rounded-md px-2 py-1 font-medium text-red-600 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500">
              {t('executionLog.deleteSelected', { count: checkedLogIds.size })}
            </button>}
          </div>
        </div>

        {/* Log List */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-2">
          {error && <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
          {loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />{t('common.loading')}</div>
            : logs.length === 0 ? <div className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
              <p>{query || statusFilter !== 'all' ? t('executionLog.noMatching') : t('executionLog.noLogsFound')}</p>
              {(query || statusFilter !== 'all') && <button type="button" onClick={() => { setSearchInput(''); setQuery(''); setStatusFilter('all') }} className="mt-2 font-medium text-blue-600 hover:underline">{t('executionLog.clearFilters')}</button>}
            </div> : <>
              {dateGroups.map((group) => <div key={group.key}>
                <div className="sticky top-0 z-10 bg-white/95 px-3 pb-1 pt-3 text-xs font-semibold text-gray-400 backdrop-blur-sm">{group.label}</div>
                <div className="space-y-1">
                  {group.logs.map((log) => <LogListItem key={log.id} log={log} locale={locale}
                    isSelected={selectedLogId === log.id} isChecked={checkedLogIds.has(log.id)}
                    onCheck={(checked) => handleCheck(log.id, checked)} onClick={() => setSelectedLogId(log.id)} />)}
                </div>
              </div>)}
              {logs.length < total && <button type="button" onClick={() => void fetchLogs(logs.length, pageSize, true)} disabled={loadingMore}
                className="my-4 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50">
                {loadingMore ? t('common.loading') : t('executionLog.loadMore')}
              </button>}
            </>}
        </div>
      </div>

      {/* Right Panel - Log Detail */}
      <div className="flex-1 bg-gray-50/50 rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-hidden min-w-0">
        {selectedLog ? (
          <LogDetail key={selectedLog.id} log={selectedLog} onNewLog={newLog => {
            setSelectedLogId(newLog.id)
            setSelectedLogFallback({ ...newLog, task_name: selectedLog.task_name })
            void fetchLogs(0, Math.max(pageSize, loadedCount.current), false, true)
          }} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center">
            <div className="w-16 h-16 bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-gray-900 font-medium mb-1">{t('executionLog.noLogSelected')}</h3>
            <p className="text-sm max-w-xs mx-auto">{t('executionLog.noLogSelectedDesc')}</p>
          </div>
        )}
      </div>
    </div>
  )
}

interface LogListItemProps {
  log: ExecutionLogWithTask
  locale: string
  isSelected: boolean
  isChecked: boolean
  onCheck: (checked: boolean) => void
  onClick: () => void
}

function LogListItem({ log, locale, isSelected, isChecked, onCheck, onClick }: LogListItemProps) {
  const { t } = useTranslation()
  const statusColors: Record<ExecutionLog['status'], string> = {
    running: 'bg-blue-500',
    success: 'bg-emerald-500',
    pending_review: 'bg-violet-500',
    failed: 'bg-red-500',
    cancelled: 'bg-amber-500'
  }
  const statusLabel = log.status === 'running' ? t('common.running') : log.status === 'success' ? t('common.done') : log.status === 'pending_review' ? t('automation.pendingReview') : log.status === 'cancelled' ? t('common.cancelled') : t('common.failed')
  const date = new Date(log.started_at)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const dateLabel = date.toDateString() === today.toDateString() ? t('executionLog.today')
    : date.toDateString() === yesterday.toDateString() ? t('executionLog.yesterday')
      : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
  const duration = log.finished_at ? formatDuration(log.started_at, log.finished_at) : null

  return (
    <div className={`flex min-h-[62px] items-center gap-2 rounded-lg px-2 transition-colors ${isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-gray-50'}`}>
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        checked={isChecked}
        onChange={(event) => onCheck(event.target.checked)}
        aria-label={t('executionLog.selectLog', { name: log.task_name || t('executionLog.unknownTask') })}
      />
      <button type="button" onClick={onClick} aria-pressed={isSelected}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
        <span className={`relative h-2 w-2 shrink-0 rounded-full ${statusColors[log.status]}`}>
          {log.status === 'running' && <span className="absolute inset-0 animate-ping rounded-full bg-blue-400 opacity-60" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${isSelected ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`} title={log.task_name || t('executionLog.unknownTask')}>
            {log.task_name || t('executionLog.unknownTask')}
          </span>
          <span className="mt-0.5 block text-xs tabular-nums text-gray-400">{dateLabel} · {time}{duration ? ` · ${duration}` : ''}</span>
        </span>
        <span className={`shrink-0 text-xs font-medium ${log.status === 'failed' ? 'rounded bg-red-50 px-1.5 py-1 text-red-700' : log.status === 'running' ? 'text-blue-700' : log.status === 'pending_review' ? 'text-violet-700' : log.status === 'cancelled' ? 'text-amber-700' : 'text-emerald-700'}`}>
          {statusLabel}
        </span>
      </button>
    </div>
  )
}

interface LogDetailProps {
  log: ExecutionLogWithTask
  onNewLog: (log: ExecutionLog) => void
}

function LogDetail({ log: initialLog, onNewLog }: LogDetailProps) {
  const { t, i18n } = useTranslation()
  const { log: liveLog, cancel } = useExecutionLog(initialLog.id)
  const log = liveLog ? { ...initialLog, ...liveLog } : initialLog
  const outputEndRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void window.electronApi.invoke('log:snapshot', initialLog.id).then(value => {
      if (active) setSnapshot(value)
    }).catch(() => { if (active) setSnapshot(null) })
    return () => { active = false }
  }, [initialLog.id, log.status])

  const review = async (approve: boolean) => {
    setActionBusy(true)
    setActionError(null)
    try {
      await window.electronApi.invoke('log:review', log.id, approve)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally { setActionBusy(false) }
  }

  const replay = async (provider?: ProviderId) => {
    if (!confirm(t('automation.replayConfirm'))) return
    setActionBusy(true)
    setActionError(null)
    try {
      const next = await window.electronApi.invoke('log:replay', log.id, provider)
      onNewLog(next)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally { setActionBusy(false) }
  }

  const resumeDelivery = async () => {
    if (!confirm(t('automation.resumeConfirm'))) return
    setActionBusy(true)
    setActionError(null)
    try {
      const next = await window.electronApi.invoke('log:resume-delivery', log.id)
      onNewLog(next)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally { setActionBusy(false) }
  }

  useEffect(() => {
    if (log.status === 'running' && outputEndRef.current) {
      outputEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [log.output, log.status])

  const handleCopy = async () => {
    if (log.output) {
      await navigator.clipboard.writeText(log.output)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleCancel = async () => {
    if (!confirm(t('executionLog.confirmStop'))) return
    await cancel()
  }

  // Extract current activity from output
  const extractCurrentActivity = (output: string): string => {
    if (!output || output.trim().length === 0) {
      return t('executionLog.activity.initializing')
    }

    const lines = output.split('\n').filter(line => line.trim().length > 0)
    const lastLine = lines[lines.length - 1] || ''

    // Pattern 1: "I will..." statements (including "I will start by...")
    const willMatch = lastLine.match(/i\s+will\s+(?:start\s+by\s+)?(.+?)(?:\.|$)/i)
    if (willMatch) {
      const action = willMatch[1].trim()
      const actionMap: Record<string, string> = {
        'search': t('executionLog.activity.searching'),
        'fetch': t('executionLog.activity.fetching'),
        'analyze': t('executionLog.activity.analyzing'),
        'access': t('executionLog.activity.accessing'),
        'check': t('executionLog.activity.checking'),
        'list': t('executionLog.activity.listing'),
        'get': t('executionLog.activity.getting'),
        'read': t('executionLog.activity.reading'),
        'process': t('executionLog.activity.processingAction'),
        'execute': t('executionLog.activity.executing'),
        'connect': t('executionLog.activity.connecting'),
        'query': t('executionLog.activity.querying'),
        'calculate': t('executionLog.activity.calculating'),
        'generate': t('executionLog.activity.generating'),
        'create': t('executionLog.activity.creating'),
        'update': t('executionLog.activity.updating'),
        'retrieve': t('executionLog.activity.retrieving'),
        'confirm': t('executionLog.activity.confirming'),
        'identify': t('executionLog.activity.identifying')
      }

      // Try to extract specific objects (GA4, schema, data, etc.)
      const objectPatterns = [
        { pattern: /ga4\s+(schema|metadata|data|dimension|metric)/i, label: 'GA4' },
        { pattern: /the\s+ga4\s+(schema|metadata)/i, label: t('executionLog.activity.ga4Schema') },
        { pattern: /performance\s+data/i, label: t('executionLog.activity.performanceData') },
        { pattern: /(dimension|metric)\s+names?/i, label: t('executionLog.activity.dimensionsMetrics') },
        { pattern: /high-traffic\s+articles?/i, label: t('executionLog.activity.highTrafficArticles') },
        { pattern: /engagement\s+(data|metrics?)/i, label: t('executionLog.activity.engagementData') },
        { pattern: /bounce\s+rates?/i, label: t('executionLog.activity.bounceRate') }
      ]

      for (const objPattern of objectPatterns) {
        if (action.match(objPattern.pattern)) {
          for (const [key, value] of Object.entries(actionMap)) {
            if (action.toLowerCase().includes(key)) {
              return `${value} ${objPattern.label}...`
            }
          }
        }
      }

      // Fallback: extract action verb and object
      for (const [key, value] of Object.entries(actionMap)) {
        if (action.toLowerCase().includes(key)) {
          // Try to extract object after the verb
          const objectMatch = action.match(new RegExp(`${key}\\s+(?:the|a|an)?\\s*(.+?)(?:\\s+to|\\s+for|\\s+and|$|\\s+to\\s+confirm|\\s+to\\s+check)`, 'i'))
          if (objectMatch && objectMatch[1]) {
            const object = objectMatch[1].trim()
            // Shorten long objects
            const shortObject = object.length > 30 ? object.substring(0, 30) + '...' : object
            return `${value} ${shortObject}...`
          }
          return `${value}...`
        }
      }

      // If no action found, show the first part of the action
      const shortAction = action.length > 40 ? action.substring(0, 40) + '...' : action
      return t('executionLog.activity.executingAction', { action: shortAction })
    }

    // Pattern 2: Chinese action patterns "正在..." or "將要..."
    // These strings are matched from raw CLI output text, not authored UI copy — passthrough as-is
    const chineseMatch = lastLine.match(/(正在|將要|開始)(.+?)(?:[。，\.]|$)/)
    if (chineseMatch) {
      return `${chineseMatch[1]}${chineseMatch[2]}...`
    }

    // Pattern 3: "Searching...", "Fetching...", etc.
    const ingMatch = lastLine.match(/(\w+ing)\s+(.+?)(?:\.|$)/i)
    if (ingMatch) {
      const action = ingMatch[1]
      const object = ingMatch[2].trim()
      const actionMap: Record<string, string> = {
        'searching': t('executionLog.activity.searching'),
        'fetching': t('executionLog.activity.fetching'),
        'analyzing': t('executionLog.activity.analyzing'),
        'accessing': t('executionLog.activity.accessing'),
        'checking': t('executionLog.activity.checking'),
        'processing': t('executionLog.activity.processingAction'),
        'executing': t('executionLog.activity.executing'),
        'connecting': t('executionLog.activity.connecting'),
        'querying': t('executionLog.activity.querying'),
        'calculating': t('executionLog.activity.calculating'),
        'generating': t('executionLog.activity.generating'),
        'creating': t('executionLog.activity.creating'),
        'updating': t('executionLog.activity.updating'),
        'retrieving': t('executionLog.activity.retrieving'),
        'loading': t('executionLog.activity.loading'),
        'reading': t('executionLog.activity.reading')
      }
      const translatedAction = actionMap[action.toLowerCase()] || t('executionLog.activity.actionGeneric', { verb: action })
      return `${translatedAction} ${object}...`
    }

    // Pattern 4: Look for key phrases in the last few sentences
    const recentText = lines.slice(-3).join(' ').toLowerCase()

    if (recentText.includes('ga4') || recentText.includes('google analytics')) {
      if (recentText.includes('schema') || recentText.includes('metadata')) {
        return t('executionLog.activity.checkingGA4Schema')
      }
      if (recentText.includes('fetch') || recentText.includes('get') || recentText.includes('retrieve')) {
        return t('executionLog.activity.fetchingGA4Data')
      }
      if (recentText.includes('analyze') || recentText.includes('analysis')) {
        return t('executionLog.activity.analyzingGA4Data')
      }
      return t('executionLog.activity.processingGA4')
    }

    if (recentText.includes('mcp') || recentText.includes('tool')) {
      return t('executionLog.activity.callingMCPTool')
    }

    // Pattern-match against CLI output text for permission-related keywords — not UI copy
    if (recentText.includes('permission') || recentText.includes('授權') || recentText.includes('權限')) {
      return t('executionLog.activity.processingPermission')
    }

    // Default: show last meaningful sentence
    if (lastLine.length > 50) {
      return t('executionLog.activity.processingText', { text: lastLine.substring(0, 50) })
    }

    return t('executionLog.activity.processing')
  }

  const currentActivity = log.status === 'running' && log.output
    ? extractCurrentActivity(log.output)
    : log.status === 'running'
      ? t('executionLog.activity.initializingTask')
      : ''

  return (
    <>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-900">
            {initialLog.task_name || t('executionLog.unknownTask')}
          </h2>
          <StatusBadge status={log.status} />
        </div>

        <div className="flex items-center gap-1">
          {log.status === 'running' && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <rect x="5" y="5" width="10" height="10" rx="1.5" />
              </svg>
              {t('executionLog.stop')}
            </button>
          )}
          {log.output && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-emerald-600">{t('executionLog.copied')}</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>{t('executionLog.copy')}</span>
              </>
            )}
          </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="px-6 py-4 space-y-4 min-w-0">
          {snapshot && <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm space-y-2">
            <div className="font-semibold text-gray-800">{t('automation.snapshot')}</div>
            <div className="text-xs text-gray-500">{snapshot.provider} · {snapshot.model || t('automation.providerDefault')} · {new Date(snapshot.created_at).toLocaleString(i18n.resolvedLanguage || i18n.language)}</div>
            {snapshot.source_path && <div className="break-all text-xs text-gray-600">{t('automation.sourceFile')}: {snapshot.source_path}</div>}
            {snapshot.source_url && <div className="break-all text-xs text-gray-600">{t('automation.sourceWebsite')}: {snapshot.source_url}</div>}
            {snapshot.proposed_file_name && <div className="text-gray-800">{t('automation.proposedFile')}: <strong>{snapshot.proposed_file_name}</strong></div>}
            {snapshot.destination && <div className="break-all text-xs text-gray-600">{t('automation.destination')}: {snapshot.destination}</div>}
            <details className="text-xs text-gray-600"><summary className="cursor-pointer">{t('automation.showInput')}</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2">{snapshot.prompt}</pre>
            </details>
            {log.status === 'pending_review' && <div className="flex gap-2 pt-2">
              <button type="button" disabled={actionBusy} onClick={() => void review(true)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{t('automation.approve')}</button>
              <button type="button" disabled={actionBusy} onClick={() => void review(false)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50">{t('automation.reject')}</button>
            </div>}
            {log.status !== 'running' && log.status !== 'pending_review' && <div className="space-y-2 pt-2">
              {!(snapshot.result_type === 'organize-file' && log.status === 'success') &&
                <button type="button" disabled={actionBusy} onClick={() => void replay()} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50">{t('automation.replay')}</button>}
              {log.status === 'failed' && snapshot.review_status === 'rejected' && snapshot.require_review &&
                <button type="button" disabled={actionBusy} onClick={() => void resumeDelivery()}
                  className="ml-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 disabled:opacity-50">{t('automation.resumeDelivery')}</button>}
              {log.status === 'failed' && <div className="flex flex-wrap items-center gap-2">
                <span className="w-full text-xs text-amber-700">{t(`automation.failure.${classifyProviderFailure(log.error || '')}`)}</span>
                <span className="text-xs text-gray-500">{t('automation.handoff')}</span>
                {(['claude', 'codex', 'antigravity'] as ProviderId[])
                  .filter(provider => provider !== snapshot.provider &&
                    (provider !== 'antigravity' || (!snapshot.require_review && !snapshot.source_path && !snapshot.source_url)))
                  .sort((left, right) => Number(right === snapshot.fallback_provider) - Number(left === snapshot.fallback_provider))
                  .map(provider => <button type="button" key={provider} disabled={actionBusy} onClick={() => void replay(provider)}
                    className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 disabled:opacity-50">{provider}</button>)}
              </div>}
            </div>}
            {actionError && <div role="alert" className="text-xs text-red-600">{actionError}</div>}
          </div>}
          {/* Timing Info */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{formatDateTime(log.started_at, i18n.resolvedLanguage || i18n.language)}</span>
            </div>
            {log.finished_at && (
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>{formatDuration(log.started_at, log.finished_at)}</span>
              </div>
            )}
            {log.finished_at && (
              <div>
                {t('executionLog.exitCode')}: <span className={`font-mono ${log.exit_code !== null && log.exit_code !== 0 ? 'text-red-600' : 'text-gray-700'}`}>{log.exit_code ?? '—'}</span>
              </div>
            )}
          </div>

          {/* Running indicator with activity status */}
          {log.status === 'running' && (
            <div className="flex items-center gap-2 text-blue-600 bg-blue-50 px-4 py-2.5 rounded-lg">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent flex-shrink-0"></div>
              <span className="text-sm font-medium">{currentActivity || t('executionLog.taskRunning')}</span>
            </div>
          )}

          {/* Error */}
          {log.error && (
            <div className={`rounded-lg p-4 ${
              log.error.includes('🚫') || log.error.includes('安全檢查')
                ? 'bg-red-100 border-2 border-red-400 shadow-lg'
                : 'bg-red-50 border border-red-200'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {log.error.includes('🚫') || log.error.includes('安全檢查') ? (
                  <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                <span className={`font-medium ${
                  log.error.includes('🚫') || log.error.includes('安全檢查')
                    ? 'text-red-800 text-base'
                    : 'text-red-700 text-sm'
                }`}>
                  {log.error.includes('🚫') || log.error.includes('安全檢查') ? t('executionLog.securityCheckFailed') : t('executionLog.errorLabel')}
                </span>
              </div>
              <pre className={`whitespace-pre-wrap font-mono mb-3 ${
                log.error.includes('🚫') || log.error.includes('安全檢查')
                  ? 'text-sm text-red-800 font-semibold'
                  : 'text-sm text-red-600'
              }`}>{log.error}</pre>

              {/* Security check failure - show detailed warning */}
              {(log.error.includes('🚫') || log.error.includes('安全檢查')) && (
                <div className="bg-red-200 border-2 border-red-400 rounded-lg p-4 mt-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      <svg className="w-6 h-6 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-red-900 mb-2">{t('executionLog.securityWarning.title')}</h4>
                      <p className="text-xs text-red-800 mb-2">
                        {t('executionLog.securityWarning.desc')}
                      </p>
                      <div className="bg-red-300 rounded p-2 mt-2">
                        <p className="text-xs font-semibold text-red-900 mb-1">{t('executionLog.securityWarning.measuresTitle')}</p>
                        <ul className="text-xs text-red-800 list-disc list-inside space-y-1">
                          <li>{t('executionLog.securityWarning.measure1')}</li>
                          <li>{t('executionLog.securityWarning.measure2')}</li>
                          <li>{t('executionLog.securityWarning.measure3')}</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Policy denied error */}
              {/* Condition checks parse CLI output content for 'Denied by policy', '政策拒絕', '系統政策' — not UI strings */}
              {!log.error.includes('🚫') && !log.error.includes('安全檢查') &&
               (log.error.includes('Denied by policy') || log.error.includes('政策拒絕') || log.error.includes('系統政策')) && (
                <div className="bg-red-100 border border-red-300 rounded p-3 text-xs text-red-800 mt-3">
                  <p className="font-medium mb-2">{t('executionLog.policyDenied.title')}</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>{t('executionLog.policyDenied.step1')}</li>
                    <li>{t('executionLog.policyDenied.step2pre')}<code className="bg-red-200 px-1 rounded">&quot;trust&quot;: true</code>{t('executionLog.policyDenied.step2post')}</li>
                    <li>{t('executionLog.policyDenied.step3')}</li>
                    <li>{t('executionLog.policyDenied.step4')}</li>
                    <li>{t('executionLog.policyDenied.step5')}</li>
                  </ol>
                </div>
              )}
            </div>
          )}

          {/* Policy Denied Warning in Output */}
          {/* Condition checks parse CLI output for 'Denied by policy', '操作遭到系統政策拒絕', '政策拒絕' — not UI strings */}
          {log.output && (log.output.includes('Denied by policy') || log.output.includes('操作遭到系統政策拒絕') || log.output.includes('政策拒絕')) && !log.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-red-900 mb-2">{t('executionLog.mcpDenied.title')}</h4>
                  <div className="bg-red-100 border border-red-300 rounded p-3 text-xs text-red-800 mb-3">
                    <p className="font-medium mb-2">{t('executionLog.mcpDenied.stepsTitle')}</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>{t('executionLog.mcpDenied.step1')}</li>
                      <li>{t('executionLog.mcpDenied.step2pre')}<code className="bg-red-200 px-1 rounded">&quot;trust&quot;: true</code>{t('executionLog.mcpDenied.step2post')}</li>
                      <li>{t('executionLog.mcpDenied.step3')}</li>
                      <li>{t('executionLog.mcpDenied.step4')}</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Output - Chat Style */}
          {log.output ? (
            <div className="space-y-4">
              <ChatMessage
                content={log.output}
                isStreaming={log.status === 'running'}
              />
              <div ref={outputEndRef} />
            </div>
          ) : log.status === 'running' ? (
            <div className="text-gray-400 text-sm">{t('executionLog.waitingForOutput')}</div>
          ) : null}
        </div>
      </div>
    </>
  )
}

function ChatMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const { t } = useTranslation()
  const rendered = linkifyIframes(content, t('executionLog.openPreview'))
  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div className="flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
      </div>

      {/* Message Content */}
      <div className="flex-1 min-w-0">
        <div className="bg-white rounded-2xl rounded-tl-sm p-4 shadow-sm border border-gray-100">
          <div className="prose prose-sm max-w-none overflow-hidden
            prose-headings:text-gray-900 prose-headings:font-semibold
            prose-h1:text-lg prose-h1:mt-4 prose-h1:mb-3
            prose-h2:text-base prose-h2:mt-3 prose-h2:mb-2
            prose-h3:text-sm prose-h3:mt-2 prose-h3:mb-1
            prose-p:text-gray-700 prose-p:leading-relaxed prose-p:break-words prose-p:my-2
            prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-a:break-all
            prose-strong:text-gray-900 prose-strong:font-semibold
            prose-code:text-blue-600 prose-code:bg-blue-50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-code:break-all
            prose-pre:bg-gray-950 prose-pre:text-gray-300 prose-pre:rounded-xl prose-pre:overflow-x-auto prose-pre:text-xs prose-pre:my-3 prose-pre:p-4 prose-pre:leading-relaxed prose-pre:shadow-inner
            [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit [&_pre_code]:text-xs [&_pre_code]:leading-relaxed [&_pre_code]:rounded-none [&_pre_code]:shadow-none
            prose-ul:text-gray-700 prose-ol:text-gray-700 prose-ul:my-2 prose-ol:my-2
            prose-li:marker:text-gray-400
            [&_table]:w-full [&_table]:table-fixed [&_table]:text-sm [&_table]:border-collapse [&_table]:my-2
            [&_thead]:bg-gray-50
            [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold [&_th]:text-gray-600 [&_th]:uppercase [&_th]:tracking-wider [&_th]:px-2 [&_th]:py-2 [&_th]:border-b [&_th]:border-gray-200 [&_th]:break-words
            [&_td]:px-2 [&_td]:py-2 [&_td]:text-gray-600 [&_td]:border-b [&_td]:border-gray-100 [&_td]:align-top [&_td]:break-words [&_td]:overflow-hidden
            [&_tr:last-child_td]:border-b-0
            [&_tbody_tr:hover]:bg-gray-50
          ">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              urlTransform={safeMarkdownUrl}
              components={{
                a({ href, children }) {
                  return (
                    <a
                      href={href}
                      onClick={(e) => {
                        e.preventDefault()
                        if (href) window.electronApi.invoke('link:open', href)
                      }}
                    >
                      {children}
                    </a>
                  )
                }
              }}
            >{rendered}</ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-2 h-4 ml-1 bg-blue-500 animate-pulse" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface StatusBadgeProps { status: ExecutionLog['status'] }

function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation()
  const styles = {
    running: 'bg-blue-100 text-blue-700',
    success: 'bg-emerald-100 text-emerald-700',
    pending_review: 'bg-violet-100 text-violet-700',
    failed: 'bg-red-100 text-red-700',
    cancelled: 'bg-amber-100 text-amber-700'
  }

  const labels = {
    running: t('common.running'),
    success: t('executionLog.statusBadge.completed'),
    pending_review: t('automation.pendingReview'),
    failed: t('common.failed'),
    cancelled: t('executionLog.statusBadge.cancelled')
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-sm font-medium ${styles[status]}`}>
      {status === 'running' && (
        <div className="animate-spin rounded-full h-2.5 w-2.5 border border-blue-700 border-t-transparent"></div>
      )}
      {labels[status]}
    </span>
  )
}

function formatDateTime(isoString: string, locale: string): string {
  const date = new Date(isoString)
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
