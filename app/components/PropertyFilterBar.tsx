'use client'

import { useState } from 'react'
import { Property, useProperties } from '@/context/PropertiesContext'
import { getPropertyColor } from '@/constants/propertyColors'

interface Props {
  properties: Property[]
  activeFilters: Set<string>  // set of property_value_id
  onToggleFilter: (propertyValueId: string) => void
  onClearFilters: () => void
  showPinToggle?: boolean
  onTogglePin?: (propertyId: string, pinned: boolean) => void
}

export function PropertyFilterBar({ properties, activeFilters, onToggleFilter, onClearFilters, showPinToggle, onTogglePin }: Props) {
  const { refetch } = useProperties()
  // Optimistic local overrides for pin state, keyed by property id
  const [pinOverrides, setPinOverrides] = useState<Record<string, boolean>>({})

  if (properties.length === 0) return null

  const hasActive = activeFilters.size > 0

  function handleTogglePin(prop: Property) {
    const current = pinOverrides[prop.id] ?? prop.pinned_in_filter_bar
    const next = !current
    // Instant optimistic update
    setPinOverrides(prev => ({ ...prev, [prop.id]: next }))
    // Fire DB update + refetch in background, then clear override
    Promise.resolve(onTogglePin?.(prop.id, next))
      .then(() => refetch())
      .then(() => setPinOverrides(prev => {
        const copy = { ...prev }
        delete copy[prop.id]
        return copy
      }))
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {properties.map((prop) => {
        const pinned = pinOverrides[prop.id] ?? prop.pinned_in_filter_bar
        return (
        <div key={prop.id} className="flex flex-wrap items-center gap-1">
          {showPinToggle && (
            <button
              onClick={() => handleTogglePin(prop)}
              title={pinned ? 'Unpin from quick bar' : 'Pin to quick bar'}
              className={`transition-colors ${pinned ? 'text-amber-500' : 'text-gray-300 hover:text-gray-400'}`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" />
              </svg>
            </button>
          )}
          <span className="text-[10px] font-medium mr-0.5 text-gray-400">{prop.name}</span>
          {(() => {
            const noneId = `none::${prop.id}`
            const noneActive = activeFilters.has(noneId)
            return (
              <button
                key={noneId}
                onClick={() => onToggleFilter(noneId)}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all ${
                  noneActive
                    ? 'border-amber-400 ring-1 ring-amber-300 shadow-sm'
                    : 'border-dashed border-gray-300 hover:border-gray-400'
                }`}
                style={{
                  backgroundColor: noneActive ? '#FFFBEB' : '#FFFFFF',
                  color: noneActive ? '#78350F' : '#9CA3AF',
                }}
              >
                None
              </button>
            )
          })()}
          {prop.values.map((val) => {
            const isActive = activeFilters.has(val.id)
            const pc = getPropertyColor(val.color)
            return (
              <button
                key={val.id}
                onClick={() => onToggleFilter(val.id)}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all ${
                  isActive
                    ? 'border-amber-400 ring-1 ring-amber-300 shadow-sm'
                    : val.archived
                      ? 'border-dashed border-gray-300 hover:border-gray-400'
                      : 'border-gray-200 hover:border-gray-300'
                }`}
                style={{
                  backgroundColor: isActive ? pc.bg : pc.bg,
                  color: isActive ? pc.text : '#6B7280',
                }}
              >
                {val.label}
              </button>
            )
          })}
        </div>
        )
      })}
      {hasActive && (
        <button
          onClick={onClearFilters}
          className="text-[11px] text-gray-400 hover:text-gray-600 underline ml-1"
        >
          Clear
        </button>
      )}
    </div>
  )
}
