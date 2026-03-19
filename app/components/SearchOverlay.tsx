'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useWorkspace } from '@/context/WorkspaceContext'
import { getScheme } from '@/constants/workspaceColorSchemes'

interface SearchResult {
  id: string
  snippet: string
  entry_type: 'info' | 'task'
  status: string
  workspace_id: string | null
  created_at: string
}

const ALL_STATUSES = ['active', 'archived', 'deleted'] as const
type StatusValue = typeof ALL_STATUSES[number]
const ALL_TYPES = ['info', 'task_mine', 'task_others'] as const
type TypeValue = typeof ALL_TYPES[number]

interface Props {
  onClose: () => void
  onNavigate: (blockId: string, workspaceId: string | null) => void
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function highlightSnippet(snippet: string, query: string): React.ReactNode {
  if (!query.trim()) return snippet
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = snippet.split(regex)
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="bg-amber-200 text-amber-900 rounded-sm px-0.5">{part}</mark>
      : part
  )
}

export function SearchOverlay({ onClose, onNavigate }: Props) {
  const { activeWorkspaceId, isGlobalView, workspaces } = useWorkspace()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  // Filters
  const [statusFilters, setStatusFilters] = useState<Set<StatusValue>>(new Set(ALL_STATUSES))
  const [typeFilters, setTypeFilters] = useState<Set<TypeValue>>(new Set(ALL_TYPES))
  const [scopeAll, setScopeAll] = useState(isGlobalView)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchMode, setSearchMode] = useState<'exact' | 'semantic'>('exact')

  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setSearched(false); return }
    setLoading(true)
    setSearched(true)
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q.trim(),
          mode: searchMode,
          statuses: Array.from(statusFilters),
          entryTypes: Array.from(typeFilters),
          workspaceId: scopeAll ? null : activeWorkspaceId,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setResults(data.results ?? [])
      } else {
        setResults([])
      }
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [searchMode, statusFilters, typeFilters, scopeAll, activeWorkspaceId, dateFrom, dateTo])

  // Debounced search on query or filter change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(query), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, doSearch])

  function wsColor(workspaceId: string | null): string | null {
    if (!workspaceId) return null
    const ws = workspaces.find(w => w.id === workspaceId)
    if (!ws) return null
    return getScheme(ws.color_scheme)?.primary ?? null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-black/30" onMouseDown={onClose} />
      <div
        className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[75vh]"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-200">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search entries…"
            className="flex-1 text-sm text-gray-900 outline-none placeholder-gray-400"
          />
          <kbd className="text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* Filter rows */}
        <div className="px-5 py-2 border-b border-gray-100 text-[11px] space-y-2">
          <div className="flex items-center gap-3">
            <CheckboxDropdown label="Status" allValues={ALL_STATUSES} selected={statusFilters} onChange={setStatusFilters}
              labels={{ active: 'Active', archived: 'Archived', deleted: 'Deleted' }} />
            <CheckboxDropdown label="Type" allValues={ALL_TYPES} selected={typeFilters} onChange={setTypeFilters}
              labels={{ info: 'Info', task_mine: 'Tasks \u2013 Mine', task_others: 'Tasks \u2013 Others' }} />
            <label className="flex items-center gap-1 text-gray-500">
              <input type="checkbox" checked={scopeAll} onChange={(e) => setScopeAll(e.target.checked)}
                className="rounded border-gray-300 text-amber-600 focus:ring-amber-300" />
              All workspaces
            </label>
            <div className="ml-auto flex items-center bg-gray-100 rounded-md p-0.5">
              <button
                type="button"
                onClick={() => setSearchMode('exact')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  searchMode === 'exact'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Exact
              </button>
              <button
                type="button"
                onClick={() => setSearchMode('semantic')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  searchMode === 'semantic'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Semantic
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-gray-500">
              From
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px] text-gray-700 outline-none" />
            </label>
            <label className="flex items-center gap-1 text-gray-500">
              To
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px] text-gray-700 outline-none" />
            </label>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-14 bg-gray-50 rounded-lg animate-pulse" />
              ))}
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div className="text-center py-10">
              <p className="text-sm text-gray-400">No entries found</p>
              <p className="text-xs text-gray-400 mt-1">Try different keywords or adjust your filters</p>
            </div>
          )}

          {!loading && !searched && (
            <div className="text-center py-10">
              <p className="text-sm text-gray-400">Type to search your journal entries</p>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="space-y-1">
              {results.map((r) => {
                const color = wsColor(r.workspace_id)
                return (
                  <button
                    key={r.id}
                    onClick={() => onNavigate(r.id, r.workspace_id)}
                    className="w-full text-left rounded-lg p-3 hover:bg-[#FFFEF7] transition-colors group"
                    style={color ? { borderLeft: `3px solid ${color}` } : { borderLeft: '3px solid #D1D5DB' }}
                  >
                    <p className="text-sm text-gray-700 line-clamp-2 break-words leading-snug">
                      {highlightSnippet(r.snippet, query)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-medium px-1 py-0.5 rounded ${
                        r.entry_type === 'task'
                          ? r.status === 'complete' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {r.entry_type === 'task' ? (r.status === 'complete' ? 'Done' : 'Task') : 'Info'}
                      </span>
                      {r.status === 'archived' && (
                        <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-gray-100 text-gray-400">Archived</span>
                      )}
                      <span className="text-[10px] text-gray-400">{formatDate(r.created_at)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// TODO: Phase B — Semantic search via pgvector
// When embeddings infrastructure is added:
// 1. Add migration: ALTER TABLE journal_blocks ADD COLUMN content_embedding vector(1536)
// 2. Create API route or trigger to generate embeddings on block save (Anthropic voyage or similar)
// 3. Create a Postgres function for cosine similarity search:
//    CREATE FUNCTION search_embeddings(query_embedding vector(1536), match_count int)
//    RETURNS TABLE(id uuid, similarity float) AS $$
//      SELECT id, 1 - (content_embedding <=> query_embedding) AS similarity
//      FROM journal_blocks WHERE content_embedding IS NOT NULL
//      ORDER BY content_embedding <=> query_embedding LIMIT match_count
//    $$ LANGUAGE sql;
// 4. In the search API, when mode='semantic':
//    - Embed the query string via the same model
//    - Call search_embeddings RPC
//    - Apply filters in a CTE or post-filter
// 5. Enable the "Semantic" toggle in SearchOverlay
// 6. Note in empty state: "Only entries saved after embeddings were enabled are searchable"

function CheckboxDropdown<T extends string>({ label, allValues, selected, onChange, labels }: {
  label: string
  allValues: readonly T[]
  selected: Set<T>
  onChange: (s: Set<T>) => void
  labels: Record<T, string>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const allChecked = selected.size === allValues.length
  const summaryLabel = allChecked
    ? 'All'
    : allValues.filter(v => selected.has(v)).map(v => labels[v]).join(', ') || 'None'

  function toggle(v: T) {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    onChange(next)
  }

  function toggleAll() {
    onChange(allChecked ? new Set() : new Set(allValues))
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-[130px] flex items-center gap-1 text-gray-500 hover:text-gray-700 transition-colors"
      >
        <span className="flex-shrink-0">{label}:</span>
        <span className="text-gray-700 font-medium truncate">{summaryLabel}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-50 flex-shrink-0 ml-auto">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[160px]">
          <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-[11px] text-gray-700">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              className="rounded border-gray-300 text-amber-600 focus:ring-amber-300"
            />
            All
          </label>
          <div className="border-t border-gray-100 my-0.5" />
          {allValues.map(v => (
            <label key={v} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-[11px] text-gray-700 whitespace-nowrap">
              <input
                type="checkbox"
                checked={selected.has(v)}
                onChange={() => toggle(v)}
                className="rounded border-gray-300 text-amber-600 focus:ring-amber-300"
              />
              {labels[v]}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

