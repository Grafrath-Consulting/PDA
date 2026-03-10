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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
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

  // Keep mutable values accessible inside stable event listeners without re-registering
  const isEditingRef = useRef(isEditing)
  isEditingRef.current = isEditing
  const blockContentRef = useRef(block.content)
  blockContentRef.current = block.content

  // ── Selection detection via selectionchange ──────────────────────────────
  // selectionchange fires as the selection forms (before mouseup), which means
  // our menu appears before the browser decides to render its native toolbar.
  useEffect(() => {
    function onSelectionChange() {
      if (isEditingRef.current || !contentRef.current) return

      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) return

      const selText = selection.toString()
      if (!selText.trim()) return

      // Only handle selections that start inside our content div
      if (!contentRef.current.contains(selection.anchorNode)) return

      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (!rect.width && !rect.height) return // phantom selection

      // Compute character offsets within the content node
      const preRange = document.createRange()
      preRange.setStart(contentRef.current, 0)
      preRange.setEnd(range.startContainer, range.startOffset)
      const start = preRange.toString().length
      const end = start + selText.length

      setMenuState({
        selText,
        start,
        end,
        x: rect.left + rect.width / 2,
        y: rect.top,
      })
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, []) // registered once; mutable state accessed via refs

  // ── Close selection menu on outside mousedown ────────────────────────────
  // SelectionMenu calls e.stopPropagation() on its own mousedown, so clicks
  // inside the menu never reach this handler.
  useEffect(() => {
    if (!menuState) return
    function onOutsideMouseDown() { setMenuState(null) }
    document.addEventListener('mousedown', onOutsideMouseDown)
    return () => document.removeEventListener('mousedown', onOutsideMouseDown)
  }, [menuState])

  // ── Close dot menu on outside mousedown ─────────────────────────────────
  useEffect(() => {
    if (!dotMenuOpen) return
    function onOutsideMouseDown(e: MouseEvent) {
      if (!dotMenuRef.current?.contains(e.target as Node)) setDotMenuOpen(false)
    }
    document.addEventListener('mousedown', onOutsideMouseDown)
    return () => document.removeEventListener('mousedown', onOutsideMouseDown)
  }, [dotMenuOpen])

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
    // Snapshot content now before any state changes
    const content = blockContentRef.current ?? ''
    setMenuState(null)
    window.getSelection()?.removeAllRanges()

    const supabase = createClient()

    // ── 1 & 2 & 3: Create Task / Delegate / Waiting On ──────────────────
    if (action.type === 'create_task') {
      const newContent = content.slice(0, start) + content.slice(end)
      const isEmpty = !newContent.trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'

      await supabase
        .from('journal_blocks')
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

    // ── 4: Split to Block ────────────────────────────────────────────────
    if (action.type === 'split_block') {
      const newContent = content.slice(0, start) + content.slice(end)
      const isEmpty = !newContent.trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'

      await supabase
        .from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)

      const { data: newBlock } = await supabase
        .from('journal_blocks')
        .insert({
          user_id: block.user_id,
          context_id: block.context_id,
          content: selText,
          status: 'partially_handled',
          created_at: block.created_at,
        })
        .select()
        .single()

      if (newBlock) onSplitBlock(newBlock as Block)
      if (isEmpty) onRemove(block.id)
      else onUpdate({ ...block, content: newContent, status: newStatus })
      return
    }

    // ── 5: Link to Project ───────────────────────────────────────────────
    // Tags the block to the project (no text removal). Finds or creates a
    // dedicated tag named `proj:<project-name>` then inserts a tagging row.
    if (action.type === 'link_project') {
      const { data: project } = await supabase
        .from('projects')
        .select('name')
        .eq('id', action.projectId)
        .single()

      if (!project) return

      const tagName = `proj:${project.name}`
      let { data: tag } = await supabase
        .from('tags')
        .select('id')
        .eq('user_id', block.user_id)
        .eq('name', tagName)
        .maybeSingle()

      if (!tag) {
        const { data: created } = await supabase
          .from('tags')
          .insert({ user_id: block.user_id, name: tagName, color: '#6366f1' })
          .select('id')
          .single()
        tag = created
      }

      if (tag) {
        await supabase
          .from('taggings')
          .insert({ tag_id: tag.id, entity_type: 'block', entity_id: block.id })
      }

      await supabase
        .from('journal_blocks')
        .update({ status: 'partially_handled' })
        .eq('id', block.id)

      onUpdate({ ...block, status: 'partially_handled' })
      return
    }

    // ── 6: Label as Info ─────────────────────────────────────────────────
    // Removes the selected text (it has been acknowledged as informational).
    if (action.type === 'label_info') {
      const newContent = content.slice(0, start) + content.slice(end)
      const isEmpty = !newContent.trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'

      await supabase
        .from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)

      if (isEmpty) onRemove(block.id)
      else onUpdate({ ...block, content: newContent, status: newStatus })
      return
    }

    // ── 7: AI Summarize ──────────────────────────────────────────────────
    // Replaces the selection with a condensed version. No text removal otherwise.
    if (action.type === 'summarize') {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selText }),
      })
      const json = await res.json()
      if (!json.summary) return

      const newContent = content.slice(0, start) + json.summary + content.slice(end)
      await supabase
        .from('journal_blocks')
        .update({ content: newContent, status: 'partially_handled' })
        .eq('id', block.id)

      onUpdate({ ...block, content: newContent, status: 'partially_handled' })
      return
    }

    // ── 8: Delete Selection ──────────────────────────────────────────────
    if (action.type === 'delete_selection') {
      const newContent = content.slice(0, start) + content.slice(end)
      const isEmpty = !newContent.trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'

      await supabase
        .from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)

      if (isEmpty) onRemove(block.id)
      else onUpdate({ ...block, content: newContent, status: newStatus })
      return
    }
  }

  // ── Inline edit ──────────────────────────────────────────────────────────
  function startEdit() {
    setEditContent(block.content ?? '')
    setIsEditing(true)
    setDotMenuOpen(false)
  }

  async function saveEdit() {
    if (!isEditing) return
    setIsEditing(false)
    const trimmed = editContent.trim()
    const supabase = createClient()

    if (trimmed === (block.content ?? '').trim()) return

    if (!trimmed) {
      await supabase
        .from('journal_blocks')
        .update({ status: 'archived', is_archived: true })
        .eq('id', block.id)
      onRemove(block.id)
      return
    }

    // The on_block_updated DB trigger snapshots the old content into
    // block_versions automatically — no manual insert needed here.
    await supabase.from('journal_blocks').update({ content: trimmed }).eq('id', block.id)
    onUpdate({ ...block, content: trimmed })
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit() }
    if (e.key === 'Escape') { setIsEditing(false); setEditContent(block.content ?? '') }
  }

  // ── Dot menu actions ─────────────────────────────────────────────────────
  async function markDone() {
    setDotMenuOpen(false)
    const supabase = createClient()
    await supabase
      .from('journal_blocks')
      .update({ status: 'archived', is_archived: true })
      .eq('id', block.id)
    onRemove(block.id)
  }

  async function deleteBlock() {
    setDotMenuOpen(false)
    const supabase = createClient()
    await supabase
      .from('journal_blocks')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', block.id)
    onRemove(block.id)
  }

  const dot = STATUS_DOT[block.status]

  return (
    // select-none on the outer card prevents the browser from treating the
    // menu/header areas as selectable text, which suppresses the native
    // copy/paste toolbar. select-text on the content div re-enables selection
    // specifically where we want it.
    <div className="relative group bg-white rounded-xl border border-gray-100 shadow-sm hover:border-gray-200 transition-colors select-none">
      {dot && (
        <div
          className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-full ${dot.cls}`}
          style={{ left: '-1px' }}
          title={dot.title}
        />
      )}

      <div className="px-4 pt-3 pb-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400">{formatDate(block.created_at)}</span>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                  <DotMenuItem onClick={startEdit}>Edit</DotMenuItem>
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

        {/* Content */}
        {isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={saveEdit}
            autoFocus
            className="w-full text-sm text-gray-800 bg-gray-50 border border-indigo-200 rounded-lg p-2 resize-none outline-none select-text"
            rows={Math.max(3, editContent.split('\n').length + 1)}
          />
        ) : (
          <div
            ref={contentRef}
            onContextMenu={handleContextMenu}
            className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed select-text cursor-text"
          >
            {block.content || <span className="text-gray-300 italic">Empty</span>}
          </div>
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
