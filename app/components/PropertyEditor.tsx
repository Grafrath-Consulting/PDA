'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { Property } from '@/context/PropertiesContext'

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
  red:     { bg: '#FEE2E2', text: '#991B1B' },
  amber:   { bg: '#FEF3C7', text: '#92400E' },
  green:   { bg: '#D1FAE5', text: '#065F46' },
  blue:    { bg: '#DBEAFE', text: '#1E40AF' },
  indigo:  { bg: '#E0E7FF', text: '#3730A3' },
  violet:  { bg: '#EDE9FE', text: '#5B21B6' },
  pink:    { bg: '#FCE7F3', text: '#9D174D' },
  gray:    { bg: '#F3F4F6', text: '#374151' },
  rose:    { bg: '#FFE4E6', text: '#9F1239' },
  orange:  { bg: '#FFEDD5', text: '#9A3412' },
  teal:    { bg: '#CCFBF1', text: '#115E59' },
  cyan:    { bg: '#CFFAFE', text: '#155E75' },
  sky:     { bg: '#E0F2FE', text: '#075985' },
  fuchsia: { bg: '#FAE8FF', text: '#86198F' },
  lime:    { bg: '#ECFCCB', text: '#3F6212' },
  slate:   { bg: '#F1F5F9', text: '#334155' },
}
const DEFAULT_COLOR = { bg: '#F3F4F6', text: '#374151' }
function colorFor(color: string | null) {
  if (!color) return DEFAULT_COLOR
  return COLOR_MAP[color] ?? DEFAULT_COLOR
}

interface Props {
  blockId: string
  appliedValueIds: Set<string>
  properties: Property[]
  onChanged: (newAppliedIds: Set<string>) => void
  onClose: () => void
  anchorRef?: React.RefObject<HTMLElement | null>
}

