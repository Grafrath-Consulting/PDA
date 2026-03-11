'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { Block, BlockStatus, SelectionAction } from '../types'
import { SelectionMenu } from './SelectionMenu'
import { HistoryModal } from './HistoryModal'
import type { TipTapEditorHandle } from './TipTapEditor'

const TipTapEditor = dynamic(() => import('./TipTapEditor').then(m => m.TipTapEditor), { ssr: false })

interface MenuState {
  selText: string
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

function isMeaningfullyModified(created: string, updated: string) {
  return created.slice(0, 16) !== updated.slice(0, 16)
}

const STATUS_DOT: Record<BlockStatus, { cls: string; title: string } | null> = {
  unprocessed: null,
  partially_handled: { cls: 'bg-amber-400', title: 'Partially processed' },
  archived: null,
}

/** Remove the first occurrence of `needle` (plain text) from an HTML string,
 *  preserving surrounding markup. Falls back to simple string replace. */
function removeTextFromHTML(html: string, needle: string): string {
  if (!needle) return html
  const div = document.createElement('div')
  div.innerHTML = html
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT)
  let remaining = needle
  const nodesToProcess: { node: Text; startIdx: number; endIdx: number }[] = []

  while (walker.nextNode() && remaining.length > 0) {
    const node = walker.currentNode as Text
    const text = node.textContent ?? ''
    const idx = remaining === needle ? text.indexOf(remaining.slice(0, Math.min(remaining.length, text.length))) : 0
    if (idx === -1) continue
    const removeLen = Math.min(remaining.length, text.length - idx)
    nodesToProcess.push({ node, startIdx: idx, endIdx: idx + removeLen })
    remaining = remaining.slice(removeLen)
  }

  // If we couldn't find via tree walk, fall back to simple text replacement
  if (remaining.length > 0) {
    const stripped = div.textContent ?? ''
    const pos = stripped.indexOf(needle)
    if (pos === -1) return html
    // Fallback: strip all HTML, splice, return plain text
    return stripped.slice(0, pos) + stripped.slice(pos + needle.length)
  }

  for (const { node, startIdx, endIdx } of nodesToProcess) {
    const text = node.textContent ?? ''
    node.textContent = text.slice(0, startIdx) + text.slice(endIdx)
  }
  return div.innerHTML
}

/** Replace the first occurrence of `needle` text with `replacement` in HTML */
function replaceTextInHTML(html: string, needle: string, replacement: string): string {
  if (!needle) return html
  const div = document.createElement('div')
  div.innerHTML = html
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT)

  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const text = node.textContent ?? ''
    const idx = text.indexOf(needle)
    if (idx !== -1) {
      node.textContent = text.slice(0, idx) + replacement + text.slice(idx + needle.length)
      return div.innerHTML
    }
  }
  // Fallback
  const stripped = div.textContent ?? ''
  const pos = stripped.indexOf(needle)
  if (pos === -1) return html
  return stripped.slice(0, pos) + replacement + stripped.slice(pos + needle.length)
}

/** Get plain text from HTML */
function htmlToText(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent ?? ''
}

