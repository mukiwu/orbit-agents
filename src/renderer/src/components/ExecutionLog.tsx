import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useExecutionLogs, useExecutionLog } from '../hooks/useApi'
import type { ExecutionLogWithTask } from '../../../shared/types'

export default function ExecutionLog() {
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
    if (!confirm(`Are you sure you want to delete ${checkedLogIds.size} logs?`)) return

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
            <h2 className="text-lg font-bold text-gray-900">Execution Logs</h2>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                checked={logs.length > 0 && checkedLogIds.size === logs.length}
                onChange={(e) => handleSelectAll(e.target.checked)}
                disabled={logs.length === 0}
              />
              <p className="text-xs text-gray-400">Select all</p>
            </div>
          </div>
          {checkedLogIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded transition-colors"
            >
              Delete ({checkedLogIds.size})
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
               <p className="text-sm text-gray-500">No logs found.</p>
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
            <h3 className="text-gray-900 font-medium mb-1">No Log Selected</h3>
            <p className="text-sm max-w-xs mx-auto">Select an execution log from the list to view its details and output.</p>
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
  const statusColors = {
    running: 'bg-blue-500',
    success: 'bg-emerald-500',
    failed: 'bg-red-500'
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
            {log.task_name || 'Unknown Task'}
          </p>

          {/* Time */}
          <p className="text-sm text-gray-400 mt-0.5">
            {formatRelativeTime(log.started_at)}
          </p>
        </div>

        {/* Status badge */}
        <span className={`text-sm font-medium px-1.5 py-0.5 rounded ${
          log.status === 'running' ? 'bg-blue-100 text-blue-700' :
          log.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
          'bg-red-100 text-red-700'
        }`}>
          {log.status === 'running' ? 'Running' : log.status === 'success' ? 'Done' : 'Failed'}
        </span>
      </div>
    </div>
  )
}

interface LogDetailProps {
  log: ExecutionLogWithTask
}

function LogDetail({ log: initialLog }: LogDetailProps) {
  const { log: liveLog } = useExecutionLog(initialLog.id)
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

  // Extract current activity from output
  const extractCurrentActivity = (output: string): string => {
    if (!output || output.trim().length === 0) {
      return '正在初始化...'
    }

    const lines = output.split('\n').filter(line => line.trim().length > 0)
    const lastLine = lines[lines.length - 1] || ''
    const lowerLastLine = lastLine.toLowerCase()

    // Pattern 1: "I will..." statements (including "I will start by...")
    const willMatch = lastLine.match(/i\s+will\s+(?:start\s+by\s+)?(.+?)(?:\.|$)/i)
    if (willMatch) {
      const action = willMatch[1].trim()
      const actionMap: Record<string, string> = {
        'search': '正在搜尋',
        'fetch': '正在獲取',
        'analyze': '正在分析',
        'access': '正在存取',
        'check': '正在檢查',
        'list': '正在列出',
        'get': '正在取得',
        'read': '正在讀取',
        'process': '正在處理',
        'execute': '正在執行',
        'connect': '正在連線',
        'query': '正在查詢',
        'calculate': '正在計算',
        'generate': '正在生成',
        'create': '正在建立',
        'update': '正在更新',
        'retrieve': '正在檢索',
        'confirm': '正在確認',
        'identify': '正在識別'
      }
      
      // Try to extract specific objects (GA4, schema, data, etc.)
      const objectPatterns = [
        { pattern: /ga4\s+(schema|metadata|data|dimension|metric)/i, label: 'GA4' },
        { pattern: /the\s+ga4\s+(schema|metadata)/i, label: 'GA4 結構' },
        { pattern: /performance\s+data/i, label: '效能數據' },
        { pattern: /(dimension|metric)\s+names?/i, label: '維度和指標' },
        { pattern: /high-traffic\s+articles?/i, label: '高流量文章' },
        { pattern: /engagement\s+(data|metrics?)/i, label: '互動數據' },
        { pattern: /bounce\s+rates?/i, label: '跳出率' }
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
      return `正在執行: ${shortAction}...`
    }

    // Pattern 2: Chinese action patterns "正在..." or "將要..."
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
        'searching': '正在搜尋',
        'fetching': '正在獲取',
        'analyzing': '正在分析',
        'accessing': '正在存取',
        'checking': '正在檢查',
        'processing': '正在處理',
        'executing': '正在執行',
        'connecting': '正在連線',
        'querying': '正在查詢',
        'calculating': '正在計算',
        'generating': '正在生成',
        'creating': '正在建立',
        'updating': '正在更新',
        'retrieving': '正在檢索',
        'loading': '正在載入',
        'reading': '正在讀取'
      }
      const translatedAction = actionMap[action.toLowerCase()] || `正在${action}`
      return `${translatedAction} ${object}...`
    }

    // Pattern 4: Look for key phrases in the last few sentences
    const recentText = lines.slice(-3).join(' ').toLowerCase()
    
    if (recentText.includes('ga4') || recentText.includes('google analytics')) {
      if (recentText.includes('schema') || recentText.includes('metadata')) {
        return '正在檢查 GA4 結構...'
      }
      if (recentText.includes('fetch') || recentText.includes('get') || recentText.includes('retrieve')) {
        return '正在獲取 GA4 數據...'
      }
      if (recentText.includes('analyze') || recentText.includes('analysis')) {
        return '正在分析 GA4 數據...'
      }
      return '正在處理 GA4 相關操作...'
    }

    if (recentText.includes('mcp') || recentText.includes('tool')) {
      return '正在呼叫 MCP 工具...'
    }

    if (recentText.includes('permission') || recentText.includes('授權') || recentText.includes('權限')) {
      return '正在處理權限請求...'
    }

    // Default: show last meaningful sentence
    if (lastLine.length > 50) {
      return `正在處理: ${lastLine.substring(0, 50)}...`
    }

    return '正在處理中...'
  }

  const currentActivity = log.status === 'running' && log.output
    ? extractCurrentActivity(log.output) 
    : log.status === 'running' 
      ? '正在初始化任務...' 
      : ''

  return (
    <>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-900">
            {initialLog.task_name || 'Unknown Task'}
          </h2>
          <StatusBadge status={log.status} />
        </div>

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
                <span className="text-emerald-600">Copied!</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Copy</span>
              </>
            )}
          </button>
        )}
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
              <span className="text-sm font-medium">{currentActivity || '任務執行中...'}</span>
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
                  {log.error.includes('🚫') || log.error.includes('安全檢查') ? '🚫 安全檢查失敗' : 'Error'}
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
                      <h4 className="text-sm font-bold text-red-900 mb-2">⚠️ 安全保護機制已啟動</h4>
                      <p className="text-xs text-red-800 mb-2">
                        系統檢測到嘗試執行危險的刪除操作，已自動停止執行以保護您的系統安全。
                      </p>
                      <div className="bg-red-300 rounded p-2 mt-2">
                        <p className="text-xs font-semibold text-red-900 mb-1">保護措施：</p>
                        <ul className="text-xs text-red-800 list-disc list-inside space-y-1">
                          <li>嚴格禁止在未經使用者授權下主動刪除項目</li>
                          <li>自動檢測並阻止危險的刪除命令（如 rm -rf）</li>
                          <li>執行已立即停止，不會對系統造成任何影響</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Policy denied error */}
              {!log.error.includes('🚫') && !log.error.includes('安全檢查') && 
               (log.error.includes('Denied by policy') || log.error.includes('政策拒絕') || log.error.includes('系統政策')) && (
                <div className="bg-red-100 border border-red-300 rounded p-3 text-xs text-red-800 mt-3">
                  <p className="font-medium mb-2">🔧 MCP 工具政策拒絕 - 解決步驟：</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>檢查 Gemini CLI 配置文件（通常在 <code className="bg-red-200 px-1 rounded">~/.config/gemini-cli/settings.json</code>）</li>
                    <li>為您的 MCP server 添加 <code className="bg-red-200 px-1 rounded">"trust": true</code> 設定</li>
                    <li>確認 MCP Server 已正確啟動（執行 <code className="bg-red-200 px-1 rounded">gemini mcp list</code> 檢查）</li>
                    <li>確認 Google Analytics API 權限已正確配置</li>
                    <li>重新啟動 Gemini CLI 或應用程式</li>
                  </ol>
                </div>
              )}
            </div>
          )}
          
          {/* Policy Denied Warning in Output */}
          {log.output && (log.output.includes('Denied by policy') || log.output.includes('操作遭到系統政策拒絕') || log.output.includes('政策拒絕')) && !log.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-red-900 mb-2">MCP 工具被系統政策拒絕</h4>
                  <div className="bg-red-100 border border-red-300 rounded p-3 text-xs text-red-800 mb-3">
                    <p className="font-medium mb-2">🔧 解決步驟：</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>檢查 Gemini CLI 配置文件（<code className="bg-red-200 px-1 rounded">~/.config/gemini-cli/settings.json</code>）</li>
                      <li>為 MCP server 添加 <code className="bg-red-200 px-1 rounded">"trust": true</code></li>
                      <li>確認 MCP Server 已啟動（執行 <code className="bg-red-200 px-1 rounded">gemini mcp list</code>）</li>
                      <li>檢查 Google Analytics API 權限配置</li>
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
            <div className="text-gray-400 text-sm">Waiting for output...</div>
          ) : null}
        </div>
      </div>
    </>
  )
}

function ChatMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
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
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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
  status: 'running' | 'success' | 'failed'
}

function StatusBadge({ status }: StatusBadgeProps) {
  const styles = {
    running: 'bg-blue-100 text-blue-700',
    success: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700'
  }

  const labels = {
    running: 'Running',
    success: 'Completed',
    failed: 'Failed'
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

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

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
