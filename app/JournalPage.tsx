'use client'

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import data from '@emoji-mart/data'

const EmojiPicker = lazy(() => import('@emoji-mart/react'))
import { createClient } from '@/lib/supabase/client'
import { Block, Context } from './types'
import { JournalBlock } from './components/JournalBlock'
import { BlockFeed } from './components/BlockFeed'
import { ContextFilter } from './components/ContextFilter'
import { ArchivedSection, ArchivedSectionHandle } from './components/ArchivedSection'
import { RightPanel } from './components/RightPanel'
import { PropertyFilterBar } from './components/PropertyFilterBar'
import { PropertiesManager } from './components/PropertiesManager'
import { ReportModal } from './components/ReportModal'
import { useWorkspace, Workspace } from '@/context/WorkspaceContext'
import { useProperties } from '@/context/PropertiesContext'
import workspaceColorSchemes from '@/constants/workspaceColorSchemes'

const PAGE_SIZE = 20
const SEARCH_PAGE_SIZE = 100
const PANEL_STORAGE_KEY = 'journal-panel-open'
const FORMATTING_VISIBLE_KEY = 'tiptap-toolbar-visible'
const DEFAULT_AUTOSAVE_INTERVAL = 30
const SORT_MODE_KEY = 'journal-sort-mode'
const ADVANCED_OPEN_KEY = 'search-advanced-open'

type SortMode = 'created_desc' | 'manual'

interface Props {
  userId: string
}