export function BlockCard({ block, onUpdate, onRemove, onSplitBlock }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [dotMenuOpen, setDotMenuOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [menuState, setMenuState] = useState<MenuState | null>(null)

  const contentRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<TipTapEditorHandle>(null)
  const dotMenuRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const blockContentRef = useRef(block.content)
  blockContentRef.current = block.content

  const savingRef = useRef(false)
  const isEditingRef = useRef(isEditing)
  isEditingRef.current = isEditing

  // ── pointerup → open selection menu (both read and edit mode) ────────
  useEffect(() => {
    function onPointerUp(e: PointerEvent) {
      // Small delay to let the browser finalize the selection
      requestAnimationFrame(() => {
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed) return
        const selText = selection.toString().trim()
        if (!selText) return

        const anchor = selection.anchorNode
        if (!cardRef.current?.contains(anchor)) return

        // Don't show menu if clicking inside the dot menu or the selection menu itself
        const target = e.target as Node
        if (dotMenuRef.current?.contains(target)) return

        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        if (!rect.width && !rect.height) return

        setMenuState({ selText, x: rect.left + rect.width / 2, y: rect.top })
      })
    }

    document.addEventListener('pointerup', onPointerUp)
    return () => document.removeEventListener('pointerup', onPointerUp)
  }, [])

  // ── Close selection menu on outside mousedown ────────────────────────
  useEffect(() => {
    if (!menuState) return
    function handler(e: MouseEvent) {
      // Let the selection menu handle its own clicks
      const target = e.target as HTMLElement
      if (target.closest?.('.selection-menu-container')) return
      setMenuState(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuState])

  // ── Close dot menu on outside mousedown ──────────────────────────────
  useEffect(() => {
    if (!dotMenuOpen) return
    function handler(e: MouseEvent) {
      if (!dotMenuRef.current?.contains(e.target as Node)) setDotMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dotMenuOpen])

  // ── Click-to-edit ────────────────────────────────────────────────────
  function handleContentClick() {
    if (isEditing) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    startEdit()
  }

  // ── Right-click: show menu for full block ────────────────────────────
  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    if (isEditing) return
    const selection = window.getSelection()
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim()
    if (!hasSelection) {
      const content = htmlToText(blockContentRef.current ?? '')
      setMenuState({ selText: content, x: e.clientX, y: e.clientY })
    }
  }

  // ── Action handler ───────────────────────────────────────────────────
  async function handleAction(action: SelectionAction) {
    if (!menuState) return
    const { selText } = menuState
    const content = blockContentRef.current ?? ''
    setMenuState(null)
    window.getSelection()?.removeAllRanges()

    // If in edit mode, get the latest content from the editor
    const currentContent = isEditingRef.current && editorRef.current
      ? editorRef.current.getHTML()
      : content

    const supabase = createClient()

    if (action.type === 'create_task') {
      const newContent = removeTextFromHTML(currentContent, selText)
      const isEmpty = !htmlToText(newContent).trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'
      await supabase.from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)
      await supabase.from('tasks').insert({
        user_id: block.user_id,
        context_id: block.context_id,
        title: selText.slice(0, 500),
        body: selText,
        status: 'open',
        task_type: action.taskType,
        assignee_id: action.assigneeId ?? null,
      })
      if (isEmpty) onRemove(block.id)
      else { onUpdate({ ...block, content: newContent, status: newStatus }); exitEdit() }
      return
    }

    if (action.type === 'split_block') {
      const newContent = removeTextFromHTML(currentContent, selText)
      const isEmpty = !htmlToText(newContent).trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'
      await supabase.from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)
      const { data: newBlock } = await supabase.from('journal_blocks')
        .insert({ user_id: block.user_id, context_id: block.context_id, content: selText, status: 'partially_handled', created_at: block.created_at })
        .select().single()
      if (newBlock) onSplitBlock(newBlock as Block)
      if (isEmpty) onRemove(block.id)
      else { onUpdate({ ...block, content: newContent, status: newStatus }); exitEdit() }
      return
    }

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

    if (action.type === 'label_info') {
      const newContent = removeTextFromHTML(currentContent, selText)
      const isEmpty = !htmlToText(newContent).trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'
      await supabase.from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)
      if (isEmpty) onRemove(block.id)
      else { onUpdate({ ...block, content: newContent, status: newStatus }); exitEdit() }
      return
    }

    if (action.type === 'summarize') {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selText }),
      })
      const json = await res.json()
      if (!json.summary) return
      const newContent = replaceTextInHTML(currentContent, selText, json.summary)
      await supabase.from('journal_blocks').update({ content: newContent, status: 'partially_handled' }).eq('id', block.id)
      onUpdate({ ...block, content: newContent, status: 'partially_handled' })
      exitEdit()
      return
    }

    if (action.type === 'delete_selection') {
      const newContent = removeTextFromHTML(currentContent, selText)
      const isEmpty = !htmlToText(newContent).trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'
      await supabase.from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)
      if (isEmpty) onRemove(block.id)
      else { onUpdate({ ...block, content: newContent, status: newStatus }); exitEdit() }
    }
  }

  // ── Inline edit ──────────────────────────────────────────────────────
  function startEdit() {
    if (isEditing) return
    savingRef.current = false
    setIsEditing(true)
    setDotMenuOpen(false)
  }

  function exitEdit() {
    setIsEditing(false)
    savingRef.current = false
  }

  const saveEdit = useCallback(async () => {
    if (!isEditingRef.current || savingRef.current || !editorRef.current) return
    savingRef.current = true
    setIsEditing(false)

    const html = editorRef.current.getHTML()
    const text = editorRef.current.getText().trim()
    const supabase = createClient()

    // Compare text content to detect real changes
    const oldText = htmlToText(block.content ?? '').trim()
    if (text === oldText) {
      savingRef.current = false
      return
    }

    if (!text) {
      await supabase.from('journal_blocks').update({ status: 'archived', is_archived: true }).eq('id', block.id)
      onRemove(block.id)
      savingRef.current = false
      return
    }

    const { data: saved } = await supabase
      .from('journal_blocks')
      .update({ content: html })
      .eq('id', block.id)
      .select()
      .single()
    onUpdate((saved as Block) ?? { ...block, content: html })
    savingRef.current = false
  }, [block, onUpdate, onRemove])

  function handleEditorKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      exitEdit()
    }
  }

  // ── Dot menu actions ─────────────────────────────────────────────────
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

  // Determine if content looks like HTML or plain text (for backward compat)
  const contentHTML = (block.content ?? '').startsWith('<') ? block.content ?? '' : `<p>${(block.content ?? '').replace(/\n/g, '</p><p>')}</p>`

  return (
    <div
      ref={cardRef}
      className="relative group bg-white rounded-xl border border-gray-100 shadow-sm hover:border-gray-200 transition-colors"
      onClick={handleContentClick}
    >
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
                onClick={(e) => { e.stopPropagation(); setDotMenuOpen((o) => !o) }}
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

        {/* Content */}
        {isEditing ? (
          <div onKeyDown={handleEditorKeyDown} onBlur={(e) => {
            // Save on blur, but not if focus moved within the card (e.g. to toolbar or selection menu)
            if (cardRef.current?.contains(e.relatedTarget as Node)) return
            saveEdit()
          }}>
            <TipTapEditor
              ref={editorRef}
              content={contentHTML}
              autoFocus
              onSubmit={saveEdit}
              className="bg-gray-50 border border-indigo-200 rounded-lg p-2"
              minHeight="60px"
            />
            <p className="text-xs text-gray-400 mt-1.5">Ctrl+Enter to save · Esc to cancel · click outside to save</p>
          </div>
        ) : (
          <div
            ref={contentRef}
            onContextMenu={handleContextMenu}
            className="tiptap-content text-sm text-gray-800 leading-relaxed select-text cursor-text"
            dangerouslySetInnerHTML={{ __html: contentHTML }}
          />
        )}
      </div>

      {menuState && (
        <div className="selection-menu-container">
          <SelectionMenu
            position={{ x: menuState.x, y: menuState.y }}
            userId={block.user_id}
            onClose={() => setMenuState(null)}
            onAction={handleAction}
          />
        </div>
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