export function PropertyEditor({ blockId, appliedValueIds, properties, onChanged, onClose, anchorRef }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [pickerTop, setPickerTop] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  function computePos(rect: DOMRect) {
    const narrow = window.innerWidth < 640
    setIsMobile(narrow)
    if (narrow) {
      setPos({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - 240)) })
    } else {
      setPos({ top: rect.top, left: rect.right + 8 })
    }
  }

  // Position the portal relative to the anchor button
  useLayoutEffect(() => {
    if (!anchorRef?.current) return
    computePos(anchorRef.current.getBoundingClientRect())
  }, [anchorRef])

  // Reposition on scroll/resize
  useEffect(() => {
    if (!anchorRef?.current) return
    function update() {
      computePos(anchorRef!.current!.getBoundingClientRect())
    }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchorRef])

  useLayoutEffect(() => {
    if (!openDropdown || !rowRefs.current[openDropdown] || !listRef.current) return
    const listRect = listRef.current.getBoundingClientRect()
    const rowRect = rowRefs.current[openDropdown]!.getBoundingClientRect()
    setPickerTop(rowRect.bottom - listRect.top)
  }, [openDropdown])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!ref.current) return
      const target = e.target as HTMLElement
      if (ref.current.contains(target)) return
      if (target.closest?.('[title="Add property"]')) return
      onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (openDropdown) { setOpenDropdown(null); e.stopPropagation() }
        else onClose()
      }
    }
    document.addEventListener('mousedown', handleClick, true)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick, true)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose, openDropdown])

  async function toggleValue(propertyId: string, valueId: string) {
    const prop = properties.find(p => p.id === propertyId)
    if (!prop) return

    const isPending = blockId === '__pending__'
    const next = new Set(appliedValueIds)
    const isCurrentlyApplied = appliedValueIds.has(valueId)

    if (prop.allow_multiple) {
      // Multi-select: toggle the clicked value
      if (isCurrentlyApplied) {
        if (!isPending) {
          const supabase = createClient()
          await supabase.from('entry_properties').delete().eq('entry_id', blockId).eq('property_value_id', valueId)
        }
        next.delete(valueId)
      } else {
        if (!isPending) {
          const supabase = createClient()
          await supabase.from('entry_properties').insert({ entry_id: blockId, property_value_id: valueId })
        }
        next.add(valueId)
      }
    } else {
      // Single-select: remove existing for this property, then set new (or clear if same)
      const existingIds = prop.values.map(v => v.id).filter(id => appliedValueIds.has(id))
      if (!isPending) {
        const supabase = createClient()
        for (const eid of existingIds) {
          await supabase.from('entry_properties').delete().eq('entry_id', blockId).eq('property_value_id', eid)
        }
        if (!isCurrentlyApplied) {
          await supabase.from('entry_properties').insert({ entry_id: blockId, property_value_id: valueId })
        }
      }
      for (const eid of existingIds) { next.delete(eid) }
      if (!isCurrentlyApplied) { next.add(valueId) }
    }

    onChanged(next)
    // Keep dropdown open for multi-select, close for single-select
    if (!prop.allow_multiple) setOpenDropdown(null)
  }

  async function clearProperty(propertyId: string) {
    const prop = properties.find(p => p.id === propertyId)
    if (!prop) return
    const existingIds = prop.values.map(v => v.id).filter(id => appliedValueIds.has(id))
    if (existingIds.length === 0) return

    const isPending = blockId === '__pending__'
    const next = new Set(appliedValueIds)

    if (!isPending) {
      const supabase = createClient()
      for (const eid of existingIds) {
        await supabase.from('entry_properties').delete().eq('entry_id', blockId).eq('property_value_id', eid)
      }
    }
    for (const eid of existingIds) { next.delete(eid) }
    onChanged(next)
    setOpenDropdown(null)
  }

  const openProp = openDropdown ? properties.find(p => p.id === openDropdown) : null

  // +1 for the "None" button
  const pickerItemCount = openProp ? openProp.values.length + 1 : 0
  const needsScroll = pickerItemCount > 12

  const usePortal = !!anchorRef && typeof document !== 'undefined'

  const content = (
    <div
      ref={ref}
      className={usePortal ? '' : 'absolute left-full top-0 ml-2 z-40'}
      style={usePortal && pos ? { position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 } : undefined}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Property list panel */}
      <div ref={listRef} className="bg-white border border-[#E5E0D0] rounded-lg shadow-xl py-2 min-w-[200px] max-h-[320px] overflow-y-auto">
        <p className="px-3 pb-1 text-[10px] font-medium text-gray-400 uppercase tracking-wide">Properties</p>
        {properties.length === 0 && (
          <p className="px-3 py-2 text-xs text-gray-400">No properties defined yet.</p>
        )}
        {properties.map((prop) => {
          const appliedValues = prop.values.filter(v => appliedValueIds.has(v.id))
          const isOpen = openDropdown === prop.id

          return (
            <div
              key={prop.id}
              ref={el => { rowRefs.current[prop.id] = el }}
              className="px-3 py-1.5 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => setOpenDropdown(isOpen ? null : prop.id)}
            >
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-medium text-gray-500 flex-shrink-0 pointer-events-none">{prop.name}</label>
                {/* Applied value chips */}
                <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
                  {appliedValues.map(v => {
                    const c = colorFor(v.color)
                    return (
                      <span
                        key={v.id}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium"
                        style={{ backgroundColor: c.bg, color: c.text }}
                      >
                        {v.label}
                      </span>
                    )
                  })}
                  {appliedValues.length === 0 && !isOpen && (
                    <span className="text-[11px] text-gray-300">None</span>
                  )}
                </div>
                {/* Dropdown toggle arrow */}
                <span className="p-0.5 rounded text-gray-400 flex-shrink-0">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points={isOpen ? "9 6 15 12 9 18" : "6 9 12 15 18 9"} />
                  </svg>
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Value picker panel — to the right on desktop, below on mobile */}
      {openProp && (
        <div
          className={`absolute bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px] whitespace-nowrap ${
            needsScroll ? 'max-h-[320px] overflow-y-auto' : ''
          } ${isMobile ? 'left-0 mt-1' : 'left-full ml-1'}`}
          style={isMobile ? { top: '100%' } : { top: pickerTop, transform: 'translateY(-100%)' }}
        >
          <button
            type="button"
            onClick={() => clearProperty(openProp.id)}
            className={`w-full flex items-center px-2 py-1.5 text-xs text-left hover:bg-gray-50 transition-colors ${
              openProp.values.every(v => !appliedValueIds.has(v.id)) ? 'font-medium text-gray-700' : 'text-gray-500'
            }`}
          >
            None
          </button>
          {openProp.values.map(v => {
            const c = colorFor(v.color)
            const isSelected = appliedValueIds.has(v.id)
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => toggleValue(openProp.id, v.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-gray-50 transition-colors ${
                  isSelected ? 'font-medium' : ''
                }`}
              >
                {openProp.allow_multiple && (
                  <span className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${
                    isSelected ? 'bg-amber-500 border-amber-500' : 'border-gray-300'
                  }`}>
                    {isSelected && (
                      <svg className="w-2 h-2 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    )}
                  </span>
                )}
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium"
                  style={{ backgroundColor: c.bg, color: c.text }}
                >
                  {v.label}
                </span>
                {!openProp.allow_multiple && isSelected && (
                  <svg className="ml-auto w-3.5 h-3.5 text-amber-600 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )

  if (usePortal) {
    return createPortal(content, document.body)
  }
  return content
}
