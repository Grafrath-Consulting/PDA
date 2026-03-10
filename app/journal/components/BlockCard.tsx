'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Block, BlockStatus, SelectionAction } from '../types'
import { SelectionMenu } from './SelectionMenu'
import { HistoryModal } from './HistoryModal'

interface MenuState {
  selText: string
  start: number
  end: number
  x: number
  y: number
}

interface Props {
  block: Block
  onUpdate: (block: Block) => void
  onRemove: (blockId: string) => void
  onSplitBlock: (newBlock: Block) => void
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function getSelectionInfo(container: Element): { selText: string; start: number; end: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return null
  const selText = selection.toString()
  if (!selText.trim()) return null
  if (!container.contains(selection.anchorNode)) return null

  const range = selection.getRangeAt(0)
  const preRange = document.createRange()
  preRange.setStart(container, 0)
  preRange.setEnd(range.startContainer, range.startOffset)
  const start = preRange.toString().length
  return { selText, start, end: start + selText.length }
}

const STATUS_DOT: Record<BlockStatus, { cls: string; title: string } | null> = {
  unprocessed: null,
  partially_handled: { cls: 'bg-amber-400', title: 'Partially processed' },
  archived: null,
}

export function BlockCard({ block, onUpdate, onRemove, onSplitBlock }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(block.content ?? '')
  const [dotMenuOpen, setDotMenuOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [menuState, setMenuState] = useState<MenuState | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const dotMenuRef = useRef<HTMLDivElement>(null)

  // Close dot menu on outside click
  useEffect(() => {
    if (!dotMenuOpen) return
    function handler(e: MouseEvent) {
      if (!dotMenuRef.current?.contains(e.target as Node)) setDotMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dotMenuOpen])

  // Close selection menu on outside click
  useEffect(() => {
    if (!menuState) return
    function handler() { setMenuState(null) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuState])

  function handleMouseUp() {
    if (isEditing || !contentRef.current) return
    const info = getSelectionInfo(contentRef.current)
    if (!info) return
    const range = window.getSelection()!.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    setMenuState({ ...info, x: rect.left + rect.width / 2, y: rect.top })
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    if (isEditing) return
    const selection = window.getSelection()
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim()
    if (!hasSelection) {
      setMenuState({
        selText: block.content ?? '',
        start: 0,
        end: (block.content ?? '').length,
        x: e.clientX,
        y: e.clientY,
      })
    }
  }

  async function handleAction(action: SelectionAction) {
    if (!menuState) return
    const { selText, start, end } = menuState
    setMenuState(null)

    const supabase = createClient()
    const content = block.content ?? ''

    // AI Summarize — replaces selection, no removal
    if (action.type === 'summarize') {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selText }),
      })
      const { summary, error } = await res.json()
      if (error || !summary) return
      const newContent = content.slice(0, start) + summary + content.slice(end)
      await supabase.from('journal_blocks')
        .update({ content: newContent, status: 'partially_handled' })
        .eq('id', block.id)
      onUpdate({ ...block, content: newContent, status: 'partially_handled' })
      return
    }

    // Link to Project — no text removal
    if (action.type === 'link_project') {
      const { data: project } = await supabase
        .from('projects').select('name').eq('id', action.projectId).single()
      if (!project) return
      const tagName = `proj:${project.name}`
      let { data: tag } = await supabase
        .from('tags').select('id').eq('user_id', block.user_id).eq('name', tagName).maybeSingle()
      if (!tag) {
        const { data: created } = await supabase
          .from('tags').insert({ user_id: block.user_id, name: tagName, color: '#6366f1' }).select('id').single()
        tag = created
      }
      if (tag) {
        await supabase.from('taggings').insert({ tag_id: tag.id, entity_type: 'block', entity_id: block.id })
      }
      await supabase.from('journal_blocks').update({ status: 'partially_handled' }).eq('id', block.id)
      onUpdate({ ...block, status: 'partially_handled' })
      return
    }

    // All remaining actions remove the selected text
    const newContent = content.slice(0, start) + content.slice(end)
    const isEmpty = !newContent.trim()
    const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'

    await supabase.from('journal_blocks').update({
      content: newContent,
      status: newStatus,
      is_archived: isEmpty,
    }).eq('id', block.id)

    if (action.type === 'create_task') {
      await supabase.from('tasks').insert({
        user_id: block.user_id,
        context_id: block.context_id,
        title: selText.trim().slice(0, 500),
        body: selText.trim(),
        status: 'open',
        task_type: action.taskType,
        assignee_id: action.assigneeId ?? null,
      })
    } else if (action.type === 'split_block') {
      const { data: newBlock } = await supabase.from('journal_blocks').insert({
        user_id: block.user_id,
        context_id: block.context_id,
        content: selText,
        status: 'partially_handled' as const,
        created_at: block.created_at,
      }).select().single()
      if (newBlock) onSplitBlock(newBlock as Block)
    }
    // label_info and delete_selection just remove the text

    if (isEmpty) onRemove(block.id)
    else onUpdate({ ...block, content: newContent, status: newStatus })
  }

