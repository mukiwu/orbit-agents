import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { useTranslation } from 'react-i18next'
import { useExecutionLogs, useExecutionLog } from '../hooks/useApi'
import { linkifyIframes, safeMarkdownUrl } from '../utils/markdown'
import type { ExecutionLogWithTask } from '../../../shared/types'

export default function ExecutionLog() {
  const { t } = useTranslation()
  const { logs, loading, error, deleteLogs } = useExecutionLogs(undefined, 200)
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null)
  const [checkedLogIds, setCheckedLogIds] = useState<Set<string>>(new Set())

  // Auto-select first log when logs load
  useEffect(() => {
    if (logs.length > 0 && !selectedLogId) {
      setSelectedLogId(logs[0].id)
    }
  }, [logs, selectedLogId])

  const selectedLog = logs.find(l => l.id === selectedLogId) || null

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
    await deleteLogs(idsToDelete)
    setCheckedLogIds(new Set())

    // If selected log was deleted, select the first available one
    if (selectedLogId && idsToDelete.includes(selectedLogId)) {
      const remainingLogs = logs.filter(l => !idsToDelete.includes(l.id))
      if (remainingLogs.length > 0) {
        setSelectedLogId(remainingLogs[0].id)
      } else {
        setSelectedLogId(null)
      }
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-white rounded-tl-2xl">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full bg-white rounded-tl-2xl p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full gap-8">
      {/* Left Panel - Log List */}
      <div className="w-80 flex-shrink-0 flex flex-col gap-1">
        {/* List Header */}
        <div className="mb-4 px-2 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t('executionLog.listTitle')}</h2>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                checked={logs.length > 0 && checkedLogIds.size === logs.length}
                onChange={(e) => handleSelectAll(e.target.checked)}
                disabled={logs.length === 0}
              />
              <p className="text-xs text-gray-400">{t('executionLog.selectAll')}</p>
            </div>
          </div>
          {checkedLogIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded transition-colors"
            >
              {t('executionLog.deleteSelected', { count: checkedLogIds.size })}
            </button>
          )}
        </div>

        {/* Log List */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-2">
          {logs.length === 0 ? (
            <div className="text-center py-12 px-4 border-2 border-dashed border-gray-200 rounded-xl">
               <svg className="w-8 h-8 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
               </svg>
               <p className="text-sm text-gray-500">{t('executionLog.noLogsFound')}</p>
            </div>
          ) : (
            <>
              {logs.map((log) => (
                <LogListItem
                  key={log.id}
                  log={log}
                  isSelected={selectedLogId === log.id}
                  isChecked={checkedLogIds.has(log.id)}
                  onCheck={(checked) => handleCheck(log.id, checked)}
                  onClick={() => setSelectedLogId(log.id)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Right Panel - Log Detail */}
      <div className="flex-1 bg-gray-50/50 rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-hidden min-w-0">
        {selectedLog ? (
          <LogDetail log={selectedLog} />
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
  isSelected: boolean
  isChecked: boolean
  onCheck: (checked: boolean) => void
  onClick: () => void
}

function LogListItem({ log, isSelected, isChecked, onCheck, onClick }: LogListItemProps) {
  const { t } = useTranslation()
  const statusColors = {
    running: 'bg-blue-500',
    success: 'bg-emerald-500',
    failed: 'bg-red-500',
    cancelled: 'bg-amber-500'
  }

  return (
    <div
      onClick={onClick}
      className={`group w-full flex items-center p-3 rounded-xl transition-all border cursor-pointer relative ${
        isSelected
          ? 'bg-white shadow-md border-blue-200 ring-1 ring-blue-100 z-10'
          : 'bg-white/40 border-transparent hover:bg-white hover:shadow-sm hover:border-gray-200'
      }`}
    >
      <input
        type="checkbox"
        className="mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        checked={isChecked}
        onChange={(e) => onCheck(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
      />
      <div
        className="flex-1 flex items-start gap-3 text-left min-w-0"
      >
        {/* Status indicator */}
        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${statusColors[log.status]}`}>
          {log.status === 'running' && (
            <span className="flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75"></span>
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Task name */}
          <p className={`text-sm truncate ${isSelected ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
            {log.task_name || t('executionLog.unknownTask')}
          </p>

          {/* Time */}
          <p className="text-sm text-gray-400 mt-0.5">
            {formatRelativeTime(log.started_at, t)}
          </p>
        </div>

        {/* Status badge */}
        <span className={`text-sm font-medium px-1.5 py-0.5 rounded ${
          log.status === 'running' ? 'bg-blue-100 text-blue-700' :
          log.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
          log.status === 'cancelled' ? 'bg-amber-100 text-amber-700' :
          'bg-red-100 text-red-700'
        }`}>
          {log.status === 'running' ? t('common.running') : log.status === 'success' ? t('common.done') : log.status === 'cancelled' ? t('common.cancelled') : t('common.failed')}
        </span>
      </div>
    </div>
  )
}

interface LogDetailProps {
  log: ExecutionLogWithTask
}

function LogDetail({ log: initialLog }: LogDetailProps) {
  const { t } = useTranslation()
  const { log: liveLog, cancel } = useExecutionLog(initialLog.id)
  const log = liveLog ? { ...initialLog, ...liveLog } : initialLog
  const outputEndRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

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
          {/* Timing Info */}
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{formatDateTime(log.started_at)}</span>
            </div>
            {log.finished_at && (
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>{formatDuration(log.started_at, log.finished_at)}</span>
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

interface StatusBadgeProps {
  status: 'running' | 'success' | 'failed' | 'cancelled'
}

function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation()
  const styles = {
    running: 'bg-blue-100 text-blue-700',
    success: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700',
    cancelled: 'bg-amber-100 text-amber-700'
  }

  const labels = {
    running: t('common.running'),
    success: t('executionLog.statusBadge.completed'),
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

function formatDateTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatRelativeTime(isoString: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return t('executionLog.time.justNow')
  if (diffMins < 60) return t('executionLog.time.minutesAgo', { count: diffMins })
  if (diffHours < 24) return t('executionLog.time.hoursAgo', { count: diffHours })
  if (diffDays < 7) return t('executionLog.time.daysAgo', { count: diffDays })

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDuration(start: string, end: string): string {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const diffMs = endDate.getTime() - startDate.getTime()

  if (diffMs < 1000) return `${diffMs}ms`
  if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`

  const minutes = Math.floor(diffMs / 60000)
  const seconds = Math.round((diffMs % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}
