'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Property } from '@/context/PropertiesContext'

interface Props {
  blockId: string
  appliedValueIds: Set<string>
  properties: Property[]
  onChanged: (newAppliedIds: Set<string>) => void
  onClose: () => void
}

export function PropertyEditor({ blockId, appliedValueIds, properties, onChanged, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!ref.current) return
      const target = e.target as HTMLElement
      if (ref.current.contains(target)) return
      // Don't close if clicking the add-tag button (it toggles the popover itself)
      if (target.closest?.('[title="Add property"]')) return
      onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    // Use capture phase so stopPropagation in parent handlers doesn't block us
    document.addEventListener('mousedown', handleClick, true)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick, true)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  async function selectValue(propertyId: string, valueId: string | null) {
    const prop = properties.find(p => p.id === propertyId)
    if (!prop) return

    // Remove any existing values for this property on this entry
    const existingIds = prop.values.map(v => v.id).filter(id => appliedValueIds.has(id))
    const next = new Set(appliedValueIds)

    const isPending = blockId === '__pending__'

    if (!isPending) {
      const supabase = createClient()
      for (const eid of existingIds) {
        await supabase.from('entry_properties').delete().eq('entry_id', blockId).eq('property_value_id', eid)
      }
      if (valueId) {
        await supabase.from('entry_properties').insert({ entry_id: blockId, property_value_id: valueId })
      }
    }

    for (const eid of existingIds) { next.delete(eid) }
    if (valueId) { next.add(valueId) }

    onChanged(next)
  }

  return (
    <div
      ref={ref}
      className="absolute top-2 left-4 z-40 bg-white border border-[#E5E0D0] rounded-lg shadow-xl py-2 min-w-[200px] max-h-[320px] overflow-y-auto"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="px-3 pb-1 text-[10px] font-medium text-gray-400 uppercase tracking-wide">Properties</p>
      {properties.length === 0 && (
        <p className="px-3 py-2 text-xs text-gray-400">No properties defined yet.</p>
      )}
      {properties.map((prop) => {
        const currentValue = prop.values.find(v => appliedValueIds.has(v.id))
        return (
          <div key={prop.id} className="px-3 py-1.5">
            <label className="text-[11px] font-medium text-gray-500">{prop.name}</label>
            <select
              value={currentValue?.id ?? ''}
              onChange={(e) => selectValue(prop.id, e.target.value || null)}
              className="block w-full mt-0.5 text-xs text-gray-900 bg-gray-50 border border-gray-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-amber-300 cursor-pointer"
            >
              <option value="">None</option>
              {prop.values.map(v => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </div>
        )
      })}
    </div>
  )
}
