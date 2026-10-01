import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity, ArrowRight, CalendarClock, CheckCircle2, CircleAlert,
  Clock3, ListChecks, Plus, RefreshCw, Sparkles
} from 'lucide-react'
import type { DashboardData, DashboardRun } from '../../../shared/types'
import { getScheduleDescription, parseCronToSimple } from '../utils/cron'

interface DashboardProps {
  onNewTask: () => void
  onOpenTasks: () => void
  onOpenTask: (id: string) => void
  onOpenLogs: (id?: string) => void
}

const hourMs = 60 * 60 * 1000

export default function Dashboard({ onNewTask, onOpenTasks, onOpenTask, onOpenLogs }: DashboardProps) {
  const { t, i18n } = useTranslation()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locale = i18n.resolvedLanguage || i18n.language

  const refresh = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const next = await window.electronApi.invoke('dashboard:get')
      setData(next)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('dashboard.loadError'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), 60_000)
    let pending: number | null = null
    const onExecutionUpdate = () => {
      if (pending !== null) return
      pending = window.setTimeout(() => {
        pending = null
        void refresh()
      }, 1200)
    }
    window.electronApi.on('execution:update', onExecutionUpdate)
    return () => {
      window.clearInterval(interval)
      if (pending !== null) window.clearTimeout(pending)
      window.electronApi.off('execution:update', onExecutionUpdate)
    }
  }, [refresh])

  const activeTasks = data?.tasks.filter((task) => task.enabled === 1) ?? []
  const reviewTasks = data?.tasks.filter((task) => task.needs_review === 1) ?? []
  const pausedCount = (data?.tasks.length ?? 0) - activeTasks.length
  const completed = (data?.executions24h.success ?? 0) + (data?.executions24h.failed ?? 0)
  const successRate = completed > 0 ? Math.round(((data?.executions24h.success ?? 0) / completed) * 100) : null
  const hasAttention = (data?.recent_failures.length ?? 0) > 0 || reviewTasks.length > 0
  const upcoming = useMemo(() => (data?.tasks ?? [])
    .filter((task) => task.enabled === 1 && task.next_run)
    .sort((a, b) => (a.next_run || '').localeCompare(b.next_run || ''))
    .slice(0, 4), [data])

  const activity = useMemo(() => {
    const nowHour = Math.floor(Date.now() / hourMs) * hourMs
    const byHour = new Map((data?.activity24h ?? []).map((point) => [point.hour, point]))
    return Array.from({ length: 25 }, (_, index) => {
      const time = new Date(nowHour - (24 - index) * hourMs)
      return {
        time,
        point: byHour.get(time.toISOString().slice(0, 13))
      }
    })
  }, [data])
  const maxActivity = Math.max(1, ...activity.map(({ point }) =>
    (point?.success ?? 0) + (point?.failed ?? 0) + (point?.running ?? 0) + (point?.cancelled ?? 0)))

  const formatDateTime = (value: string) => new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value))
  const formatRelative = (value: string) => {
    const minutes = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 60_000))
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (minutes < 60) return formatter.format(minutes, 'minute')
    if (minutes < 1440) return formatter.format(Math.ceil(minutes / 60), 'hour')
    return formatter.format(Math.ceil(minutes / 1440), 'day')
  }
  const scheduleLabel = (task: DashboardData['tasks'][number]) => {
    const parsed = parseCronToSimple(task.cron_expression)
    if (parsed.mode === 'advanced') return task.cron_expression
    return getScheduleDescription(
      parsed.frequency, parsed.intervalValue, parsed.intervalUnit, parsed.time,
      parsed.weekdays, task.week_interval || 1, parsed.monthDay,
      t as (key: string, vars?: Record<string, string | number>) => string
    )
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center gap-3 text-sm text-slate-500">
      <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />{t('common.loading')}
    </div>
  }

  return <div className="h-full overflow-y-auto bg-white">
    <div className="space-y-5 p-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{t('dashboard.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('dashboard.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void refresh(true)} disabled={refreshing}
            aria-label={t('dashboard.refresh')} title={t('dashboard.refresh')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={onNewTask}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700">
            <Plus className="h-4 w-4" />{t('app.newTask')}
          </button>
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {t('dashboard.loadError')}: {error}
      </div>}

      {data && <>
        <section className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[minmax(220px,1.1fr)_minmax(0,2fr)] lg:p-6">
          <div className="flex min-w-0 items-start gap-3 lg:border-r lg:border-slate-200 lg:pr-6">
            <span className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${hasAttention ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
              {hasAttention ? <CircleAlert className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">
                {data.tasks.length === 0 ? t('dashboard.health.noTasks') : hasAttention ? t('dashboard.health.attention') : t('dashboard.health.healthy')}
              </h2>
              <p className="mt-1 text-sm text-slate-500">{t('dashboard.health.summary', {
                active: activeTasks.length, paused: pausedCount, running: data.executions24h.running
              })}</p>
              {data.tasks.length === 0 && <button type="button" onClick={onNewTask} className="mt-3 text-sm font-medium text-blue-600 hover:underline">
                {t('dashboard.createFirst')} <ArrowRight className="inline h-4 w-4" />
              </button>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
            <Metric label={t('dashboard.metric.runs')} value={data.executions24h.total.toString()} note={t('dashboard.last24h')} />
            <Metric label={t('dashboard.metric.successRate')} value={successRate === null ? '—' : `${successRate}%`} note={t('dashboard.metric.completedOnly')} />
            <Metric label={t('dashboard.metric.failures')} value={data.executions24h.failed.toString()} note={data.executions24h.failed > 0 ? t('dashboard.metric.needsAttention') : t('dashboard.metric.noFailures')} tone={data.executions24h.failed > 0 ? 'red' : 'green'} />
            <Metric label={t('dashboard.metric.activeTasks')} value={activeTasks.length.toString()} note={t('dashboard.metric.totalTasks', { count: data.tasks.length })} />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:px-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-slate-900"><CalendarClock className="h-5 w-5 text-blue-600" /><h2 className="font-semibold">{t('dashboard.upcoming.title')}</h2></div>
            <button type="button" onClick={onOpenTasks} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
              {t('dashboard.viewTasks')} <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          {upcoming.length > 0 ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {upcoming.map((task) => <button key={task.id} type="button" onClick={() => onOpenTask(task.id)}
              className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/50">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-800">{task.name}</span>
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              </div>
              <p className="mt-1 text-sm font-semibold text-blue-600">{formatRelative(task.next_run!)}</p>
              <p className="mt-1 truncate text-xs text-slate-500" title={scheduleLabel(task)}>{formatDateTime(task.next_run!)} · {task.cli_tool}</p>
            </button>)}
          </div> : <p className="rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500">{t('dashboard.upcoming.empty')}</p>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-slate-900"><Activity className="h-5 w-5 text-blue-600" /><h2 className="font-semibold">{t('dashboard.activity.title')}</h2></div>
              <p className="mt-1 text-sm text-slate-500">{t('dashboard.activity.subtitle')}</p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <Legend color="bg-emerald-500" label={t('dashboard.activity.success')} />
              <Legend color="bg-red-500" label={t('dashboard.activity.failed')} />
              <Legend color="bg-blue-500" label={t('dashboard.activity.running')} />
            </div>
          </div>
          <div className="mt-6 rounded-xl bg-slate-50 p-4">
            <div className="flex h-32 items-end gap-1" role="group" aria-label={t('dashboard.activity.chartLabel')}>
              {activity.map(({ time, point }) => {
                const total = (point?.success ?? 0) + (point?.failed ?? 0) + (point?.running ?? 0) + (point?.cancelled ?? 0)
                const label = `${formatDateTime(time.toISOString())}: ${point?.success ?? 0} ${t('dashboard.activity.success')}, ${point?.failed ?? 0} ${t('dashboard.activity.failed')}`
                return <button key={time.toISOString()} type="button" onClick={() => onOpenLogs()} title={label} aria-label={label}
                  className="group flex h-full min-w-0 flex-1 flex-col justify-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                  {total === 0 ? <span className="h-1 w-full rounded-sm bg-slate-200 group-hover:bg-slate-300" /> :
                    <span className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm transition-opacity group-hover:opacity-70" style={{ height: `${Math.max(7, total / maxActivity * 100)}%` }}>
                      {(point?.running ?? 0) > 0 && <span className="w-full bg-blue-500" style={{ flex: point!.running }} />}
                      {(point?.cancelled ?? 0) > 0 && <span className="w-full bg-amber-400" style={{ flex: point!.cancelled }} />}
                      {(point?.failed ?? 0) > 0 && <span className="w-full bg-red-500" style={{ flex: point!.failed }} />}
                      {(point?.success ?? 0) > 0 && <span className="w-full bg-emerald-500" style={{ flex: point!.success }} />}
                    </span>}
                </button>
              })}
            </div>
            <div className="mt-3 flex justify-between text-[11px] text-slate-400">
              <span>{t('dashboard.activity.before24h')}</span><span>{t('dashboard.activity.before12h')}</span><span>{t('dashboard.activity.now')}</span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-600">
            <span><strong className="font-semibold text-slate-900">{data.executions24h.success}</strong> {t('dashboard.activity.success')}</span>
            <span><strong className={`font-semibold ${data.executions24h.failed ? 'text-red-600' : 'text-slate-900'}`}>{data.executions24h.failed}</strong> {t('dashboard.activity.failed')}</span>
            <span><strong className="font-semibold text-slate-900">{data.executions24h.running}</strong> {t('dashboard.activity.running')}</span>
            <span><strong className="font-semibold text-slate-900">{data.executions24h.cancelled}</strong> {t('dashboard.activity.cancelled')}</span>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
            <div className="mb-4 flex items-center gap-2"><CircleAlert className="h-5 w-5 text-amber-600" /><h2 className="font-semibold text-slate-900">{t('dashboard.attention.title')}</h2></div>
            {reviewTasks.length === 0 && data.recent_failures.length === 0 ? <EmptyMessage text={t('dashboard.attention.empty')} /> :
              <div className="space-y-2">
                {reviewTasks.slice(0, 2).map((task) => <button key={task.id} type="button" onClick={() => onOpenTask(task.id)} className="flex w-full items-center justify-between gap-3 rounded-xl bg-amber-50 p-3 text-left hover:bg-amber-100">
                  <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900">{task.name}</p><p className="mt-0.5 text-xs text-amber-700">{t('dashboard.attention.review')}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-amber-700" />
                </button>)}
                {data.recent_failures.map((run) => <button key={run.id} type="button" onClick={() => onOpenLogs(run.id)} className="flex w-full items-center justify-between gap-3 rounded-xl bg-red-50 p-3 text-left hover:bg-red-100">
                  <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900">{run.task_name || t('executionLog.unknownTask')}</p><p className="mt-0.5 truncate text-xs text-red-700">{run.error || formatDateTime(run.started_at)}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-red-600" />
                </button>)}
              </div>}
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
            <div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><ListChecks className="h-5 w-5 text-blue-600" /><h2 className="font-semibold text-slate-900">{t('dashboard.topTasks.title')}</h2></div><span className="text-xs text-slate-400">{t('dashboard.last7d')}</span></div>
            {data.top_tasks.length === 0 ? <EmptyMessage text={t('dashboard.topTasks.empty')} /> :
              <div className="space-y-4">
                {data.top_tasks.map((task) => <button key={task.task_id} type="button" onClick={() => onOpenTask(task.task_id)} className="block w-full text-left group">
                  <div className="flex items-center justify-between gap-3 text-sm"><span className="truncate font-medium text-slate-700 group-hover:text-blue-600">{task.task_name || t('executionLog.unknownTask')}</span><span className="shrink-0 font-semibold text-slate-900">{t('dashboard.topTasks.runs', { count: task.total })}</span></div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: `${task.total / data.top_tasks[0].total * 100}%` }} /></div>
                  {task.failed > 0 && <p className="mt-1 text-xs text-red-600">{t('dashboard.topTasks.failures', { count: task.failed })}</p>}
                </button>)}
              </div>}
          </section>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
          <div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-blue-600" /><h2 className="font-semibold text-slate-900">{t('dashboard.recent.title')}</h2></div><button type="button" onClick={() => onOpenLogs()} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">{t('dashboard.viewLogs')}<ArrowRight className="h-4 w-4" /></button></div>
          {data.recent_runs.length === 0 ? <EmptyMessage text={t('dashboard.recent.empty')} /> :
            <div className="divide-y divide-slate-100">
              {data.recent_runs.map((run) => <RunRow key={run.id} run={run} locale={locale} onClick={() => onOpenLogs(run.id)} />)}
            </div>}
        </section>
      </>}
    </div>
  </div>
}

