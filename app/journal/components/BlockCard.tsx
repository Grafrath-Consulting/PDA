'use client'

import { useState, useRef, useEffect } from 'react'
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

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Compare at minute granularity — sub-minute differences (e.g. status updates)
// don't warrant showing a "modified" label.
function isMeaningfullyModified(created: string, updated: string) {
  return created.slice(0, 16) !== updated.slice(0, 16)
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dotMenuRef = useRef<HTMLDivElement>(null)

  // Refs so stable event listeners can read current values without re-registering
  const isEditingRef = useRef(isEditing)
  isEditingRef.current = isEditing
  const blockContentRef = useRef(block.content)
  blockContentRef.current = block.content

  // Guard against double-save (Ctrl+Enter fires saveEdit, then blur also fires it)
  const savingRef = useRef(false)

  // ── selectionchange → open selection menu ────────────────────────────────
  useEffect(() => {
    function onSelectionChange() {
      if (isEditingRef.current || !contentRef.current) return

      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) return
      const selText = selection.toString()
      if (!selText.trim()) return
      if (!contentRef.current.contains(selection.anchorNode)) return

      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (!rect.width && !rect.height) return

      const preRange = document.createRange()
      preRange.setStart(contentRef.current, 0)
      preRange.setEnd(range.startContainer, range.startOffset)
      const start = preRange.toString().length
      const end = start + selText.length

      setMenuState({ selText, start, end, x: rect.left + rect.width / 2, y: rect.top })
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  // ── Close selection menu on outside mousedown ────────────────────────────
  useEffect(() => {
    if (!menuState) return
    function handler() { setMenuState(null) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuState])

  // ── Close dot menu on outside mousedown ─────────────────────────────────
  useEffect(() => {
    if (!dotMenuOpen) return
    function handler(e: MouseEvent) {
      if (!dotMenuRef.current?.contains(e.target as Node)) setDotMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dotMenuOpen])

  // ── Click-to-edit ────────────────────────────────────────────────────────
  // A plain click (no drag-selection) on the content div opens inline editing.
  function handleContentClick() {
    if (isEditing) return
    // If the user just made a text selection, don't enter edit mode
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    startEdit()
  }

  // ── Right-click: show menu for full block ────────────────────────────────
  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    if (isEditing) return
    const selection = window.getSelection()
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim()
    if (!hasSelection) {
      const content = blockContentRef.current ?? ''
      setMenuState({ selText: content, start: 0, end: content.length, x: e.clientX, y: e.clientY })
    }
  }

  // ── Action handler — all 8 actions ──────────────────────────────────────
  async function handleAction(action: SelectionAction) {
    if (!menuState) return
    const { selText, start, end } = menuState
    const content = blockContentRef.current ?? ''
    setMenuState(null)
    window.getSelection()?.removeAllRanges()

    const supabase = createClient()

    // 1–3: Create Task / Delegate / Waiting On
    if (action.type === 'create_task') {
      const newContent = content.slice(0, start) + content.slice(end)
      const isEmpty = !newContent.trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'
      await supabase.from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)
      await supabase.from('tasks').insert({
        user_id: block.user_id,
        context_id: block.context_id,
        title: selText.trim().slice(0, 500),
        body: selText.trim(),
        status: 'open',
        task_type: action.taskType,
        assignee_id: action.assigneeId ?? null,
      })
      if (isEmpty) onRemove(block.id)
      else onUpdate({ ...block, content: newContent, status: newStatus })
      return
    }

    // 4: Split to Block
    if (action.type === 'split_block') {
      const newContent = content.slice(0, start) + content.slice(end)
      const isEmpty = !newContent.trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'
      await supabase.from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)
      const { data: newBlock } = await supabase.from('journal_blocks')
        .insert({ user_id: block.user_id, context_id: block.context_id, content: selText, status: 'partially_handled', created_at: block.created_at })
        .select().single()
      if (newBlock) onSplitBlock(newBlock as Block)
      if (isEmpty) onRemove(block.id)
      else onUpdate({ ...block, content: newContent, status: newStatus })
      return
    }

    // 5: Link to Project
    if (action.type === 'link_project') {
      const { data: project } = await supabase.from('projects').select('name').eq('id', action.projectId).single()
      if (!project) return
      const tagName = `proj:${project.name}`
      let { data: tag } = await supabase.from('tags').select('id').eq('user_id', block.user_id).eq('name', tagName).maybeSingle()
      if (!tag) {
        const { data: created } = await supabase.from('tags').insert({ user_id: block.user_id, name: tagName, color: '#6366f1' }).select('id').single()
        tag = created
      }
      if (tag) await supabase.from('taggings').insert({ tag_id: tag.id, entity_type: 'block', entity_id: block.id })
      await supabase.from('journal_blocks').update({ status: 'partially_handled' }).eq('id', block.id)
      onUpdate({ ...block, status: 'partially_handled' })
      return
    }

    // 6: Label as Info — acknowledge and remove from block
    if (action.type === 'label_info') {
      const newContent = content.slice(0, start) + content.slice(end)
      const isEmpty = !newContent.trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'
      await supabase.from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)
      if (isEmpty) onRemove(block.id)
      else onUpdate({ ...block, content: newContent, status: newStatus })
      return
    }

    // 7: AI Summarize
    if (action.type === 'summarize') {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selText }),
      })
      const json = await res.json()
      if (!json.summary) return
      const newContent = content.slice(0, start) + json.summary + content.slice(end)
      await supabase.from('journal_blocks').update({ content: newContent, status: 'partially_handled' }).eq('id', block.id)
      onUpdate({ ...block, content: newContent, status: 'partially_handled' })
      return
    }

    // 8: Delete Selection
    if (action.type === 'delete_selection') {
      const newContent = content.slice(0, start) + content.slice(end)
      const isEmpty = !newContent.trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'
      await supabase.from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)
      if (isEmpty) onRemove(block.id)
      else onUpdate({ ...block, content: newContent, status: newStatus })
    }
  }

  // ── Inline edit ──────────────────────────────────────────────────────────
  function startEdit() {
    if (isEditing) return
    savingRef.current = false
    setEditContent(block.content ?? '')
    setIsEditing(true)
    setDotMenuOpen(false)
    // Focus the textarea on the next frame after it mounts
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  async function saveEdit() {
    if (!isEditing || savingRef.current) return
    savingRef.current = true
    setIsEditing(false)

    const trimmed = editContent.trim()
    const supabase = createClient()

    if (trimmed === (block.content ?? '').trim()) {
      savingRef.current = false
      return
    }

    if (!trimmed) {
      await supabase.from('journal_blocks').update({ status: 'archived', is_archived: true }).eq('id', block.id)
      onRemove(block.id)
      savingRef.current = false
      return
    }

    // The on_block_updated DB trigger writes old content to block_versions and
    // sets updated_at = now(). Fetching the row back gives us the DB-assigned
    // updated_at so the timestamp refreshes in the UI without a page reload.
    const { data: saved } = await supabase
      .from('journal_blocks')
      .update({ content: trimmed })
      .eq('id', block.id)
      .select()
      .single()
    onUpdate((saved as Block) ?? { ...block, content: trimmed })
    savingRef.current = false
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit() }
    if (e.key === 'Escape') { setIsEditing(false); setEditContent(block.content ?? ''); savingRef.current = false }
  }

  // ── Dot menu actions ─────────────────────────────────────────────────────
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
  const showModified = isMeaningfullyModified(block.created_at, block.updated_at)

  return (
    <div className="relative group bg-white rounded-xl border border-gray-100 shadow-sm hover:border-gray-200 transition-colors select-none">
      {dot && (
        <div
          className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-full ${dot.cls}`}
          style={{ left: '-1px' }}
          title={dot.title}
        />
      )}

      <div className="px-4 pt-3 pb-3">
        {/* Header: timestamps + dot menu */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-gray-400 whitespace-nowrap">{formatTimestamp(block.created_at)}</span>
            {showModified && (
              <>
                <span className="text-xs text-gray-200">·</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  edited {formatTimestamp(block.updated_at)}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
            <div ref={dotMenuRef} className="relative">
              <button
                onClick={() => setDotMenuOpen((o) => !o)}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="More options"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                </svg>
              </button>

              {dotMenuOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-44 z-40">
                  <DotMenuItem onClick={markDone}>Mark as Done</DotMenuItem>
                  <DotMenuItem onClick={() => { setShowHistory(true); setDotMenuOpen(false) }}>
                    View History
                  </DotMenuItem>
                  <div className="h-px bg-gray-100 my-1" />
                  <DotMenuItem onClick={deleteBlock} className="text-red-500">
                    Delete block
                  </DotMenuItem>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content — click anywhere to edit */}
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={saveEdit}
            className="w-full text-sm text-gray-800 bg-gray-50 border border-indigo-200 rounded-lg p-2 resize-none outline-none select-text"
            rows={Math.max(3, editContent.split('\n').length + 1)}
          />
        ) : (
          <div
            ref={contentRef}
            onClick={handleContentClick}
            onContextMenu={handleContextMenu}
            className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed select-text cursor-text"
            title="Click to edit"
          >
            {block.content || <span className="text-gray-300 italic">Click to edit…</span>}
          </div>
        )}

        {isEditing && (
          <p className="text-xs text-gray-400 mt-1.5">Ctrl+Enter to save · Esc to cancel · click outside to save</p>
        )}
      </div>

      {menuState && (
        <SelectionMenu
          position={{ x: menuState.x, y: menuState.y }}
          selectedText={menuState.selText}
          userId={block.user_id}
          onClose={() => setMenuState(null)}
          onAction={handleAction}
        />
      )}

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
      className={`w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors ${className}`}
    >
      {children}
    </button>
  )
}
