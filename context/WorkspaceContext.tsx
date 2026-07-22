'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getScheme, WorkspaceColorScheme } from '@/constants/workspaceColorSchemes'

export interface Workspace {
  id: string
  user_id: string
  name: string
  emoji: string | null
  color_scheme: string
  is_default: boolean
  created_at: string
  sort_order: number
}

interface WorkspaceContextValue {
  workspaces: Workspace[]
  activeWorkspaceId: string | null   // null = global/merged view
  activeWorkspace: Workspace | null
  activeScheme: WorkspaceColorScheme | null
  isGlobalView: boolean
  hydrated: boolean
  setActiveWorkspace: (id: string | null) => void
  refreshWorkspaces: () => Promise<void>
  reorderWorkspaces: (fromIndex: number, toIndex: number) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

const LS_KEY = 'pda_active_workspace'

export function WorkspaceProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY)
    if (saved) setActiveWorkspaceId(saved)
    setHydrated(true)
  }, [])

  const loadWorkspaces = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('workspaces')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
    setWorkspaces((data ?? []) as Workspace[])
  }, [userId])

  useEffect(() => { loadWorkspaces() }, [loadWorkspaces])

  // If the persisted workspace doesn't exist in the loaded list, reset to global
  useEffect(() => {
    if (activeWorkspaceId && workspaces.length > 0 && !workspaces.find(w => w.id === activeWorkspaceId)) {
      setActiveWorkspaceId(null)
      localStorage.removeItem(LS_KEY)
    }
  }, [activeWorkspaceId, workspaces])

  const setActiveWorkspace = useCallback((id: string | null) => {
    setActiveWorkspaceId(id)
    if (id) {
      localStorage.setItem(LS_KEY, id)
    } else {
      localStorage.removeItem(LS_KEY)
    }
  }, [])

  const reorderWorkspaces = useCallback((fromIndex: number, toIndex: number) => {
    const next = [...workspaces]
    const [moved] = next.splice(fromIndex, 1)
    if (!moved) return
    next.splice(toIndex, 0, moved)
    setWorkspaces(next)
    // Persist new order to DB (fire-and-forget)
    const supabase = createClient()
    next.forEach((ws, i) => {
      supabase.from('workspaces').update({ sort_order: i + 1 }).eq('id', ws.id).then(() => {})
    })
  }, [workspaces])

  const activeWorkspace = activeWorkspaceId
    ? workspaces.find(w => w.id === activeWorkspaceId) ?? null
    : null

  const activeScheme = activeWorkspace ? getScheme(activeWorkspace.color_scheme) : null

  return (
    <WorkspaceContext.Provider value={{
      workspaces,
      activeWorkspaceId,
      activeWorkspace,
      activeScheme,
      isGlobalView: !activeWorkspaceId,
      hydrated,
      setActiveWorkspace,
      refreshWorkspaces: loadWorkspaces,
      reorderWorkspaces,
    }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}
