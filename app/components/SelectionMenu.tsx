'use client'

import { SelectionAction } from '../types'

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
  function act(action: SelectionAction) {
    onAction(action)
    onClose()
  }

  // Position below the selection, centered horizontally on it
  const style: React.CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y + 6,
    transform: 'translateX(-50%)',
    zIndex: 50,
  }

  return (
    <div
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
      </MenuSection>
      <Sep />
      <MenuSection>
        {!disableSplit && (
          <Item onClick={() => act({ type: 'split_block' })}>
            <SplitIcon /> Split to Block
          </Item>
        )}
      </MenuSection>
      <Sep />
      <MenuSection>
        <Item onClick={() => act({ type: 'summarize' })}>
          <SparkleIcon /> AI Summarize
        </Item>
      </MenuSection>
    </div>
  )
}

function MenuSection({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>
}

function Sep() {
  return <div className="h-px bg-[#E5E0D0] my-1" />
}

function Item({
  onClick,
  children,
  className = '',
}: {
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
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
function SparkleIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
}
function LinkIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
}
