'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Task {
  id: string
  title: string
  due_date: string | null
  task_type: 'my_task' | 'delegated' | 'waiting_on'
  status: string
}

interface Section {
  key: string
  label: string
  tasks: Task[]
  accent: 'red' | 'amber' | 'sky' | 'violet'
}

function formatDue(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface SectionBlockProps {
  section: Section
  collapsed: boolean
  onToggle: () => void
}

const ACCENT: Record<string, { header: string; badge: string; item: string; dot: string }> = {
  red:    { header: 'text-red-600',    badge: 'bg-red-100 text-red-600',    item: 'text-red-800',    dot: 'bg-red-400' },
  amber:  { header: 'text-amber-600',  badge: 'bg-amber-100 text-amber-600',  item: 'text-gray-700',   dot: 'bg-amber-400' },
  sky:    { header: 'text-sky-600',    badge: 'bg-sky-100 text-sky-600',    item: 'text-gray-700',   dot: 'bg-sky-400' },
  violet: { header: 'text-violet-600', badge: 'bg-violet-100 text-violet-600', item: 'text-gray-700',   dot: 'bg-violet-400' },
}

function SectionBlock({ section, collapsed, onToggle }: SectionBlockProps) {
  const count = section.tasks.length
  const colors = ACCENT[section.accent]

  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        disabled={count === 0}
        className="flex items-center justify-between w-full px-1 py-1.5 rounded hover:bg-[#FFFEF7] transition-colors disabled:cursor-default"
      >
        <div className="flex items-center gap-1.5">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-gray-400 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className={`text-xs font-semibold ${count > 0 ? colors.header : 'text-gray-400'}`}>
            {section.label}
          </span>
        </div>
        {count > 0 && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${colors.badge}`}>
            {count}
          </span>
        )}
      </button>

      {!collapsed && count > 0 && (
        <div className="mt-0.5 space-y-px pl-4">
          {section.tasks.map((task) => (
            <div key={task.id} className="flex items-start gap-2 py-1.5 px-2 rounded-lg hover:bg-[#FFFEF7]">
              <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${colors.dot}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-xs leading-snug ${colors.item} break-words`}>{task.title}</p>
                {task.due_date && (
                  <p className="text-xs text-gray-400 mt-0.5">{formatDue(task.due_date)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  userId: string
}

export function RightPanel({ userId }: Props) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  // null = auto (derived from task count); true/false = manual override
  const [manualCollapse, setManualCollapse] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('tasks')
      .select('id, title, due_date, task_type, status')
      .eq('user_id', userId)
      .neq('status', 'done')
      .neq('status', 'cancelled')
      .order('due_date', { ascending: true, nullsFirst: false })
      .then(({ data }) => {
        setTasks((data ?? []) as Task[])
        setLoading(false)
      })
  }, [userId])

  const today = new Date().toISOString().split('T')[0]

  const sections: Section[] = [
    {
      key: 'overdue',
      label: 'Overdue',
      accent: 'red',
      tasks: tasks.filter((t) => t.due_date && t.due_date < today),
    },
    {
      key: 'today',
      label: 'Due Today',
      accent: 'amber',
      tasks: tasks.filter((t) => t.due_date === today),
    },
    {
      key: 'waiting',
      label: 'Waiting On',
      accent: 'sky',
      tasks: tasks.filter((t) => t.task_type === 'waiting_on'),
    },
    {
      key: 'delegated',
      label: 'Delegated',
      accent: 'violet',
      tasks: tasks.filter((t) => t.task_type === 'delegated'),
    },
  ]

  const allEmpty = sections.every((s) => s.tasks.length === 0)

  function isCollapsed(section: Section) {
    if (section.key in manualCollapse) return manualCollapse[section.key]
    // Auto: collapse empty sections, expand non-empty
    return section.tasks.length === 0
  }

  function toggleSection(key: string) {
    const section = sections.find((s) => s.key === key)!
    setManualCollapse((prev) => ({ ...prev, [key]: !isCollapsed(section) }))
  }

  return (
    <div className="w-[280px] flex-shrink-0 bg-white border-l border-[#E5E0D0] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {loading && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-6 bg-[#FFFEF7] rounded animate-pulse" />
            ))}
          </div>
        )}

        {!loading && allEmpty && (
          <div className="text-center py-10">
            <p className="text-sm font-medium text-gray-500">All clear</p>
            <p className="text-xs text-gray-400 mt-1">No tasks need attention.</p>
          </div>
        )}

        {!loading && !allEmpty && sections.map((section) => (
          <SectionBlock
            key={section.key}
            section={section}
            collapsed={isCollapsed(section)}
            onToggle={() => toggleSection(section.key)}
          />
        ))}
      </div>
    </div>
  )
}
