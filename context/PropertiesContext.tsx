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
}

export interface Property {
  id: string
  user_id: string
  workspace_id: string | null
  name: string
  pinned_in_filter_bar: boolean
  values: PropertyValue[]
}

interface PropertiesContextValue {
  allProperties: Property[]
  globalProperties: Property[]
  propertiesForWorkspace: (workspaceId: string | null) => Property[]
  refetch: () => Promise<void>
}

const PropertiesContext = createContext<PropertiesContextValue | null>(null)

export function PropertiesProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { activeWorkspaceId } = useWorkspace()
  const [allProperties, setAllProperties] = useState<Property[]>([])

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: props } = await supabase
      .from('properties')
      .select('id, user_id, workspace_id, name, pinned_in_filter_bar')
      .eq('user_id', userId)
      .order('name')

    if (!props || props.length === 0) { setAllProperties([]); return }

    const { data: vals } = await supabase
      .from('property_values')
      .select('id, property_id, label, color, sort_order')
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
        values: valuesByProp.get(p.id) ?? [],
      }))
    )
  }, [userId])

  useEffect(() => { load() }, [load, activeWorkspaceId])

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
