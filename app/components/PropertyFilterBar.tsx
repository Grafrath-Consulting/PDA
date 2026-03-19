'use client'

import { Property, useProperties } from '@/context/PropertiesContext'

interface Props {
  properties: Property[]
  activeFilters: Set<string>  // set of property_value_id
  onToggleFilter: (propertyValueId: string) => void
  onClearFilters: () => void
  showPinToggle?: boolean
  onTogglePin?: (propertyId: string, pinned: boolean) => void
}

/** Map color keys to pill background colors */
const PILL_COLORS: Record<string, string> = {
  red: '#FEE2E2', amber: '#FEF3C7', green: '#D1FAE5',
  blue: '#DBEAFE', indigo: '#E0E7FF', violet: '#EDE9FE',
  pink: '#FCE7F3', gray: '#F3F4F6',
  rose: '#FFE4E6', orange: '#FFEDD5', teal: '#CCFBF1', cyan: '#CFFAFE',
  sky: '#E0F2FE', fuchsia: '#FAE8FF', lime: '#ECFCCB', slate: '#F1F5F9',
}

export function PropertyFilterBar({ properties, activeFilters, onToggleFilter, onClearFilters, showPinToggle, onTogglePin }: Props) {
  const { refetch } = useProperties()
  if (properties.length === 0) return null

  const hasActive = activeFilters.size > 0

  async function handleTogglePin(prop: Property) {
    const next = !prop.pinned_in_filter_bar
    // Optimistic: mutate in-place for immediate UI feedback
    prop.pinned_in_filter_bar = next
    onTogglePin?.(prop.id, next)
    await refetch()
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {properties.map((prop) => (
        <div key={prop.id} className="flex items-center gap-1">
          {showPinToggle && (
            <button
              onClick={() => handleTogglePin(prop)}
              title={prop.pinned_in_filter_bar ? 'Unpin from quick bar' : 'Pin to quick bar'}
              className={`transition-colors ${prop.pinned_in_filter_bar ? 'text-amber-500' : 'text-gray-300 hover:text-gray-400'}`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill={prop.pinned_in_filter_bar ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" />
              </svg>
            </button>
          )}
          <span className="text-[10px] text-gray-400 font-medium mr-0.5">{prop.name}</span>
          {prop.values.map((val) => {
            const isActive = activeFilters.has(val.id)
            const bg = val.color ? PILL_COLORS[val.color] : undefined
            return (
              <button
                key={val.id}
                onClick={() => onToggleFilter(val.id)}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all ${
                  isActive
                    ? 'border-amber-400 ring-1 ring-amber-300 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                style={{
                  backgroundColor: isActive ? (bg ?? '#FEF3C7') : (bg ?? '#F9FAFB'),
                  color: isActive ? '#78350F' : '#6B7280',
                }}
              >
                {val.label}
              </button>
            )
          })}
        </div>
      ))}
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