export function JournalPage({ userId }: Props) {
  const { activeWorkspace, activeWorkspaceId, activeScheme, isGlobalView, workspaces, setActiveWorkspace, refreshWorkspaces } = useWorkspace()
  const { propertiesForWorkspace } = useProperties()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [propsManagerOpen, setPropsManagerOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  // Inline search & advanced filters
  const [searchText, setSearchText] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [filterEntryTypes, setFilterEntryTypes] = useState<Set<string>>(new Set(['info', 'task']))
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set(['active']))
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [aiSearchMode, setAiSearchMode] = useState(false)
  const [aiSearchResults, setAiSearchResults] = useState<Block[] | null>(null)
  const [aiSearchScores, setAiSearchScores] = useState<Record<string, number>>({})
  const [aiMatchedChunks, setAiMatchedChunks] = useState<Record<string, string>>({})
  const [aiSearchLoading, setAiSearchLoading] = useState(false)

  // Property filter state (in-memory only)
  const [activePropertyFilters, setActivePropertyFilters] = useState<Set<string>>(new Set())

  // Batch-loaded entry_properties: Map<blockId, Set<propertyValueId>>
  const [blockProperties, setBlockProperties] = useState<Map<string, Set<string>>>(new Map())

  const [blocks, setBlocks] = useState<Block[]>([])
  const [contexts, setContexts] = useState<Context[]>([])
  const [contextFilter, setContextFilter] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [initialised, setInitialised] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [autosaveInterval, setAutosaveInterval] = useState(DEFAULT_AUTOSAVE_INTERVAL)
  const [formattingVisible, setFormattingVisible] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('created_desc')

  const contextFilterRef = useRef(contextFilter)
  contextFilterRef.current = contextFilter
  const debouncedSearchRef = useRef(debouncedSearch)
  debouncedSearchRef.current = debouncedSearch
  const filterEntryTypesRef = useRef(filterEntryTypes)
  filterEntryTypesRef.current = filterEntryTypes
  const filterStatusesRef = useRef(filterStatuses)
  filterStatusesRef.current = filterStatuses
  const filterDateFromRef = useRef(filterDateFrom)
  filterDateFromRef.current = filterDateFrom
  const filterDateToRef = useRef(filterDateTo)
  filterDateToRef.current = filterDateTo
  const archiveRef = useRef<ArchivedSectionHandle>(null)

  useEffect(() => {
    const saved = localStorage.getItem(PANEL_STORAGE_KEY)
    if (saved !== null) setPanelOpen(saved === 'true')
    const fmt = localStorage.getItem(FORMATTING_VISIBLE_KEY)
    if (fmt === 'true') setFormattingVisible(true)
    const sort = localStorage.getItem(SORT_MODE_KEY)
    if (sort === 'manual' || sort === 'created_desc') setSortMode(sort)
    const adv = localStorage.getItem(ADVANCED_OPEN_KEY)
    if (adv !== null) setAdvancedOpen(adv === 'true')
  }, [])

  // Cmd+K / Ctrl+K to focus inline search
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'f')) {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  // Debounce search text (longer delay for AI search)
  useEffect(() => {
    const delay = aiSearchMode ? 600 : 300
    const id = setTimeout(() => setDebouncedSearch(searchText), delay)
    return () => clearTimeout(id)
  }, [searchText, aiSearchMode])

  // Toggle advanced panel with localStorage persistence
  function toggleAdvanced() {
    setAdvancedOpen(prev => {
      const next = !prev
      localStorage.setItem(ADVANCED_OPEN_KEY, String(next))
      return next
    })
  }

  const hasActiveFilters = searchText.length > 0 || filterEntryTypes.size < 2 || filterStatuses.size !== 1 || !filterStatuses.has('active') || filterDateFrom || filterDateTo || activePropertyFilters.size > 0

  // AI semantic search
  useEffect(() => {
    if (!aiSearchMode || !debouncedSearch) {
      setAiSearchResults(null)
      setAiSearchScores({})
      setAiMatchedChunks({})
      return
    }
    let cancelled = false
    setAiSearchLoading(true)
    fetch('/api/ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: debouncedSearch,
        workspaceId: isGlobalView ? null : activeWorkspaceId,
      }),
    })
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        if (data.error === 'embedding_not_configured') {
          setAiSearchResults([])
          setAiSearchScores({})
          setAiMatchedChunks({})
        } else {
          setAiSearchResults(data.results ?? [])
          setAiSearchScores(data.scores ?? {})
          setAiMatchedChunks(data.matchedChunks ?? {})
        }
      })
      .catch(() => { if (!cancelled) { setAiSearchResults([]); setAiMatchedChunks({}) } })
      .finally(() => { if (!cancelled) setAiSearchLoading(false) })
    return () => { cancelled = true }
  }, [aiSearchMode, debouncedSearch, isGlobalView, activeWorkspaceId])

  function toggleFormatting() {
    setFormattingVisible(prev => {
      const next = !prev
      localStorage.setItem(FORMATTING_VISIBLE_KEY, String(next))
      return next
    })
  }

  // Fetch autosave preference and sort mode
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('profiles')
      .select('autosave_interval_seconds, journal_sort_mode')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (data?.autosave_interval_seconds) {
          setAutosaveInterval(data.autosave_interval_seconds)
        }
        if (data?.journal_sort_mode) {
          setSortMode(data.journal_sort_mode as SortMode)
          localStorage.setItem(SORT_MODE_KEY, data.journal_sort_mode)
        }
      })
  }, [userId])

  async function saveSortMode(mode: SortMode) {
    setSortMode(mode)
    localStorage.setItem(SORT_MODE_KEY, mode)
    const supabase = createClient()
    await supabase.from('profiles').update({ journal_sort_mode: mode }).eq('id', userId)
  }

  function togglePanel() {
    setPanelOpen((prev) => {
      const next = !prev
      localStorage.setItem(PANEL_STORAGE_KEY, String(next))
      return next
    })
  }

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('contexts')
      .select('id, name, color, icon')
      .eq('user_id', userId)
      .order('name')
      .then(({ data }) => setContexts(data ?? []))
  }, [userId])

  const fetchBlocks = useCallback(async (cursor?: string) => {
    if (loading) return
    setLoading(true)

    const isSearching = !!debouncedSearchRef.current
    const supabase = createClient()
    let query = supabase
      .from('journal_blocks')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(isSearching ? SEARCH_PAGE_SIZE : PAGE_SIZE)

    // Status filter — map UI selections to DB status values
    const statuses = filterStatusesRef.current
    const allStatuses = statuses.has('active') && statuses.has('archived') && statuses.has('deleted')
    if (!allStatuses && statuses.size > 0) {
      const dbStatuses: string[] = []
      if (statuses.has('active')) dbStatuses.push('active')
      if (statuses.has('archived')) dbStatuses.push('archived', 'complete')
      if (dbStatuses.length > 0) query = query.in('status', dbStatuses)
    } else if (statuses.size === 0) {
      // Nothing selected — show nothing
      query = query.eq('status', '__none__')
    }
    // Include deleted entries only if 'deleted' is selected
    if (!statuses.has('deleted')) {
      query = query.is('deleted_at', null)
    }

    // Context filter
    if (contextFilterRef.current) {
      query = query.eq('context_id', contextFilterRef.current)
    }

    // Text search
    if (debouncedSearchRef.current) {
      query = query.ilike('content', `%${debouncedSearchRef.current}%`)
    }

    // Entry type filter
    const types = filterEntryTypesRef.current
    if (types.size === 1) {
      query = query.eq('entry_type', types.values().next().value!)
    } else if (types.size === 0) {
      query = query.eq('entry_type', '__none__')
    }

    // Date range
    if (filterDateFromRef.current) {
      query = query.gte('created_at', filterDateFromRef.current + 'T00:00:00')
    }
    if (filterDateToRef.current) {
      query = query.lte('created_at', filterDateToRef.current + 'T23:59:59')
    }

    // Pagination (disabled during search)
    if (cursor && !isSearching) {
      query = query.lt('created_at', cursor)
    }

    const { data, error } = await query
    if (error) { console.error(error); setLoading(false); return }

    const rows = (data ?? []) as Block[]
    if (cursor && !isSearching) {
      setBlocks((prev) => [...prev, ...rows])
    } else {
      setBlocks(rows)
    }
    setHasMore(!isSearching && rows.length === PAGE_SIZE)
    setLoading(false)
    setInitialised(true)
  }, [userId, loading])

  useEffect(() => {
    fetchBlocks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    if (!initialised) return
    setHasMore(true)
    fetchBlocks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextFilter, debouncedSearch, filterEntryTypes, filterStatuses, filterDateFrom, filterDateTo])

  // Batch-load entry_properties for all visible blocks
  useEffect(() => {
    if (blocks.length === 0) { setBlockProperties(new Map()); return }
    const supabase = createClient()
    supabase
      .from('entry_properties')
      .select('entry_id, property_value_id')
      .in('entry_id', blocks.map(b => b.id))
      .then(({ data }) => {
        const map = new Map<string, Set<string>>()
        for (const row of (data ?? []) as { entry_id: string; property_value_id: string }[]) {
          const set = map.get(row.entry_id) ?? new Set()
          set.add(row.property_value_id)
          map.set(row.entry_id, set)
        }
        setBlockProperties(map)
      })
  }, [blocks])

  function handleBlockPropertiesChanged(blockId: string, newIds: Set<string>) {
    setBlockProperties(prev => {
      const next = new Map(prev)
      next.set(blockId, newIds)
      return next
    })
  }

  function loadMore() {
    const last = blocks[blocks.length - 1]
    if (last) fetchBlocks(last.created_at)
  }

  function handleNewBlock(block: Block) {
    const minOrder = blocks.reduce((m, b) => Math.min(m, b.sort_order ?? 0), 0)
    const withOrder = { ...block, sort_order: minOrder - 1 }
    setBlocks(prev => [withOrder, ...prev])
    if (sortMode === 'manual') {
      const supabase = createClient()
      supabase.from('journal_blocks')
        .update({ sort_order: minOrder - 1 })
        .eq('id', block.id)
        .then(({ error }) => { if (error) console.error(error) })
    }
  }

  function handleBlockUpdate(updated: Block) {
    setBlocks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
  }

  function handleBlockRemove(blockId: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId))
  }

  function handleBlockArchived(block: Block) {
    archiveRef.current?.addBlock(block)
  }

  function handleSplitBlock(newBlock: Block, updatedSourceBlock: Block) {
    setBlocks((prev) => {
      const withUpdatedSource = prev.map((b) =>
        b.id === updatedSourceBlock.id ? updatedSourceBlock : b
      )
      const idx = withUpdatedSource.findIndex(
        (b) => b.created_at <= newBlock.created_at
      )
      if (idx === -1) return [...withUpdatedSource, newBlock]
      return [
        ...withUpdatedSource.slice(0, idx),
        newBlock,
        ...withUpdatedSource.slice(idx),
      ]
    })
  }

  function handleReorder(activeId: string, overId: string) {
    // Ensure every block has a numeric sort_order before computing
    const sorted = sortedBlocks.map((b, i) => ({
      ...b,
      sort_order: b.sort_order ?? i,
    }))
    const oldIdx = sorted.findIndex(b => b.id === activeId)
    const newIdx = sorted.findIndex(b => b.id === overId)
    if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return

    const reordered = [...sorted]
    const [moved] = reordered.splice(oldIdx, 1)
    reordered.splice(newIdx, 0, moved)

    const above = reordered[newIdx - 1]?.sort_order ?? null
    const below = reordered[newIdx + 1]?.sort_order ?? null
    const newSortOrder =
      above !== null && below !== null ? (above + below) / 2
      : above !== null ? above + 1
      : below !== null ? below - 1
      : newIdx

    const updated = { ...moved, sort_order: newSortOrder }
    setBlocks(prev => prev.map(b => b.id === activeId ? updated : b))

    const supabase = createClient()
    supabase.from('journal_blocks')
      .update({ sort_order: newSortOrder })
      .eq('id', activeId)
      .then(({ error }) => { if (error) console.error(error) })
  }

  function togglePropertyFilter(valueId: string) {
    setActivePropertyFilters(prev => {
      const next = new Set(prev)
      if (next.has(valueId)) next.delete(valueId)
      else next.add(valueId)
      return next
    })
  }

  function clearPropertyFilters() {
    setActivePropertyFilters(new Set())
  }

  // Filter blocks by active property filters (AND logic: block must have ALL selected values).
  // NOTE: This only filters the currently loaded blocks. Journal entries further back in the
  // pagination that match the filter won't appear until they're loaded via "load more" or
  // scrolling. This is a known limitation we may need to address later with server-side
  // filtering on entry_properties.
  const filteredBlocks = activePropertyFilters.size > 0
    ? blocks.filter(b => {
        const applied = blockProperties.get(b.id)
        if (!applied) return false
        const filters = Array.from(activePropertyFilters)
        return filters.every(filterId => applied.has(filterId))
      })
    : blocks

  // Derive sorted blocks for rendering
  const sortedBlocks = sortMode === 'manual'
    ? [...filteredBlocks].sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity))
    : [...filteredBlocks].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )

  // ── Top bar colors ──────────────────────────────────────
  const barBg = activeScheme?.primary ?? '#FFFFFF'
  const barText = activeScheme?.textOnColor ?? undefined
  // For icon buttons in the top bar, derive a semi-transparent hover layer
  const btnActiveClass = activeScheme
    ? 'bg-white/20'
    : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
  const btnInactiveClass = activeScheme
    ? 'hover:bg-white/10'
    : 'text-[#78716C] hover:bg-amber-50 hover:text-amber-700'

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header
        className="h-14 border-b flex items-center justify-between px-6 flex-shrink-0 transition-colors duration-200"
        style={{
          backgroundColor: barBg,
          color: barText,
          borderColor: activeScheme ? 'transparent' : '#E5E0D0',
        }}
      >
        <div className="relative">
          <button
            onClick={() => setSwitcherOpen(prev => !prev)}
            className={`flex items-center gap-2 px-2 py-1.5 -ml-2 rounded-lg transition-colors ${activeScheme ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
          >
            {isGlobalView ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <span className="text-sm font-medium text-gray-600">All Workspaces</span>
              </>
            ) : (
              <>
                {activeWorkspace?.emoji && <span className="w-6 h-6 rounded-full flex items-center justify-center text-sm flex-shrink-0" style={{ backgroundColor: activeScheme?.muted ?? '#F3F4F6' }}>{activeWorkspace.emoji}</span>}
                <span className="text-sm font-medium">{activeWorkspace?.name}</span>
              </>
            )}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {switcherOpen && (
            <WorkspaceSwitcherDropdown
              workspaces={workspaces}
              activeId={activeWorkspace?.id ?? null}
              onSelect={(id) => { setActiveWorkspace(id); setSwitcherOpen(false) }}
              onNewWorkspace={() => { setSwitcherOpen(false); setCreateModalOpen(true) }}
              onEditWorkspace={(ws) => { setSwitcherOpen(false); setEditingWorkspace(ws); setCreateModalOpen(true) }}
              onClose={() => setSwitcherOpen(false)}
            />
          )}
        </div>

        {/* Inline search */}
        <div className="flex-1 max-w-sm mx-4 relative">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40 pointer-events-none">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={aiSearchMode ? "Describe what you\u2019re looking for\u2026" : "Filter entries\u2026 (Ctrl+K)"}
            className={`w-full pl-8 pr-16 py-1.5 text-xs rounded-lg border outline-none transition-colors text-gray-900 placeholder-gray-400 ${aiSearchLoading ? 'animate-pulse' : ''}`}
            style={{
              backgroundColor: activeScheme ? 'rgba(255,255,255,0.15)' : '#F9FAFB',
              borderColor: aiSearchLoading ? '#F59E0B' : (hasActiveFilters ? '#F59E0B' : (activeScheme ? 'rgba(255,255,255,0.2)' : '#E5E0D0')),
              color: activeScheme ? (activeScheme.textOnColor ?? '#FFFFFF') : '#111827',
            }}
            onKeyDown={(e) => { if (e.key === 'Escape') { setSearchText(''); searchInputRef.current?.blur() } }}
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute right-14 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-80"
              style={{ color: activeScheme ? (activeScheme.textOnColor ?? '#FFF') : '#6B7280' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
          <button
            onClick={toggleAdvanced}
            className="absolute right-1 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors"
            style={{
              color: activeScheme ? (activeScheme.textOnColor ?? '#FFF') : '#6B7280',
              opacity: advancedOpen || hasActiveFilters ? 1 : 0.6,
            }}
          >
            {hasActiveFilters && !advancedOpen && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-0.5 align-middle" />}
            Advanced
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={`inline-block ml-0.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setReportOpen(true)}
            title="Send report"
            className={`p-1.5 rounded-lg transition-colors ${btnInactiveClass}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </button>
          <button
            onClick={() => setPropsManagerOpen(true)}
            title="Manage properties"
            className={`p-1.5 rounded-lg transition-colors ${btnInactiveClass}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
          </button>
          <button
            onClick={() => saveSortMode('created_desc')}
            title="Sort by newest first"
            className={`p-1.5 rounded-lg transition-colors ${sortMode === 'created_desc' ? btnActiveClass : btnInactiveClass}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <button
            onClick={() => saveSortMode('manual')}
            title="Manual sort (drag to reorder)"
            className={`p-1.5 rounded-lg transition-colors ${sortMode === 'manual' ? btnActiveClass : btnInactiveClass}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <circle cx="9" cy="6" r="2" /><circle cx="15" cy="6" r="2" />
              <circle cx="9" cy="12" r="2" /><circle cx="15" cy="12" r="2" />
              <circle cx="9" cy="18" r="2" /><circle cx="15" cy="18" r="2" />
            </svg>
          </button>
          <button
            onClick={togglePanel}
            title={panelOpen ? 'Close focus panel' : 'Open focus panel'}
            className={`p-1.5 rounded-lg transition-colors ${panelOpen ? btnActiveClass : btnInactiveClass}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        </div>
      </header>

      {/* Advanced filter panel */}
      {advancedOpen && (
        <div className="border-b border-[#E5E0D0] bg-[#FDFCF7] px-6 py-3 space-y-3 flex-shrink-0 overflow-x-auto">
          {/* Property filters */}
          <PropertyFilterBar
            properties={propertiesForWorkspace(activeWorkspaceId)}
            activeFilters={activePropertyFilters}
            onToggleFilter={togglePropertyFilter}
            onClearFilters={clearPropertyFilters}
            showPinToggle
            onTogglePin={async (propertyId, pinned) => {
              const supabase = createClient()
              await supabase.from('properties').update({ pinned_in_filter_bar: pinned }).eq('id', propertyId)
            }}
          />

          {/* Filter toggles row */}
          <div className="flex items-center gap-4 flex-wrap text-[11px]">
            <div className={`flex items-center gap-1.5 ${aiSearchMode ? 'opacity-40 pointer-events-none' : ''}`}
              title={aiSearchMode ? 'Bypassed during AI search' : undefined}>
              <span className="text-gray-400 font-medium">Type:</span>
              {([['info', 'Info'], ['task', 'Task']] as const).map(([t, label]) => (
                <button key={t} onClick={() => setFilterEntryTypes(prev => {
                  const next = new Set(prev)
                  if (next.has(t)) next.delete(t); else next.add(t)
                  return next
                })}
                  className={`px-2 py-0.5 rounded-full border text-[11px] font-medium transition-all ${filterEntryTypes.has(t) ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className={`flex items-center gap-1.5 ${aiSearchMode ? 'opacity-40 pointer-events-none' : ''}`}
              title={aiSearchMode ? 'Bypassed during AI search' : undefined}>
              <span className="text-gray-400 font-medium">Status:</span>
              {([['active', 'Open'], ['archived', 'Archived'], ['deleted', 'Deleted']] as const).map(([s, label]) => (
                <button key={s} onClick={() => setFilterStatuses(prev => {
                  const next = new Set(prev)
                  if (next.has(s)) next.delete(s); else next.add(s)
                  return next
                })}
                  className={`px-2 py-0.5 rounded-full border text-[11px] font-medium transition-all ${filterStatuses.has(s) ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className={`flex items-center gap-1.5 ${aiSearchMode ? 'opacity-40 pointer-events-none' : ''}`}
              title={aiSearchMode ? 'Bypassed during AI search' : undefined}>
              <label className="flex items-center gap-1 text-gray-500">
                From
                <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px] text-gray-700 outline-none" />
              </label>
              <label className="flex items-center gap-1 text-gray-500">
                To
                <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)}
                  className="border border-gray-200 rounded px-1.5 py-0.5 text-[11px] text-gray-700 outline-none" />
              </label>
            </div>
            {/* Search mode toggle */}
            <div className="flex items-center bg-gray-100 rounded-md p-0.5">
              <button
                type="button"
                onClick={() => setAiSearchMode(false)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  !aiSearchMode
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Exact
              </button>
              <button
                type="button"
                onClick={() => setAiSearchMode(true)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  aiSearchMode
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                AI (Semantic)
              </button>
            </div>
            {hasActiveFilters && !aiSearchMode && (
              <button onClick={() => { setSearchText(''); setFilterEntryTypes(new Set(['info', 'task'])); setFilterStatuses(new Set(['active'])); setFilterDateFrom(''); setFilterDateTo(''); clearPropertyFilters() }}
                className="text-[11px] text-gray-400 hover:text-gray-600 underline">
                Clear all
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div
          className="flex-1 overflow-y-auto min-w-0 transition-colors duration-200"
          style={{ backgroundColor: isGlobalView ? '#FAFAF8' : (activeScheme?.muted ?? '#FAFAF8') }}
        >
          <div className="px-6 py-6 space-y-4">
            <ContextFilter
              contexts={contexts}
              active={contextFilter}
              onChange={setContextFilter}
            />

            {/* Quick filter bar — pinned properties only */}
            {!advancedOpen && (() => {
              const pinned = propertiesForWorkspace(activeWorkspaceId).filter(p => p.pinned_in_filter_bar)
              return pinned.length > 0 ? (
                <PropertyFilterBar
                  properties={pinned}
                  activeFilters={activePropertyFilters}
                  onToggleFilter={togglePropertyFilter}
                  onClearFilters={clearPropertyFilters}
                />
              ) : null
            })()}

            {/* Search status */}
            {debouncedSearch && !aiSearchMode && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {loading ? 'Searching\u2026' : (
                  <>
                    <span>{blocks.length} result{blocks.length !== 1 ? 's' : ''} for &ldquo;{debouncedSearch}&rdquo;</span>
                    <button onClick={() => setSearchText('')} className="text-amber-600 hover:text-amber-800 underline">Clear</button>
                  </>
                )}
              </div>
            )}
            {aiSearchMode && debouncedSearch && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {aiSearchLoading ? (
                  <span>AI searching\u2026</span>
                ) : aiSearchResults ? (
                  <>
                    <span>{aiSearchResults.length} result{aiSearchResults.length !== 1 ? 's' : ''} for &ldquo;{debouncedSearch}&rdquo;</span>
                    <button onClick={() => { setSearchText(''); setAiSearchMode(false) }} className="text-amber-600 hover:text-amber-800 underline">Clear AI search</button>
                  </>
                ) : null}
              </div>
            )}

            <JournalBlock
              userId={userId}
              contextId={contextFilter}
              onSaved={handleNewBlock}
              autosaveInterval={autosaveInterval}
              formattingVisible={formattingVisible}
              onToggleFormatting={toggleFormatting}
            />

            <BlockFeed
              blocks={aiSearchMode && aiSearchResults ? aiSearchResults as Block[] : sortedBlocks}
              loading={aiSearchMode ? aiSearchLoading : (loading && !initialised)}
              hasMore={aiSearchMode ? false : hasMore}
              onLoadMore={loadMore}
              onBlockUpdate={handleBlockUpdate}
              onBlockRemove={handleBlockRemove}
              onBlockArchived={handleBlockArchived}
              onSplitBlock={handleSplitBlock}
              sortMode={aiSearchMode ? 'created_desc' : sortMode}
              onReorder={handleReorder}
              autosaveInterval={autosaveInterval}
              formattingVisible={formattingVisible}
              onToggleFormatting={toggleFormatting}
              blockProperties={blockProperties}
              onBlockPropertiesChanged={handleBlockPropertiesChanged}
              searchHighlight={debouncedSearch || undefined}
              similarityScores={aiSearchMode ? aiSearchScores : undefined}
              matchedChunks={aiSearchMode ? aiMatchedChunks : undefined}
            />

            {!debouncedSearch && (
              <ArchivedSection ref={archiveRef} userId={userId} activeWorkspaceId={activeWorkspaceId} onRestored={handleNewBlock} />
            )}
          </div>
        </div>

        {panelOpen && (
          <RightPanel
            userId={userId}
            refreshKey={blocks.length}
            onTaskClick={(blockId) => {
              const el = document.getElementById(`block-${blockId}`)
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                el.classList.add('ring-2', 'ring-amber-400')
                setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400'), 1500)
              }
            }}
          />
        )}
      </div>

      {/* TODO: Semantic/AI-powered search from SearchOverlay is not yet replicated here.
         The old SearchOverlay supported a 'semantic' search mode toggle and per-result
         navigation across workspaces. Those features should be added when embeddings
         infrastructure is in place. */}

      {reportOpen && <ReportModal userId={userId} onClose={() => setReportOpen(false)} />}

      <PropertiesManager open={propsManagerOpen} onClose={() => setPropsManagerOpen(false)} userId={userId} />

      {createModalOpen && (
        <CreateWorkspaceModal
          userId={userId}
          editingWorkspace={editingWorkspace}
          allWorkspaces={workspaces}
          onClose={() => { setCreateModalOpen(false); setEditingWorkspace(null) }}
          onCreated={async (ws) => {
            await refreshWorkspaces()
            if (!editingWorkspace) setActiveWorkspace(ws.id)
            setCreateModalOpen(false)
            setEditingWorkspace(null)
          }}
        />
      )}
    </div>
  )
}

// ── Workspace Switcher Dropdown ──────────────────────────────────────

function WorkspaceSwitcherDropdown({
  workspaces,
  activeId,
  onSelect,
  onNewWorkspace,
  onEditWorkspace,
  onClose,
}: {
  workspaces: Workspace[]
  activeId: string | null
  onSelect: (id: string | null) => void
  onNewWorkspace: () => void
  onEditWorkspace: (ws: Workspace) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50"
    >
      <button
        onClick={() => onSelect(null)}
        className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors ${
          activeId === null ? 'bg-amber-50 text-amber-800' : 'text-gray-900 hover:bg-gray-50'
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-gray-400">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span className="flex-1">All Workspaces</span>
      </button>

      {workspaces.length > 0 && <div className="h-px bg-gray-100 my-1" />}

      {workspaces.map((ws) => {
        const scheme = workspaceColorSchemes.find(s => s.key === ws.color_scheme)
        return (
          <div key={ws.id} className="flex items-center group/ws">
            <button
              onClick={() => onSelect(ws.id)}
              className={`flex-1 flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors ${
                activeId === ws.id ? 'bg-amber-50 text-amber-800' : 'text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-sm" style={{ backgroundColor: workspaceColorSchemes.find(s => s.key === ws.color_scheme)?.muted ?? '#F3F4F6' }}>{ws.emoji || '\u2022'}</span>
              <span className="flex-1 truncate">
                {ws.name}
                {ws.is_default && <span className="text-[10px] text-gray-400 ml-1">(Default)</span>}
              </span>
              {scheme && (
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: scheme.primary }}
                />
              )}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onEditWorkspace(ws) }}
              className="px-2 py-1 text-[10px] text-gray-400 hover:text-amber-600 opacity-0 group-hover/ws:opacity-100 transition-opacity"
            >
              Edit
            </button>
          </div>
        )
      })}

      <div className="h-px bg-gray-100 my-1" />

      <button
        onClick={onNewWorkspace}
        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left text-gray-500 hover:bg-gray-50 transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>New Workspace</span>
      </button>
    </div>
  )
}

