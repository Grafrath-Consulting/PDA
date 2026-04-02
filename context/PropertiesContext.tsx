'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspace } from './WorkspaceContext'

export interface PropertyValue {
  id: string
  property_id: string
  label: string
  color: string | null
  sort_order: number
  archived: boolean
}

export interface Property {
  id: string
  user_id: string
  workspace_id: string | null
  name: string
  pinned_in_filter_bar: boolean
  allow_multiple: boolean
  archived: boolean
  sort_order: number
  values: PropertyValue[]
}

interface PropertiesContextValue {
  allProperties: Property[]
  globalProperties: Property[]
  propertiesForWorkspace: (workspaceId: string | null) => Property[]
  refetch: () => Promise<void>
  reorderProperties: (fromIndex: number, toIndex: number) => void
}

const PropertiesContext = createContext<PropertiesContextValue | null>(null)

export function PropertiesProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { activeWorkspaceId } = useWorkspace()
  const [allProperties, setAllProperties] = useState<Property[]>([])

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: props } = await supabase
      .from('properties')
      .select('id, user_id, workspace_id, name, pinned_in_filter_bar, allow_multiple, archived, sort_order')
      .eq('user_id', userId)
      .order('sort_order')

    if (!props || props.length === 0) { setAllProperties([]); return }

    const { data: vals } = await supabase
      .from('property_values')
      .select('id, property_id, label, color, sort_order, archived')
      .in('property_id', props.map(p => p.id))
      .order('sort_order')

    const valuesByProp = new Map<string, PropertyValue[]>()
    for (const v of (vals ?? []) as PropertyValue[]) {
      const arr = valuesByProp.get(v.property_id) ?? []
      arr.push(v)
      valuesByProp.set(v.property_id, arr)
    }

    setAllProperties(
      (props as Omit<Property, 'values'>[]).map(p => ({
        ...p,
        values: (valuesByProp.get(p.id) ?? []).sort((a, b) => a.label.localeCompare(b.label)),
      }))
    )
  }, [userId])

  useEffect(() => { load() }, [load, activeWorkspaceId])

  const reorderProperties = useCallback((fromIndex: number, toIndex: number) => {
    setAllProperties(prev => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      const supabase = createClient()
      next.forEach((p, i) => {
        supabase.from('properties').update({ sort_order: i + 1 }).eq('id', p.id).then(() => {})
      })
      return next
    })
  }, [])

  const globalProperties = allProperties.filter(p => p.workspace_id === null)

  const propertiesForWorkspace = useCallback((workspaceId: string | null): Property[] => {
    return allProperties.filter(
      p => p.workspace_id === null || p.workspace_id === workspaceId
    )
  }, [allProperties])

  return (
    <PropertiesContext.Provider value={{
      allProperties,
      globalProperties,
      propertiesForWorkspace,
      refetch: load,
      reorderProperties,
    }}>
      {children}
    </PropertiesContext.Provider>
  )
}

export function useProperties() {
  const ctx = useContext(PropertiesContext)
  if (!ctx) throw new Error('useProperties must be used within PropertiesProvider')
  return ctx
}
