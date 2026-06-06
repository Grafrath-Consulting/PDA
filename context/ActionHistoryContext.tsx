'use client'

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react'
import { Block } from '@/app/types'

// One ring-buffer entry per feed-affecting app action (delete, archive, move,
// pin, property change). Carries everything needed to invert the action plus a
// snapshot of the card's title (the card may no longer be on screen). Session
// only — never persisted.
type ActionBase = { blockId: string; blockTitle: string }
export type ActionInput = ActionBase & (
  | { type: 'delete'; block: Block }
  | { type: 'archive'; block: Block }
  | { type: 'move'; fromWorkspaceId: string | null; toWorkspaceName: string }
  | { type: 'pin'; prev: boolean }
  | { type: 'property'; before: string[]; after: string[]; label: string }
  // In-card field edits (task status, assignee, dates, header, info/task convert).
  // `patch` holds the column(s) to restore; `label` describes what was done.
  | { type: 'field'; patch: Record<string, unknown>; label: string }
)
export type ActionEntry = ActionInput & { id: string; at: number; undone: boolean }

const MAX_ENTRIES = 25
const TOAST_MS = 6000

interface ActionHistoryValue {
  entries: ActionEntry[]
  record: (input: ActionInput, opts?: { toast?: boolean }) => void
  markUndone: (id: string) => void
  clear: () => void
  toastId: string | null
  dismissToast: () => void
}

const ActionHistoryContext = createContext<ActionHistoryValue | null>(null)

export function ActionHistoryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ActionEntry[]>([])
  const [toastId, setToastId] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismissToast = useCallback(() => {
    if (toastTimer.current) { clearTimeout(toastTimer.current); toastTimer.current = null }
    setToastId(null)
  }, [])

  const record = useCallback((input: ActionInput, opts?: { toast?: boolean }) => {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const entry = { ...input, id, at: Date.now(), undone: false } as ActionEntry
    setEntries(prev => [entry, ...prev].slice(0, MAX_ENTRIES))
    if (opts?.toast) {
      if (toastTimer.current) clearTimeout(toastTimer.current)
      setToastId(id)
      toastTimer.current = setTimeout(() => { setToastId(null); toastTimer.current = null }, TOAST_MS)
    }
  }, [])

  const markUndone = useCallback((id: string) => {
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, undone: true } : e)))
    setToastId(curr => (curr === id ? null : curr))
  }, [])

  const clear = useCallback(() => setEntries([]), [])

  return (
    <ActionHistoryContext.Provider value={{ entries, record, markUndone, clear, toastId, dismissToast }}>
      {children}
    </ActionHistoryContext.Provider>
  )
}

export function useActionHistory() {
  const ctx = useContext(ActionHistoryContext)
  if (!ctx) throw new Error('useActionHistory must be used within ActionHistoryProvider')
  return ctx
}
