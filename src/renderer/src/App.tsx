import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import TaskList from './components/TaskList'
import TaskForm from './components/TaskForm'
import ExecutionLog from './components/ExecutionLog'
import Settings from './components/Settings'
import WelcomePage from './components/WelcomePage'
import { useSettings } from './hooks/useApi'
import { applyLanguagePreference } from './i18n'
import type { Task } from '../../shared/types'

type View = 'tasks' | 'logs' | 'settings'

export default function App() {
  // Check synchronously to avoid flash of wrong content and potential crashes in hooks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [isElectron] = useState(() => (window as any).electronApi !== undefined)

  // Hooks must be called before any early return (React rules).
  // In non-Electron environments, useSettings fails gracefully (no-op) and
  // the effect below guards on isElectron, so WelcomePage is never affected.
  const { settings, loading } = useSettings()
  const { t } = useTranslation()

  // Apply persisted language preference on startup (Electron only).
  // Keyed on settings.language so it also re-fires if the value changes while
  // the app is open, though the Settings component handles live switches directly.
  useEffect(() => {
    if (!isElectron || loading) return
    applyLanguagePreference(settings.language ?? 'system')
  }, [isElectron, loading, settings.language])

  const [currentView, setCurrentView] = useState<View>('tasks')
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [taskListKey, setTaskListKey] = useState(0)

  if (!isElectron) {
    return <WelcomePage />
  }

  const handleViewChange = (view: View) => {
    setCurrentView(view)
  }

  const handleEditTask = (task: Task) => {
    setEditingTask(task)
    setShowTaskForm(true)
  }

  const handleNewTask = () => {
    setEditingTask(null)
    setShowTaskForm(true)
    setCurrentView('tasks')
  }

  const handleCloseForm = () => {
    setEditingTask(null)
    setShowTaskForm(false)
  }

  const handleTaskSaved = () => {
    setTaskListKey(prev => prev + 1)
    handleCloseForm()
  }

  return (
    <div className="flex h-screen bg-[#F8F7F6]">
      {/* Sidebar */}
      <div className="w-56 bg-[#F8F7F6] flex flex-col border-r border-gray-200/60">
        {/* Header drag region */}
        <div className="h-12 drag-region" />

        {/* Logo & Brand */}
        <div className="px-6 pb-2">
          <div className="flex items-center gap-1">
            <div className="relative flex items-center justify-center w-8 h-8">
              {/* Central Planet/Core */}
              <svg className="w-8 h-8 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="3" className="fill-blue-600 stroke-none" />
                <path strokeWidth="1.5" strokeLinecap="round" className="opacity-80" d="M12 21c-4.97 0-9-4.03-9-9s4.03-9 9-9c4.97 0 9 4.03 9 9" />
                <path strokeWidth="1.5" strokeLinecap="round" className="opacity-60" d="M19.07 4.93L4.93 19.07" />
                <path strokeWidth="1.5" className="text-cyan-400" d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12" transform="rotate(-45 12 12)" />
                <path strokeWidth="1.5" className="text-blue-500" d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12" transform="rotate(45 12 12)" />
              </svg>
            </div>
            <span className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-cyan-600">
              Orbit Agents
            </span>
          </div>
        </div>

        {/* New Task Button */}
        <div className="px-3 pt-2 pb-4">
          <button
            onClick={handleNewTask}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm rounded-lg transition-all border border-transparent hover:border-gray-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t('app.newTask')}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-0.5">
          <NavItem
            label={t('app.nav.tasks')}
            icon={
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            }
            active={currentView === 'tasks'}
            onClick={() => handleViewChange('tasks')}
          />
          <NavItem
            label={t('app.nav.executionLogs')}
            icon={
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
            active={currentView === 'logs'}
            onClick={() => handleViewChange('logs')}
          />
          <NavItem
            label={t('app.nav.settings')}
            icon={
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
            active={currentView === 'settings'}
            onClick={() => handleViewChange('settings')}
          />
        </nav>

        {/* Version info */}
        <div className="p-4 text-sm text-gray-400">
          v1.1.0
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header drag region */}
        <div className="h-12 drag-region bg-[#F8F7F6]" />

        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
          {currentView === 'tasks' && (
            <div className="h-full bg-white rounded-tl-2xl shadow-sm border-t border-l border-gray-200/60 p-6">
              <TaskList 
                key={taskListKey} 
                onEditTask={handleEditTask} 
                onNewTask={handleNewTask}
                editingTask={editingTask}
                showTaskForm={showTaskForm}
                onCloseForm={handleCloseForm}
                onTaskSaved={handleTaskSaved}
              />
            </div>
          )}
          {currentView === 'logs' && (
            <div className="h-full bg-white rounded-tl-2xl shadow-sm border-t border-l border-gray-200/60 p-6">
              <ExecutionLog />
            </div>
          )}
          {currentView === 'settings' && (
            <div className="h-full bg-white rounded-tl-2xl shadow-sm border-t border-l border-gray-200/60 p-6">
              <Settings />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface NavItemProps {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}

function NavItem({ label, icon, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-all text-sm ${
        active
          ? 'bg-white shadow-sm text-gray-900 font-medium border border-gray-200/60'
          : 'text-gray-600 hover:bg-white/60'
      }`}
    >
      <span className={active ? 'text-gray-700' : 'text-gray-500'}>{icon}</span>
      {label}
    </button>
  )
}
