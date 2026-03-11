'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { Block, BlockStatus, SelectionAction } from '../types'
import { SelectionMenu } from './SelectionMenu'
import { HistoryModal } from './HistoryModal'
import type { TipTapEditorHandle } from './TipTapEditor'

const TipTapEditor = dynamic(() => import('./TipTapEditor').then(m => m.TipTapEditor), { ssr: false })

const TOOLBAR_EXPANDED_KEY = 'block-toolbar-expanded'
const FORMATTING_VISIBLE_KEY = 'tiptap-toolbar-visible'

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
  autosaveInterval?: number
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

  if (remaining.length > 0) {
    const stripped = div.textContent ?? ''
    const pos = stripped.indexOf(needle)
    if (pos === -1) return html
    return stripped.slice(0, pos) + stripped.slice(pos + needle.length)
  }

  for (const { node, startIdx, endIdx } of nodesToProcess) {
    const text = node.textContent ?? ''
    node.textContent = text.slice(0, startIdx) + text.slice(endIdx)
  }
  return div.innerHTML
}

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
  const stripped = div.textContent ?? ''
  const pos = stripped.indexOf(needle)
  if (pos === -1) return html
  return stripped.slice(0, pos) + replacement + stripped.slice(pos + needle.length)
}

function htmlToText(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent ?? ''
}

// ── Toolbar item definitions ──────────────────────────────────────────
interface ToolbarItem {
  key: string
  label: string
  icon: React.ReactNode
  className?: string
}

const ICON_SIZE = 14

function taskIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
}
function waitingIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
}
function linkIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
}
function infoIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
}
function sparkleIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
}
function checkIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
}
function historyIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5" /><path d="M3 8a9 9 0 1 1 1.36 4.69" /></svg>
}
function trashIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
}
function aaIcon() {
  return <span className="text-[10px] font-semibold leading-none">Aa</span>
}

