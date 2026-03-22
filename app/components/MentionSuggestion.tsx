'use client'

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'

export interface MentionSuggestionItem {
  id: string
  name: string
}

export interface MentionSuggestionHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface Props {
  items: MentionSuggestionItem[]
  command: (item: { id: string; label: string }) => void
  clientRect: (() => DOMRect | null) | null
}

export const MentionSuggestionList = forwardRef<MentionSuggestionHandle, Props>(function MentionSuggestionList({ items, command, clientRect }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setSelectedIndex(0) }, [items])

  const selectItem = useCallback((idx: number) => {
    const item = items[idx]
    if (item) command({ id: item.id, label: item.name })
  }, [items, command])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((prev) => (prev + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((prev) => (prev + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex)
        return true
      }
      if (event.key === 'Escape') return true
      return false
    },
  }))

  const rect = clientRect?.()
  if (!rect) return null

  const style: React.CSSProperties = {
    position: 'fixed',
    left: rect.left,
    top: rect.bottom + 4,
    zIndex: 60,
  }

  return createPortal(
    <div ref={listRef} style={style} className="bg-white border border-[#E5E0D0] rounded-lg shadow-xl py-1 min-w-[180px] max-w-[280px]">
      {items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-gray-400">No people found</div>
      ) : (
        items.map((item, idx) => (
          <button
            key={item.id}
            onClick={() => selectItem(idx)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
              idx === selectedIndex ? 'bg-amber-50 text-amber-800' : 'text-gray-700 hover:bg-[#FFFEF7]'
            }`}
          >
            <div className="w-5 h-5 rounded-full bg-[#FEF3C7] flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-medium text-[#92400E]">{item.name[0]?.toUpperCase()}</span>
            </div>
            <span className="truncate">{item.name}</span>
          </button>
        ))
      )}
    </div>,
    document.body
  )
})