  // ---- Edit mode ----
  function startEdit() {
    setEditContent(block.content ?? '')
    setIsEditing(true)
    setDotMenuOpen(false)
  }

  async function saveEdit() {
    if (!isEditing) return
    setIsEditing(false)
    const trimmed = editContent.trim()
    // Trigger on_block_updated handles block_versions automatically
    const supabase = createClient()
    if (trimmed === (block.content ?? '').trim()) return

    if (!trimmed) {
      await supabase.from('journal_blocks').update({ status: 'archived', is_archived: true }).eq('id', block.id)
      onRemove(block.id)
      return
    }

    await supabase.from('journal_blocks').update({ content: trimmed }).eq('id', block.id)
    onUpdate({ ...block, content: trimmed })
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit() }
    if (e.key === 'Escape') { setIsEditing(false); setEditContent(block.content ?? '') }
  }

  // ---- Dot menu actions ----
  async function markDone() {
    setDotMenuOpen(false)
    const supabase = createClient()
    await supabase.from('journal_blocks').update({ status: 'archived', is_archived: true }).eq('id', block.id)
    onRemove(block.id)
  }

  async function deleteBlock() {
    setDotMenuOpen(false)
    const supabase = createClient()
    await supabase.from('journal_blocks').update({ deleted_at: new Date().toISOString() }).eq('id', block.id)
    onRemove(block.id)
  }

  const dot = STATUS_DOT[block.status]

  return (
    <div className="relative group bg-white rounded-xl border border-gray-100 shadow-sm hover:border-gray-200 transition-colors">
      {/* Status bar */}
      {dot && (
        <div
          className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-full ${dot.cls}`}
          style={{ left: '-1px' }}
          title={dot.title}
        />
      )}

      <div className="px-4 pt-3 pb-3">
        {/* Header row */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400">{formatDate(block.created_at)}</span>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Dot menu */}
            <div ref={dotMenuRef} className="relative">
              <button
                onClick={() => setDotMenuOpen((o) => !o)}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="More options"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                </svg>
              </button>

              {dotMenuOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-44 z-40">
                  <DotMenuItem onClick={startEdit}>Edit</DotMenuItem>
                  <DotMenuItem onClick={markDone}>Mark as Done</DotMenuItem>
                  <DotMenuItem onClick={() => { setShowHistory(true); setDotMenuOpen(false) }}>
                    View History
                  </DotMenuItem>
                  <div className="h-px bg-gray-100 my-1" />
                  <DotMenuItem onClick={deleteBlock} className="text-red-500">Delete block</DotMenuItem>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        {isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={saveEdit}
            autoFocus
            className="w-full text-sm text-gray-800 bg-gray-50 border border-indigo-200 rounded-lg p-2 resize-none outline-none"
            rows={Math.max(3, editContent.split('\n').length + 1)}
          />
        ) : (
          <div
            ref={contentRef}
            onMouseUp={handleMouseUp}
            onContextMenu={handleContextMenu}
            className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed select-text cursor-text"
          >
            {block.content || <span className="text-gray-300 italic">Empty</span>}
          </div>
        )}
      </div>

      {/* Floating selection menu */}
      {menuState && (
        <SelectionMenu
          position={{ x: menuState.x, y: menuState.y }}
          selectedText={menuState.selText}
          userId={block.user_id}
          onClose={() => setMenuState(null)}
          onAction={handleAction}
        />
      )}

      {/* History modal */}
      {showHistory && (
        <HistoryModal blockId={block.id} onClose={() => setShowHistory(false)} />
      )}
    </div>
  )
}

function DotMenuItem({
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
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors ${className}`}
    >
      {children}
    </button>
  )
}