// ── Create Workspace Modal ───────────────────────────────────────────

function CreateWorkspaceModal({
  userId,
  onClose,
  onCreated,
  editingWorkspace,
  allWorkspaces,
}: {
  userId: string
  onClose: () => void
  onCreated: (ws: Workspace) => void
  editingWorkspace?: Workspace | null
  allWorkspaces?: Workspace[]
}) {
  const isEditing = !!editingWorkspace
  const [name, setName] = useState(editingWorkspace?.name ?? '')
  const [emoji, setEmoji] = useState<string | null>(editingWorkspace?.emoji ?? null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [colorScheme, setColorScheme] = useState(editingWorkspace?.color_scheme ?? workspaceColorSchemes[0].key)
  const [isDefault, setIsDefault] = useState(editingWorkspace?.is_default ?? false)
  const [saving, setSaving] = useState(false)
  const currentDefault = allWorkspaces?.find(w => w.is_default && w.id !== editingWorkspace?.id)
  const inputRef = useRef<HTMLInputElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Close emoji picker on click outside
  useEffect(() => {
    if (!showEmojiPicker) return
    function handleClick(e: MouseEvent) {
      if (
        emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node) &&
        emojiButtonRef.current && !emojiButtonRef.current.contains(e.target as Node)
      ) {
        setShowEmojiPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showEmojiPicker])

  async function handleSave() {
    if (!name.trim() || saving) return
    setSaving(true)
    const supabase = createClient()

    // If setting as default, unset any existing default
    if (isDefault) {
      await supabase.from('workspaces').update({ is_default: false }).eq('user_id', userId).eq('is_default', true)
    }

    if (isEditing) {
      const { data, error } = await supabase
        .from('workspaces')
        .update({
          name: name.trim(),
          emoji,
          color_scheme: colorScheme,
          is_default: isDefault,
        })
        .eq('id', editingWorkspace.id)
        .select('*')
        .single()
      if (error || !data) { console.error(error); setSaving(false); return }
      onCreated(data as Workspace)
    } else {
      const { data, error } = await supabase
        .from('workspaces')
        .insert({
          user_id: userId,
          name: name.trim(),
          emoji,
          color_scheme: colorScheme,
          is_default: isDefault,
        })
        .select('*')
        .single()
      if (error || !data) { console.error(error); setSaving(false); return }
      onCreated(data as Workspace)
    }
  }

  const selectedScheme = workspaceColorSchemes.find(s => s.key === colorScheme)!

  return (
    <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col overflow-visible"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Preview header */}
        <div
          className="h-12 rounded-t-xl flex items-center px-5 gap-2 transition-colors duration-200"
          style={{ backgroundColor: selectedScheme.primary, color: selectedScheme.textOnColor }}
        >
          {emoji && <span className="w-7 h-7 rounded-full flex items-center justify-center text-base flex-shrink-0" style={{ backgroundColor: selectedScheme.muted }}>{emoji}</span>}
          <span className="text-sm font-medium">{name || (isEditing ? 'Edit Workspace' : 'New Workspace')}</span>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Work, Personal, Side Project..."
              className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-transparent"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
            />
          </div>

          {/* Emoji */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Icon</label>
            <div className="flex items-center gap-2">
              <button
                ref={emojiButtonRef}
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className={`w-10 h-10 rounded-lg flex items-center justify-center text-2xl transition-colors ${emoji ? 'border border-gray-200 hover:border-gray-300' : 'border border-dashed border-gray-300 hover:border-gray-400'}`}
              >
                {emoji || <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>}
              </button>
              {emoji && (
                <button
                  type="button"
                  onClick={() => { setEmoji(null); setShowEmojiPicker(false) }}
                  className="text-xs text-gray-400 hover:text-gray-600 underline"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Color scheme */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Color</label>
            <div className="flex flex-wrap gap-1.5">
              {workspaceColorSchemes.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setColorScheme(s.key)}
                  title={s.label}
                  className={`w-7 h-7 rounded-full transition-all ${
                    colorScheme === s.key ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: s.primary }}
                />
              ))}
            </div>
          </div>

          {/* Default checkbox */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded border-gray-300 text-amber-600 focus:ring-amber-300"
            />
            <span className="text-sm text-gray-600">
              Set as default workspace
              {currentDefault && <span className="text-xs text-gray-400 ml-1">(Current default: {currentDefault.name})</span>}
            </span>
          </label>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-4 py-1.5 text-sm text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Workspace'}
          </button>
        </div>
      </div>

      {showEmojiPicker && createPortal(
        <div
          ref={emojiPickerRef}
          style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseDown={() => setShowEmojiPicker(false)}
        >
          <div onMouseDown={(e) => e.stopPropagation()} style={{ borderRadius: 12, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            <Suspense fallback={<div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, fontSize: 12, color: '#9ca3af' }}>Loading...</div>}>
              <EmojiPicker
                data={data}
                onEmojiSelect={(e: { native: string }) => { setEmoji(e.native); setShowEmojiPicker(false) }}
                theme="light"
                previewPosition="none"
                skinTonePosition="search"
                set="native"
                perLine={8}
                maxFrequentRows={1}
              />
            </Suspense>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
