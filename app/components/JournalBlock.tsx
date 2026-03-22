'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { Block, BlockStatus, SelectionAction } from '../types'
import { SelectionMenu } from './SelectionMenu'
import { HistoryModal } from './HistoryModal'
import type { TipTapEditorHandle } from './TipTapEditor'
import { useWorkspace } from '@/context/WorkspaceContext'
import { useDateFormat } from '@/context/DateFormatContext'
import { formatTimestamp, formatDatePart } from '@/lib/date-format'
import { getScheme } from '@/constants/workspaceColorSchemes'
import { useProperties } from '@/context/PropertiesContext'
import { PropertyBubbles } from './PropertyBubbles'
import { PropertyEditor } from './PropertyEditor'
import { AttachmentRow, Attachment } from './AttachmentRow'

const TipTapEditor = dynamic(() => import('./TipTapEditor').then(m => m.TipTapEditor), { ssr: false })

// ── 30-minute increment time picker dropdown ─────────────────────────
// Internal values stored as "HH:MM" (24h), display formatted per user pref
const TIME_SLOTS: string[] = (() => {
  const opts: string[] = []
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return opts
})()

function formatTimeSlot(slot: string, fmt: '12h' | '24h'): string {
  const [hStr, mStr] = slot.split(':')
  const h = parseInt(hStr)
  if (fmt === '24h') return `${hStr}:${mStr}`
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${String(h12).padStart(2, '0')}:${mStr} ${period}`
}

function TimePickerDropdown({ value, onChange, timeFormat }: { value: string; onChange: (v: string) => void; timeFormat: '12h' | '24h' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Scroll to current value when opening
  useEffect(() => {
    if (!open || !listRef.current) return
    const active = listRef.current.querySelector('[data-active="true"]')
    if (active) active.scrollIntoView({ block: 'center' })
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="inline-flex items-center gap-1 cursor-pointer text-xs hover:text-gray-900 py-0.5 ml-0.5"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        {value ? (
          <span className="text-gray-600">{formatTimeSlot(value, timeFormat)}</span>
        ) : (
          <span className="text-gray-300">Time</span>
        )}
      </button>
      {open && (
        <div
          ref={listRef}
          className="absolute bottom-full mb-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-[110px] max-h-[200px] overflow-y-auto z-50"
        >
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false) }}
            className={`w-full px-3 py-1 text-xs text-left hover:bg-gray-50 transition-colors ${
              !value ? 'text-amber-700 font-medium' : 'text-gray-500'
            }`}
          >
            No time
          </button>
          {TIME_SLOTS.map(t => (
            <button
              key={t}
              type="button"
              data-active={t === value ? 'true' : undefined}
              onClick={() => { onChange(t); setOpen(false) }}
              className={`w-full px-3 py-1 text-xs text-left hover:bg-gray-50 transition-colors ${
                t === value ? 'text-amber-700 font-medium bg-amber-50' : 'text-gray-700'
              }`}
            >
              {formatTimeSlot(t, timeFormat)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface MenuState {
  selText: string
  selHTML: string
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
  appliedPropertyIds?: Set<string>
  onPropertyChanged?: (newIds: Set<string>) => void
  similarityScore?: number
  searchHighlight?: string | string[]
  matchedChunk?: string
}

type Props = NewEntryProps | ExistingBlockProps


function isMeaningfullyModified(created: string, updated: string) {
  return created.slice(0, 16) !== updated.slice(0, 16)
}

function removeTextFromHTML(html: string, needle: string): string {
  if (!needle) return html
  const div = document.createElement('div')
  div.innerHTML = html
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT)
  let remaining = needle
  let started = false
  const nodesToProcess: { node: Text; startIdx: number; endIdx: number }[] = []

  while (walker.nextNode() && remaining.length > 0) {
    const node = walker.currentNode as Text
    const text = node.textContent ?? ''
    if (!started) {
      // Find where the needle starts in this text node
      const matchLen = Math.min(remaining.length, text.length)
      const idx = text.indexOf(remaining.slice(0, matchLen))
      if (idx === -1) continue
      started = true
      const removeLen = Math.min(remaining.length, text.length - idx)
      nodesToProcess.push({ node, startIdx: idx, endIdx: idx + removeLen })
      remaining = remaining.slice(removeLen)
    } else {
      // Continuation: verify the text node content matches the remaining needle
      const matchLen = Math.min(remaining.length, text.length)
      if (text.slice(0, matchLen) !== remaining.slice(0, matchLen)) break
      nodesToProcess.push({ node, startIdx: 0, endIdx: matchLen })
      remaining = remaining.slice(matchLen)
    }
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
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, '')
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent ?? ''
}

/** Normalise raw block content to HTML suitable for TipTap */
function toEditorHTML(raw: string | null): string {
  if (!raw) return ''
  return raw.startsWith('<') ? raw : `<p>${raw.replace(/\n/g, '</p><p>')}</p>`
}

const THUMB_SIZE = 160

/** Generate a thumbnail blob from an image File using canvas. Returns null for non-images. */
async function generateThumbnail(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(THUMB_SIZE / img.width, THUMB_SIZE / img.height, 1)
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(null); return }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.7)
    }
    img.onerror = () => resolve(null)
    img.src = URL.createObjectURL(file)
  })
}

const REFUSAL_PHRASES = [
  "i can't summarize", "i cannot summarize",
  "i'm unable to", "i am unable to",
  "there's nothing to summarize", "there is nothing to summarize",
  "no content to summarize", "no text to summarize",
  "please paste", "please provide", "please share",
  "i'd be happy to help", "i would be happy to help",
]

function isSummaryRefusal(summary: string, inputText: string): boolean {
  const lower = summary.toLowerCase().trim()
  // Check for refusal phrases
  if (REFUSAL_PHRASES.some(p => lower.includes(p))) return true
  // A valid compression should be significantly shorter — allow some slack
  // for short inputs where rephrasing may not reduce length much.
  const inputLen = inputText.trim().length
  if (inputLen > 100 && summary.trim().length > inputLen) return true
  return false
}

interface Person {
  id: string
  name: string
}

const ICON_SIZE = 14

function archiveIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>
}
function convertIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
}
function moveIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><polyline points="12 5 19 12 12 19" /></svg>
}
function cutIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
}
function copyIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
}
function sparkleIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
}
function historyIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
}
function trashIcon() {
  return <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
}

// Module-level: only one block can be active at a time.
// When a new block activates, it calls the previous block's save+deactivate directly.
let deactivatePreviousBlock: (() => void) | null = null

export function JournalBlock(props: Props) {
  const { autosaveInterval = 30, formattingVisible, onToggleFormatting } = props
  const isNewEntry = !props.block
  const { activeWorkspace, activeScheme, activeWorkspaceId, isGlobalView, workspaces } = useWorkspace()
  const { propertiesForWorkspace } = useProperties()
  const { dateFormat, timeFormat } = useDateFormat()
  const [propertyEditorOpen, setPropertyEditorOpen] = useState(false)
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
  const [pillMenuOpen, setPillMenuOpen] = useState(false)
  const pillRef = useRef<HTMLDivElement>(null)

  const [showHistory, setShowHistory] = useState(false)
  const [menuState, setMenuState] = useState<MenuState | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [people, setPeople] = useState<Person[]>([])
  const [peopleLoaded, setPeopleLoaded] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentsLoaded, setAttachmentsLoaded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Staged state for new entries (before block exists)
  const [pendingPropertyIds, setPendingPropertyIds] = useState<Set<string>>(new Set())
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const hasPendingData = pendingPropertyIds.size > 0 || pendingFiles.length > 0
  const pendingPropertyIdsRef = useRef(pendingPropertyIds)
  pendingPropertyIdsRef.current = pendingPropertyIds
  const pendingFilesRef = useRef(pendingFiles)
  pendingFilesRef.current = pendingFiles

  const editorRef = useRef<TipTapEditorHandle>(null)
  // Fallback handle from onReady callback — next/dynamic doesn't always forward refs
  const editorHandleRef = useRef<TipTapEditorHandle | null>(null)
  const getEditor = () => editorRef.current ?? editorHandleRef.current
  const cardRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const savingRef = useRef(false)
  const suppressBlurRef = useRef(false)
  const workspaceRef = useRef(activeWorkspace)
  workspaceRef.current = activeWorkspace
  const workspacesRef = useRef(workspaces)
  workspacesRef.current = workspaces

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

  // Close pill menu on outside click
  useEffect(() => {
    if (!pillMenuOpen) return
    function handler(e: MouseEvent) {
      if (pillRef.current?.contains(e.target as Node)) return
      setPillMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pillMenuOpen])

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
        // Ignore if the pointer event originated inside the selection menu
        const target = e.target as Node
        if ((target as HTMLElement).closest?.('.selection-menu-container')) return

        const selection = window.getSelection()
        if (!selection || selection.isCollapsed) return
        const selText = selection.toString().trim()
        if (!selText) return

        const anchor = selection.anchorNode
        if (!cardRef.current?.contains(anchor)) return

        if (triggerRef.current?.contains(target)) return
        if (popoverRef.current?.contains(target)) return

        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        if (!rect.width && !rect.height) return

        // Capture the HTML of the selected range
        const fragment = range.cloneContents()
        const tempDiv = document.createElement('div')
        tempDiv.appendChild(fragment)
        const selHTML = tempDiv.innerHTML

        const cardRect = cardRef.current?.getBoundingClientRect()
        const menuX = cardRect ? cardRect.left : rect.left
        const menuY = rect.top + rect.height / 2
        setMenuState({ selText, selHTML, x: menuX, y: menuY })
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

    if (action.type === 'insert_link') {
      const selectedText = selText
      suppressBlurRef.current = true
      if (focused) {
        getEditor()?.openLinkEditor(selectedText)
        suppressBlurRef.current = false
      } else {
        lastSavedHTMLRef.current = liveHTMLRef.current
        setFocused(true)
        deactivatePreviousBlock = () => saveExistingBlock()
        // Double rAF: first for React re-render with editable=true,
        // second for TipTap's useLayoutEffect to call editor.setEditable(true)
        requestAnimationFrame(() => requestAnimationFrame(() => {
          suppressBlurRef.current = false
          getEditor()?.openLinkEditor(selectedText)
        }))
      }
      return
    }

    window.getSelection()?.removeAllRanges()
    await executeAction(action, selText, menuState.selHTML)
  }

  async function handleToolbarAction(action: SelectionAction) {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    await flushEdits()
    const content = liveHTMLRef.current || toEditorHTML(p.block.content)
    const fullText = htmlToText(content)
    await executeAction(action, fullText)
  }

  async function executeAction(action: SelectionAction, selText: string, selHTML?: string) {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    const block = p.block
    const currentContent = liveHTMLRef.current || toEditorHTML(block.content)

    const supabase = createClient()

    if (action.type === 'create_task') {
      const newContent = removeTextFromHTML(currentContent, selText)
      const isEmpty = !htmlToText(newContent).trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'active'
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
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'active'
      await supabase.from('journal_blocks')
        .update({ content: newContent, status: newStatus, is_archived: isEmpty })
        .eq('id', block.id)
      const splitCreatedAt = new Date(
        new Date(block.created_at).getTime() - 1
      ).toISOString()
      const splitSortOrder = (block.sort_order ?? 0) - 0.5
      const { data: newBlock } = await supabase.from('journal_blocks')
        .insert({ user_id: block.user_id, context_id: block.context_id, content: selHTML || selText, status: 'active', created_at: splitCreatedAt, sort_order: splitSortOrder })
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

    if (action.type === 'insert_link') {
      editorRef.current?.openLinkEditor()
      return
    }


    if (action.type === 'summarize') {
      const fullText = htmlToText(currentContent).trim()
      const isFullBlock = selText.trim() === fullText
      const textToSummarize = isFullBlock
        ? htmlToText(liveHTMLRef.current || currentContent)
        : selText
      setSummarizing(true)
      setErrorMessage(null)
      try {
        const res = await fetch('/api/ai/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: textToSummarize }),
        })
        if (!res.ok) {
          try {
            const errJson = await res.json()
            if (errJson.error === 'no_api_key') {
              setErrorMessage('AI features require an API key. Add yours in Settings \u2192 AI.')
            } else {
              setErrorMessage(errJson.message ?? 'Summarization failed')
            }
          } catch {
            setErrorMessage('Summarization failed')
          }
          return
        }
        const json = await res.json()
        if (!json.summary) {
          setErrorMessage('Summarization returned empty result.')
          return
        }
        if (isSummaryRefusal(json.summary, textToSummarize)) {
          setErrorMessage("Couldn't summarize — try selecting more meaningful text.")
          return
        }
        const newContent = isFullBlock
          ? `<p>${json.summary.replace(/\n/g, '</p><p>')}</p>`
          : replaceTextInHTML(currentContent, selText, json.summary)
        if (newContent === currentContent) {
          setErrorMessage('Summary could not be applied — text mismatch.')
          return
        }
        await supabase.from('journal_blocks').update({ content: newContent, status: 'active' }).eq('id', block.id)
        syncEditorContent(newContent)
        p.onUpdate({ ...block, content: newContent, status: 'active' })
        deactivate()
      } finally {
        setSummarizing(false)
      }
      return
    }

    if (action.type === 'delete_selection') {
      const newContent = removeTextFromHTML(currentContent, selText)
      const isEmpty = !htmlToText(newContent).trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'active'
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
    // In global view, route to the user's default workspace
    const wsId = workspaceRef.current?.id
      ?? workspacesRef.current.find(w => w.is_default)?.id
    if (!wsId) {
      console.error('Cannot save: no workspace available')
      savingRef.current = false
      return null
    }
    const supabase = createClient()
    const { data, error } = await supabase
      .from('journal_blocks')
      .insert({
        user_id: p.userId,
        context_id: p.contextId ?? null,
        workspace_id: wsId,
        content: html,
        status: 'active',
      })
      .select()
      .single()

    savingRef.current = false
    if (error) { console.error(error); return null }

    const saved = data as Block | null
    if (saved) {
      // Flush pending properties
      const pendingProps = pendingPropertyIdsRef.current
      if (pendingProps.size > 0) {
        const rows = Array.from(pendingProps).map(pvId => ({
          entry_id: saved.id,
          property_value_id: pvId,
        }))
        await supabase.from('entry_properties').insert(rows)
      }
      // Flush pending files
      const files = pendingFilesRef.current
      if (files.length > 0) {
        for (const file of files) {
          const storagePath = `${saved.user_id}/${saved.id}/${file.name}`
          const { error: upErr } = await supabase.storage.from('attachments').upload(storagePath, file, { upsert: true })
          if (!upErr) {
            let thumbnailPath: string | null = null
            const thumb = await generateThumbnail(file)
            if (thumb) {
              thumbnailPath = `${saved.user_id}/${saved.id}/.thumbs/${file.name}.jpg`
              await supabase.storage.from('attachments').upload(thumbnailPath, thumb, { upsert: true, contentType: 'image/jpeg' })
            }
            await supabase.from('attachments').insert({
              user_id: saved.user_id,
              block_id: saved.id,
              file_name: file.name,
              file_path: storagePath,
              file_size: file.size,
              mime_type: file.type || null,
              thumbnail_path: thumbnailPath,
            })
            await supabase.from('attachment_events').insert({
              block_id: saved.id,
              user_id: saved.user_id,
              event_type: 'added',
              filename: file.name,
              file_size: file.size,
            })
          }
        }
      }
    }

    liveHTMLRef.current = ''
    liveTextRef.current = ''
    setPendingPropertyIds(new Set())
    setPendingFiles([])
    setFocused(false)
    setEditorKey(k => k + 1)
    if (saved) {
      p.onSaved(saved)
      // Fire-and-forget: embed block for semantic search
      fetch('/api/ai/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId: saved.id }) }).catch(() => {})
    }
    return saved
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

    // Write block_version before updating — skip if the most recent version
    // already has the same content (avoids duplicates from rapid edits).
    const { data: latestVersion } = await supabase
      .from('block_versions')
      .select('content')
      .eq('block_id', block.id)
      .order('edited_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestVersion?.content !== block.content) {
      await supabase.from('block_versions').insert({
        block_id: block.id,
        content: block.content,
        content_html: block.content,
        edited_at: new Date().toISOString(),
      })
    }

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
    // Fire-and-forget: embed block for semantic search
    fetch('/api/ai/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId: block.id }) }).catch(() => {})
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
      if (!trimmed && !hasPendingData) { setFocused(false); clearAutosaveTimer(); return }
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
        status: 'active',
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
      setSummarizing(true)
      setErrorMessage(null)
      try {
        const res = await fetch('/api/ai/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: fullText }),
        })
        if (!res.ok) {
          try {
            const errJson = await res.json()
            if (errJson.error === 'no_api_key') {
              setErrorMessage('AI features require an API key. Add yours in Settings \u2192 AI.')
            } else {
              setErrorMessage(errJson.message ?? 'Summarization failed')
            }
          } catch {
            setErrorMessage('Summarization failed')
          }
          return
        }
        const json = await res.json()
        if (!json.summary) return
        if (isSummaryRefusal(json.summary, fullText)) {
          setErrorMessage("Couldn't summarize — try selecting more meaningful text.")
          return
        }
        await supabase2.from('journal_blocks')
          .update({ content: json.summary, status: 'active' })
          .eq('id', saved.id)
      } finally {
        setSummarizing(false)
      }
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

    if (!isNewEntry && focused && e.altKey && !e.shiftKey && !e.ctrlKey && (e.key === '`' || e.key === '~')) {
      e.preventDefault()
      toggleEntryType()
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
      setPendingPropertyIds(new Set())
      setPendingFiles([])
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
        archiveBlock()
        return
      }
      if (e.key === 'S') {
        e.preventDefault()
        handleToolbarAction({ type: 'summarize' })
        return
      }
      if (e.key === 'C') {
        e.preventDefault()
        copyBlockToClipboard()
        return
      }
      if (e.key === 'H') {
        e.preventDefault()
        setShowHistory(true)
        return
      }
      if (e.key === 'X') {
        e.preventDefault()
        copyBlockToClipboard()
        deleteBlock()
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
    // Suppress blur when insert_link is transitioning the block to editable
    if (suppressBlurRef.current) return
    // If focus moved to another element inside the card, stay active
    if (cardRef.current?.contains(e.relatedTarget as Node)) return
    // If focus moved to an emoji picker (portaled to body, possibly in shadow DOM), stay active
    const related = e.relatedTarget as HTMLElement | null
    if (related?.closest?.('em-emoji-picker') || related?.tagName === 'EM-EMOJI-PICKER') return
    if (document.activeElement?.closest?.('em-emoji-picker') || document.activeElement?.tagName === 'EM-EMOJI-PICKER') return
    // When clicking non-focusable areas (padding) inside the card,
    // relatedTarget is null. Defer to let the browser settle focus,
    // then check whether the click was actually outside the card.
    if (!e.relatedTarget) {
      requestAnimationFrame(() => {
        // If focus has already landed inside this card, do nothing.
        if (cardRef.current?.contains(document.activeElement)) return
        // If focus moved to an emoji picker (shadow DOM — activeElement is the host element)
        if (document.activeElement?.closest?.('em-emoji-picker') || document.activeElement?.tagName === 'EM-EMOJI-PICKER') return
        if (isNewEntry) {
          const text = liveTextRef.current.trim()
          const hasPending = pendingPropertyIdsRef.current.size > 0 || pendingFilesRef.current.length > 0
          if (!text && !hasPending) { setFocused(false); return }
          if (!text) { setFocused(false); return } // unfocus but keep pending data
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
      const hasPending = pendingPropertyIdsRef.current.size > 0 || pendingFilesRef.current.length > 0
      if (!text && !hasPending) { setFocused(false); return }
      if (!text) { setFocused(false); return } // unfocus but keep pending data
      saveNewEntry()
    } else if (focused) {
      deactivatePreviousBlock = null // already deactivating, prevent double-save
      saveExistingBlock()
    }
  }

  function copyBlockToClipboard() {
    const html = liveHTMLRef.current || toEditorHTML(props.block?.content ?? '')
    const plain = htmlToText(html)
    // Write both HTML and plain text so pasting into rich editors preserves formatting
    try {
      navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ])
    } catch {
      // Fallback for browsers that don't support ClipboardItem
      navigator.clipboard.writeText(plain)
    }
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

  async function archiveBlock() {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    await flushEdits()
    deactivate()
    const supabase = createClient()
    const archivedAt = new Date().toISOString()
    await supabase.from('journal_blocks').update({ status: 'archived', is_archived: true, archived_at: archivedAt }).eq('id', p.block.id)
    p.onRemove(p.block.id)
    p.onBlockArchived?.({ ...p.block, status: 'archived', is_archived: true, archived_at: archivedAt })
  }

  async function toggleEntryType() {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    const current = p.block.entry_type
    const next = current === 'info' ? 'task' : 'info'

    const supabase = createClient()
    const updates: Record<string, unknown> = { entry_type: next }
    // When converting to info, revert block status to active if task was done
    // but retain task_status, owner_id, due_date, due_date_type so they restore on revert
    if (next === 'info' && p.block.status === 'complete') {
      updates.status = 'active'
    }
    await supabase.from('journal_blocks').update(updates).eq('id', p.block.id)
    p.onUpdate({ ...p.block, entry_type: next, ...(next === 'info' && p.block.status === 'complete' ? { status: 'active' as const } : {}) })
  }

  async function updateTaskField(field: string, value: unknown) {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    const supabase = createClient()
    await supabase.from('journal_blocks').update({ [field]: value }).eq('id', p.block.id)
    p.onUpdate({ ...p.block, [field]: value })
  }

  async function setTaskStatus(taskStatus: 'not_started' | 'in_progress' | 'done') {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    const blockStatus = taskStatus === 'done' ? 'complete' as const : 'active' as const
    const supabase = createClient()
    await supabase.from('journal_blocks').update({ task_status: taskStatus, status: blockStatus }).eq('id', p.block.id)
    p.onUpdate({ ...p.block, task_status: taskStatus, status: blockStatus })
  }

  async function moveToWorkspace(targetWsId: string | null) {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    setMoveMenuOpen(false)
    setPopoverOpen(false)
    const supabase = createClient()
    await supabase.from('journal_blocks').update({ workspace_id: targetWsId }).eq('id', p.block.id)
    // In single-workspace view, block has left this workspace — remove it from feed
    if (!isGlobalView && targetWsId !== activeWorkspaceId) {
      p.onRemove(p.block.id)
    } else {
      p.onUpdate({ ...p.block, workspace_id: targetWsId })
    }
  }

  // Lazy-load people when a task block is visible
  const blockForPeople = props.block
  useEffect(() => {
    if (isNewEntry || peopleLoaded) return
    if (!blockForPeople || blockForPeople.entry_type !== 'task') return
    const supabase = createClient()
    supabase
      .from('people')
      .select('id, name')
      .eq('user_id', blockForPeople.user_id)
      .order('name')
      .then(({ data }) => {
        setPeople((data ?? []) as Person[])
        setPeopleLoaded(true)
      })
  }, [isNewEntry, blockForPeople, peopleLoaded])

  // Load attachments for existing blocks
  useEffect(() => {
    if (isNewEntry || attachmentsLoaded || !props.block) return
    const supabase = createClient()
    supabase
      .from('attachments')
      .select('id, file_name, file_path, file_size, mime_type, thumbnail_path')
      .eq('block_id', props.block.id)
      .order('created_at')
      .then(({ data }) => {
        setAttachments((data ?? []) as Attachment[])
        setAttachmentsLoaded(true)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch when block id changes, not on every content update
  }, [isNewEntry, props.block?.id, attachmentsLoaded])

  const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
  const MAX_ATTACHMENTS = 50

  async function uploadFiles(files: FileList | File[]) {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block || uploading) return

    const fileArray = Array.from(files)

    // Client-side validation
    if (attachments.length + fileArray.length > MAX_ATTACHMENTS) {
      setErrorMessage(`Cannot add more files — maximum ${MAX_ATTACHMENTS} attachments per block.`)
      return
    }
    for (const f of fileArray) {
      if (f.size > MAX_FILE_SIZE) {
        setErrorMessage(`"${f.name}" is ${(f.size / (1024 * 1024)).toFixed(1)} MB — maximum file size is 20 MB.`)
        return
      }
    }

    setUploading(true)
    const supabase = createClient()
    const newAttachments: Attachment[] = []

    for (const file of fileArray) {
      const storagePath = `${p.block.user_id}/${p.block.id}/${file.name}`
      const { error: uploadErr } = await supabase.storage
        .from('attachments')
        .upload(storagePath, file, { upsert: true })

      if (uploadErr) {
        console.error('Upload failed:', uploadErr)
        const reason = uploadErr.message || 'unknown error'
        const sizeStr = file.size > 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${(file.size / 1024).toFixed(0)} KB`
        setErrorMessage(`Failed to upload "${file.name}" (${sizeStr}): ${reason}`)
        continue
      }

      // Generate and upload thumbnail for images
      let thumbnailPath: string | null = null
      const thumb = await generateThumbnail(file)
      if (thumb) {
        thumbnailPath = `${p.block.user_id}/${p.block.id}/.thumbs/${file.name}.jpg`
        await supabase.storage.from('attachments').upload(thumbnailPath, thumb, { upsert: true, contentType: 'image/jpeg' })
      }

      const { data: row, error: insertErr } = await supabase
        .from('attachments')
        .insert({
          user_id: p.block.user_id,
          block_id: p.block.id,
          file_name: file.name,
          file_path: storagePath,
          file_size: file.size,
          mime_type: file.type || null,
          thumbnail_path: thumbnailPath,
        })
        .select('id, file_name, file_path, file_size, mime_type, thumbnail_path')
        .single()

      if (insertErr) {
        console.error('Insert failed:', insertErr)
        setErrorMessage(`Uploaded "${file.name}" but failed to save record: ${insertErr.message || 'unknown error'}`)
        continue
      }
      if (row) {
        newAttachments.push(row as Attachment)
        // Log attachment event
        await supabase.from('attachment_events').insert({
          block_id: p.block.id,
          user_id: p.block.user_id,
          event_type: 'added',
          filename: file.name,
          file_size: file.size,
        })
      }
    }

    setAttachments(prev => [...prev, ...newAttachments])
    setUploading(false)
  }

  async function deleteAttachment(attachmentId: string, filePath: string) {
    const att = attachments.find(a => a.id === attachmentId)
    const supabase = createClient()
    const toRemove = [filePath]
    if (att?.thumbnail_path) toRemove.push(att.thumbnail_path)
    await supabase.storage.from('attachments').remove(toRemove)
    await supabase.from('attachments').delete().eq('id', attachmentId)
    // Log attachment event
    if (att && props.block) {
      await supabase.from('attachment_events').insert({
        block_id: props.block.id,
        user_id: props.block.user_id,
        event_type: 'deleted',
        filename: att.file_name,
        file_size: att.file_size,
      })
    }
    setAttachments(prev => prev.filter(a => a.id !== attachmentId))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const files = e.dataTransfer.files
    if (files.length === 0) return
    if (block) {
      uploadFiles(files)
    } else {
      // New entry — stage files locally
      const newFiles = Array.from(files)
      const tooLarge = newFiles.find(f => f.size > MAX_FILE_SIZE)
      if (tooLarge) { setErrorMessage(`"${tooLarge.name}" is ${(tooLarge.size / (1024 * 1024)).toFixed(1)} MB — maximum file size is 20 MB.`); return }
      setPendingFiles(prev => {
        if (prev.length + newFiles.length > MAX_ATTACHMENTS) { setErrorMessage(`Cannot add more files — maximum ${MAX_ATTACHMENTS} attachments per block.`); return prev }
        return [...prev, ...newFiles]
      })
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  // ── Derived values ──────────────────────────────────────────────────
  const block = props.block
  const showModified = block ? isMeaningfullyModified(block.created_at, block.updated_at) : false
  const contentHTML = block ? toEditorHTML(block.content) : ''
  const showToolbar = focused && formattingVisible

  const isTask = block?.entry_type === 'task'
  const isComplete = block?.task_status === 'done'

  // Route an action through the correct handler depending on new entry vs existing block
  function popoverAction(action: SelectionAction) {
    setPopoverOpen(false)
    if (isNewEntry) {
      handleNewEntryShortcut(action)
    } else {
      handleToolbarAction(action)
    }
  }

  // Build popover menu items — shown for both new entry and existing blocks.
  const popoverItems: { key: string; label: string; shortcut?: string; shortcutTip?: string; icon: React.ReactNode; onClick: () => void; className?: string; separator?: boolean }[] = [
    ...(block ? [{
      key: 'convert', label: isTask ? 'Convert to Info' : 'Convert to Task', shortcut: '⌥`', shortcutTip: 'Alt + Backtick', icon: convertIcon(),
      onClick: () => { setPopoverOpen(false); toggleEntryType() },
    }] : []),
    { key: 'ai', label: 'AI Summarize', shortcut: '⌥⇧S', shortcutTip: 'Alt + Shift + S', icon: sparkleIcon(), onClick: () => popoverAction({ type: 'summarize' }) },
    ...(block ? [
      { key: 'history', label: 'View History', shortcut: '⌥⇧H', shortcutTip: 'Alt + Shift + H', icon: historyIcon(), onClick: () => { setPopoverOpen(false); setShowHistory(true) } },
      { key: 'copyblock', label: 'Copy Block', shortcut: '⌥⇧C', shortcutTip: 'Alt + Shift + C', icon: copyIcon(), onClick: () => { setPopoverOpen(false); copyBlockToClipboard() } },
      { key: 'cutblock', label: 'Cut Block', shortcut: '⌥⇧X', shortcutTip: 'Alt + Shift + X', icon: cutIcon(), onClick: () => { setPopoverOpen(false); copyBlockToClipboard(); deleteBlock() } },
    ] : []),
    ...(block && workspaces.length > 0 ? [{
      key: 'move', label: 'Move to…', icon: moveIcon(),
      onClick: () => setMoveMenuOpen(prev => !prev),
    }] : []),
    ...(block ? [{ key: 'archive', label: 'Archive', shortcut: '⌥⇧D', shortcutTip: 'Alt + Shift + D', icon: archiveIcon(), onClick: () => { setPopoverOpen(false); archiveBlock() }, separator: true }] : []),
    { key: 'delete', label: 'Delete', shortcut: '⌃⌦', shortcutTip: 'Ctrl + Delete', icon: trashIcon(), onClick: () => { setPopoverOpen(false); if (isNewEntry) { liveHTMLRef.current = ''; liveTextRef.current = ''; clearAutosaveTimer(); setPendingPropertyIds(new Set()); setPendingFiles([]); setEditorKey(k => k + 1) } else { deleteBlock() } }, className: 'text-red-500 hover:bg-red-50' },
  ]

  // Disable split when selection covers entire block content
  const splitWouldEmpty = menuState
    ? htmlToText(liveHTMLRef.current || toEditorHTML(block?.content ?? '')).trim() === menuState.selText.trim()
    : false

  // In global view, show a workspace color left border on existing blocks.
  // Use a consistent border-l-[3px] for ALL states in global view so focus/unfocus
  // is just a color swap, never a geometry change — no layout shift or flicker.
  const showWsBorder = isGlobalView && !isNewEntry && block
  let wsLeftColor: string | undefined
  if (showWsBorder) {
    if (focused) {
      wsLeftColor = activeScheme?.primary ?? '#F59E0B'
    } else if (block.workspace_id) {
      const ws = workspaces.find(w => w.id === block.workspace_id)
      if (ws) {
        wsLeftColor = getScheme(ws.color_scheme)?.primary ?? '#D1D5DB'
      } else {
        wsLeftColor = '#D1D5DB' // gray fallback
      }
    } else {
      wsLeftColor = '#D1D5DB' // null workspace = neutral gray
    }
  }

  // Derive border left color for focused/workspace states
  let borderLeftColor: string | undefined
  if (!isDragOver) {
    if (showWsBorder) {
      borderLeftColor = wsLeftColor
    } else if (focused) {
      borderLeftColor = activeScheme?.primary ?? '#F59E0B'
    }
  }

  const appliedProps = block
    ? ((props as ExistingBlockProps).appliedPropertyIds ?? new Set<string>())
    : pendingPropertyIds
  const hasAppliedProps = appliedProps.size > 0

  return (
    <div
      id={block ? `block-${block.id}` : undefined}
      ref={cardRef}
      className={`relative group rounded-xl shadow-sm transition-colors ${
        hasAppliedProps ? 'mt-4' : ''
      } ${
        isDragOver
          ? 'border-2 border-amber-400 bg-amber-50/50 shadow-md'
          : showWsBorder
            ? `border-l-[3px] border border-[#E5E0D0] ${focused ? 'shadow-md' : 'hover:border-[#D5D0C0]'}`
            : focused
              ? 'border-l-[3px] border border-[#E5E0D0] shadow-md'
              : 'border border-[#E5E0D0] pl-[2px] hover:border-[#D5D0C0]'
      } ${isDragOver ? '' : focused && !isNewEntry ? '' : 'bg-white'}`}
      style={{
        ...(focused && !isNewEntry && !isDragOver
            ? { backgroundColor: activeScheme?.muted ?? '#FFFBEB' }
            : {}),
        ...(borderLeftColor ? { borderLeftColor } : {}),
      }}
      onMouseDown={handleContentMouseDown}
      onDrop={(e) => { setIsDragOver(false); handleDrop(e) }}
      onDragOver={handleDragOver}
      onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={(e) => {
        if (!cardRef.current?.contains(e.relatedTarget as Node)) setIsDragOver(false)
      }}
    >
      {/* Hidden file input for paperclip button */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (!e.target.files?.length) return
          if (block) {
            uploadFiles(e.target.files)
          } else {
            // New entry — stage files locally
            const newFiles = Array.from(e.target.files)
            const tooLarge = newFiles.find(f => f.size > MAX_FILE_SIZE)
            if (tooLarge) { setErrorMessage(`"${tooLarge.name}" is ${(tooLarge.size / (1024 * 1024)).toFixed(1)} MB — maximum file size is 20 MB.`); e.target.value = ''; return }
            setPendingFiles(prev => {
              if (prev.length + newFiles.length > MAX_ATTACHMENTS) { setErrorMessage(`Cannot add more files — maximum ${MAX_ATTACHMENTS} attachments per block.`); return prev }
              return [...prev, ...newFiles]
            })
          }
          e.target.value = ''
        }}
      />

      {/* ── STICKY TAG ROW — straddles the top border ── */}
      <div
        className="absolute top-0 left-4 right-14 -translate-y-1/2 z-10 flex items-center gap-1 pointer-events-none"
      >
        {/* Entry type indicator */}
        <div className="pointer-events-auto text-gray-400" title={isTask ? 'Task' : 'Info'}>
          {isTask ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" fill="white" /><polyline points="17 8 10 15 7 12" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" fill="white" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
          )}
        </div>
        <div className="flex items-center gap-1 overflow-hidden pointer-events-auto">
          <PropertyBubbles
            appliedValueIds={appliedProps}
            properties={propertiesForWorkspace(activeWorkspaceId)}
            onClickValue={() => setPropertyEditorOpen(true)}
          />
        </div>
        {/* Add-tag button — sits after last pill */}
        <div className="relative pointer-events-auto">
          <button
            type="button"
            title="Add property"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
            onClick={(e) => { e.stopPropagation(); setPropertyEditorOpen(prev => !prev) }}
            className={`w-5 h-5 flex items-center justify-center rounded-full bg-white border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-all ${
              propertyEditorOpen ? 'opacity-100' : hasAppliedProps ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
            }`}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
          {/* Property editor popover — pops out to the right of the floating bar */}
          {propertyEditorOpen && (
            block ? (
              <PropertyEditor
                blockId={block.id}
                appliedValueIds={appliedProps}
                properties={propertiesForWorkspace(activeWorkspaceId)}
                onChanged={(newIds) => (props as ExistingBlockProps).onPropertyChanged?.(newIds)}
                onClose={() => setPropertyEditorOpen(false)}
              />
            ) : (
              <PropertyEditor
                blockId="__pending__"
                appliedValueIds={pendingPropertyIds}
                properties={propertiesForWorkspace(activeWorkspaceId)}
                onChanged={(newIds) => setPendingPropertyIds(newIds)}
                onClose={() => setPropertyEditorOpen(false)}
              />
            )
          )}
        </div>
      </div>

      {/* ── ACTION ICONS — pinned top-right corner ── */}
      <div className={`absolute top-0 right-2 -translate-y-1/2 z-10 flex items-center gap-0.5 transition-opacity ${
        popoverOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}>
        {/* Toggle formatting bar — only when focused */}
        {focused && (
          <button
            type="button"
            title="Formatting (Alt+Shift+F)"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
            onClick={(e) => { e.stopPropagation(); onToggleFormatting() }}
            className={`w-6 h-6 flex items-center justify-center rounded-full bg-white border text-[10px] font-semibold leading-none transition-colors ${
              formattingVisible ? 'border-amber-400 text-amber-700 bg-amber-50' : 'border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-400'
            }`}
          >
            Aa
          </button>
        )}
        {/* Attach file */}
        <button
          type="button"
          title="Attach file"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
          className="w-6 h-6 flex items-center justify-center rounded-full bg-white border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-400"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
        </button>
        {/* Actions menu (⋮) — always shown */}
        <button
          ref={triggerRef}
          type="button"
          title="Actions"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
          onClick={(e) => { e.stopPropagation(); setPopoverOpen(prev => !prev) }}
          className="w-6 h-6 flex items-center justify-center rounded-full bg-white border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-400"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
        </button>
      </div>

      {/* Popover menu */}
      {popoverOpen && (
        <div
          ref={popoverRef}
          className="absolute top-9 right-2 z-20 bg-white border border-[#E5E0D0] rounded-lg shadow-xl py-1 min-w-[172px]"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {popoverItems.map((item) => (
            <div key={item.key}>
              {item.separator && <div className="h-px bg-gray-100 my-1" />}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={item.onClick}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[#FFFEF7] transition-colors ${
                  item.className ?? 'text-gray-700'
                }`}
              >
                <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.shortcut && <span className="text-[10px] text-gray-400 ml-3" title={item.shortcutTip}>{item.shortcut}</span>}
              </button>
              {/* Move-to-workspace submenu */}
              {item.key === 'move' && moveMenuOpen && (
                <div className="bg-gray-50 py-1">
                  {workspaces.map(ws => (
                    <button
                      key={ws.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => moveToWorkspace(ws.id)}
                      className={`w-full flex items-center gap-2 px-5 py-1.5 text-xs text-left hover:bg-[#FFFEF7] transition-colors ${
                        block?.workspace_id === ws.id ? 'text-amber-700 font-medium' : 'text-gray-600'
                      }`}
                    >
                      {ws.emoji && <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0" style={{ backgroundColor: getScheme(ws.color_scheme)?.muted ?? '#F3F4F6' }}>{ws.emoji}</span>}
                      <span className="truncate">{ws.name}</span>
                      {block?.workspace_id === ws.id && <span className="text-[10px] text-gray-400 ml-auto">current</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── CONTENT ── */}
      <div
        className={`relative px-4 pb-0 ${showToolbar ? 'pt-1' : 'pt-2'}`}
        onKeyDown={handleEditorKeyDown}
        onFocus={() => {
          if (isNewEntry) {
            deactivatePreviousBlock?.()
            deactivatePreviousBlock = null
            if (!focused) setFocused(true)
          }
        }}
        onBlur={handleBlur}
        onContextMenu={handleContextMenu}
      >
        <div className={`${summarizing ? 'opacity-30 pointer-events-none' : ''} ${isComplete && !focused ? 'opacity-50 line-through decoration-gray-400' : ''}`}>
          <TipTapEditor
            key={isNewEntry ? editorKey : undefined}
            ref={editorRef}
            content={contentHTML}
            placeholder={isNewEntry
              ? 'Type to create a new entry \u00b7 Ctrl+Enter to save \u00b7 Esc to cancel'
              : undefined}
            autoFocus={isNewEntry}
            onSubmit={handleSave}
            onChange={handleEditorChange}
            editable={isNewEntry || focused}
            toolbarVisible={showToolbar}
            onReady={(handle) => { editorHandleRef.current = handle }}
            searchHighlight={!isNewEntry && !focused ? (props as ExistingBlockProps).searchHighlight : undefined}
            matchedChunk={!isNewEntry && !focused ? (props as ExistingBlockProps).matchedChunk : undefined}
          />
        </div>
        {summarizing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-amber-700">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Summarizing…
            </div>
          </div>
        )}
      </div>

      {/* ── ATTACHMENTS + UPLOADING INDICATOR ── */}
      {(block && attachments.length > 0) || (isNewEntry && pendingFiles.length > 0) || uploading ? (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-1.5">
          {/* Saved attachments */}
          {block && attachments.length > 0 && (
            <AttachmentRow
              attachments={attachments}
              onDelete={deleteAttachment}
              readOnly={!focused}
            />
          )}
          {/* Pending files for new entries */}
          {isNewEntry && pendingFiles.map((f, i) => (
            <div key={`${f.name}-${i}`} className="relative group/pf">
              <button
                title={f.name}
                onClick={(e) => { e.stopPropagation(); const url = URL.createObjectURL(f); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 1000) }}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 transition-colors bg-gray-50 max-w-[180px] cursor-pointer"
              >
                <span className="text-[11px] text-gray-600 truncate">{f.name}</span>
                <span className="text-[9px] text-gray-400 flex-shrink-0">{f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(0)} KB` : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setPendingFiles(prev => prev.filter((_, j) => j !== i)) }}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/pf:opacity-100 transition-opacity"
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          ))}
          {/* Uploading spinner — inline with attachments */}
          {uploading && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400 px-1">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Uploading…
            </div>
          )}
        </div>
      ) : null}

      {/* ── ERROR MESSAGE ── */}
      {errorMessage && (
        <div className="mx-4 mb-1 flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">
          <span className="flex-1">{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-red-600 flex-shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* ── TASK FIELDS PANEL ── */}
      {block && isTask && (
        <div
          className="flex items-center gap-3 px-4 py-1.5 border-t border-gray-100 flex-wrap"
          onMouseDown={(e) => { e.stopPropagation() }}
        >
          <div className="flex items-center gap-0.5">
            {([
              { value: 'not_started' as const, label: 'Not Started', color: 'gray' },
              { value: 'in_progress' as const, label: 'In Progress', color: 'blue' },
              { value: 'done' as const, label: 'Done', color: 'green' },
            ]).map(({ value, label, color }) => {
              const isActive = block.task_status === value
              const colors = {
                gray: isActive ? 'bg-gray-100 border-gray-400 text-gray-700' : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-500',
                blue: isActive ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-500',
                green: isActive ? 'bg-green-50 border-green-400 text-green-700' : 'border-gray-200 text-gray-400 hover:border-green-300 hover:text-green-500',
              }[color]
              return (
                <button
                  key={value}
                  onClick={() => setTaskStatus(value)}
                  className={`px-2 py-0.5 text-[11px] font-medium border rounded-full transition-colors ${colors}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <span className="w-px h-4 bg-gray-200" />
          <div className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            <select
              value={block.owner_id ?? ''}
              onChange={(e) => updateTaskField('owner_id', e.target.value || null)}
              className="text-xs bg-transparent border-none outline-none cursor-pointer text-gray-600 hover:text-gray-900 py-0.5 -ml-0.5 pr-4"
            >
              <option value="">Me</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <span className="w-px h-4 bg-gray-200" />
          {(() => {
            // Parse timestamptz into date and time parts (using local time)
            const dueDateStr = block.due_date
            let dateVal = ''
            let timeVal = '' // empty means no time set (sentinel 23:59:59), otherwise "HH:MM" 24h
            if (dueDateStr) {
              // Parse as local time — strip any trailing Z to avoid UTC conversion
              const localStr = dueDateStr.replace(/Z$/i, '').replace(/[+-]\d{2}:\d{2}$/, '')
              const d = new Date(localStr)
              const yyyy = d.getFullYear()
              const mm = String(d.getMonth() + 1).padStart(2, '0')
              const dd = String(d.getDate()).padStart(2, '0')
              dateVal = `${yyyy}-${mm}-${dd}`
              const hh = d.getHours()
              const mi = d.getMinutes()
              const ss = d.getSeconds()
              // 23:59:59 is the sentinel for "no time"
              if (!(hh === 23 && mi === 59 && ss === 59)) {
                timeVal = `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
              }
            }

            function buildTimestamp(date: string, time: string | null): string {
              if (!time) return `${date}T23:59:59`
              return `${date}T${time}:00`
            }

            function onDateChange(newDate: string) {
              if (!newDate) {
                updateTaskField('due_date', null)
                updateTaskField('due_date_type', null)
                return
              }
              const ts = buildTimestamp(newDate, timeVal || null)
              updateTaskField('due_date', ts)
            }

            function onTimeChange(newTime: string) {
              if (!dateVal) return
              const ts = buildTimestamp(dateVal, newTime || null)
              updateTaskField('due_date', ts)
            }

            function clearDueDate() {
              updateTaskField('due_date', null)
              updateTaskField('due_date_type', null)
            }

            const datePickerId = `datepicker-${block?.id ?? 'new'}`

            return (
              <div className="flex items-center gap-1">
                <div className="relative flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById(datePickerId) as HTMLInputElement | null
                      if (el) { el.showPicker?.() }
                    }}
                    className="cursor-pointer text-gray-400 hover:text-gray-600"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  </button>
                  <input
                    id={datePickerId}
                    type="date"
                    value={dateVal}
                    onChange={(e) => onDateChange(e.target.value)}
                    className="absolute inset-0 opacity-0 w-full h-full pointer-events-none"
                    tabIndex={-1}
                  />
                </div>
                <span
                  className="text-xs text-gray-600 hover:text-gray-900 py-0.5 cursor-pointer select-none"
                  onClick={() => {
                    const el = document.getElementById(datePickerId) as HTMLInputElement | null
                    if (el) { el.showPicker?.() }
                  }}
                >
                  {dateVal
                    ? formatDatePart(new Date(dateVal + 'T00:00:00'), dateFormat)
                    : <span className="text-gray-300">mm/dd/yyyy</span>
                  }
                </span>
                {dateVal && (
                  <>
                    <TimePickerDropdown
                      value={timeVal}
                      onChange={onTimeChange}
                      timeFormat={timeFormat}
                    />
                    <div className="flex items-center rounded overflow-hidden border border-gray-200 ml-2">
                      <button
                        onClick={() => updateTaskField('due_date_type', 'deadline')}
                        className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                          block.due_date_type === 'deadline' ? 'bg-red-100 text-red-700' : 'text-gray-400 hover:text-gray-600'
                        }`}
                      >Deadline</button>
                      <button
                        onClick={() => updateTaskField('due_date_type', 'target')}
                        className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                          block.due_date_type === 'target' || !block.due_date_type ? 'bg-amber-100 text-amber-700' : 'text-gray-400 hover:text-gray-600'
                        }`}
                      >Target</button>
                    </div>
                    <button
                      onClick={clearDueDate}
                      title="Clear date"
                      className="p-0.5 text-gray-300 hover:text-red-400 transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* ── FOOTER ── */}
      <div className="flex items-center px-4 pb-1.5 pt-0 select-none">
        <span className="text-[11px] text-gray-400 flex-1" suppressHydrationWarning>
          {block
            ? <>Created {formatTimestamp(block.created_at, dateFormat, timeFormat)}{showModified && <span> · Modified {formatTimestamp(block.updated_at, dateFormat, timeFormat)}</span>}{(props as ExistingBlockProps).similarityScore != null && <span className="ml-1.5 px-1.5 py-0 rounded-full bg-amber-50 text-amber-700 text-[10px] font-medium">{Math.round((props as ExistingBlockProps).similarityScore! * 100)}% match</span>}</>
            : (() => {
                if (activeWorkspace) return `New ${activeWorkspace.name} Entry`
                const defaultWs = workspaces.find(w => w.is_default)
                if (defaultWs) return <>New {defaultWs.name} Entry <span className="text-gray-300">(Default Workspace)</span></>
                return 'New Entry'
              })()
          }
          {isNewEntry && isGlobalView && !workspaces.some(w => w.is_default) && workspaces.length > 0 && (
            <span className="text-[10px] text-amber-500 ml-1">Tip: set a default workspace in settings</span>
          )}
        </span>
        {/* Workspace pill — shown in All Workspaces mode, click to move */}
        {isGlobalView && !isNewEntry && block?.workspace_id && (() => {
          const ws = workspaces.find(w => w.id === block.workspace_id)
          if (!ws) return null
          const scheme = getScheme(ws.color_scheme)
          return (
            <div className="relative flex-shrink-0 ml-2" ref={pillRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setPillMenuOpen(prev => !prev) }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity"
                style={{
                  backgroundColor: scheme?.primary ?? '#6B7280',
                  color: scheme?.textOnColor ?? '#FFFFFF',
                }}
              >
                {ws.emoji && <span className="w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] leading-none flex-shrink-0" style={{ backgroundColor: scheme?.muted ?? '#F3F4F6' }}>{ws.emoji}</span>}
                {ws.name}
              </button>
              {pillMenuOpen && (
                <div className="absolute bottom-full right-0 mb-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px] z-50">
                  <div className="px-3 py-1 text-[10px] text-gray-400 font-medium uppercase tracking-wide">Move to…</div>
                  {workspaces.map(w => {
                    const wScheme = getScheme(w.color_scheme)
                    return (
                      <button
                        key={w.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setPillMenuOpen(false); moveToWorkspace(w.id) }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50 transition-colors ${
                          block.workspace_id === w.id ? 'text-amber-700 font-medium' : 'text-gray-600'
                        }`}
                      >
                        {w.emoji && <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0" style={{ backgroundColor: wScheme?.muted ?? '#F3F4F6' }}>{w.emoji}</span>}
                        <span className="truncate">{w.name}</span>
                        {block.workspace_id === w.id && <span className="text-[10px] text-gray-400 ml-auto">current</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {menuState && block && (
        <div className="selection-menu-container">
          <SelectionMenu
            position={{ x: menuState.x, y: menuState.y }}
            userId={block.user_id}
            selectedText={menuState.selText}
            onClose={() => setMenuState(null)}
            onAction={handleSelectionAction}
            disableSplit={splitWouldEmpty}
          />
        </div>
      )}

      {showHistory && block && (
        <HistoryModal
          blockId={block.id}
          onClose={() => setShowHistory(false)}
          onRevert={async (content) => {
            const p = propsRef.current as ExistingBlockProps
            if (!p.block) return

            // Take the block out of edit mode first to prevent
            // autosave/blur from overwriting the reverted content
            setFocused(false)
            clearAutosaveTimer()
            deactivatePreviousBlock = null

            const supabase = createClient()
            const { data: latestVersion } = await supabase
              .from('block_versions')
              .select('content')
              .eq('block_id', p.block.id)
              .order('edited_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            if (latestVersion?.content !== p.block.content) {
              await supabase.from('block_versions').insert({
                block_id: p.block.id,
                content: p.block.content,
                content_html: p.block.content,
                edited_at: new Date().toISOString(),
              })
            }
            await supabase.from('journal_blocks').update({ content }).eq('id', p.block.id)
            liveHTMLRef.current = content
            liveTextRef.current = htmlToText(content)
            lastSavedHTMLRef.current = content
            p.onUpdate({ ...p.block, content })
            setShowHistory(false)
          }}
        />
      )}
    </div>
  )
}