export function BlockCard({ block, onUpdate, onRemove, onSplitBlock, autosaveInterval = 30 }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [menuState, setMenuState] = useState<MenuState | null>(null)
  const [toolbarExpanded, setToolbarExpanded] = useState(false)
  const [formattingVisible, setFormattingVisible] = useState(false)

  const contentRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<TipTapEditorHandle>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  const blockContentRef = useRef(block.content)
  blockContentRef.current = block.content

  const savingRef = useRef(false)
  const isEditingRef = useRef(isEditing)
  isEditingRef.current = isEditing

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedHTMLRef = useRef(block.content ?? '')

  // Read persisted preferences once
  useEffect(() => {
    const exp = localStorage.getItem(TOOLBAR_EXPANDED_KEY)
    if (exp === 'true') setToolbarExpanded(true)
    const fmt = localStorage.getItem(FORMATTING_VISIBLE_KEY)
    if (fmt === 'true') setFormattingVisible(true)
  }, [])

  function toggleToolbarExpanded() {
    setToolbarExpanded(prev => {
      const next = !prev
      localStorage.setItem(TOOLBAR_EXPANDED_KEY, String(next))
      return next
    })
  }

  function toggleFormatting() {
    setFormattingVisible(prev => {
      const next = !prev
      localStorage.setItem(FORMATTING_VISIBLE_KEY, String(next))
      return next
    })
  }

  function clearAutosaveTimer() {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }

  useEffect(() => clearAutosaveTimer, [])

  // ── pointerup → open selection menu ──────────────────────────────────
  useEffect(() => {
    function onPointerUp(e: PointerEvent) {
      requestAnimationFrame(() => {
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed) return
        const selText = selection.toString().trim()
        if (!selText) return

        const anchor = selection.anchorNode
        if (!cardRef.current?.contains(anchor)) return

        const target = e.target as Node
        if (toolbarRef.current?.contains(target)) return

        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        if (!rect.width && !rect.height) return

        setMenuState({ selText, x: rect.left + rect.width / 2, y: rect.top })
      })
    }

    document.addEventListener('pointerup', onPointerUp)
    return () => document.removeEventListener('pointerup', onPointerUp)
  }, [])

  useEffect(() => {
    if (!menuState) return
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest?.('.selection-menu-container')) return
      setMenuState(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuState])

  // ── Click-to-edit ────────────────────────────────────────────────────
  function handleContentClick() {
    if (isEditing) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    startEdit()
  }

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

  // ── Action handlers ──────────────────────────────────────────────────
  async function handleSelectionAction(action: SelectionAction) {
    if (!menuState) return
    const { selText } = menuState
    setMenuState(null)
    window.getSelection()?.removeAllRanges()
    await executeAction(action, selText)
  }

  async function handleToolbarAction(action: SelectionAction) {
    const content = isEditingRef.current && editorRef.current
      ? editorRef.current.getHTML()
      : blockContentRef.current ?? ''
    const fullText = htmlToText(content)
    await executeAction(action, fullText)
  }

  async function executeAction(action: SelectionAction, selText: string) {
    const content = blockContentRef.current ?? ''
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
    lastSavedHTMLRef.current = block.content ?? ''
    setIsEditing(true)
  }

  function exitEdit() {
    clearAutosaveTimer()
    setIsEditing(false)
    savingRef.current = false
  }

  const saveEdit = useCallback(async () => {
    if (!isEditingRef.current || savingRef.current || !editorRef.current) return
    savingRef.current = true
    clearAutosaveTimer()
    setIsEditing(false)

    const html = editorRef.current.getHTML()
    const text = editorRef.current.getText().trim()
    const supabase = createClient()

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
    lastSavedHTMLRef.current = html
    onUpdate((saved as Block) ?? { ...block, content: html })
    savingRef.current = false
  }, [block, onUpdate, onRemove])

  const autosave = useCallback(async () => {
    if (!isEditingRef.current || savingRef.current || !editorRef.current) return
    const html = editorRef.current.getHTML()
    if (html === lastSavedHTMLRef.current) return

    const supabase = createClient()
    await supabase
      .from('journal_blocks')
      .update({ content: html })
      .eq('id', block.id)
    lastSavedHTMLRef.current = html
    blockContentRef.current = html
  }, [block.id])

  function handleEditorChange() {
    clearAutosaveTimer()
    autosaveTimerRef.current = setTimeout(autosave, autosaveInterval * 1000)
  }

  function handleEditorKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      exitEdit()
    }
  }

  async function markDone() {
    exitEdit()
    const supabase = createClient()
    await supabase.from('journal_blocks').update({ status: 'archived', is_archived: true }).eq('id', block.id)
    onRemove(block.id)
  }

  async function deleteBlock() {
    exitEdit()
    const supabase = createClient()
    await supabase.from('journal_blocks').update({ deleted_at: new Date().toISOString() }).eq('id', block.id)
    onRemove(block.id)
  }

  const dot = STATUS_DOT[block.status]
  const showModified = isMeaningfullyModified(block.created_at, block.updated_at)
  const contentHTML = (block.content ?? '').startsWith('<') ? block.content ?? '' : `<p>${(block.content ?? '').replace(/\n/g, '</p><p>')}</p>`

  // Build toolbar items (no Delegate)
  const toolbarItems: (ToolbarItem & { onClick: () => void })[] = [
    { key: 'task', label: 'Task', icon: taskIcon(), onClick: () => handleToolbarAction({ type: 'create_task', taskType: 'my_task' }) },
    { key: 'waiting', label: 'Waiting', icon: waitingIcon(), onClick: () => handleToolbarAction({ type: 'create_task', taskType: 'waiting_on' }) },
    { key: 'link', label: 'Link', icon: linkIcon(), onClick: () => {} },
    { key: 'info', label: 'Info', icon: infoIcon(), onClick: () => handleToolbarAction({ type: 'label_info' }) },
    { key: 'ai', label: 'AI', icon: sparkleIcon(), onClick: () => handleToolbarAction({ type: 'summarize' }) },
    { key: 'done', label: 'Done', icon: checkIcon(), onClick: markDone },
    { key: 'history', label: 'History', icon: historyIcon(), onClick: () => setShowHistory(true) },
    { key: 'format', label: 'Format', icon: aaIcon(), onClick: toggleFormatting, className: formattingVisible ? 'text-indigo-500 bg-indigo-50' : undefined },
    { key: 'delete', label: 'Delete', icon: trashIcon(), onClick: deleteBlock, className: 'text-red-400 hover:text-red-600 hover:bg-red-50' },
  ]

  return (
    <div
      ref={cardRef}
      className="relative group bg-white rounded-xl border border-gray-100 shadow-sm hover:border-gray-200 transition-colors flex"
      onClick={handleContentClick}
    >
      {dot && (
        <div
          className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-full ${dot.cls}`}
          style={{ left: '-1px' }}
          title={dot.title}
        />
      )}

      {/* Main content area */}
      <div className="flex-1 min-w-0 px-4 pt-3 pb-3">
        <div className="flex items-center gap-2 min-w-0 mb-2">
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

        {isEditing ? (
          <div onKeyDown={handleEditorKeyDown} onBlur={(e) => {
            if (cardRef.current?.contains(e.relatedTarget as Node)) return
            saveEdit()
          }}>
            <TipTapEditor
              ref={editorRef}
              content={contentHTML}
              autoFocus
              onSubmit={saveEdit}
              onChange={handleEditorChange}
              toolbarVisible={formattingVisible}
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

      {/* Right-edge vertical icon toolbar */}
      <div
        ref={toolbarRef}
        className={`flex-shrink-0 border-l border-gray-50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-stretch py-1 ${
          toolbarExpanded ? 'w-24' : 'w-9'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Expand/collapse chevron */}
        <button
          title={toolbarExpanded ? 'Collapse toolbar' : 'Expand toolbar'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleToolbarExpanded}
          className="p-0.5 mx-auto rounded text-gray-300 hover:text-gray-500 transition-colors mb-0.5"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {toolbarExpanded
              ? <><polyline points="15 18 9 12 15 6" /></>
              : <><polyline points="9 18 15 12 9 6" /></>
            }
          </svg>
        </button>

        {toolbarItems.map((item) => (
          <button
            key={item.key}
            title={item.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={item.onClick}
            className={`flex items-center gap-1.5 rounded transition-colors ${
              toolbarExpanded ? 'px-2 py-0.5' : 'justify-center px-0 py-0.5'
            } ${item.className ?? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
          >
            <span className="flex-shrink-0 flex items-center justify-center w-4 h-4">{item.icon}</span>
            {toolbarExpanded && (
              <span className="text-[10px] leading-none whitespace-nowrap">{item.label}</span>
            )}
          </button>
        ))}
      </div>

      {menuState && (
        <div className="selection-menu-container">
          <SelectionMenu
            position={{ x: menuState.x, y: menuState.y }}
            userId={block.user_id}
            onClose={() => setMenuState(null)}
            onAction={handleSelectionAction}
          />
        </div>
      )}

      {showHistory && (
        <HistoryModal blockId={block.id} onClose={() => setShowHistory(false)} />
      )}
    </div>
  )
}
