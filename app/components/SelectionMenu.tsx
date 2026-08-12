'use client'

import { useRef, useState, useLayoutEffect } from 'react'
import { SelectionAction, SelectionFormat } from '../types'

// Project linking has been removed — project association is now handled via a
// workspace-local "Project" property with user-defined values in the properties system.

interface Props {
  position: { x: number; y: number }
  userId: string
  selectedText: string
  onClose: () => void
  onAction: (action: SelectionAction) => void
  disableSplit?: boolean
}

export function SelectionMenu({ position, selectedText, onClose, onAction, disableSplit }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [flipped, setFlipped] = useState(false)

  useLayoutEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    if (rect.bottom > window.innerHeight - 8) {
      setFlipped(true)
    }
  }, [position])

  function act(action: SelectionAction) {
    onAction(action)
    onClose()
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(position.x, window.innerWidth - 100),
    top: flipped ? undefined : position.y + 6,
    bottom: flipped ? (window.innerHeight - position.y + 6) : undefined,
    transform: 'translateX(-50%)',
    zIndex: 50,
  }

  return (
    <div
      ref={menuRef}
      style={style}
      className="bg-white border border-[#E5E0D0] rounded-lg shadow-xl py-1 min-w-[176px]"
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuSection>
        <Item onClick={() => { navigator.clipboard.writeText(selectedText); act({ type: 'delete_selection' }) }}>
          <CutIcon /> Cut
        </Item>
        <Item onClick={() => { navigator.clipboard.writeText(selectedText); onClose() }}>
          <CopyIcon /> Copy
        </Item>
        <Item onClick={() => act({ type: 'insert_link' })}>
          <LinkIcon /> Insert Link
        </Item>
        <FormattingItem onSelect={(format) => act({ type: 'format', format })} />
      </MenuSection>
      <Sep />
      <MenuSection>
        {!disableSplit && (
          <Item onClick={() => act({ type: 'split_block' })}>
            <SplitIcon /> Split to New Entry
          </Item>
        )}
      </MenuSection>
      <Sep />
      <MenuSection>
        <Item onClick={() => act({ type: 'summarize' })}>
          <RobotIcon /> AI Summarize
        </Item>
      </MenuSection>
    </div>
  )
}

function MenuSection({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>
}

const FORMAT_ITEMS: { format: SelectionFormat; label: string; icon: React.ReactNode }[] = [
  { format: 'bold', label: 'Bold', icon: <Glyph className="font-bold">B</Glyph> },
  { format: 'italic', label: 'Italic', icon: <Glyph className="italic font-serif">I</Glyph> },
  { format: 'underline', label: 'Underline', icon: <Glyph className="underline">U</Glyph> },
  { format: 'strike', label: 'Strikethrough', icon: <Glyph className="line-through">S</Glyph> },
  { format: 'highlight', label: 'Highlight', icon: <HighlightIcon /> },
  { format: 'code', label: 'Code', icon: <CodeIcon /> },
]

// "Formatting >" row: hovering (or clicking) it opens a submenu of the inline
// marks that can be applied to the selection. The submenu is a child of the
// row's wrapper, so moving the pointer into it never fires mouseleave.
function FormattingItem({ onSelect }: { onSelect: (format: SelectionFormat) => void }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState<'right' | 'left'>('right')
  const [flippedUp, setFlippedUp] = useState(false)

  useLayoutEffect(() => {
    if (!open || !wrapRef.current || !subRef.current) return
    const anchor = wrapRef.current.getBoundingClientRect()
    const sub = subRef.current.getBoundingClientRect()
    setSide(anchor.right + sub.width > window.innerWidth - 8 ? 'left' : 'right')
    setFlippedUp(anchor.top + sub.height > window.innerHeight - 8)
  }, [open])

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Item onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}>
        <FormatIcon /> Formatting
        <ChevronRightIcon />
      </Item>
      {open && (
        <div
          ref={subRef}
          role="menu"
          style={{
            position: 'absolute',
            left: side === 'right' ? '100%' : undefined,
            right: side === 'left' ? '100%' : undefined,
            top: flippedUp ? undefined : -4,
            bottom: flippedUp ? -4 : undefined,
          }}
          className="bg-white border border-[#E5E0D0] rounded-lg shadow-xl py-1 min-w-[168px]"
        >
          {FORMAT_ITEMS.map(({ format, label, icon }) => (
            <Item key={format} onClick={() => onSelect(format)}>
              {icon} {label}
            </Item>
          ))}
          <Sep />
          <Item onClick={() => onSelect('clear')}>
            <ClearFormatIcon /> Clear Formatting
          </Item>
        </div>
      )}
    </div>
  )
}

function Glyph({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`w-[13px] text-center text-xs leading-none flex-shrink-0 ${className}`}>{children}</span>
}

function Sep() {
  return <div className="h-px bg-[#E5E0D0] my-1" />
}

function Item({
  onClick,
  children,
  className = '',
  ...aria
}: {
  onClick: () => void
  children: React.ReactNode
  className?: string
  'aria-haspopup'?: 'menu'
  'aria-expanded'?: boolean
}) {
  return (
    <button
      {...aria}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 text-left hover:bg-[#FFFEF7] transition-colors ${className}`}
    >
      {children}
    </button>
  )
}

// Icons
function CutIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
}
function CopyIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
}
function SplitIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><line x1="3" y1="12" x2="21" y2="12" /><polyline points="8 7 3 12 8 17" /><polyline points="16 7 21 12 16 17" /></svg>
}
function RobotIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></svg>
}
function FormatIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></svg>
}
function ChevronRightIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 ml-auto text-gray-400"><polyline points="9 18 15 12 9 6" /></svg>
}
function HighlightIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /><line x1="2" y1="20" x2="6" y2="20" stroke="#FBBF24" strokeWidth="3" /></svg>
}
function CodeIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
}
function ClearFormatIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><path d="M4 7V4h16v3" /><path d="M5 20h6" /><path d="M13 4 8 20" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="21" y1="15" x2="15" y2="21" /></svg>
}
function LinkIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
}
