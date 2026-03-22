'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspace } from '@/context/WorkspaceContext'
import { getScheme } from '@/constants/workspaceColorSchemes'

interface TodayTask {
  id: string
  content: string | null
  owner_id: string | null
  due_date: string | null
  due_date_type: 'deadline' | 'target' | null
  workspace_id: string | null
}

interface Person {
  id: string
  name: string
}

/** Strip HTML tags to plain text. Uses DOM when available, regex fallback for SSR. */
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

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

interface Props {
  userId: string
  refreshKey?: number
  onTaskClick?: (blockId: string) => void
}

export function RightPanel({ userId, refreshKey, onTaskClick }: Props) {
  const { activeWorkspaceId, isGlobalView, workspaces } = useWorkspace()
  const [tasks, setTasks] = useState<TodayTask[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTasks = useCallback(async () => {
    const supabase = createClient()
    const today = todayISO()
    let query = supabase
      .from('journal_blocks')
      .select('id, content, owner_id, due_date, due_date_type, task_status, workspace_id')
      .eq('user_id', userId)
      .eq('entry_type', 'task')
      .gte('due_date', `${today}T00:00:00`)
      .lte('due_date', `${today}T23:59:59`)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (!isGlobalView && activeWorkspaceId) {
      query = query.eq('workspace_id', activeWorkspaceId)
    }

    const { data } = await query
    setTasks((data ?? []) as TodayTask[])
    setLoading(false)
  }, [userId, activeWorkspaceId, isGlobalView])

  useEffect(() => { fetchTasks() }, [fetchTasks, refreshKey])

  // Load people once for owner display
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('people')
      .select('id, name')
      .eq('user_id', userId)
      .order('name')
      .then(({ data }) => setPeople((data ?? []) as Person[]))
  }, [userId])

  function personName(ownerId: string | null): string | null {
    if (!ownerId) return null
    return people.find(p => p.id === ownerId)?.name ?? null
  }

  async function markComplete(taskId: string) {
    // Optimistic removal
    setTasks(prev => prev.filter(t => t.id !== taskId))
    const supabase = createClient()
    await supabase.from('journal_blocks').update({ status: 'complete' }).eq('id', taskId)
  }

  function workspaceColor(workspaceId: string | null): string | null {
    if (!isGlobalView || !workspaceId) return null
    const ws = workspaces.find(w => w.id === workspaceId)
    if (!ws) return null
    return getScheme(ws.color_scheme)?.primary ?? null
  }

  return (
    <div className="w-[280px] flex-shrink-0 bg-white border-l border-[#E5E0D0] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-[#E5E0D0]">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Due Today</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loading && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-[#FFFEF7] rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {!loading && tasks.length === 0 && (
          <div className="text-center py-10">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-gray-300 mb-2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <p className="text-sm text-gray-400">Nothing due today</p>
          </div>
        )}

        {!loading && tasks.length > 0 && (
          <div className="space-y-1.5">
            {tasks.map((task) => {
              const wsColor = workspaceColor(task.workspace_id)
              const owner = personName(task.owner_id)
              const text = truncate(htmlToPlainText(task.content), 120)
              const isDeadline = task.due_date_type === 'deadline'

              return (
                <div
                  key={task.id}
                  className="flex items-start gap-2 p-2 rounded-lg hover:bg-[#FFFEF7] cursor-pointer transition-colors group"
                  style={wsColor ? { borderLeft: `3px solid ${wsColor}` } : undefined}
                  onClick={() => onTaskClick?.(task.id)}
                >
                  {/* Completion checkbox */}
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
                      {owner && (
                        <span className="text-[10px] text-gray-400">{owner}</span>
                      )}
                      <span className={`text-[10px] ${isDeadline ? 'font-semibold text-red-500' : 'text-gray-400'}`}>
                        {isDeadline ? 'Deadline' : 'Target'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
