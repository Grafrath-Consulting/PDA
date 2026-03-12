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

interface BaseProps {
  autosaveInterval?: number
  formattingVisible: boolean
  onToggleFormatting: () => void
}

interface NewEntryProps extends BaseProps {
  block?: undefined
  userId: string
  contextId: string | null
  onSaved: (block: Block) => void
  onUpdate?: never
  onRemove?: never
  onSplitBlock?: never
}

interface ExistingBlockProps extends BaseProps {
  block: Block
  userId?: never
  contextId?: never
  onSaved?: never
  onUpdate: (block: Block) => void
  onRemove: (blockId: string) => void
  onSplitBlock: (newBlock: Block) => void
}

type Props = NewEntryProps | ExistingBlockProps

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

export function JournalBlock(props: Props) {
  const { autosaveInterval = 30, formattingVisible, onToggleFormatting } = props
  const isNewEntry = !props.block

  const [isEditing, setIsEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [menuState, setMenuState] = useState<MenuState | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [editorKey, setEditorKey] = useState(0)

  const editorRef = useRef<TipTapEditorHandle>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const blockContentRef = useRef(props.block?.content ?? '')
  if (props.block) blockContentRef.current = props.block.content ?? ''

  // Live editor content — updated on every keystroke via onChange.
  // These are the source of truth for save operations (avoids reliance
  // on editorRef which may be null if next/dynamic doesn't forward refs).
  const liveHTMLRef = useRef('')
  const liveTextRef = useRef('')

  const savingRef = useRef(false)
  const isEditingRef = useRef(isEditing || isNewEntry)
  isEditingRef.current = isEditing || isNewEntry

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedHTMLRef = useRef(props.block?.content ?? '')

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return
    function handler(e: MouseEvent) {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setPopoverOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverOpen])

  function clearAutosaveTimer() {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }

  useEffect(() => clearAutosaveTimer, [])

  // ── pointerup → open selection menu (existing blocks only) ──────────
  useEffect(() => {
    if (isNewEntry) return
    function onPointerUp(e: PointerEvent) {
      requestAnimationFrame(() => {
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed) return
        const selText = selection.toString().trim()
        if (!selText) return

        const anchor = selection.anchorNode
        if (!cardRef.current?.contains(anchor)) return

        const target = e.target as Node
        if (triggerRef.current?.contains(target)) return
        if (popoverRef.current?.contains(target)) return

        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        if (!rect.width && !rect.height) return

        setMenuState({ selText, x: rect.left + rect.width / 2, y: rect.top })
      })
    }

    document.addEventListener('pointerup', onPointerUp)
    return () => document.removeEventListener('pointerup', onPointerUp)
  }, [isNewEntry])

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

  // ── Click-to-edit (existing blocks only) ────────────────────────────
  function handleContentClick() {
    if (isNewEntry || isEditing) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    startEdit()
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (isNewEntry) return
    e.preventDefault()
    if (isEditing) return
    const selection = window.getSelection()
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim()
    if (!hasSelection) {
      const content = htmlToText(blockContentRef.current)
      setMenuState({ selText: content, x: e.clientX, y: e.clientY })
    }
  }

  // ── Action handlers (existing blocks only) ──────────────────────────
  async function handleSelectionAction(action: SelectionAction) {
    if (!menuState || !props.block) return
    const { selText } = menuState
    setMenuState(null)
    window.getSelection()?.removeAllRanges()
    await executeAction(action, selText)
  }

  async function handleToolbarAction(action: SelectionAction) {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    const content = isEditingRef.current
      ? liveHTMLRef.current
      : blockContentRef.current
    const fullText = htmlToText(content)
    await executeAction(action, fullText)
  }

  async function executeAction(action: SelectionAction, selText: string) {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    const block = p.block
    const currentContent = isEditingRef.current
      ? liveHTMLRef.current
      : blockContentRef.current

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
      if (isEmpty) p.onRemove(block.id)
      else { p.onUpdate({ ...block, content: newContent, status: newStatus }); exitEdit() }
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
      if (newBlock) p.onSplitBlock(newBlock as Block)
      if (isEmpty) p.onRemove(block.id)
      else { p.onUpdate({ ...block, content: newContent, status: newStatus }); exitEdit() }
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
      p.onUpdate({ ...block, status: 'partially_handled' })
      return
    }

    if (action.type === 'label_info') {
      const newContent = removeTextFromHTML(currentContent, selText)
      const isEmpty = !htmlToText(newContent).trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'
      await supabase.from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)
      if (isEmpty) p.onRemove(block.id)
      else { p.onUpdate({ ...block, content: newContent, status: newStatus }); exitEdit() }
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
      p.onUpdate({ ...block, content: newContent, status: 'partially_handled' })
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
      if (isEmpty) p.onRemove(block.id)
      else { p.onUpdate({ ...block, content: newContent, status: newStatus }); exitEdit() }
    }
  }

  // ── Inline edit ──────────────────────────────────────────────────────
  function startEdit() {
    if (isEditing) return
    savingRef.current = false
    const content = props.block?.content ?? ''
    lastSavedHTMLRef.current = content
    liveHTMLRef.current = content
    liveTextRef.current = htmlToText(content)
    setIsEditing(true)
  }

  function exitEdit() {
    clearAutosaveTimer()
    setIsEditing(false)
    setFocused(false)
    savingRef.current = false
  }

  // Keep a ref to props so async callbacks always see the latest values
  const propsRef = useRef(props)
  propsRef.current = props

  // ── Save: new entry → INSERT, existing → UPDATE + block_version ─────
  const saveNewEntry = useCallback(async () => {
    if (savingRef.current) return
    const html = liveHTMLRef.current
    const text = liveTextRef.current.trim()
    if (!text) return

    savingRef.current = true
    clearAutosaveTimer()

    const p = propsRef.current as NewEntryProps
    const supabase = createClient()
    const { data, error } = await supabase
      .from('journal_blocks')
      .insert({
        user_id: p.userId,
        context_id: p.contextId ?? null,
        content: html,
        status: 'unprocessed',
      })
      .select()
      .single()

    savingRef.current = false
    if (error) { console.error(error); return }
    liveHTMLRef.current = ''
    liveTextRef.current = ''
    setFocused(false)
    setEditorKey(k => k + 1)
    if (data) p.onSaved(data as Block)
  }, [])

  const saveExistingBlock = useCallback(async () => {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block || savingRef.current) return

    const html = liveHTMLRef.current
    const text = liveTextRef.current.trim()

    savingRef.current = true
    clearAutosaveTimer()
    setIsEditing(false)
    setFocused(false)

    const supabase = createClient()
    const block = p.block

    const oldText = htmlToText(block.content ?? '').trim()
    if (text === oldText) {
      savingRef.current = false
      return
    }

    if (!text) {
      await supabase.from('journal_blocks').update({ status: 'archived', is_archived: true }).eq('id', block.id)
      p.onRemove(block.id)
      savingRef.current = false
      return
    }

    // Write block_version before updating
    await supabase.from('block_versions').insert({
      block_id: block.id,
      content: block.content,
      content_html: block.content,
      edited_at: new Date().toISOString(),
    })

    const { data: saved } = await supabase
      .from('journal_blocks')
      .update({ content: html })
      .eq('id', block.id)
      .select()
      .single()
    lastSavedHTMLRef.current = html
    p.onUpdate((saved as Block) ?? { ...block, content: html })
    savingRef.current = false
  }, [])

  const handleSave = isNewEntry ? saveNewEntry : saveExistingBlock

  // ── Autosave (silent content update, no block_version) ──────────────
  const autosaveRef = useRef(() => {})

  autosaveRef.current = isNewEntry
    ? async () => {
        if (savingRef.current) return
        const text = liveTextRef.current.trim()
        if (!text) return
        await saveNewEntry()
      }
    : async () => {
        const p = propsRef.current as ExistingBlockProps
        if (!p.block || savingRef.current) return
        if (!isEditingRef.current) return
        const html = liveHTMLRef.current
        if (html === lastSavedHTMLRef.current) return

        const supabase = createClient()
        await supabase
          .from('journal_blocks')
          .update({ content: html })
          .eq('id', p.block.id)
        lastSavedHTMLRef.current = html
        blockContentRef.current = html
      }

  function handleEditorChange(html: string, text: string) {
    liveHTMLRef.current = html
    liveTextRef.current = text
    const trimmed = text.trim()
    if (isNewEntry) {
      if (trimmed && !focused) setFocused(true)
      if (!trimmed) { setFocused(false); clearAutosaveTimer(); return }
    }
    clearAutosaveTimer()
    autosaveTimerRef.current = setTimeout(() => autosaveRef.current(), autosaveInterval * 1000)
  }

  function handleEditorKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !isNewEntry) {
      e.preventDefault()
      exitEdit()
    }
  }

  function handleBlur(e: React.FocusEvent) {
    if (cardRef.current?.contains(e.relatedTarget as Node)) return
    if (isNewEntry) {
      const text = liveTextRef.current.trim()
      if (!text) { setFocused(false); return }
      saveNewEntry()
    } else if (isEditing) {
      saveExistingBlock()
    }
  }

  async function markDone() {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    exitEdit()
    const supabase = createClient()
    await supabase.from('journal_blocks').update({ status: 'archived', is_archived: true }).eq('id', p.block.id)
    p.onRemove(p.block.id)
  }

  async function deleteBlock() {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    exitEdit()
    const supabase = createClient()
    await supabase.from('journal_blocks').update({ deleted_at: new Date().toISOString() }).eq('id', p.block.id)
    p.onRemove(p.block.id)
  }

  // ── Derived values ──────────────────────────────────────────────────
  const block = props.block
  const showModified = block ? isMeaningfullyModified(block.created_at, block.updated_at) : false
  const contentHTML = block
    ? ((block.content ?? '').startsWith('<') ? block.content ?? '' : `<p>${(block.content ?? '').replace(/\n/g, '</p><p>')}</p>`)
    : ''
  const editorActive = isNewEntry || isEditing
  const showToolbarInEditor = editorActive && focused && formattingVisible

  // Build popover menu items (existing blocks only)
  const popoverItems = block ? [
    { key: 'task', label: 'Create Task', icon: taskIcon(), onClick: () => { setPopoverOpen(false); handleToolbarAction({ type: 'create_task', taskType: 'my_task' }) } },
    { key: 'waiting', label: 'Waiting On', icon: waitingIcon(), onClick: () => { setPopoverOpen(false); handleToolbarAction({ type: 'create_task', taskType: 'waiting_on' }) } },
    { key: 'link', label: 'Link to Project', icon: linkIcon(), onClick: () => { setPopoverOpen(false) } },
    { key: 'info', label: 'Label as Info', icon: infoIcon(), onClick: () => { setPopoverOpen(false); handleToolbarAction({ type: 'label_info' }) } },
    { key: 'ai', label: 'AI Summarize', icon: sparkleIcon(), onClick: () => { setPopoverOpen(false); handleToolbarAction({ type: 'summarize' }) } },
    { key: 'format', label: 'Aa', icon: aaIcon(), onClick: () => { setPopoverOpen(false); onToggleFormatting() }, className: formattingVisible ? 'text-indigo-600 bg-indigo-50' : undefined },
    { key: 'done', label: 'Mark as Done', icon: checkIcon(), onClick: () => { setPopoverOpen(false); markDone() } },
    { key: 'history', label: 'View History', icon: historyIcon(), onClick: () => { setPopoverOpen(false); setShowHistory(true) } },
    { key: 'delete', label: 'Delete', icon: trashIcon(), onClick: () => { setPopoverOpen(false); deleteBlock() }, className: 'text-red-500 hover:bg-red-50' },
  ] as { key: string; label: string; icon: React.ReactNode; onClick: () => void; className?: string }[] : []

  return (
    <div
      ref={cardRef}
      className={`relative group bg-white rounded-xl border shadow-sm transition-colors ${
        (isNewEntry && focused) ? 'border-indigo-200 shadow-md' : 'border-gray-100 hover:border-gray-200'
      }`}
      onClick={handleContentClick}
    >
      {/* Popover trigger — existing blocks only */}
      {block && (
        <button
          ref={triggerRef}
          type="button"
          title="Actions"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.stopPropagation(); setPopoverOpen(prev => !prev) }}
          className={`absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all ${
            popoverOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
        </button>
      )}

      {/* Popover menu */}
      {popoverOpen && block && (
        <div
          ref={popoverRef}
          className="absolute top-9 right-2 z-20 bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-[172px]"
          onClick={(e) => e.stopPropagation()}
        >
          {popoverItems.map((item) => (
            <button
              key={item.key}
              onMouseDown={(e) => e.preventDefault()}
              onClick={item.onClick}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-gray-50 transition-colors ${
                item.className ?? 'text-gray-700'
              }`}
            >
              <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="px-4 pt-3 pb-1">
        {editorActive ? (
          <div
            onKeyDown={handleEditorKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={handleBlur}
          >
            <TipTapEditor
              key={isNewEntry ? editorKey : undefined}
              ref={editorRef}
              content={contentHTML}
              placeholder={isNewEntry ? "What's on your mind? Press Ctrl+Enter to save." : undefined}
              autoFocus={isNewEntry || isEditing}
              onSubmit={handleSave}
              onChange={handleEditorChange}
              toolbarVisible={showToolbarInEditor}
            />
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

      {/* Bottom bar */}
      <div className="flex items-center justify-between px-4 pb-2 pt-1">
        <span className="text-xs text-gray-400">
          {block
            ? <>{formatTimestamp(block.created_at)}{showModified && <span> · edited {formatTimestamp(block.updated_at)}</span>}</>
            : 'New Entry'
          }
        </span>
        {editorActive && focused && (
          <span className="text-xs text-gray-400">
            Ctrl+Enter to save{!isNewEntry && ' · Esc to cancel'} · click outside to save
          </span>
        )}
      </div>

      {menuState && block && (
        <div className="selection-menu-container">
          <SelectionMenu
            position={{ x: menuState.x, y: menuState.y }}
            userId={block.user_id}
            onClose={() => setMenuState(null)}
            onAction={handleSelectionAction}
          />
        </div>
      )}

      {showHistory && block && (
        <HistoryModal blockId={block.id} onClose={() => setShowHistory(false)} />
      )}
    </div>
  )
}
