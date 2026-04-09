'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
import { threeWayMerge } from '@/lib/three-way-merge'
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

  // Scroll to current value (or 8:00 AM default) when opening
  useEffect(() => {
    if (!open || !listRef.current) return
    const active = listRef.current.querySelector('[data-active="true"]')
    if (active) { active.scrollIntoView({ block: 'center' }); return }
    // Default scroll to 8:00 AM
    const default8am = listRef.current.querySelector('[data-slot="08:00"]')
    if (default8am) default8am.scrollIntoView({ block: 'start' })
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
              data-slot={t}
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
  editorFrom: number
  editorTo: number
  x: number
  y: number
}

interface BaseProps {
  autosaveInterval?: number
  formattingVisible: boolean
  onToggleFormatting: () => void
  people?: { id: string; name: string }[]
  feedCollapsed?: boolean
  collapseLines?: number
}

interface NewEntryProps extends BaseProps {
  block?: undefined
  userId: string
  contextId: string | null
  onSaved: (block: Block) => void
  onUpdate?: never
  onRemove?: never
  onSplitBlock?: never
  activePropertyFilters?: Set<string>
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
  "please paste the text", "please provide the text", "please share the text",
]

function isSummaryRefusal(summary: string): boolean {
  const lower = summary.toLowerCase().trim()
  return REFUSAL_PHRASES.some(p => lower.includes(p))
}

interface Person {
  id: string
  name: string
}

const ICON_SIZE = 14

function AssigneeSelect({ value, people, userId, onChange, onPersonAdded }: {
  value: string | null
  people: Person[]
  userId: string
  onChange: (id: string | null) => void
  onPersonAdded: (person: Person) => void
}) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newCompany, setNewCompany] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const addNameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setAdding(false); setSearch('') }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (open && !adding) searchRef.current?.focus()
  }, [open, adding])

  useEffect(() => {
    if (adding) addNameRef.current?.focus()
  }, [adding])

  const selectedName = value ? (people.find(p => p.id === value)?.name ?? 'Unknown') : 'Me'
  const query = search.toLowerCase()
  const filtered = query
    ? people.filter(p => p.name.toLowerCase().includes(query))
    : people
  const showMe = !query || 'me'.includes(query)

  async function handleSave() {
    if (!newName.trim()) return
    setSaving(true)
    const supabase = createClient()
    const { data, error } = await supabase.from('people').insert({
      user_id: userId,
      name: newName.trim(),
      email: newEmail.trim() || null,
      company: newCompany.trim() || null,
    }).select('id, name').single()
    setSaving(false)
    if (error || !data) return
    const person = data as Person
    onPersonAdded(person)
    onChange(person.id)
    setNewName(''); setNewEmail(''); setNewCompany('')
    setAdding(false); setSearch(''); setOpen(false)
  }

  return (
    <div ref={ref} className="relative flex items-center gap-1" title="Assignee">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
      <button
        onClick={() => { setOpen(!open); setAdding(false); setSearch('') }}
        className="text-xs bg-transparent border-none outline-none cursor-pointer text-gray-600 hover:text-gray-900 py-0.5 flex items-center gap-0.5"
      >
        {selectedName}
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-gray-400"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl min-w-[200px] z-50 flex flex-col max-h-[280px]" onMouseDown={(e) => e.stopPropagation()}>
          {!adding ? (
            <>
              {/* Search input */}
              {people.length > 3 && (
                <div className="px-2 pt-2 pb-1 flex-shrink-0">
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') { setOpen(false); setSearch('') }
                      if (e.key === 'Enter' && filtered.length === 1) { onChange(filtered[0].id); setOpen(false); setSearch('') }
                    }}
                    placeholder="Search..."
                    className="w-full text-xs text-gray-900 border border-gray-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-amber-300"
                  />
                </div>
              )}
              {/* Scrollable list */}
              <div className="overflow-y-auto flex-1 py-1">
                {showMe && (
                  <button
                    onClick={() => { onChange(null); setOpen(false); setSearch('') }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors ${!value ? 'font-medium text-amber-700' : 'text-gray-700'}`}
                  >
                    Me
                  </button>
                )}
                {filtered.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { onChange(p.id); setOpen(false); setSearch('') }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors ${value === p.id ? 'font-medium text-amber-700' : 'text-gray-700'}`}
                  >
                    {p.name}
                  </button>
                ))}
                {!showMe && filtered.length === 0 && (
                  <p className="px-3 py-1.5 text-xs text-gray-400">No match</p>
                )}
              </div>
              {/* Pinned Add person button */}
              <div className="border-t border-gray-100 flex-shrink-0">
                <button
                  onClick={() => { setAdding(true); setNewName(search); setSearch('') }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors flex items-center gap-1.5"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Add person
                </button>
              </div>
            </>
          ) : (
            <div className="px-3 py-2 space-y-2">
              <input
                ref={addNameRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setAdding(false) }}
                placeholder="Name *"
                className="w-full text-xs text-gray-900 border border-gray-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-amber-300"
              />
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setAdding(false) }}
                placeholder="Email"
                className="w-full text-xs text-gray-900 border border-gray-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-amber-300"
              />
              <input
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setAdding(false) }}
                placeholder="Company"
                className="w-full text-xs text-gray-900 border border-gray-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-amber-300"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button onClick={() => setAdding(false)} className="text-[10px] text-gray-400 hover:text-gray-600 px-2 py-0.5">Cancel</button>
                <button onClick={handleSave} disabled={saving || !newName.trim()} className="text-[10px] text-white bg-gray-900 hover:bg-gray-800 px-2 py-0.5 rounded disabled:opacity-40">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EntryTypeToggle({ isTask, onClick, isDueToday, isPastDue, isDone }: { isTask: boolean; onClick: () => void; isDueToday?: boolean; isPastDue?: boolean; isDone?: boolean }) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [hover, setHover] = useState(false)
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!hover || !btnRef.current) { setTooltipPos(null); return }
    const rect = btnRef.current.getBoundingClientRect()
    setTooltipPos({ top: rect.top - 4, left: rect.left + rect.width / 2 })
  }, [hover])

  return (
    <>
      <button
        ref={btnRef}
        className={`pointer-events-auto transition-colors cursor-pointer ${
          isTask && isDone ? 'text-green-500 hover:text-green-600'
          : isTask && isPastDue ? 'text-red-500 hover:text-red-600'
          : isTask && isDueToday ? 'text-yellow-500 hover:text-yellow-600'
          : 'text-gray-400 hover:text-gray-600'
        }`}
        title={isTask ? 'Task — click to convert' : 'Info — click to convert'}
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {isTask ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" fill="white" /><polyline points="17 8 10 15 7 12" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" fill="white" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
        )}
      </button>
      {hover && tooltipPos && createPortal(
        <div
          className="fixed px-2 py-1 rounded-lg bg-white border border-gray-200 shadow-lg text-[10px] text-gray-400 font-medium whitespace-nowrap pointer-events-none"
          style={{ top: tooltipPos.top, left: tooltipPos.left, transform: 'translate(-50%, -100%)', zIndex: 9999 }}
        >
          {isTask ? (
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="17 8 10 15 7 12" /></svg>
              <span className="text-gray-300">→</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
              <span className="text-gray-300">→</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="17 8 10 15 7 12" /></svg>
            </span>
          )}
        </div>,
        document.body
      )}
    </>
  )
}

function ArchiveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title="Archive (Alt+Shift+D)"
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className="w-6 h-6 flex items-center justify-center rounded-full bg-white border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-400"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>
    </button>
  )
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
  const { autosaveInterval = 30, formattingVisible, onToggleFormatting, feedCollapsed, collapseLines = 10 } = props
  const isNewEntry = !props.block
  const [cardExpanded, setCardExpanded] = useState(false)
  // Reset per-card expansion when global collapse is re-enabled
  useEffect(() => { if (feedCollapsed) setCardExpanded(false) }, [feedCollapsed])
  const currentUserId = isNewEntry ? (props as NewEntryProps).userId : props.block!.user_id
  const { activeWorkspace, activeScheme, activeWorkspaceId, isGlobalView, workspaces } = useWorkspace()
  const { propertiesForWorkspace } = useProperties()
  const { dateFormat, timeFormat } = useDateFormat()
  const propertyWorkspaceId = (!isNewEntry ? (props as ExistingBlockProps).block?.workspace_id : null) ?? activeWorkspaceId
  const [propertyEditorOpen, setPropertyEditorOpen] = useState(false)
  const propertyEditorOpenRef = useRef(false)
  const prevPropertyEditorOpen = useRef(false)
  propertyEditorOpenRef.current = propertyEditorOpen

  // When property editor closes, refocus the text editor so keyboard shortcuts work
  useEffect(() => {
    if (prevPropertyEditorOpen.current && !propertyEditorOpen) {
      requestAnimationFrame(() => {
        if (!cardRef.current?.contains(document.activeElement)) {
          editorRef.current?.focus()
        }
      })
    }
    prevPropertyEditorOpen.current = propertyEditorOpen
  }, [propertyEditorOpen])
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
  const [pillMenuOpen, setPillMenuOpen] = useState(false)
  const pillRef = useRef<HTMLDivElement>(null)

  const [showHistory, setShowHistory] = useState(false)
  const [menuState, setMenuState] = useState<MenuState | null>(null)
  const menuStateRef = useRef<MenuState | null>(null)
  menuStateRef.current = menuState
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [dateWarning, setDateWarning] = useState<string | null>(null)
  const dateWarningTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showDateWarning(msg: string) {
    if (dateWarningTimer.current) clearTimeout(dateWarningTimer.current)
    setDateWarning(msg)
    dateWarningTimer.current = setTimeout(() => setDateWarning(null), 3000)
  }
  const [focused, setFocused] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [summaryPreview, setSummaryPreview] = useState<{ original: string; summary: string; newContent: string; isFullBlock: boolean } | null>(null)
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

  // Property filter prompt state (new entries only)
  const [filterPromptOpen, setFilterPromptOpen] = useState(false)
  const [filterPromptValues, setFilterPromptValues] = useState<Set<string>>(new Set())
  const filterPromptResolveRef = useRef<((selectedIds: Set<string>) => void) | null>(null)

  const editorRef = useRef<TipTapEditorHandle>(null)
  // Fallback handle from onReady callback — next/dynamic doesn't always forward refs
  const editorHandleRef = useRef<TipTapEditorHandle | null>(null)
  const getEditor = () => editorRef.current ?? editorHandleRef.current
  const cardRef = useRef<HTMLDivElement>(null)
  const contentMeasureRef = useRef<HTMLDivElement>(null)
  const [isContentTall, setIsContentTall] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const addPropertyBtnRef = useRef<HTMLButtonElement>(null)

  const savingRef = useRef(false)
  const suppressBlurRef = useRef(false)
  const autosavedBlockIdRef = useRef<string | null>(null)
  const [pendingEntryType, setPendingEntryType] = useState<'info' | 'task'>('info')
  const pendingEntryTypeRef = useRef<'info' | 'task'>('info')
  pendingEntryTypeRef.current = pendingEntryType
  const [pendingTaskStatus, setPendingTaskStatus] = useState<'not_started' | 'in_progress' | 'done'>('not_started')
  const [pendingOwnerId, setPendingOwnerId] = useState<string | null>(null)
  const [pendingDueDate, setPendingDueDate] = useState<string | null>(null)
  const [pendingDueDateType, setPendingDueDateType] = useState<'deadline' | 'target' | null>(null)
  const [pendingStartDate, setPendingStartDate] = useState<string | null>(null)
  const pendingTaskFieldsRef = useRef({ taskStatus: 'not_started' as 'not_started' | 'in_progress' | 'done', ownerId: null as string | null, dueDate: null as string | null, dueDateType: null as 'deadline' | 'target' | null, startDate: null as string | null })
  pendingTaskFieldsRef.current = { taskStatus: pendingTaskStatus, ownerId: pendingOwnerId, dueDate: pendingDueDate, dueDateType: pendingDueDateType, startDate: pendingStartDate }
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
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedHTMLRef = useRef(props.block?.content ?? '')
  const lastDraftHTMLRef = useRef<string | null>(null)
  const accessTokenRef = useRef<string | null>(null)


  // Track the last props.block.content we synced into the editor,
  // so we can detect external updates and push them in.
  const lastSyncedContentRef = useRef(props.block?.draft_content ?? props.block?.content ?? null)

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
  function clearDraftTimer() {
    if (draftTimerRef.current) { clearTimeout(draftTimerRef.current); draftTimerRef.current = null }
  }
  function clearCommitTimer() {
    if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null }
  }

  // Capture access token for beforeunload fetch with keepalive
  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => {
      accessTokenRef.current = data.session?.access_token ?? null
    })
  }, [])

  useEffect(() => clearAutosaveTimer, [])

  // ── Sync content from props into the editor when block is updated externally ──
  // Reacts to both committed content and draft_content (whichever is fresher).
  const remoteContent = props.block?.draft_content ?? props.block?.content ?? null
  useEffect(() => {
    if (remoteContent === lastSyncedContentRef.current) return
    const base = lastSyncedContentRef.current
    lastSyncedContentRef.current = remoteContent

    if (focusedRef.current) {
      // User is editing — three-way merge local edits with remote changes
      const ours = liveHTMLRef.current
      const theirs = toEditorHTML(remoteContent)
      const baseHTML = toEditorHTML(base)
      const merged = threeWayMerge(baseHTML, ours, theirs)
      if (merged !== ours) {
        getEditor()?.setContent(merged)
        liveHTMLRef.current = merged
        liveTextRef.current = htmlToText(merged)
      }
      // Don't update lastSavedHTMLRef — user still has unsaved local changes
      return
    }

    const html = toEditorHTML(remoteContent)
    getEditor()?.setContent(html)
    liveHTMLRef.current = html
    liveTextRef.current = htmlToText(html)
    lastSavedHTMLRef.current = html
  }, [remoteContent])

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

        const menuX = rect.left + rect.width / 2
        const menuY = rect.bottom
        const editor = editorRef.current ?? editorHandleRef.current
        const domRange = editor?.getDOMSelectionRange?.() ?? { from: 0, to: 0 }
        setMenuState({ selText, selHTML, editorFrom: domRange.from, editorTo: domRange.to, x: menuX, y: menuY })
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
  // Find the nearest block element at a Y coordinate and select its line
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
        const pm = cardRef.current?.querySelector('.ProseMirror') as HTMLElement
        if (pm) {
          const pmRect = pm.getBoundingClientRect()
          const side = e.clientX < pmRect.left ? 'left' : 'right'
          pm.focus()
          const blockEls = Array.from(pm.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote'))
          let targetEl: Element | null = null
          let closestDist = Infinity
          for (const el of blockEls) {
            const rect = el.getBoundingClientRect()
            const mid = rect.top + rect.height / 2
            const dist = Math.abs(e.clientY - mid)
            if (dist < closestDist) { closestDist = dist; targetEl = el }
          }
          if (targetEl) {
            const range = document.createRange()
            range.selectNodeContents(targetEl)
            if (side === 'right') range.collapse(false)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
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
    // Quick sync check: fetch latest from DB on activation
    {
      const p = propsRef.current as ExistingBlockProps
      if (p.block) {
        const supabase = createClient()
        supabase.from('journal_blocks').select('*').eq('id', p.block.id).single()
          .then(({ data }) => { if (data && data.updated_at !== p.block!.updated_at) p.onUpdate(data as Block) })
      }
    }
    // Register this block's deactivation so the *next* activated block can call it
    deactivatePreviousBlock = () => saveExistingBlock()
    const x = e.clientX, y = e.clientY
    const target = e.target as HTMLElement
    const tiptapEl = cardRef.current?.querySelector('.tiptap-wrapper')
    const clickedInEditor = tiptapEl?.contains(target)
    // Detect whitespace click and which side (left = select line, right = cursor at end)
    let whitespaceSide: 'left' | 'right' | null = null
    if (!clickedInEditor) {
      // Card padding — determine side based on editor position
      const pm = cardRef.current?.querySelector('.ProseMirror')
      if (pm) {
        const pmRect = pm.getBoundingClientRect()
        whitespaceSide = x < pmRect.left ? 'left' : 'right'
      } else {
        whitespaceSide = 'right'
      }
    } else {
      const pm = cardRef.current?.querySelector('.ProseMirror')
      if (pm) {
        const blockEls = Array.from(pm.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote'))
        for (const el of blockEls) {
          const rect = el.getBoundingClientRect()
          if (y >= rect.top && y <= rect.bottom) {
            const range = document.createRange()
            range.selectNodeContents(el)
            const textRect = range.getBoundingClientRect()
            if (x < textRect.left - 4) whitespaceSide = 'left'
            else if (x > textRect.right + 4) whitespaceSide = 'right'
            break
          }
        }
        if (target === pm) whitespaceSide = 'right'
      }
    }
    requestAnimationFrame(() => {
      if (whitespaceSide === 'right') {
        // Right-side whitespace: focusAtCoords places cursor at end of the visual line
        editorRef.current?.focusAtCoords(x, y)
      } else if (whitespaceSide === 'left') {
        // Left-side whitespace: select the entire line
        editorRef.current?.focusAtCoords(x, y)
        setTimeout(() => {
          const pm = cardRef.current?.querySelector('.ProseMirror') as HTMLElement
          if (!pm) return
          const blockEls = Array.from(pm.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote'))
          let targetEl: Element | null = null
          let closestDist = Infinity
          for (const el of blockEls) {
            const rect = el.getBoundingClientRect()
            const mid = rect.top + rect.height / 2
            const dist = Math.abs(y - mid)
            if (dist < closestDist) { closestDist = dist; targetEl = el }
          }
          if (targetEl) {
            const range = document.createRange()
            range.selectNodeContents(targetEl)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
          }
        }, 100)
      } else if (clickedInEditor) {
        editorRef.current?.focusAtCoords(x, y)
      } else {
        const ce = cardRef.current?.querySelector('[contenteditable="true"]') as HTMLElement
        if (ce) {
          ce.focus()
          const sel = window.getSelection()
          if (sel) { sel.selectAllChildren(ce); sel.collapseToEnd() }
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
    clearDraftTimer()
    clearCommitTimer()
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
      const now = new Date().toISOString()
      const splitTs = new Date(new Date(block.created_at).getTime() + 1).toISOString()
      const splitSortOrder = (block.sort_order ?? 0) + 0.5

      // Temporarily make the editor editable so we can programmatically delete the selection
      const editor = getEditor()
      let newContent: string
      if (editor) {
        const from = menuStateRef.current?.editorFrom ?? 0
        const to = menuStateRef.current?.editorTo ?? 0
        if (from > 0 && to > from) {
          newContent = editor.deleteRange(from, to)
        } else {
          newContent = removeTextFromHTML(currentContent, selText)
          editor.setContent(newContent)
        }
      } else {
        newContent = removeTextFromHTML(currentContent, selText)
      }
      // Clean up empty list items left behind by deleteRange
      newContent = newContent
        .replace(/<li><p><br[^>]*><\/p><\/li>/g, '')
        .replace(/<li><p>\s*<\/p><\/li>/g, '')
        .replace(/<(ul|ol)>\s*<\/(ul|ol)>/g, '')
      const isEmpty = !htmlToText(newContent).trim()
      const newStatus: BlockStatus = isEmpty ? 'archived' : 'active'

      // Create the new block inheriting all properties from the original
      const { data: newBlock } = await supabase.from('journal_blocks')
        .insert({
          user_id: block.user_id,
          context_id: block.context_id,
          workspace_id: block.workspace_id,
          entry_type: block.entry_type,
          owner_id: block.owner_id,
          due_date: block.due_date,
          due_date_type: block.due_date_type,
          start_date: block.start_date,
          task_status: block.task_status,
          content: selHTML || selText,
          status: 'active',
          created_at: splitTs,
          updated_at: splitTs,
          sort_order: splitSortOrder,
        })
        .select().single()
      if (!newBlock) return

      // Copy property values from source block to new block
      const { data: srcProps } = await supabase
        .from('entry_properties')
        .select('property_value_id')
        .eq('entry_id', block.id)
      if (srcProps && srcProps.length > 0) {
        await supabase.from('entry_properties').insert(
          srcProps.map((ep: { property_value_id: string }) => ({
            entry_id: (newBlock as Block).id,
            property_value_id: ep.property_value_id,
          }))
        )
      }

      await supabase.from('journal_blocks')
        .update({ content: newContent, draft_content: null, status: newStatus, is_archived: isEmpty, updated_at: now })
        .eq('id', block.id)
      const updatedSourceBlock = { ...block, content: newContent, draft_content: null, status: newStatus, updated_at: now }
      if (isEmpty) {
        p.onSplitBlock(newBlock as Block, updatedSourceBlock)
        p.onRemove(block.id)
        p.onBlockArchived?.({ ...block, content: newContent, status: 'archived', is_archived: true })
      } else {
        syncEditorContent(newContent)
        p.onUpdate({ ...block, content: newContent, draft_content: null, status: newStatus, updated_at: now })
        p.onSplitBlock(newBlock as Block, updatedSourceBlock)
        deactivate()
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
        if (isSummaryRefusal(json.summary)) {
          setErrorMessage("Couldn't summarize — try selecting more meaningful text.")
          return
        }
        // Summary is now HTML — use directly for full block, or strip tags for partial replacement
        const summaryHTML = json.summary
        const newContent = isFullBlock
          ? summaryHTML
          : replaceTextInHTML(currentContent, selText, summaryHTML.replace(/<[^>]*>/g, ''))
        if (newContent === currentContent) {
          setErrorMessage('Summary could not be applied — text mismatch.')
          return
        }
        // Show preview — use original HTML for full block, plain text for partial selection
        const originalDisplay = isFullBlock ? currentContent : `<p>${textToSummarize.replace(/\n/g, '</p><p>')}</p>`
        setSummaryPreview({ original: originalDisplay, summary: summaryHTML, newContent, isFullBlock })
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
  const pendingSaveRef = useRef(false)
  const saveNewEntry = useCallback(async () => {
    if (savingRef.current) {
      // An autosave is in flight — queue the full save for when it completes
      pendingSaveRef.current = true
      return
    }
    pendingSaveRef.current = false
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
    let saved: Block | null = null

    const taskFields = pendingEntryTypeRef.current === 'task' ? {
      task_status: pendingTaskFieldsRef.current.taskStatus,
      owner_id: pendingTaskFieldsRef.current.ownerId,
      due_date: pendingTaskFieldsRef.current.dueDate,
      due_date_type: pendingTaskFieldsRef.current.dueDateType,
      start_date: pendingTaskFieldsRef.current.startDate,
    } : {}

    if (autosavedBlockIdRef.current) {
      // Block was already created by autosave — update and fetch it
      const { data, error } = await supabase
        .from('journal_blocks')
        .update({ content: html, entry_type: pendingEntryTypeRef.current, ...taskFields })
        .eq('id', autosavedBlockIdRef.current)
        .select()
        .single()
      savingRef.current = false
      if (error) { console.error(error); return null }
      saved = data as Block | null
      autosavedBlockIdRef.current = null
    } else {
      const { data, error } = await supabase
        .from('journal_blocks')
        .insert({
          user_id: p.userId,
          context_id: p.contextId ?? null,
          workspace_id: wsId,
          content: html,
          status: 'active',
          entry_type: pendingEntryTypeRef.current,
          ...taskFields,
        })
        .select()
        .single()
      savingRef.current = false
      if (error) { console.error(error); return null }
      saved = data as Block | null
    }
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
    setPendingEntryType('info'); setPendingTaskStatus('not_started'); setPendingOwnerId(null); setPendingDueDate(null); setPendingDueDateType(null); setPendingStartDate(null)
    setFocused(false)
    setEditorKey(k => k + 1)
    if (saved) {
      p.onSaved(saved)
      // Fire-and-forget: embed block for semantic search
      fetch('/api/ai/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId: saved.id }) }).catch(() => {})
    }
    return saved
  }, [])

  const saveExistingBlock = useCallback(async (opts?: { keepFocus?: boolean }) => {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return

    clearAutosaveTimer()
    clearDraftTimer()
    clearCommitTimer()
    // Only deactivate when explicitly leaving the block, not on background save
    if (!opts?.keepFocus) setFocused(false)

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

    // Version history is handled by the handle_block_update trigger,
    // which inserts the old content into block_versions before any update.
    const { data: saved } = await supabase
      .from('journal_blocks')
      .update({ content: html, draft_content: null })
      .eq('id', block.id)
      .select()
      .single()
    lastSavedHTMLRef.current = html
    lastDraftHTMLRef.current = null
    const savedBlock = (saved as Block) ?? { ...block, content: html, draft_content: null }
    lastSyncedContentRef.current = savedBlock.content
    p.onUpdate(savedBlock)
    savingRef.current = false
    // Fire-and-forget: embed block for semantic search
    fetch('/api/ai/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId: block.id }) }).catch(() => {})
  }, [])

  // Wrapper that prompts user to apply active property filters before saving a new entry
  const saveNewEntryWithFilterPrompt = useCallback(async () => {
    if (!isNewEntry) return saveNewEntry()
    const text = liveTextRef.current.trim()
    if (!text) return saveNewEntry()
    const filters = (propsRef.current as NewEntryProps).activePropertyFilters
    if (!filters || filters.size === 0) return saveNewEntry()
    // Find filter values not already applied to the pending entry
    const pending = pendingPropertyIdsRef.current
    const missing = new Set<string>()
    filters.forEach(vid => { if (!pending.has(vid)) missing.add(vid) })
    if (missing.size === 0) return saveNewEntry()
    // Show prompt and wait for user decision
    clearAutosaveTimer()
    setFilterPromptValues(missing)
    setFilterPromptOpen(true)
    const selected = await new Promise<Set<string>>(resolve => {
      filterPromptResolveRef.current = resolve
    })
    // Merge selected values into pending properties before saving
    if (selected.size > 0) {
      const merged = new Set(pendingPropertyIdsRef.current)
      selected.forEach(vid => merged.add(vid))
      setPendingPropertyIds(merged)
      pendingPropertyIdsRef.current = merged
    }
    return saveNewEntry()
  }, [isNewEntry, saveNewEntry])

  const handleSave = isNewEntry ? saveNewEntryWithFilterPrompt : saveExistingBlock

  // ── Autosave (new entries) & Draft save (existing blocks) ───────────
  const autosaveRef = useRef(() => {})

  // New-entry autosave: inserts/updates the block content directly
  autosaveRef.current = async () => {
    if (savingRef.current) return
    const html = liveHTMLRef.current
    const text = liveTextRef.current.trim()
    if (!text) return
    savingRef.current = true
    try {
      const supabase = createClient()
      if (autosavedBlockIdRef.current) {
        await supabase
          .from('journal_blocks')
          .update({ content: html, entry_type: pendingEntryTypeRef.current })
          .eq('id', autosavedBlockIdRef.current)
      } else {
        const p = propsRef.current as NewEntryProps
        const wsId = workspaceRef.current?.id
          ?? workspacesRef.current.find(w => w.is_default)?.id
        if (!wsId) { savingRef.current = false; return }
        const { data, error } = await supabase
          .from('journal_blocks')
          .insert({
            user_id: p.userId,
            context_id: p.contextId ?? null,
            workspace_id: wsId,
            content: html,
            status: 'active',
            entry_type: pendingEntryTypeRef.current,
          })
          .select('id')
          .single()
        if (!error && data) {
          autosavedBlockIdRef.current = data.id
        }
      }
      lastSavedHTMLRef.current = html
    } finally {
      savingRef.current = false
      if (!filterPromptResolveRef.current && (pendingSaveRef.current || (!focusedRef.current && liveTextRef.current.trim()))) {
        saveNewEntry()
      }
    }
  }

  // Draft save for existing blocks: writes to draft_content only (no history)
  async function saveDraft(blockId: string) {
    const html = liveHTMLRef.current
    if (html === lastSavedHTMLRef.current) return
    if (html === lastDraftHTMLRef.current) return
    const supabase = createClient()
    await supabase.from('journal_blocks').update({ draft_content: html }).eq('id', blockId)
    lastDraftHTMLRef.current = html
    lastSyncedContentRef.current = html // prevent our own draft from re-triggering sync
  }

  // beforeunload: save draft via fetch+keepalive so it survives page close
  useEffect(() => {
    if (isNewEntry) return
    function handleBeforeUnload() {
      const blockId = (propsRef.current as ExistingBlockProps).block?.id
      if (!blockId) return
      const html = liveHTMLRef.current
      if (html === lastSavedHTMLRef.current) return
      const token = accessTokenRef.current
      if (!token) return
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/journal_blocks?id=eq.${blockId}`
      fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          'Authorization': `Bearer ${token}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ draft_content: html }),
        keepalive: true,
      }).catch(() => {})
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isNewEntry])

  function handleEditorChange(html: string, text: string) {
    liveHTMLRef.current = html
    liveTextRef.current = text
    const trimmed = text.trim()
    if (isNewEntry) {
      if (trimmed && !focused) setFocused(true)
      if (!trimmed && !hasPendingData) { setFocused(false); clearAutosaveTimer(); return }
      // New entries: autosave after inactivity
      clearAutosaveTimer()
      autosaveTimerRef.current = setTimeout(() => autosaveRef.current(), autosaveInterval * 1000)
    } else if (focusedRef.current) {
      const blockId = (propsRef.current as ExistingBlockProps).block?.id
      if (!blockId) return
      // Draft save: 5 seconds after last keystroke
      clearDraftTimer()
      draftTimerRef.current = setTimeout(() => saveDraft(blockId), 5000)
      // Commit (content + history): use autosave interval — keep focus + cursor
      clearCommitTimer()
      commitTimerRef.current = setTimeout(() => saveExistingBlock({ keepFocus: true }), autosaveInterval * 1000)
    }
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
    setPendingEntryType('info'); setPendingTaskStatus('not_started'); setPendingOwnerId(null); setPendingDueDate(null); setPendingDueDateType(null); setPendingStartDate(null)
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
        if (isSummaryRefusal(json.summary)) {
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
      // Clear any saved draft since we're reverting
      const blockId = (propsRef.current as ExistingBlockProps).block?.id
      if (blockId && lastDraftHTMLRef.current !== null) {
        lastDraftHTMLRef.current = null
        createClient().from('journal_blocks').update({ draft_content: null }).eq('id', blockId).then(() => {})
      }
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

    if (focused && e.altKey && !e.shiftKey && !e.ctrlKey && (e.key === '`' || e.key === '~')) {
      e.preventDefault()
      if (isNewEntry) { setPendingEntryType(prev => prev === 'info' ? 'task' : 'info') }
      else { toggleEntryType() }
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
      setPendingEntryType('info'); setPendingTaskStatus('not_started'); setPendingOwnerId(null); setPendingDueDate(null); setPendingDueDateType(null); setPendingStartDate(null)
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
    // If the property editor popup is open (portaled to body), stay active
    if (propertyEditorOpenRef.current) return
    // If the property filter prompt is open (portaled to body), stay active
    if (filterPromptResolveRef.current) return
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
          setFocused(false)
          if (!text) return // unfocus but keep pending data
          saveNewEntryWithFilterPrompt()
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
      setFocused(false)
      if (!text) return // unfocus but keep pending data
      saveNewEntryWithFilterPrompt()
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

  async function restoreBlock() {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    const supabase = createClient()
    const updates: Record<string, unknown> = { status: 'active', is_archived: false, archived_at: null, completed_at: null, deleted_at: null }
    await supabase.from('journal_blocks').update(updates).eq('id', p.block.id)
    // Update in-place: notify parent with restored block, but don't remove from feed
    p.onUpdate({ ...p.block, status: 'active', is_archived: false, archived_at: null, completed_at: null, deleted_at: null })
    setRestoredLocally(true)
  }

  async function permanentlyDeleteBlock() {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    const supabase = createClient()
    await supabase.from('journal_blocks').delete().eq('id', p.block.id)
    p.onRemove(p.block.id)
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

  function updateTaskField(field: string, value: unknown) {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    p.onUpdate({ ...p.block, [field]: value })
    const supabase = createClient()
    supabase.from('journal_blocks').update({ [field]: value }).eq('id', p.block.id).then(() => {})
  }

  function handlePersonAdded(person: Person) {
    setPeople(prev => [...prev, person].sort((a, b) => a.name.localeCompare(b.name)))
  }

  function setTaskStatus(taskStatus: 'not_started' | 'in_progress' | 'done') {
    const p = propsRef.current as ExistingBlockProps
    if (!p.block) return
    // Keep status active — task_status drives strikethrough/grey styling, no auto-archive
    p.onUpdate({ ...p.block, task_status: taskStatus })
    const supabase = createClient()
    supabase.from('journal_blocks').update({ task_status: taskStatus }).eq('id', p.block.id).then(() => {})
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

  // Load people for assignee dropdown
  const blockForPeople = props.block
  useEffect(() => {
    if (peopleLoaded) return
    // For new entries, use props.people if available
    if (isNewEntry) {
      if (props.people && props.people.length > 0) {
        setPeople(props.people as Person[])
        setPeopleLoaded(true)
      } else {
        const supabase = createClient()
        supabase.from('people').select('id, name').eq('user_id', currentUserId).order('name')
          .then(({ data }) => { setPeople((data ?? []) as Person[]); setPeopleLoaded(true) })
      }
      return
    }
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
  }, [isNewEntry, blockForPeople, peopleLoaded, currentUserId, props.people])

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

  // Measure content height for collapse/expand using ResizeObserver
  // so we detect height after TipTap renders its content asynchronously
  const lineHeightPx = 24
  const collapseMaxHeight = collapseLines * lineHeightPx
  useEffect(() => {
    if (isNewEntry) return
    const el = contentMeasureRef.current
    if (!el) return
    function measure() {
      const prev = el!.style.maxHeight
      const prevOverflow = el!.style.overflow
      el!.style.maxHeight = 'none'
      el!.style.overflow = 'visible'
      const natural = el!.scrollHeight
      el!.style.maxHeight = prev
      el!.style.overflow = prevOverflow
      setIsContentTall(natural > collapseMaxHeight + lineHeightPx)
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [collapseMaxHeight, isNewEntry])

  // Whether this card is currently visually collapsed
  const shouldCollapse = !isNewEntry && !focused && isContentTall && feedCollapsed && !cardExpanded

  const isTask = isNewEntry ? pendingEntryType === 'task' : block?.entry_type === 'task'
  const isComplete = block?.task_status === 'done'

  // Lifecycle state — determines rendering mode for non-active entries
  const isArchived = block?.status === 'archived'
  const isCompleted = block?.status === 'complete'
  const isDeleted = !!block?.deleted_at
  const isInactive = isArchived || isCompleted || isDeleted
  const [confirmPermanentDelete, setConfirmPermanentDelete] = useState(false)
  const [restoredLocally, setRestoredLocally] = useState(false)

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
    {
      key: 'convert', label: isTask ? 'Convert to Info' : 'Convert to Task', shortcut: '⌥`', shortcutTip: 'Alt + Backtick', icon: convertIcon(),
      onClick: () => { setPopoverOpen(false); if (isNewEntry) { setPendingEntryType(prev => prev === 'info' ? 'task' : 'info') } else { toggleEntryType() } },
    },
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
    { key: 'delete', label: 'Delete', shortcut: '⌃⌦', shortcutTip: 'Ctrl + Delete', icon: trashIcon(), onClick: () => { setPopoverOpen(false); if (isNewEntry) { liveHTMLRef.current = ''; liveTextRef.current = ''; clearAutosaveTimer(); setPendingPropertyIds(new Set()); setPendingFiles([]); setPendingEntryType('info'); setPendingTaskStatus('not_started'); setPendingOwnerId(null); setPendingDueDate(null); setPendingDueDateType(null); setPendingStartDate(null); setEditorKey(k => k + 1) } else { deleteBlock() } }, separator: true, className: 'text-red-500 hover:bg-red-50' },
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

  // Derive border left color for focused/workspace/lifecycle states
  let borderLeftColor: string | undefined
  if (!isDragOver) {
    if (isInactive && !restoredLocally) {
      // Lifecycle accent border for inactive entries
      if (isDeleted) borderLeftColor = '#F87171' // red-400
      else if (isCompleted) borderLeftColor = '#4ADE80' // green-400
      else borderLeftColor = '#FBBF24' // amber-400
    } else if (showWsBorder) {
      borderLeftColor = wsLeftColor
    } else if (focused) {
      borderLeftColor = activeScheme?.primary ?? '#F59E0B'
    }
  }

  const appliedProps = block
    ? ((props as ExistingBlockProps).appliedPropertyIds ?? new Set<string>())
    : pendingPropertyIds
  const hasAppliedProps = appliedProps.size > 0

  // Due date visual indicators
  const todayStr = new Date().toISOString().split('T')[0]
  const dueDateDay = block?.due_date ? block.due_date.replace(/Z$/i, '').replace(/[+-]\d{2}:\d{2}$/, '').split('T')[0] : null
  const isDueToday = dueDateDay === todayStr
  const isPastDue = !!dueDateDay && dueDateDay < todayStr

  // Future start date → dim the card
  const hasFutureStart = (() => {
    const sd = block?.start_date
    if (!sd) return false
    const start = new Date(sd.replace(/Z$/i, '').replace(/[+-]\d{2}:\d{2}$/, ''))
    return start > new Date()
  })()

  return (
    <div
      id={block ? `block-${block.id}` : undefined}
      ref={cardRef}
      className={`relative group rounded-xl shadow-sm transition-colors ${
        hasAppliedProps ? 'mt-4' : ''
      } ${
        isDragOver
          ? 'border-2 border-amber-400 bg-amber-50/50 shadow-md'
          : (isInactive && !restoredLocally) || showWsBorder
            ? `border-l-[3px] border border-[#E5E0D0] ${focused ? 'shadow-md' : 'hover:border-[#D5D0C0]'}`
            : focused
              ? 'border-l-[3px] border border-[#E5E0D0] shadow-md'
              : 'border-l-[3px] border-l-transparent border border-[#E5E0D0] hover:border-[#D5D0C0]'
      } ${isDragOver ? '' : focused ? '' : 'bg-white'} ${isDeleted && !restoredLocally ? 'opacity-60' : hasFutureStart && !focused ? 'opacity-50' : ''}`}
      style={{
        ...(focused && !isDragOver
            ? { backgroundColor: activeScheme?.activeMuted ?? '#FEF3C7' }
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
        {/* Entry type indicator — click to switch */}
        <EntryTypeToggle
          isTask={isTask}
          isDueToday={isDueToday}
          isPastDue={isPastDue}
          isDone={block?.task_status === 'done'}
          onClick={() => {
            if (isNewEntry) { setPendingEntryType(prev => prev === 'info' ? 'task' : 'info') }
            else { toggleEntryType() }
          }}
        />
        {/* Status badge for inactive entries */}
        {isInactive && !restoredLocally && (
          <span className={`pointer-events-auto px-2 py-0.5 rounded-full text-[10px] font-medium leading-tight ${
            isDeleted
              ? 'bg-red-50 text-red-600 border border-red-200'
              : isCompleted
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}>
            {isDeleted ? 'Deleted' : isCompleted ? 'Completed' : 'Archived'}
          </span>
        )}
        {restoredLocally && (
          <span className="pointer-events-auto px-2 py-0.5 rounded-full text-[10px] font-medium leading-tight bg-blue-50 text-blue-600 border border-blue-200">
            Restored
          </span>
        )}
        <div className="flex items-center gap-1 overflow-hidden pointer-events-auto">
          <PropertyBubbles
            appliedValueIds={appliedProps}
            properties={propertiesForWorkspace(propertyWorkspaceId)}
            onClickValue={() => setPropertyEditorOpen(true)}
          />
        </div>
        {/* Add-tag button — sits after last pill (hidden for inactive entries) */}
        {!(isInactive && !restoredLocally) && <div className="relative pointer-events-auto">
          <button
            ref={addPropertyBtnRef}
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
                properties={propertiesForWorkspace(propertyWorkspaceId)}
                onChanged={(newIds) => (props as ExistingBlockProps).onPropertyChanged?.(newIds)}
                onClose={() => setPropertyEditorOpen(false)}
                anchorRef={addPropertyBtnRef}
              />
            ) : (
              <PropertyEditor
                blockId="__pending__"
                appliedValueIds={pendingPropertyIds}
                properties={propertiesForWorkspace(propertyWorkspaceId)}
                onChanged={(newIds) => setPendingPropertyIds(newIds)}
                onClose={() => setPropertyEditorOpen(false)}
                anchorRef={addPropertyBtnRef}
              />
            )
          )}
        </div>}
      </div>

      {/* ── ACTION ICONS — pinned top-right corner ── */}
      {isInactive && !restoredLocally ? (
        <div className={`absolute top-0 right-2 -translate-y-1/2 z-10 flex items-center gap-0.5 transition-opacity opacity-0 group-hover:opacity-100`}>
          {confirmPermanentDelete ? (
            <>
              <span className="text-[10px] text-red-600 font-medium mr-0.5">Are you sure?</span>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                onClick={(e) => { e.stopPropagation(); permanentlyDeleteBlock() }}
                className="h-6 px-2 flex items-center justify-center rounded-full bg-red-500 border border-red-500 text-white text-[10px] font-medium hover:bg-red-600"
              >
                Confirm
              </button>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                onClick={(e) => { e.stopPropagation(); setConfirmPermanentDelete(false) }}
                className="h-6 px-2 flex items-center justify-center rounded-full bg-white border border-gray-200 text-gray-500 text-[10px] font-medium hover:border-gray-400"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                title="Restore"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                onClick={(e) => { e.stopPropagation(); restoreBlock() }}
                className="h-6 px-2 flex items-center gap-1 rounded-full bg-white border border-gray-200 text-gray-500 text-[10px] font-medium hover:text-green-600 hover:border-green-400"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                Restore
              </button>
              {isDeleted && (
                <button
                  type="button"
                  title="Delete permanently"
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                  onClick={(e) => { e.stopPropagation(); setConfirmPermanentDelete(true) }}
                  className="h-6 px-2 flex items-center gap-1 rounded-full bg-white border border-gray-200 text-red-500 text-[10px] font-medium hover:bg-red-50 hover:border-red-300"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                  Delete forever
                </button>
              )}
            </>
          )}
        </div>
      ) : (
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
          {/* Archive — only for existing blocks */}
          {block && <ArchiveButton onClick={() => archiveBlock()} />}
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
      )}

      {/* Popover menu */}
      {popoverOpen && (
        <div
          ref={popoverRef}
          className="absolute top-9 right-2 z-20 bg-white border border-[#E5E0D0] rounded-lg shadow-xl py-1 min-w-[172px]"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
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
        ref={contentMeasureRef}
        className={`relative px-4 pb-0 ${showToolbar ? 'pt-1' : 'pt-2'}`}
        style={shouldCollapse ? { maxHeight: `${collapseMaxHeight}px`, overflow: 'hidden' } : undefined}
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
        {/* Fade overlay when collapsed */}
        {shouldCollapse && (
          <div
            className="absolute bottom-0 left-0 right-0 h-16 z-[1] pointer-events-none"
            style={{ background: 'linear-gradient(transparent, white)' }}
          />
        )}
        <div className={`${summarizing ? 'opacity-30 pointer-events-none' : ''} ${isComplete && !focused ? 'opacity-50 line-through decoration-gray-400' : ''}`}>
          <TipTapEditor
            key={isNewEntry ? editorKey : undefined}
            ref={editorRef}
            content={contentHTML}
            placeholder={isNewEntry
              ? 'Type to create a new entry \u00b7 Ctrl+Enter or Ctrl+S to save \u00b7 Esc to cancel'
              : undefined}
            autoFocus={isNewEntry}
            onSubmit={handleSave}
            onChange={handleEditorChange}
            editable={(isNewEntry || focused) && !(isInactive && !restoredLocally)}
            toolbarVisible={showToolbar}
            toolbarBg={activeScheme?.activeMuted}
            onReady={(handle) => { editorHandleRef.current = handle }}
            searchHighlight={!isNewEntry && !focused ? (props as ExistingBlockProps).searchHighlight : undefined}
            matchedChunk={!isNewEntry && !focused ? (props as ExistingBlockProps).matchedChunk : undefined}
            people={props.people}
          />
        </div>
        {summarizing && !summaryPreview && (
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
        {summaryPreview && createPortal(
          <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4" onMouseDown={() => { setSummaryPreview(null); setSummarizing(false) }}>
            <div
              className="bg-white rounded-xl shadow-xl w-full max-w-3xl flex flex-col max-h-[85vh]"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900">Summary Preview</h3>
                <button onClick={() => { setSummaryPreview(null); setSummarizing(false) }} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Original</p>
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 max-h-[35vh] overflow-y-auto tiptap-content text-sm text-gray-600 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: summaryPreview.original }}
                  />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide mb-1.5">Summary</p>
                  <div className="bg-green-50 rounded-lg p-4 border border-green-200 tiptap-content text-sm text-gray-800 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: summaryPreview.summary }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
                <button
                  onClick={() => { setSummaryPreview(null); setSummarizing(false) }}
                  className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const preview = summaryPreview
                    setSummaryPreview(null)
                    setSummarizing(false)
                    const p = propsRef.current as ExistingBlockProps
                    const block = p.block
                    if (!block) return
                    const supabase = createClient()
                    await supabase.from('journal_blocks').update({ content: preview.newContent, draft_content: null, status: 'active' }).eq('id', block.id)
                    syncEditorContent(preview.newContent)
                    lastSavedHTMLRef.current = preview.newContent
                    lastDraftHTMLRef.current = null
                    p.onUpdate({ ...block, content: preview.newContent, draft_content: null, status: 'active' })
                    deactivate()
                  }}
                  className="px-4 py-1.5 text-sm text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors"
                >
                  Accept
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
        {/* "Show less" overlay centered in card when expanded & tall */}
        {!isNewEntry && !focused && isContentTall && !shouldCollapse && (
          <div className="flex justify-center py-1">
            <button
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
              onClick={(e) => { e.stopPropagation(); setCardExpanded(false) }}
              className="text-xs text-amber-600 hover:text-amber-700 hover:underline cursor-pointer"
            >
              Show less
            </button>
          </div>
        )}
      </div>

      {/* ── EXPAND / COLLAPSE LINK ── */}
      {!isNewEntry && !focused && isContentTall && shouldCollapse && (
        <div className="flex justify-center pb-1 pt-0">
          <button
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
            onClick={(e) => { e.stopPropagation(); setCardExpanded(true) }}
            className="text-xs text-amber-600 hover:text-amber-700 hover:underline cursor-pointer"
          >
            Show more
          </button>
        </div>
      )}

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

      {/* ── TASK FIELDS PANEL (new entry) ── */}
      {isNewEntry && isTask && (
        <div
          className="flex items-center gap-3 px-4 py-1.5 border-t border-gray-100 flex-wrap"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSave() }
            if (e.key === 'Escape') { e.preventDefault(); handleSave() }
          }}
        >
          <div className="flex items-center gap-0.5">
            {([
              { value: 'not_started' as const, label: 'Not Started', color: 'gray' },
              { value: 'in_progress' as const, label: 'In Progress', color: 'blue' },
              { value: 'done' as const, label: 'Done', color: 'green' },
            ]).map(({ value, label, color }) => {
              const isActive = pendingTaskStatus === value
              const colors = {
                gray: isActive ? 'bg-gray-100 border-gray-400 text-gray-700' : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-500',
                blue: isActive ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-500',
                green: isActive ? 'bg-green-50 border-green-400 text-green-700' : 'border-gray-200 text-gray-400 hover:border-green-300 hover:text-green-500',
              }[color]
              return (
                <button
                  key={value}
                  onClick={() => setPendingTaskStatus(value)}
                  className={`px-2 py-0.5 text-[11px] font-medium border rounded-full transition-colors ${colors}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <span className="w-px h-4 bg-gray-200" />
          <AssigneeSelect
            value={pendingOwnerId}
            people={people}
            userId={currentUserId}
            onChange={setPendingOwnerId}
            onPersonAdded={handlePersonAdded}
          />
          <span className="w-px h-4 bg-gray-200" />
          {pendingStartDate === null ? (
            <button
              title="Add Start Date/Time"
              onClick={() => {
                const today = `${new Date().toISOString().split('T')[0]}T00:00:00`
                if (pendingDueDate) {
                  const dueDay = pendingDueDate.split('T')[0]
                  const todayDay = new Date().toISOString().split('T')[0]
                  setPendingStartDate(todayDay > dueDay ? `${dueDay}T00:00:00` : today)
                } else {
                  setPendingStartDate('')
                }
              }}
              className="w-5 h-5 flex items-center justify-center rounded-full text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
          ) : (() => {
            const startDateVal = pendingStartDate ? pendingStartDate.split('T')[0] : ''
            let startTimeVal = ''
            if (pendingStartDate) {
              const parts = pendingStartDate.split('T')
              if (parts[1] && parts[1] !== '00:00:00') startTimeVal = parts[1].slice(0, 5)
            }
            function buildStartTs(date: string, time: string | null): string {
              if (!time) return `${date}T00:00:00`
              return `${date}T${time}:00`
            }
            function setStartWithValidation(ts: string | null) {
              if (ts && pendingDueDate) {
                const startDay = ts.split('T')[0]
                const dueDay = pendingDueDate.split('T')[0]
                if (startDay > dueDay) { showDateWarning('Start date cannot be after due date'); return }
              }
              setPendingStartDate(ts)
            }
            const startPickerId = 'datepicker-new-start'
            return (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400 font-medium">Start</span>
                <div className="relative flex-shrink-0">
                  <button type="button" title="Start Date" onClick={() => { (document.getElementById(startPickerId) as HTMLInputElement)?.showPicker?.() }} className="cursor-pointer text-gray-400 hover:text-gray-600">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  </button>
                  <input id={startPickerId} type="date" value={startDateVal} onChange={(e) => {
                    if (!e.target.value) { setPendingStartDate(null); return }
                    setStartWithValidation(buildStartTs(e.target.value, startTimeVal || null))
                  }} className="absolute inset-0 opacity-0 w-full h-full pointer-events-none" tabIndex={-1} />
                </div>
                <span title="Start Date" className="text-xs text-gray-600 hover:text-gray-900 py-0.5 cursor-pointer select-none" onClick={() => { (document.getElementById(startPickerId) as HTMLInputElement)?.showPicker?.() }}>
                  {startDateVal ? formatDatePart(new Date(startDateVal + 'T00:00:00'), dateFormat) : <span className="text-gray-300">mm/dd/yyyy</span>}
                </span>
                {startDateVal && (
                  <TimePickerDropdown value={startTimeVal} onChange={(t) => { setStartWithValidation(buildStartTs(startDateVal, t || null)) }} timeFormat={timeFormat} />
                )}
                <button onClick={() => setPendingStartDate(null)} title="Remove start date" className="p-0.5 text-gray-300 hover:text-red-400 transition-colors">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            )
          })()}
          <span className="w-px h-4 bg-gray-200" />
          {(() => {
            const pendingDateVal = pendingDueDate ? pendingDueDate.split('T')[0] : ''
            let pendingTimeVal = ''
            if (pendingDueDate) {
              const parts = pendingDueDate.split('T')
              if (parts[1] && parts[1] !== '23:59:59') pendingTimeVal = parts[1].slice(0, 5)
            }
            function buildPendingTimestamp(date: string, time: string | null): string {
              if (!time) return `${date}T23:59:59`
              return `${date}T${time}:00`
            }
            function setDueWithValidation(ts: string | null) {
              if (ts && pendingStartDate) {
                const startDay = pendingStartDate.split('T')[0]
                const dueDay = ts.split('T')[0]
                if (dueDay < startDay) { showDateWarning('Due date cannot be before start date'); return }
              }
              setPendingDueDate(ts)
              if (!ts) setPendingDueDateType(null)
            }
            const newDatePickerId = 'datepicker-new-entry'
            return (
              <div className="flex items-center gap-1">
                <div className="relative flex-shrink-0">
                  <button type="button" title="Due Date" onClick={() => { (document.getElementById(newDatePickerId) as HTMLInputElement)?.showPicker?.() }} className="cursor-pointer text-gray-400 hover:text-gray-600">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  </button>
                  <input id={newDatePickerId} type="date" value={pendingDateVal} onChange={(e) => {
                    if (!e.target.value) { setDueWithValidation(null) }
                    else { setDueWithValidation(buildPendingTimestamp(e.target.value, pendingTimeVal || null)); if (!pendingDueDateType) setPendingDueDateType('target') }
                  }} className="absolute inset-0 opacity-0 w-full h-full pointer-events-none" tabIndex={-1} />
                </div>
                <span title="Due Date" className="text-xs text-gray-600 hover:text-gray-900 py-0.5 cursor-pointer select-none" onClick={() => { (document.getElementById(newDatePickerId) as HTMLInputElement)?.showPicker?.() }}>
                  {pendingDateVal ? formatDatePart(new Date(pendingDateVal + 'T00:00:00'), dateFormat) : <span className="text-gray-300">mm/dd/yyyy</span>}
                </span>
                {pendingDateVal && (
                  <>
                    <TimePickerDropdown value={pendingTimeVal} onChange={(t) => { setDueWithValidation(buildPendingTimestamp(pendingDateVal, t || null)) }} timeFormat={timeFormat} />
                    <div className="flex items-center bg-gray-100 rounded-md p-0.5 ml-2">
                      <button onClick={() => setPendingDueDateType('deadline')} className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${pendingDueDateType === 'deadline' ? 'bg-red-100 text-red-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>Deadline</button>
                      <button onClick={() => setPendingDueDateType('target')} className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${pendingDueDateType === 'target' || !pendingDueDateType ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>Target</button>
                    </div>
                    <button onClick={() => { setDueWithValidation(null) }} title="Clear date" className="p-0.5 text-gray-300 hover:text-red-400 transition-colors">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </>
                )}
              </div>
            )
          })()}
          {dateWarning && <span className="text-[10px] text-red-500 basis-full pl-1">{dateWarning}</span>}
        </div>
      )}

      {/* ── TASK FIELDS PANEL (existing block) ── */}
      {block && isTask && (
        <div
          className="flex items-center gap-3 px-4 py-1.5 border-t border-gray-100 flex-wrap"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveExistingBlock() }
            if (e.key === 'Escape') { e.preventDefault(); deactivate() }
          }}
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
          <AssigneeSelect
            value={block.owner_id}
            people={people}
            userId={block.user_id}
            onChange={(id) => updateTaskField('owner_id', id)}
            onPersonAdded={handlePersonAdded}
          />
          <span className="w-px h-4 bg-gray-200" />
          {block.start_date === null || block.start_date === undefined ? (
            <button
              title="Add Start Date/Time"
              onClick={() => {
                const today = `${new Date().toISOString().split('T')[0]}T00:00:00`
                if (block.due_date) {
                  const dueDay = block.due_date.replace(/Z$/i, '').replace(/[+-]\d{2}:\d{2}$/, '').split('T')[0]
                  const todayDay = new Date().toISOString().split('T')[0]
                  updateTaskField('start_date', todayDay > dueDay ? `${dueDay}T00:00:00` : today)
                } else {
                  updateTaskField('start_date', today)
                }
              }}
              className="w-5 h-5 flex items-center justify-center rounded-full text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
          ) : (() => {
            const sdStr = block.start_date
            let sdDateVal = ''
            let sdTimeVal = ''
            if (sdStr) {
              const localStr = sdStr.replace(/Z$/i, '').replace(/[+-]\d{2}:\d{2}$/, '')
              const d = new Date(localStr)
              sdDateVal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
              const hh = d.getHours(), mi = d.getMinutes(), ss = d.getSeconds()
              if (!(hh === 0 && mi === 0 && ss === 0)) sdTimeVal = `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
            }
            function buildStartTs(date: string, time: string | null): string {
              return time ? `${date}T${time}:00` : `${date}T00:00:00`
            }
            function setStartValidated(ts: string | null) {
              if (ts && block?.due_date) {
                const startDay = ts.split('T')[0]
                const dueDay = block.due_date.replace(/Z$/i, '').replace(/[+-]\d{2}:\d{2}$/, '').split('T')[0]
                if (startDay > dueDay) { showDateWarning('Start date cannot be after due date'); return }
              }
              updateTaskField('start_date', ts)
            }
            const startPickerId = `datepicker-start-${block.id}`
            return (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400 font-medium">Start</span>
                <div className="relative flex-shrink-0">
                  <button type="button" title="Start Date" onClick={() => { (document.getElementById(startPickerId) as HTMLInputElement)?.showPicker?.() }} className="cursor-pointer text-gray-400 hover:text-gray-600">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  </button>
                  <input id={startPickerId} type="date" value={sdDateVal} onChange={(e) => {
                    if (!e.target.value) { updateTaskField('start_date', null); return }
                    setStartValidated(buildStartTs(e.target.value, sdTimeVal || null))
                  }} className="absolute inset-0 opacity-0 w-full h-full pointer-events-none" tabIndex={-1} />
                </div>
                <span title="Start Date" className="text-xs text-gray-600 hover:text-gray-900 py-0.5 cursor-pointer select-none" onClick={() => { (document.getElementById(startPickerId) as HTMLInputElement)?.showPicker?.() }}>
                  {sdDateVal ? formatDatePart(new Date(sdDateVal + 'T00:00:00'), dateFormat) : <span className="text-gray-300">mm/dd/yyyy</span>}
                </span>
                {sdDateVal && (
                  <TimePickerDropdown value={sdTimeVal} onChange={(t) => { setStartValidated(buildStartTs(sdDateVal, t || null)) }} timeFormat={timeFormat} />
                )}
                <button onClick={() => updateTaskField('start_date', null)} title="Remove start date" className="p-0.5 text-gray-300 hover:text-red-400 transition-colors">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            )
          })()}
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
              // Prevent due date before start_date
              if (block?.start_date) {
                const startDay = block.start_date.replace(/Z$/i, '').replace(/[+-]\d{2}:\d{2}$/, '').split('T')[0]
                if (newDate < startDay) { showDateWarning('Due date cannot be before start date'); return }
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
                    title="Due Date"
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
                  title="Due Date"
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
                    <div className="flex items-center bg-gray-100 rounded-md p-0.5 ml-2">
                      <button
                        onClick={() => updateTaskField('due_date_type', 'deadline')}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                          block.due_date_type === 'deadline' ? 'bg-red-100 text-red-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'
                        }`}
                      >Deadline</button>
                      <button
                        onClick={() => updateTaskField('due_date_type', 'target')}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                          block.due_date_type === 'target' || !block.due_date_type ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'
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
          {dateWarning && <span className="text-[10px] text-red-500 basis-full pl-1">{dateWarning}</span>}
        </div>
      )}

      {/* ── FOOTER ── */}
      <div className="flex items-center px-4 pb-1.5 pt-0 select-none">
        <span className="text-[11px] text-gray-400 flex-1" suppressHydrationWarning>
          {block
            ? <>Created {formatTimestamp(block.created_at, dateFormat, timeFormat)}{showModified && <span> · Modified {formatTimestamp(block.updated_at, dateFormat, timeFormat)}</span>}{isArchived && block.archived_at && !restoredLocally && <span> · Archived {formatTimestamp(block.archived_at, dateFormat, timeFormat)}</span>}{isCompleted && block.completed_at && !restoredLocally && <span> · Completed {formatTimestamp(block.completed_at, dateFormat, timeFormat)}</span>}{isDeleted && block.deleted_at && !restoredLocally && <span> · Deleted {formatTimestamp(block.deleted_at, dateFormat, timeFormat)}</span>}{(props as ExistingBlockProps).similarityScore != null && <span className="ml-1.5 px-1.5 py-0 rounded-full bg-amber-50 text-amber-700 text-[10px] font-medium">{Math.round((props as ExistingBlockProps).similarityScore! * 100)}% match</span>}</>
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

      {filterPromptOpen && isNewEntry && createPortal(
        (() => {
          const allProps = propertiesForWorkspace(propertyWorkspaceId)
          // Group filter values by property
          const groups: { propName: string; values: { id: string; label: string; color: string | null }[] }[] = []
          const grouped = new Map<string, { propName: string; values: { id: string; label: string; color: string | null }[] }>()
          filterPromptValues.forEach(vid => {
            for (const prop of allProps) {
              const val = prop.values.find(v => v.id === vid)
              if (val) {
                let g = grouped.get(prop.id)
                if (!g) { g = { propName: prop.name, values: [] }; grouped.set(prop.id, g); groups.push(g) }
                g.values.push({ id: val.id, label: val.label, color: val.color })
                break
              }
            }
          })
          const [checked, setChecked] = [filterPromptValues, setFilterPromptValues]
          const toggle = (vid: string) => {
            setChecked(prev => { const n = new Set(prev); if (n.has(vid)) n.delete(vid); else n.add(vid); return n })
          }
          const resolve = (ids: Set<string>) => {
            setFilterPromptOpen(false)
            filterPromptResolveRef.current?.(ids)
            filterPromptResolveRef.current = null
          }
          return (
            <div className="fixed inset-0 bg-black/30 z-[100000] flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) resolve(new Set()) }}>
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm" onMouseDown={(e) => e.stopPropagation()}>
                <div className="px-5 pt-5 pb-2">
                  <p className="text-sm font-semibold text-gray-900">Apply property filters?</p>
                  <p className="text-xs text-gray-400 italic mt-1">
                    You have property filters active. Without these properties, this entry won&apos;t appear in your current view.
                  </p>
                </div>
                <div className="px-5 pb-3 space-y-2">
                  {groups.map(g => (
                    <div key={g.propName}>
                      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">{g.propName}</p>
                      {g.values.map(v => (
                        <label key={v.id} className="flex items-center gap-2 py-0.5 cursor-pointer">
                          <input type="checkbox" checked={checked.has(v.id)} onChange={() => toggle(v.id)} className="rounded border-gray-300 text-amber-600 focus:ring-amber-300" />
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: v.color ?? '#9ca3af' }} />
                          <span className="text-xs text-gray-700">{v.label}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
                  <button onClick={() => resolve(new Set())} className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
                    Skip
                  </button>
                  <button onClick={() => resolve(checked)} className="px-3 py-1.5 text-xs text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors">
                    {checked.size === filterPromptValues.size ? 'Apply All' : checked.size > 0 ? `Apply Selected (${checked.size})` : 'Skip'}
                  </button>
                </div>
              </div>
            </div>
          )
        })(),
        document.body
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
