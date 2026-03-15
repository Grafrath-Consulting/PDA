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
  onBlockArchived?: (block: Block) => void
  onSplitBlock: (newBlock: Block, updatedSourceBlock: Block) => void
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

/** Normalise raw block content to HTML suitable for TipTap */
function toEditorHTML(raw: string | null): string {
  if (!raw) return ''
  return raw.startsWith('<') ? raw : `<p>${raw.replace(/\n/g, '</p><p>')}</p>`
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
function formatBarIcon() {
  return <span className="text-[10px] font-semibold leading-none">Aa</span>
}

// Module-level: only one block can be active at a time.
// When a new block activates, it calls the previous block's save+deactivate directly.
let deactivatePreviousBlock: (() => void) | null = null

export function JournalBlock(props: Props) {
  const { autosaveInterval = 30, formattingVisible, onToggleFormatting } = props
  const isNewEntry = !props.block

  const [showHistory, setShowHistory] = useState(false)
  const [menuState, setMenuState] = useState<MenuState | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [editorKey, setEditorKey] = useState(0)

  const editorRef = useRef<TipTapEditorHandle>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const savingRef = useRef(false)

  // Live editor content — updated on every keystroke via onChange.
  // Initialised from block content so save sees real data even before onChange fires.
  const liveHTMLRef = useRef(toEditorHTML(props.block?.content ?? ''))
  const liveTextRef = useRef(htmlToText(props.block?.content ?? ''))
  const focusedRef = useRef(isNewEntry || focused)
  focusedRef.current = isNewEntry || focused

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedHTMLRef = useRef(props.block?.content ?? '')


  // Track the last props.block.content we synced into the editor,
  // so we can detect external updates and push them in.
  const lastSyncedContentRef = useRef(props.block?.content ?? null)

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

  // ── Sync content from props into the editor when block is updated externally ──
  useEffect(() => {
    const incoming = props.block?.content ?? null
    if (incoming === lastSyncedContentRef.current) return
    lastSyncedContentRef.current = incoming
    // Don't overwrite the editor while the user is actively editing
    if (focusedRef.current) return
    const html = toEditorHTML(incoming)
    editorRef.current?.setContent(html)
    liveHTMLRef.current = html
    liveTextRef.current = htmlToText(html)
    lastSavedHTMLRef.current = html
  }, [props.block?.content])

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

        const cardRect = cardRef.current?.getBoundingClientRect()
        const menuX = cardRect ? cardRect.left : rect.left
        const menuY = rect.top + rect.height / 2
        setMenuState({ selText, x: menuX, y: menuY })
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

  // ── Mousedown-to-activate (existing blocks only) ────────────────────
  // Clicking a non-focused block sets it to focused/editable. The actual
  // editor focus + cursor placement is deferred to requestAnimationFrame
  // so React has time to re-render with editable={true} first.
  function handleContentMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return // left click only
    // If already focused, clicking inside the card but OUTSIDE the editor
    // (padding, timestamp, etc.) should keep the editor focused rather than
    // letting the browser steal focus. Clicks inside the editor are left to
    // ProseMirror so it handles cursor placement natively.
    if (focused || isNewEntry) {
      const tiptapEl = cardRef.current?.querySelector('.tiptap-wrapper')
      if (!tiptapEl?.contains(e.target as Node)) {
        e.preventDefault()
        const ce = cardRef.current?.querySelector('[contenteditable="true"]') as HTMLElement
        if (ce) {
          ce.focus()
          const sel = window.getSelection()
          if (sel) {
            sel.selectAllChildren(ce)
            sel.collapseToEnd()
          }
        }
      }
      return
    }
    if (popoverOpen) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    // Directly deactivate the previously focused block (save + unfocus).
    // This is reliable regardless of DOM focus state — no blur chain dependency.
    deactivatePreviousBlock?.()
    lastSavedHTMLRef.current = liveHTMLRef.current
    setFocused(true)
    // Register this block's deactivation so the *next* activated block can call it
    deactivatePreviousBlock = () => saveExistingBlock()
    const x = e.clientX, y = e.clientY
    const tiptapEl = cardRef.current?.querySelector('.tiptap-wrapper')
    const clickedInEditor = tiptapEl?.contains(e.target as Node)
    requestAnimationFrame(() => {
      if (clickedInEditor) {
        editorRef.current?.focusAtCoords(x, y)
      } else {
        // Bypass TipTap's API — directly focus the contenteditable element
        // and place the cursor at the end using native browser APIs.
        // This avoids issues with TipTap's command chain silently failing
        // when the editor just transitioned from non-editable to editable.
        const ce = cardRef.current?.querySelector('[contenteditable="true"]') as HTMLElement
        if (ce) {
          ce.focus()
          const sel = window.getSelection()
          if (sel) {
            sel.selectAllChildren(ce)
            sel.collapseToEnd()
          }
        }
      }
    })
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (isNewEntry) return
    e.preventDefault()
    if (focused) return
    const selection = window.getSelection()
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim()
    if (!hasSelection) {
      const content = htmlToText(liveHTMLRef.current || toEditorHTML(props.block?.content ?? ''))
      const cardRect = cardRef.current?.getBoundingClientRect()
      setMenuState({ selText: content, x: cardRect?.left ?? e.clientX, y: e.clientY })
    }
  }

  // ── Push new content into the always-mounted editor + sync refs ────
  // Note: we intentionally do NOT update lastSyncedContentRef here.
  // If editorRef.current is null (e.g. timing/dynamic import), setContent
  // silently no-ops. By leaving lastSyncedContentRef stale, the content
  // sync useEffect will detect the mismatch when props.block.content
  // updates (via onUpdate) and push the content into the editor as a
  // reliable fallback — which works because deactivate() clears focused.
  function syncEditorContent(html: string) {
    editorRef.current?.setContent(html)
    liveHTMLRef.current = html
    liveTextRef.current = htmlToText(html)
    lastSavedHTMLRef.current = html
  }

  // ── Deactivate (unfocus) an existing block ──────────────────────────
  function deactivate() {
    deactivatePreviousBlock = null
    clearAutosaveTimer()
    setFocused(false)
    savingRef.current = false
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
    await flushEdits()
    const content = liveHTMLRef.current || toEditorHTML(p.block.content)
    const fullText = htmlToText(content)
    await executeAction(action, fullText)
  }

  async function executeAction(action: SelectionAction, selText: string) {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    const block = p.block
    const currentContent = liveHTMLRef.current || toEditorHTML(block.content)

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
      if (isEmpty) { p.onRemove(block.id); p.onBlockArchived?.({ ...block, content: newContent, status: 'archived', is_archived: true }) }
      else { syncEditorContent(newContent); p.onUpdate({ ...block, content: newContent, status: newStatus }); deactivate() }
      return
    }

    if (action.type === 'split_block') {
      const newContent = removeTextFromHTML(currentContent, selText)
      const isEmpty = !htmlToText(newContent).trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'
      await supabase.from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)
      const splitCreatedAt = new Date(
        new Date(block.created_at).getTime() - 1
      ).toISOString()
      const splitSortOrder = (block.sort_order ?? 0) - 0.5
      const { data: newBlock } = await supabase.from('journal_blocks')
        .insert({ user_id: block.user_id, context_id: block.context_id, content: selText, status: 'partially_handled', created_at: splitCreatedAt, sort_order: splitSortOrder })
        .select().single()
      const updatedSourceBlock = { ...block, content: newContent, status: newStatus }
      if (newBlock) p.onSplitBlock(newBlock as Block, updatedSourceBlock as Block)
      if (isEmpty) { p.onRemove(block.id); p.onBlockArchived?.({ ...block, content: newContent, status: 'archived', is_archived: true }) }
      else {
        const htmlToApply = toEditorHTML(newContent)
        syncEditorContent(newContent)
        deactivate()
        // Re-apply after React re-renders and TipTap editable-change effects settle.
        // This guards against TipTap reverting content when editable flips to false.
        requestAnimationFrame(() => {
          editorRef.current?.setContent(htmlToApply)
          liveHTMLRef.current = htmlToApply
          liveTextRef.current = htmlToText(htmlToApply)
          lastSavedHTMLRef.current = htmlToApply
          lastSyncedContentRef.current = newContent
        })
      }
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
      if (isEmpty) { p.onRemove(block.id); p.onBlockArchived?.({ ...block, content: newContent, status: 'archived', is_archived: true }) }
      else { syncEditorContent(newContent); p.onUpdate({ ...block, content: newContent, status: newStatus }); deactivate() }
      return
    }

    if (action.type === 'summarize') {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selText }),
      })
      if (!res.ok) {
        const errText = await res.text()
        console.error('Summarize API error:', res.status, errText)
        return
      }
      const json = await res.json()
      if (!json.summary) return
      const newContent = replaceTextInHTML(currentContent, selText, json.summary)
      await supabase.from('journal_blocks').update({ content: newContent, status: 'partially_handled' }).eq('id', block.id)
      syncEditorContent(newContent)
      p.onUpdate({ ...block, content: newContent, status: 'partially_handled' })
      deactivate()
      return
    }

    if (action.type === 'delete_selection') {
      const newContent = removeTextFromHTML(currentContent, selText)
      const isEmpty = !htmlToText(newContent).trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'partially_handled'
      await supabase.from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)
      if (isEmpty) { p.onRemove(block.id); p.onBlockArchived?.({ ...block, content: newContent, status: 'archived', is_archived: true }) }
      else { syncEditorContent(newContent); p.onUpdate({ ...block, content: newContent, status: newStatus }); deactivate() }
    }
  }

  // Keep a ref to props so async callbacks always see the latest values
  const propsRef = useRef(props)
  propsRef.current = props

  // Flush pending editor content to DB without creating a block_version.
  // Called before dot-menu actions so they operate on current content.
  async function flushEdits() {
    if (!focusedRef.current || savingRef.current) return
    const p = propsRef.current
    if (!('block' in p) || !p.block) return
    const html = liveHTMLRef.current
    if (html === lastSavedHTMLRef.current) return
    const supabase = createClient()
    await supabase
      .from('journal_blocks')
      .update({ content: html })
      .eq('id', p.block.id)
    lastSavedHTMLRef.current = html
  }

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
    if (error) { console.error(error); return null }
    liveHTMLRef.current = ''
    liveTextRef.current = ''
    setFocused(false)
    setEditorKey(k => k + 1)
    if (data) p.onSaved(data as Block)
    return (data as Block) ?? null
  }, [])

  const saveExistingBlock = useCallback(async () => {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return

    // Always deactivate visually, even if a save is already in flight
    clearAutosaveTimer()
    setFocused(false)

    if (savingRef.current) return

    const html = liveHTMLRef.current
    const text = liveTextRef.current.trim()

    savingRef.current = true

    const supabase = createClient()
    const block = p.block

    const oldText = htmlToText(block.content ?? '').trim()
    const oldHtml = block.content ?? ''
    if (text === oldText && html === oldHtml) {
      savingRef.current = false
      return
    }

    if (!text) {
      await supabase.from('journal_blocks').update({ status: 'archived', is_archived: true }).eq('id', block.id)
      p.onRemove(block.id)
      p.onBlockArchived?.({ ...block, status: 'archived', is_archived: true })
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
    const savedBlock = (saved as Block) ?? { ...block, content: html }
    lastSyncedContentRef.current = savedBlock.content
    p.onUpdate(savedBlock)
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
        if (!focusedRef.current) return
        const html = liveHTMLRef.current
        if (html === lastSavedHTMLRef.current) return

        const supabase = createClient()
        await supabase
          .from('journal_blocks')
          .update({ content: html })
          .eq('id', p.block.id)
        lastSavedHTMLRef.current = html
      }

  function handleEditorChange(html: string, text: string) {
    liveHTMLRef.current = html
    liveTextRef.current = text
    const trimmed = text.trim()
    if (isNewEntry) {
      if (trimmed && !focused) setFocused(true)
      if (!trimmed) { setFocused(false); clearAutosaveTimer(); return }
    }
    // Don't start autosave timers for unfocused existing blocks
    if (!isNewEntry && !focusedRef.current) return
    clearAutosaveTimer()
    autosaveTimerRef.current = setTimeout(() => autosaveRef.current(), autosaveInterval * 1000)
  }

  async function handleNewEntryShortcut(action: SelectionAction) {
    const p = propsRef.current as NewEntryProps
    if (savingRef.current) return
    const html = liveHTMLRef.current
    const text = liveTextRef.current.trim()
    if (!text) return

    savingRef.current = true
    clearAutosaveTimer()
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
    if (error || !data) { console.error(error); return }

    liveHTMLRef.current = ''
    liveTextRef.current = ''
    setFocused(false)
    setEditorKey(k => k + 1)
    p.onSaved(data as Block)

    const saved = data as Block
    const fullText = htmlToText(html)
    const supabase2 = createClient()

    if (action.type === 'create_task') {
      await supabase2.from('journal_blocks')
        .update({ status: 'archived', is_archived: true })
        .eq('id', saved.id)
      await supabase2.from('tasks').insert({
        user_id: saved.user_id,
        context_id: saved.context_id,
        title: fullText.slice(0, 500),
        body: fullText,
        status: 'open',
        task_type: action.taskType,
        assignee_id: null,
      })
      return
    }

    if (action.type === 'mark_done') {
      await supabase2.from('tasks').insert({
        user_id: saved.user_id,
        context_id: saved.context_id,
        title: fullText.slice(0, 500),
        body: fullText,
        status: 'done',
        task_type: 'my_task',
        assignee_id: null,
      })
      await supabase2.from('journal_blocks')
        .update({ status: 'archived', is_archived: true })
        .eq('id', saved.id)
      return
    }

    if (action.type === 'summarize') {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fullText }),
      })
      if (!res.ok) return
      const json = await res.json()
      if (!json.summary) return
      await supabase2.from('journal_blocks')
        .update({ content: json.summary, status: 'partially_handled' })
        .eq('id', saved.id)
    }
  }

  function handleEditorKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !isNewEntry && focused) {
      e.preventDefault()
      const revertTo = lastSavedHTMLRef.current
      editorRef.current?.setContent(revertTo)
      liveHTMLRef.current = revertTo
      liveTextRef.current = htmlToText(revertTo)
      deactivate()
      return
    }

    const isAltShift = e.altKey && e.shiftKey
    const isCtrlOnly = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey

    if (isAltShift && e.key === 'F') {
      e.preventDefault()
      onToggleFormatting()
      return
    }

    if (isNewEntry && isAltShift) {
      if (e.key === 'T') {
        e.preventDefault()
        handleNewEntryShortcut({ type: 'create_task', taskType: 'my_task' })
        return
      }
      if (e.key === 'W') {
        e.preventDefault()
        handleNewEntryShortcut({ type: 'create_task', taskType: 'waiting_on' })
        return
      }
      if (e.key === 'D') {
        e.preventDefault()
        handleNewEntryShortcut({ type: 'mark_done' })
        return
      }
      if (e.key === 'S') {
        e.preventDefault()
        handleNewEntryShortcut({ type: 'summarize' })
        return
      }
    }

    if (isNewEntry && isCtrlOnly && e.key === 'Delete') {
      e.preventDefault()
      e.stopPropagation()
      liveHTMLRef.current = ''
      liveTextRef.current = ''
      clearAutosaveTimer()
      setEditorKey(k => k + 1)
      return
    }

    if (!isNewEntry && focused && isAltShift) {
      if (e.key === 'T') {
        e.preventDefault()
        handleToolbarAction({ type: 'create_task', taskType: 'my_task' })
        return
      }
      if (e.key === 'W') {
        e.preventDefault()
        handleToolbarAction({ type: 'create_task', taskType: 'waiting_on' })
        return
      }
      if (e.key === 'D') {
        e.preventDefault()
        markDone()
        return
      }
      if (e.key === 'S') {
        e.preventDefault()
        handleToolbarAction({ type: 'summarize' })
        return
      }
    }

    if (!isNewEntry && focused && isCtrlOnly && e.key === 'Delete') {
      e.preventDefault()
      deleteBlock()
      return
    }
  }

  function handleBlur(e: React.FocusEvent) {
    // If focus moved to another element inside the card, stay active
    if (cardRef.current?.contains(e.relatedTarget as Node)) return
    // When clicking non-focusable areas (padding) inside the card,
    // relatedTarget is null. Defer to let the browser settle focus,
    // then check whether the click was actually outside the card.
    if (!e.relatedTarget) {
      requestAnimationFrame(() => {
        // If focus has already landed inside this card, do nothing.
        if (cardRef.current?.contains(document.activeElement)) return
        if (isNewEntry) {
          const text = liveTextRef.current.trim()
          if (!text) { setFocused(false); return }
          saveNewEntry()
        } else if (focusedRef.current) {
          // Extra guard: if this block was just activated in the same rAF
          // batch (e.g. padding click on an inactive block), focusedRef is
          // true but saveExistingBlock would deactivate it immediately.
          // Only save/deactivate if the active element is truly outside the card.
          if (!cardRef.current?.contains(document.activeElement)) {
            deactivatePreviousBlock = null
            saveExistingBlock()
          }
        }
      })
      return
    }
    if (isNewEntry) {
      const text = liveTextRef.current.trim()
      if (!text) { setFocused(false); return }
      saveNewEntry()
    } else if (focused) {
      deactivatePreviousBlock = null // already deactivating, prevent double-save
      saveExistingBlock()
    }
  }

  async function markDone() {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    await flushEdits()
    deactivate()
    const supabase = createClient()
    await supabase.from('journal_blocks').update({ status: 'archived', is_archived: true }).eq('id', p.block.id)
    p.onRemove(p.block.id)
    p.onBlockArchived?.({ ...p.block, status: 'archived', is_archived: true })
  }

  async function deleteBlock() {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    await flushEdits()
    deactivate()
    const supabase = createClient()
    const deletedAt = new Date().toISOString()
    await supabase.from('journal_blocks').update({ deleted_at: deletedAt }).eq('id', p.block.id)
    p.onRemove(p.block.id)
    p.onBlockArchived?.({ ...p.block, deleted_at: deletedAt })
  }

  // ── Derived values ──────────────────────────────────────────────────
  const block = props.block
  const showModified = block ? isMeaningfullyModified(block.created_at, block.updated_at) : false
  const contentHTML = block ? toEditorHTML(block.content) : ''
  const showToolbar = focused && formattingVisible

  // Build popover menu items — identical chrome for new entry and existing blocks.
  const popoverItems: { key: string; label: string; shortcut?: string; icon: React.ReactNode; onClick: () => void; className?: string }[] = [
    { key: 'task', label: 'Create Task', shortcut: '⌥⇧T', icon: taskIcon(), onClick: () => { setPopoverOpen(false); handleToolbarAction({ type: 'create_task', taskType: 'my_task' }) } },
    { key: 'waiting', label: 'Waiting On', shortcut: '⌥⇧W', icon: waitingIcon(), onClick: () => { setPopoverOpen(false); handleToolbarAction({ type: 'create_task', taskType: 'waiting_on' }) } },
    { key: 'link', label: 'Link to Project', icon: linkIcon(), onClick: () => { setPopoverOpen(false) } },
    { key: 'info', label: 'Label as Info', icon: infoIcon(), onClick: () => { setPopoverOpen(false); handleToolbarAction({ type: 'label_info' }) } },
    { key: 'ai', label: 'AI Summarize', shortcut: '⌥⇧S', icon: sparkleIcon(), onClick: () => { setPopoverOpen(false); handleToolbarAction({ type: 'summarize' }) } },
    { key: 'format', label: 'Formatting', shortcut: '⌥⇧F', icon: formatBarIcon(), onClick: () => { setPopoverOpen(false); onToggleFormatting() }, className: formattingVisible ? 'text-amber-700 bg-amber-50' : undefined },
    { key: 'done', label: 'Mark as Done', shortcut: '⌥⇧D', icon: checkIcon(), onClick: () => { setPopoverOpen(false); markDone() } },
    { key: 'history', label: 'View History', icon: historyIcon(), onClick: () => { setPopoverOpen(false); if (block) setShowHistory(true) } },
    { key: 'delete', label: 'Delete', shortcut: '⌃⌦', icon: trashIcon(), onClick: () => { setPopoverOpen(false); if (isNewEntry) { liveHTMLRef.current = ''; liveTextRef.current = ''; clearAutosaveTimer(); setEditorKey(k => k + 1) } else { deleteBlock() } }, className: 'text-red-500 hover:bg-red-50' },
  ]

  // Disable split when selection covers entire block content
  const splitWouldEmpty = menuState
    ? htmlToText(liveHTMLRef.current || toEditorHTML(block?.content ?? '')).trim() === menuState.selText.trim()
    : false

  return (
    <div
      ref={cardRef}
      className={`relative group rounded-xl shadow-sm transition-colors ${
        focused
          ? 'border-l-[3px] border-l-[#F59E0B] border border-[#E5E0D0] bg-[#FFFBEB] shadow-md'
          : 'border border-[#E5E0D0] bg-white pl-[2px] hover:border-[#D5D0C0]'
      }`}
      onMouseDown={handleContentMouseDown}
    >
      {/* Popover trigger */}
      <button
        ref={triggerRef}
        type="button"
        title="Actions"
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
        onClick={(e) => { e.stopPropagation(); setPopoverOpen(prev => !prev) }}
        className={`absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all ${
          popoverOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
      </button>

      {/* Popover menu */}
      {popoverOpen && (
        <div
          ref={popoverRef}
          className="absolute top-9 right-2 z-20 bg-white border border-[#E5E0D0] rounded-lg shadow-xl py-1 min-w-[172px]"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {popoverItems.map((item) => (
            <button
              key={item.key}
              onMouseDown={(e) => e.preventDefault()}
              onClick={item.onClick}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[#FFFEF7] transition-colors ${
                item.className ?? 'text-gray-700'
              }`}
            >
              <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.shortcut && <span className="text-[10px] text-gray-400 ml-3">{item.shortcut}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Content — always-mounted TipTap editor for active blocks */}
      <div
        className={`px-4 pb-0 ${showToolbar ? 'pt-1' : 'pt-2'}`}
        onKeyDown={handleEditorKeyDown}
        onFocus={() => {
          if (isNewEntry) {
            // Deactivate any previously focused existing block.
            // handleContentMouseDown returns early for new entry blocks so this
            // is the only place we can intercept focus arriving at the composer.
            deactivatePreviousBlock?.()
            deactivatePreviousBlock = null
            if (!focused) setFocused(true)
          }
        }}
        onBlur={handleBlur}
        onContextMenu={handleContextMenu}
      >
        <TipTapEditor
          key={isNewEntry ? editorKey : undefined}
          ref={editorRef}
          content={contentHTML}
          placeholder={isNewEntry ? "What's on your mind? Press Ctrl+Enter to save." : undefined}
          autoFocus={isNewEntry}
          onSubmit={handleSave}
          onChange={handleEditorChange}
          editable={isNewEntry || focused}
          toolbarVisible={showToolbar}
        />
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between px-4 pb-1.5 pt-0 select-none">
        <span className="text-[11px] text-gray-400">
          {block
            ? <>Created {formatTimestamp(block.created_at)}{showModified && <span> · Modified {formatTimestamp(block.updated_at)}</span>}</>
            : 'New Entry'
          }
        </span>
        {focused && (
          <span className="text-[11px] text-gray-400">
            Ctrl+Enter (or click outside) to save{!isNewEntry && ' · Esc to cancel'} · Ctrl+Del to delete
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
            disableSplit={splitWouldEmpty}
          />
        </div>
      )}

      {showHistory && block && (
        <HistoryModal blockId={block.id} onClose={() => setShowHistory(false)} />
      )}
    </div>
  )
}