function Metric({ label, value, note, tone = 'default' }: { label: string; value: string; note: string; tone?: 'default' | 'red' | 'green' }) {
  return <div className="min-w-0">
    <p className="text-xs font-medium text-slate-500">{label}</p>
    <p className={`mt-2 text-2xl font-semibold tabular-nums ${tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-600' : 'text-slate-900'}`}>{value}</p>
    <p className="mt-1 truncate text-xs text-slate-400" title={note}>{note}</p>
  </div>
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-sm ${color}`} />{label}</span>
}

function EmptyMessage({ text }: { text: string }) {
  return <div className="flex min-h-24 items-center justify-center rounded-xl bg-slate-50 px-4 text-center text-sm text-slate-500"><Sparkles className="mr-2 h-4 w-4 text-slate-400" />{text}</div>
}

function RunRow({ run, locale, onClick }: { run: DashboardRun; locale: string; onClick: () => void }) {
  const { t } = useTranslation()
  const statusLabel = t(`dashboard.activity.${run.status}`)
  const statusColor = run.status === 'success' ? 'bg-emerald-500' : run.status === 'failed' ? 'bg-red-500' : run.status === 'running' ? 'bg-blue-500' : 'bg-amber-400'
  return <button type="button" onClick={onClick} className="flex w-full items-center gap-3 py-3 text-left hover:bg-slate-50">
    <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`} />
    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{run.task_name || t('executionLog.unknownTask')}</span>
    <span className="shrink-0 text-xs text-slate-500">{statusLabel}</span>
    <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(run.started_at))}</span>
    <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
  </button>
}
