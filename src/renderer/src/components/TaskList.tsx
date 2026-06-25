import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { parseCronToSimple, getScheduleDescription } from '../utils/cron'
import { useTasks } from '../hooks/useApi'
import type { Task } from '../../../shared/types'
import TaskForm from './TaskForm'
import { Play, Pause, Trash2, Clock, Terminal, ChevronRight, Plus } from 'lucide-react'

interface TaskListProps {
  onEditTask: (task: Task) => void
  onNewTask: () => void
  editingTask: Task | null
  showTaskForm: boolean
  onCloseForm: () => void
  onTaskSaved: () => void
}

export default function TaskList({ 
  onEditTask, 
  onNewTask, 
  editingTask, 
  showTaskForm, 
  onCloseForm, 
  onTaskSaved 
}: TaskListProps) {
  const { t } = useTranslation()
  const { tasks, loading, error, toggleTask, deleteTask, runTaskNow } = useTasks()
  const [runningTasks, setRunningTasks] = useState<Set<string>>(new Set())
  const [deletingTask, setDeletingTask] = useState<string | null>(null)
  
  // Local selection state to sync with App props
  const selectedTaskId = editingTask?.id

  const handleToggle = async (e: React.MouseEvent, task: Task) => {
    e.stopPropagation()
    try {
      await toggleTask(task.id)
    } catch (err) {
      console.error('Failed to toggle task:', err)
    }
  }

  const handleRunNow = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation()
    setRunningTasks((prev) => new Set(prev).add(taskId))
    try {
      await runTaskNow(taskId)
    } catch (err) {
      console.error('Failed to run task:', err)
    } finally {
      setRunningTasks((prev) => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
    }
  }

  const handleDelete = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation()
    const found = tasks.find((task) => task.id === taskId)
    const name = found?.name ?? taskId
    if (!confirm(t('taskList.confirmDelete', { name }))) {
      return
    }

    setDeletingTask(taskId)
    try {
      await deleteTask(taskId)
      // If deleted task was selected, close form
      if (selectedTaskId === taskId) {
        onCloseForm()
      }
    } catch (err) {
      console.error('Failed to delete task:', err)
    } finally {
      setDeletingTask(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-sm text-gray-500">{t('taskList.loading')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 m-8">
        <span className="font-medium">{t('taskList.error')}</span> {error}
      </div>
    )
  }

  return (
    <div className="flex h-full gap-8">
      {/* Left Sidebar - Task List */}
      <div className="w-80 flex-shrink-0 flex flex-col gap-1">
        <div className="mb-4 px-2 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t('taskList.title')}</h2>
            <p className="text-xs text-gray-400 mt-1">{t('taskList.subtitle')}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-2">
          {tasks.length === 0 ? (
            <div className="text-center py-12 px-4 border-2 border-dashed border-gray-200 rounded-xl">
               <p className="text-sm text-gray-500">{t('taskList.emptyState')}</p>
               <button onClick={onNewTask} className="mt-2 text-blue-600 text-sm font-medium hover:underline">{t('taskList.createOne')}</button>
            </div>
          ) : (
            tasks.map((task) => {
               const isSelected = selectedTaskId === task.id
               const isEnabled = task.enabled === 1
               
               return (
                 <div
                   key={task.id}
                   onClick={() => onEditTask(task)}
                   className={`group w-full text-left p-3 rounded-xl transition-all border cursor-pointer relative ${
                     isSelected 
                       ? 'bg-white shadow-md border-blue-200 ring-1 ring-blue-100 z-10' 
                       : 'bg-white/40 border-transparent hover:bg-white hover:shadow-sm hover:border-gray-200'
                   }`}
                 >
                   <div className="flex items-start justify-between mb-2">
                     <div className="flex-1 min-w-0 pr-2">
                       <h3 className={`font-semibold text-sm truncate ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                         {task.name}
                       </h3>
                       {task.needs_review === 1 && (
                         <div className="mt-1 mb-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[10px] text-amber-700 font-medium">
                           {t('taskList.needsReview')}
                         </div>
                       )}
                       <div className="flex items-center gap-1.5 mt-1">
                         <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            task.cli_tool === 'claude' ? 'bg-orange-100 text-orange-700' :
                            'bg-indigo-100 text-indigo-700'
                         }`}>
                           {task.cli_tool}
                         </span>
                       <span className="text-xs text-gray-400 flex items-center gap-0.5 ml-1">
                           <Clock className="w-3 h-3" />
                           {(() => {
                             const params = parseCronToSimple(task.cron_expression || '')
                             if (params.mode === 'advanced') return task.cron_expression
                             return getScheduleDescription(
                               params.frequency,
                               params.intervalValue,
                               params.intervalUnit,
                               params.time,
                               params.weekdays,
                               task.week_interval || 1,
                               params.monthDay
                             )
                           })()}
                         </span>
                       </div>
                     </div>
                     
                     <div className="flex flex-col gap-1">
                        <button
                          onClick={(e) => handleToggle(e, task)}
                          className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                            isEnabled ? 'bg-blue-600' : 'bg-gray-300'
                          }`}
                        >
                          <span
                            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                              isEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                     </div>
                   </div>
                   
                   {/* Hover Actions */}
                   <div className={`absolute right-2 bottom-2 flex items-center gap-1 transition-opacity ${
                     isSelected || runningTasks.has(task.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                   }`}>
                      <button
                        onClick={(e) => handleRunNow(e, task.id)}
                        disabled={runningTasks.has(task.id)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title={t('taskList.runNow')}
                      >
                         {runningTasks.has(task.id) ? (
                            <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent" />
                         ) : (
                            <Play className="w-3.5 h-3.5 fill-current" />
                         )}
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, task.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title={t('common.delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                   </div>
                 </div>
               )
            })
          )}
        </div>
      </div>

      {/* Right Panel - Content */}
      <div className="flex-1 bg-gray-50/50 rounded-2xl border border-gray-100 overflow-hidden flex flex-col relative">
        {showTaskForm ? (
           <TaskForm 
             task={editingTask} 
             onClose={onCloseForm} 
             onSaved={onTaskSaved} 
             variant="panel"
           />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center">
            <div className="w-16 h-16 bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center justify-center mb-4">
              <Terminal className="w-8 h-8 text-gray-300" />
            </div>
            <h3 className="text-gray-900 font-medium mb-1">{t('taskList.noTaskSelected')}</h3>
            <p className="text-sm max-w-xs mx-auto">{t('taskList.noTaskSelectedDesc')}</p>
            <button
               onClick={onNewTask}
               className="mt-6 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg shadow-sm hover:bg-blue-700 hover:shadow-md transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {t('taskList.createNewTask')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
