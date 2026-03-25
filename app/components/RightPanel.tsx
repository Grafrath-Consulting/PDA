'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspace } from '@/context/WorkspaceContext'
import { getScheme } from '@/constants/workspaceColorSchemes'

interface TaskItem {
  id: string
  content: string | null
  owner_id: string | null
  due_date: string | null
  due_date_type: 'deadline' | 'target' | null
  workspace_id: string | null
  updated_at: string
}

interface ActivityItem {
  id: string
  content: string | null
  entry_type: 'info' | 'task'
  workspace_id: string | null
  updated_at: string
}

interface Person {
  id: string
  name: string
}

function htmlToPlainText(html: string | null): string {
  if (!html) return ''
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, '')
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent ?? ''
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trimEnd() + '…'
}

function todayStart(): string {
  return new Date().toISOString().split('T')[0] + 'T00:00:00'
}

function todayEnd(): string {
  return new Date().toISOString().split('T')[0] + 'T23:59:59'
}

function addDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0] + 'T23:59:59'
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const FUTURE_RANGES = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'All', days: 0 },
] as const

interface Props {
  userId: string
  refreshKey?: number
  onTaskClick?: (blockId: string) => void
  onClose?: () => void
}

export function RightPanel({ userId, refreshKey, onTaskClick, onClose }: Props) {
  const { activeWorkspaceId, isGlobalView, workspaces } = useWorkspace()
  const [dueTasks, setDueTasks] = useState<TaskItem[]>([])
  const [futureTasks, setFutureTasks] = useState<TaskItem[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [futureRange, setFutureRange] = useState(7)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const today = todayEnd()

    // Tasks Due: past due + due today
    let dueQuery = supabase
      .from('journal_blocks')
      .select('id, content, owner_id, due_date, due_date_type, workspace_id, updated_at')
      .eq('user_id', userId)
      .eq('entry_type', 'task')
      .lte('due_date', today)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('due_date', { ascending: true })
      .limit(50)
    if (!isGlobalView && activeWorkspaceId) dueQuery = dueQuery.eq('workspace_id', activeWorkspaceId)

    // Future tasks
    const futureEnd = futureRange === 0 ? undefined : addDays(futureRange)
    let futureQuery = supabase
      .from('journal_blocks')
      .select('id, content, owner_id, due_date, due_date_type, workspace_id, updated_at')
      .eq('user_id', userId)
      .eq('entry_type', 'task')
      .gt('due_date', today)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('due_date', { ascending: true })
      .limit(50)
    if (futureEnd) futureQuery = futureQuery.lte('due_date', futureEnd)
    if (!isGlobalView && activeWorkspaceId) futureQuery = futureQuery.eq('workspace_id', activeWorkspaceId)

    // Recent activity: last 20 modified blocks
    let activityQuery = supabase
      .from('journal_blocks')
      .select('id, content, entry_type, workspace_id, updated_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(20)
    if (!isGlobalView && activeWorkspaceId) activityQuery = activityQuery.eq('workspace_id', activeWorkspaceId)

    const [dueRes, futureRes, activityRes] = await Promise.all([dueQuery, futureQuery, activityQuery])
    setDueTasks((dueRes.data ?? []) as TaskItem[])
    setFutureTasks((futureRes.data ?? []) as TaskItem[])
    setActivity((activityRes.data ?? []) as ActivityItem[])
    setLoading(false)
  }, [userId, activeWorkspaceId, isGlobalView, futureRange])

  useEffect(() => { fetchAll() }, [fetchAll, refreshKey])

  useEffect(() => {
    const supabase = createClient()
    supabase.from('people').select('id, name').eq('user_id', userId).order('name')
      .then(({ data }) => setPeople((data ?? []) as Person[]))
  }, [userId])

  function personName(ownerId: string | null): string | null {
    if (!ownerId) return null
    return people.find(p => p.id === ownerId)?.name ?? null
  }

  async function markComplete(taskId: string) {
    setDueTasks(prev => prev.filter(t => t.id !== taskId))
    setFutureTasks(prev => prev.filter(t => t.id !== taskId))
    const supabase = createClient()
    await supabase.from('journal_blocks').update({ status: 'complete' }).eq('id', taskId)
  }

  function wsColor(workspaceId: string | null): string | null {
    if (!isGlobalView || !workspaceId) return null
    const ws = workspaces.find(w => w.id === workspaceId)
    if (!ws) return null
    return getScheme(ws.color_scheme)?.primary ?? null
  }

  function formatDueDate(dueDate: string | null): string {
    if (!dueDate) return ''
    const d = new Date(dueDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const due = new Date(d)
    due.setHours(0, 0, 0, 0)
    const diff = Math.round((due.getTime() - today.getTime()) / 86400000)
    if (diff < 0) return `${Math.abs(diff)}d overdue`
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Tomorrow'
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  function renderTask(task: TaskItem, showDueLabel = true) {
    const color = wsColor(task.workspace_id)
    const owner = personName(task.owner_id)
    const text = truncate(htmlToPlainText(task.content), 100)
    const isDeadline = task.due_date_type === 'deadline'
    const isOverdue = task.due_date ? new Date(task.due_date) < new Date(todayStart()) : false

    return (
      <div
        key={task.id}
        className="flex items-start gap-2 p-2 rounded-lg hover:bg-[#FFFEF7] cursor-pointer transition-colors group"
        style={color ? { borderLeft: `3px solid ${color}` } : undefined}
        onClick={() => onTaskClick?.(task.id)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); markComplete(task.id) }}
          className="w-4 h-4 mt-0.5 rounded border border-gray-300 hover:border-amber-400 hover:bg-amber-50 flex items-center justify-center flex-shrink-0 transition-colors"
          title="Mark complete"
        >
          <svg width="0" height="0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 group-hover:[&]:w-2.5 group-hover:[&]:h-2.5 transition-all">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-700 leading-snug line-clamp-2 break-words">{text || 'Untitled task'}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {owner && <span className="text-[10px] text-gray-400">{owner}</span>}
            {showDueLabel && task.due_date && (
              <span className={`text-[10px] ${isOverdue ? 'font-semibold text-red-500' : isDeadline ? 'font-semibold text-orange-500' : 'text-gray-400'}`}>
                {formatDueDate(task.due_date)}
              </span>
            )}
            {!showDueLabel && (
              <span className={`text-[10px] ${isDeadline ? 'font-semibold text-red-500' : 'text-gray-400'}`}>
                {isDeadline ? 'Deadline' : 'Target'}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Mobile backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40 sm:hidden" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 w-[280px] z-50 sm:relative sm:z-auto flex flex-shrink-0 bg-white border-l border-[#E5E0D0] flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#E5E0D0] flex items-center justify-between">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Focus</h2>
          {onClose && (
            <button onClick={onClose} className="sm:hidden p-1 text-gray-400 hover:text-gray-600">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="px-3 py-3 space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-[#FFFEF7] rounded-lg animate-pulse" />
              ))}
            </div>
          )}

          {!loading && (
            <>
              {/* ── Tasks Due (Past Due + Today) ───────────────── */}
              <div className="px-3 pt-3 pb-1">
                <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Tasks Due
                  {dueTasks.length > 0 && <span className="ml-1 text-red-400">{dueTasks.length}</span>}
                </h3>
                {dueTasks.length === 0 ? (
                  <p className="text-[11px] text-gray-300 py-2 text-center">All clear</p>
                ) : (
                  <div className="space-y-1">
                    {dueTasks.map(t => renderTask(t, true))}
                  </div>
                )}
              </div>

              <div className="mx-3 border-t border-gray-100 my-2" />

              {/* ── Future Tasks ────────────────────────────────── */}
              <div className="px-3 pb-1">
                <div className="flex items-center justify-between mb-1.5">
                  <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Future Tasks</h3>
                  <select
                    value={futureRange}
                    onChange={(e) => setFutureRange(Number(e.target.value))}
                    className="text-[10px] text-gray-400 bg-transparent border-none outline-none cursor-pointer pr-0"
                  >
                    {FUTURE_RANGES.map(r => (
                      <option key={r.days} value={r.days}>{r.label}</option>
                    ))}
                  </select>
                </div>
                {futureTasks.length === 0 ? (
                  <p className="text-[11px] text-gray-300 py-2 text-center">No upcoming tasks</p>
                ) : (
                  <div className="space-y-1">
                    {futureTasks.map(t => renderTask(t, true))}
                  </div>
                )}
              </div>

              <div className="mx-3 border-t border-gray-100 my-2" />

              {/* ── Recent Activity ─────────────────────────────── */}
              <div className="px-3 pb-3">
                <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Recent Activity</h3>
                {activity.length === 0 ? (
                  <p className="text-[11px] text-gray-300 py-2 text-center">No recent activity</p>
                ) : (
                  <div className="space-y-1">
                    {activity.map(item => {
                      const color = wsColor(item.workspace_id)
                      const text = truncate(htmlToPlainText(item.content), 80)
                      return (
                        <div
                          key={item.id}
                          className="p-2 rounded-lg hover:bg-[#FFFEF7] cursor-pointer transition-colors"
                          style={color ? { borderLeft: `3px solid ${color}` } : undefined}
                          onClick={() => onTaskClick?.(item.id)}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {item.entry_type === 'task' ? (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 flex-shrink-0">
                                <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                              </svg>
                            ) : (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 flex-shrink-0">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                              </svg>
                            )}
                            <span className="text-[10px] text-gray-400">{relativeTime(item.updated_at)}</span>
                          </div>
                          <p className="text-xs text-gray-600 leading-snug line-clamp-2 break-words">{text || 'Untitled'}</p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
