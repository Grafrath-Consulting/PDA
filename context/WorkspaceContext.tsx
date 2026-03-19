'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import workspaceColorSchemes, { getScheme, WorkspaceColorScheme } from '@/constants/workspaceColorSchemes'

export interface Workspace {
  id: string
  user_id: string
  name: string
  emoji: string | null
  color_scheme: string
  is_default: boolean
  created_at: string
}

interface WorkspaceContextValue {
  workspaces: Workspace[]
  activeWorkspaceId: string | null   // null = global/merged view
  activeWorkspace: Workspace | null
  activeScheme: WorkspaceColorScheme | null
  isGlobalView: boolean
  setActiveWorkspace: (id: string | null) => void
  refreshWorkspaces: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

const LS_KEY = 'pda_active_workspace'

export function WorkspaceProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY)
    if (saved) setActiveWorkspaceId(saved)
  }, [])

  const loadWorkspaces = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('workspaces')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
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
      setActiveWorkspace,
      refreshWorkspaces: loadWorkspaces,
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
