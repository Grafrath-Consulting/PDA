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
import { UserPreferencesPanel } from '@/components/UserPreferencesPanel'
import { RightPanel } from './components/RightPanel'
import { PropertyFilterBar } from './components/PropertyFilterBar'
import { PropertiesManager } from './components/PropertiesManager'
import { ReportModal } from './components/ReportModal'
import { PeopleModal } from './components/PeopleModal'
import { useWorkspace, Workspace } from '@/context/WorkspaceContext'
import { useProperties } from '@/context/PropertiesContext'
import { useDateFormat } from '@/context/DateFormatContext'
import { formatDatePart } from '@/lib/date-format'
import workspaceColorSchemes, { type WorkspaceColorScheme } from '@/constants/workspaceColorSchemes'
import { PdaIcon } from '@/components/PdaIcon'

/** Diagonal-split circle showing swatch + pillBg */
function splitSchemeStyle(s: WorkspaceColorScheme): React.CSSProperties {
  return { background: `linear-gradient(135deg, ${s.swatch} 50%, ${s.pillBg} 50%)` }
}

const PAGE_SIZE = 20
const SEARCH_PAGE_SIZE = 100
const PANEL_STORAGE_KEY = 'journal-panel-open'
const FORMATTING_VISIBLE_KEY = 'tiptap-toolbar-visible'
const DEFAULT_AUTOSAVE_INTERVAL = 30
const DEFAULT_SYNC_INTERVAL = 60
const MIN_SYNC_INTERVAL = 5
const SORT_MODE_KEY = 'journal-sort-mode'
const ADVANCED_OPEN_KEY = 'search-advanced-open'
const FEED_COLLAPSED_KEY = 'feed-collapsed'
const FILTERS_KEY = 'journal-filters'

const VALID_SORT_MODES: SortMode[] = ['created_desc', 'created_asc', 'modified_desc', 'modified_asc', 'due_date', 'manual']

type SortMode = 'created_desc' | 'created_asc' | 'modified_desc' | 'modified_asc' | 'due_date' | 'manual'

interface Props {
  userId: string
  email: string
  displayName: string
}

export function JournalPage({ userId, email, displayName }: Props) {
  const { activeWorkspace, activeWorkspaceId, activeScheme, isGlobalView, hydrated, workspaces, setActiveWorkspace, refreshWorkspaces, reorderWorkspaces } = useWorkspace()
  const { propertiesForWorkspace, allProperties, refetch: refetchProperties } = useProperties()
  const { dateFormat } = useDateFormat()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [wsSelectMode, setWsSelectMode] = useState(false)
  const [selectedWsIds, setSelectedWsIds] = useState<Set<string> | null>(null) // null = all
  const rememberedWsIdsRef = useRef<Set<string> | null>(null)
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
  const [filterModifiedFrom, setFilterModifiedFrom] = useState('')
  const [filterModifiedTo, setFilterModifiedTo] = useState('')
  const [filterDueFrom, setFilterDueFrom] = useState('')
  const [filterDueTo, setFilterDueTo] = useState('')
  const [filterStartFrom, setFilterStartFrom] = useState('')
  const [filterStartTo, setFilterStartTo] = useState('')
  const [filterArchivedFrom, setFilterArchivedFrom] = useState('')
  const [filterArchivedTo, setFilterArchivedTo] = useState('')
  const [filterDeletedFrom, setFilterDeletedFrom] = useState('')
  const [filterDeletedTo, setFilterDeletedTo] = useState('')
  const [filterAssignee, setFilterAssignee] = useState<string | null>(null) // null=any, 'unassigned', or person id
  const searchInputRef = useRef<HTMLInputElement>(null)
  const switcherContainerRef = useRef<HTMLDivElement>(null)
  const [searchMode, setSearchMode] = useState<'smart' | 'exact'>('smart')
  const [searchNonce, setSearchNonce] = useState(0)
  const [smartSearchResults, setSmartSearchResults] = useState<Block[] | null>(null)
  const [smartSearchScores, setSmartSearchScores] = useState<Record<string, number>>({})
  const [smartSearchChunks, setSmartSearchChunks] = useState<Record<string, string>>({})
  const [smartSearchLoading, setSmartSearchLoading] = useState(false)
  const [aiParsedInfo, setAiParsedInfo] = useState<{ searchTerms: string; filters: { dateFrom?: string; dateTo?: string; entryTypes?: string[]; statuses?: string[]; propertyValues?: string[] }; reasoning: string } | null>(null)

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
  const [syncInterval, setSyncInterval] = useState(DEFAULT_SYNC_INTERVAL)
  const [formattingVisible, setFormattingVisible] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('created_desc')
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false)

  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  activeWorkspaceIdRef.current = activeWorkspaceId
  const isGlobalViewRef = useRef(isGlobalView)
  isGlobalViewRef.current = isGlobalView
  const selectedWsIdsRef = useRef(selectedWsIds)
  selectedWsIdsRef.current = selectedWsIds
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
  const filterModifiedFromRef = useRef(filterModifiedFrom)
  filterModifiedFromRef.current = filterModifiedFrom
  const filterModifiedToRef = useRef(filterModifiedTo)
  filterModifiedToRef.current = filterModifiedTo
  const filterDueFromRef = useRef(filterDueFrom)
  filterDueFromRef.current = filterDueFrom
  const filterDueToRef = useRef(filterDueTo)
  filterDueToRef.current = filterDueTo
  const filterStartFromRef = useRef(filterStartFrom)
  filterStartFromRef.current = filterStartFrom
  const filterStartToRef = useRef(filterStartTo)
  filterStartToRef.current = filterStartTo
  const filterArchivedFromRef = useRef(filterArchivedFrom)
  filterArchivedFromRef.current = filterArchivedFrom
  const filterArchivedToRef = useRef(filterArchivedTo)
  filterArchivedToRef.current = filterArchivedTo
  const filterDeletedFromRef = useRef(filterDeletedFrom)
  filterDeletedFromRef.current = filterDeletedFrom
  const filterDeletedToRef = useRef(filterDeletedTo)
  filterDeletedToRef.current = filterDeletedTo
  const filterAssigneeRef = useRef(filterAssignee)
  filterAssigneeRef.current = filterAssignee
  const [feedCollapsed, setFeedCollapsed] = useState(true)
  const [feedCollapseLines, setFeedCollapseLines] = useState(10)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [peopleModalOpen, setPeopleModalOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [peopleList, setPeopleList] = useState<{ id: string; name: string }[]>([])
  const [apiKeyBannerDismissed, setApiKeyBannerDismissed] = useState(false)
  const [apiKeyMissing, setApiKeyMissing] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(PANEL_STORAGE_KEY)
    if (saved !== null) setPanelOpen(saved === 'true')
    const fmt = localStorage.getItem(FORMATTING_VISIBLE_KEY)
    if (fmt === 'true') setFormattingVisible(true)
    const sort = localStorage.getItem(SORT_MODE_KEY)
    if (sort && VALID_SORT_MODES.includes(sort as SortMode)) setSortMode(sort as SortMode)
    const adv = localStorage.getItem(ADVANCED_OPEN_KEY)
    if (adv !== null) setAdvancedOpen(adv === 'true')
    const fc = localStorage.getItem(FEED_COLLAPSED_KEY)
    if (fc !== null) setFeedCollapsed(fc === 'true')
    // Restore saved filters
    try {
      const raw = localStorage.getItem(FILTERS_KEY)
      if (raw) {
        const f = JSON.parse(raw)
        if (f.entryTypes?.length) setFilterEntryTypes(new Set(f.entryTypes))
        if (f.statuses?.length) setFilterStatuses(new Set(f.statuses))
        if (f.dateFrom) setFilterDateFrom(f.dateFrom)
        if (f.dateTo) setFilterDateTo(f.dateTo)
        if (f.modifiedFrom) setFilterModifiedFrom(f.modifiedFrom)
        if (f.modifiedTo) setFilterModifiedTo(f.modifiedTo)
        if (f.dueFrom) setFilterDueFrom(f.dueFrom)
        if (f.dueTo) setFilterDueTo(f.dueTo)
        if (f.startFrom) setFilterStartFrom(f.startFrom)
        if (f.startTo) setFilterStartTo(f.startTo)
        if (f.archivedFrom) setFilterArchivedFrom(f.archivedFrom)
        if (f.archivedTo) setFilterArchivedTo(f.archivedTo)
        if (f.deletedFrom) setFilterDeletedFrom(f.deletedFrom)
        if (f.deletedTo) setFilterDeletedTo(f.deletedTo)
        if (f.assignee) setFilterAssignee(f.assignee)
        if (f.contextFilter) setContextFilter(f.contextFilter)
        if (f.propertyFilters?.length) setActivePropertyFilters(new Set(f.propertyFilters))
        if (f.searchMode) setSearchMode(f.searchMode)
      }
    } catch {}

  }, [])

  // Fetch people list for @mention support
  const fetchPeople = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase.from('people').select('id, name').eq('user_id', userId).order('name')
    setPeopleList((data ?? []) as { id: string; name: string }[])
  }, [userId])
  useEffect(() => { fetchPeople() }, [fetchPeople])

  // Check if API key is configured
  useEffect(() => {
    fetch('/api/user/ai-config').then(r => r.json()).then(data => {
      if (!data.configured) setApiKeyMissing(true)
    }).catch(() => {})
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
    const delay = searchMode === 'smart' ? 800 : 400
    const id = setTimeout(() => setDebouncedSearch(searchText), delay)
    return () => clearTimeout(id)
  }, [searchText, searchMode])

  // Toggle advanced panel with localStorage persistence
  function toggleAdvanced() {
    setAdvancedOpen(prev => {
      const next = !prev
      localStorage.setItem(ADVANCED_OPEN_KEY, String(next))
      return next
    })
  }

  // Persist filter selections to localStorage
  const filtersInitialised = useRef(false)
  useEffect(() => {
    // Skip the initial render (loading from localStorage)
    if (!filtersInitialised.current) { filtersInitialised.current = true; return }
    const f: Record<string, unknown> = {}
    if (filterEntryTypes.size < 2) f.entryTypes = Array.from(filterEntryTypes)
    if (filterStatuses.size !== 1 || !filterStatuses.has('active')) f.statuses = Array.from(filterStatuses)
    if (filterDateFrom) f.dateFrom = filterDateFrom
    if (filterDateTo) f.dateTo = filterDateTo
    if (filterModifiedFrom) f.modifiedFrom = filterModifiedFrom
    if (filterModifiedTo) f.modifiedTo = filterModifiedTo
    if (filterDueFrom) f.dueFrom = filterDueFrom
    if (filterDueTo) f.dueTo = filterDueTo
    if (filterStartFrom) f.startFrom = filterStartFrom
    if (filterStartTo) f.startTo = filterStartTo
    if (filterArchivedFrom) f.archivedFrom = filterArchivedFrom
    if (filterArchivedTo) f.archivedTo = filterArchivedTo
    if (filterDeletedFrom) f.deletedFrom = filterDeletedFrom
    if (filterDeletedTo) f.deletedTo = filterDeletedTo
    if (filterAssignee) f.assignee = filterAssignee
    if (contextFilter) f.contextFilter = contextFilter
    if (activePropertyFilters.size > 0) f.propertyFilters = Array.from(activePropertyFilters)
    if (searchMode !== 'smart') f.searchMode = searchMode
    if (Object.keys(f).length > 0) {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(f))
    } else {
      localStorage.removeItem(FILTERS_KEY)
    }
  }, [filterEntryTypes, filterStatuses, filterDateFrom, filterDateTo, filterModifiedFrom, filterModifiedTo, filterDueFrom, filterDueTo, filterStartFrom, filterStartTo, filterArchivedFrom, filterArchivedTo, filterDeletedFrom, filterDeletedTo, filterAssignee, contextFilter, activePropertyFilters, searchMode])

  const hasActiveSearch = searchText.length > 0
  const hasNonDefaultFilters = filterEntryTypes.size < 2 || filterStatuses.size !== 1 || !filterStatuses.has('active') || !!filterDateFrom || !!filterDateTo || !!filterModifiedFrom || !!filterModifiedTo || !!filterDueFrom || !!filterDueTo || !!filterStartFrom || !!filterStartTo || !!filterArchivedFrom || !!filterArchivedTo || !!filterDeletedFrom || !!filterDeletedTo || !!filterAssignee

  // Smart search (combined exact + semantic + AI parsing)
  useEffect(() => {
    if (searchMode !== 'smart' || !debouncedSearch) {
      setSmartSearchResults(null)
      setSmartSearchScores({})
      setSmartSearchChunks({})
      setAiParsedInfo(null)
      return
    }
    let cancelled = false
    setSmartSearchLoading(true)
    fetch('/api/smart-search', {
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
        setSmartSearchResults(data.results ?? [])
        setSmartSearchScores(data.scores ?? {})
        setSmartSearchChunks(data.matchedChunks ?? {})
        setAiParsedInfo(data.aiParsed ?? null)
      })
      .catch(() => { if (!cancelled) { setSmartSearchResults([]); setSmartSearchChunks({}); setAiParsedInfo(null) } })
      .finally(() => { if (!cancelled) setSmartSearchLoading(false) })
    return () => { cancelled = true }
  }, [searchMode, debouncedSearch, isGlobalView, activeWorkspaceId, searchNonce])

  // Sync AI-parsed filters to UI filter controls so the user can adjust them
  const aiSyncedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!aiParsedInfo || !aiParsedInfo.filters) return
    // Only sync once per unique search (avoid re-syncing on re-renders)
    const key = JSON.stringify(aiParsedInfo.filters)
    if (aiSyncedRef.current === key) return
    aiSyncedRef.current = key

    const f = aiParsedInfo.filters
    if (f.entryTypes && f.entryTypes.length > 0) {
      setFilterEntryTypes(new Set(f.entryTypes))
    }
    if (f.statuses && f.statuses.length > 0) {
      setFilterStatuses(new Set(f.statuses))
    }
    if (f.dateFrom) setFilterDateFrom(f.dateFrom)
    if (f.dateTo) setFilterDateTo(f.dateTo)
    if (f.propertyValues && f.propertyValues.length > 0) {
      // Resolve property value labels to IDs
      const props = propertiesForWorkspace(activeWorkspaceId)
      const ids = new Set<string>()
      const targetLabels = new Set(f.propertyValues.map(v => v.toLowerCase()))
      for (const prop of props) {
        for (const val of prop.values) {
          if (targetLabels.has(val.label.toLowerCase())) {
            ids.add(val.id)
          }
        }
      }
      if (ids.size > 0) setActivePropertyFilters(ids)
    }
    // Auto-open the advanced panel so filters are visible
    if (!advancedOpen) {
      setAdvancedOpen(true)
      localStorage.setItem(ADVANCED_OPEN_KEY, 'true')
    }
  }, [aiParsedInfo, propertiesForWorkspace, activeWorkspaceId, advancedOpen])

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
      .select('autosave_interval_seconds, sync_interval_seconds, journal_sort_mode, ws_select_mode, ws_selected_ids, feed_collapse_lines')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (data?.autosave_interval_seconds) {
          setAutosaveInterval(data.autosave_interval_seconds)
        }
        if (data?.sync_interval_seconds) {
          setSyncInterval(data.sync_interval_seconds)
        }
        if (data?.journal_sort_mode) {
          setSortMode(data.journal_sort_mode as SortMode)
          localStorage.setItem(SORT_MODE_KEY, data.journal_sort_mode)
        }
        if (data?.ws_select_mode) {
          setWsSelectMode(true)
          const ids = (data.ws_selected_ids ?? []) as string[]
          if (ids.length > 0) {
            setSelectedWsIds(new Set(ids))
            rememberedWsIdsRef.current = new Set(ids)
          }
        }
        if (data?.feed_collapse_lines != null) {
          setFeedCollapseLines(data.feed_collapse_lines)
        }
      })
  }, [userId])

  // Persist workspace selection prefs when they change
  const wsSelectInitialised = useRef(false)
  useEffect(() => {
    // Skip the first render (loading from DB)
    if (!wsSelectInitialised.current) { wsSelectInitialised.current = true; return }
    const supabase = createClient()
    supabase.from('profiles').update({
      ws_select_mode: wsSelectMode,
      ws_selected_ids: selectedWsIds ? Array.from(selectedWsIds) : [],
    }).eq('id', userId).then(() => {})
  }, [wsSelectMode, selectedWsIds, userId])

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
    if (cursor && loading) return
    setLoading(true)

    const isSearching = !!debouncedSearchRef.current
    const supabase = createClient()
    let query = supabase
      .from('journal_blocks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(isSearching ? SEARCH_PAGE_SIZE : PAGE_SIZE)

    // Workspace filter
    if (!isGlobalViewRef.current && activeWorkspaceIdRef.current) {
      query = query.eq('workspace_id', activeWorkspaceIdRef.current)
    } else if (isGlobalViewRef.current && selectedWsIdsRef.current) {
      // Multi-select mode: filter to selected workspaces
      query = query.in('workspace_id', Array.from(selectedWsIdsRef.current))
    }

    // Status filter — build OR conditions for each selected bucket
    // "active" = status IN (active) AND deleted_at IS NULL
    // "archived" = status IN (archived, complete) AND deleted_at IS NULL
    // "deleted" = deleted_at IS NOT NULL
    const statuses = filterStatusesRef.current
    if (statuses.size === 0) {
      query = query.eq('status', '__none__')
    } else {
      const orClauses: string[] = []
      if (statuses.has('active')) orClauses.push('and(status.eq.active,deleted_at.is.null)')
      if (statuses.has('archived')) orClauses.push('and(status.in.(archived,complete),deleted_at.is.null)')
      if (statuses.has('deleted')) orClauses.push('deleted_at.not.is.null')
      if (orClauses.length > 0) query = query.or(orClauses.join(','))
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

    // Created date range
    if (filterDateFromRef.current) {
      query = query.gte('created_at', filterDateFromRef.current + 'T00:00:00')
    }
    if (filterDateToRef.current) {
      query = query.lte('created_at', filterDateToRef.current + 'T23:59:59')
    }
    // Modified date range
    if (filterModifiedFromRef.current) {
      query = query.gte('updated_at', filterModifiedFromRef.current + 'T00:00:00')
    }
    if (filterModifiedToRef.current) {
      query = query.lte('updated_at', filterModifiedToRef.current + 'T23:59:59')
    }
    // Due date range
    if (filterDueFromRef.current) {
      query = query.gte('due_date', filterDueFromRef.current + 'T00:00:00')
    }
    if (filterDueToRef.current) {
      query = query.lte('due_date', filterDueToRef.current + 'T23:59:59')
    }
    // Start date range
    if (filterStartFromRef.current) {
      query = query.gte('start_date', filterStartFromRef.current + 'T00:00:00')
    }
    if (filterStartToRef.current) {
      query = query.lte('start_date', filterStartToRef.current + 'T23:59:59')
    }
    // Archived/Done date range — filter on archived_at OR completed_at
    if (filterArchivedFromRef.current) {
      query = query.or(`archived_at.gte.${filterArchivedFromRef.current}T00:00:00,completed_at.gte.${filterArchivedFromRef.current}T00:00:00`)
    }
    if (filterArchivedToRef.current) {
      query = query.or(`archived_at.lte.${filterArchivedToRef.current}T23:59:59,completed_at.lte.${filterArchivedToRef.current}T23:59:59`)
    }
    // Deleted date range
    if (filterDeletedFromRef.current) {
      query = query.gte('deleted_at', filterDeletedFromRef.current + 'T00:00:00')
    }
    if (filterDeletedToRef.current) {
      query = query.lte('deleted_at', filterDeletedToRef.current + 'T23:59:59')
    }

    // Assignee filter
    if (filterAssigneeRef.current === 'me') {
      query = query.is('owner_id', null)
    } else if (filterAssigneeRef.current === 'others') {
      query = query.not('owner_id', 'is', null)
    } else if (filterAssigneeRef.current) {
      query = query.eq('owner_id', filterAssigneeRef.current)
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
    setSwitching(false)
    setInitialised(true)
  }, [userId, loading])

  useEffect(() => {
    if (!hydrated) return
    fetchBlocks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, hydrated])

  // On load, commit any blocks that have unsaved drafts from a previous session
  const draftRecoveryDone = useRef(false)
  useEffect(() => {
    if (!initialised || draftRecoveryDone.current) return
    draftRecoveryDone.current = true
    const drafty = blocks.filter(b => b.draft_content != null)
    if (drafty.length === 0) return
    const supabase = createClient()
    Promise.all(drafty.map(async (block) => {
      await supabase
        .from('journal_blocks')
        .update({ content: block.draft_content, draft_content: null })
        .eq('id', block.id)
      return { ...block, content: block.draft_content!, draft_content: null }
    })).then((committed) => {
      setBlocks(prev => prev.map(b => {
        const updated = committed.find(c => c.id === b.id)
        return updated ?? b
      }))
      for (const b of committed) {
        fetch('/api/ai/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId: b.id }) }).catch(() => {})
      }
    })
  }, [initialised, blocks])

  // Track previous workspace to detect workspace switches
  const prevWorkspaceRef = useRef(activeWorkspaceId)
  const [switching, setSwitching] = useState(false)
  useEffect(() => {
    if (!initialised) return
    // In smart mode, the smart search API handles everything — skip exact fetch
    if (searchMode === 'smart' && debouncedSearch) return
    // On workspace switch, clear blocks immediately to show loading placeholders
    if (prevWorkspaceRef.current !== activeWorkspaceId) {
      setBlocks([])
      setSwitching(true)
      prevWorkspaceRef.current = activeWorkspaceId
    }
    setHasMore(true)
    fetchBlocks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, selectedWsIds, contextFilter, debouncedSearch, filterEntryTypes, filterStatuses, filterDateFrom, filterDateTo, filterModifiedFrom, filterModifiedTo, filterDueFrom, filterDueTo, filterStartFrom, filterStartTo, filterArchivedFrom, filterArchivedTo, filterDeletedFrom, filterDeletedTo, filterAssignee, searchMode, searchNonce])

  // ── Periodic sync polling: fetch blocks updated on other devices ──
  const lastPollRef = useRef<string>(new Date().toISOString())
  const syncIntervalRef = useRef(syncInterval)
  syncIntervalRef.current = syncInterval

  useEffect(() => {
    if (!initialised) return
    const timer = setInterval(async () => {
      const since = lastPollRef.current
      lastPollRef.current = new Date().toISOString()

      const supabase = createClient()
      let query = supabase
        .from('journal_blocks')
        .select('*')
        .eq('user_id', userId)
        .gt('updated_at', since)

      // Scope to current workspace view
      if (!isGlobalViewRef.current && activeWorkspaceIdRef.current) {
        query = query.eq('workspace_id', activeWorkspaceIdRef.current)
      } else if (isGlobalViewRef.current && selectedWsIdsRef.current) {
        query = query.in('workspace_id', Array.from(selectedWsIdsRef.current))
      }

      const { data, error } = await query
      if (error || !data || data.length === 0) return
      const remote = data as Block[]

      setBlocks(prev => {
        const existing = new Map(prev.map(b => [b.id, b]))
        let updated = [...prev]
        const addedIds = new Set<string>()

        for (const r of remote) {
          const local = existing.get(r.id)
          if (!local) {
            // New block from another device — add to feed (deduplicate within this batch)
            if (r.status === 'active' && !r.deleted_at && filterStatusesRef.current.has('active') && !addedIds.has(r.id)) {
              updated = [r, ...updated]
              addedIds.add(r.id)
            }
          } else {
            // Existing block updated remotely — merge metadata + content
            // Content merge happens in JournalBlock via lastSyncedContentRef
            updated = updated.map(b => b.id === r.id ? { ...r } : b)
          }
        }

        // Remove blocks that were archived/deleted on another device
        const removedIds = new Set(
          remote.filter(r => r.status !== 'active' || r.deleted_at).map(r => r.id)
        )
        if (removedIds.size > 0 && filterStatusesRef.current.has('active') && !filterStatusesRef.current.has('archived') && !filterStatusesRef.current.has('deleted')) {
          updated = updated.filter(b => !removedIds.has(b.id))
        }

        return updated
      })
    }, syncIntervalRef.current * 1000)

    return () => clearInterval(timer)
  }, [initialised, userId, syncInterval])

  // Batch-load entry_properties for all visible blocks (including smart search results)
  const visibleBlockIds = (() => {
    const ids = blocks.map(b => b.id)
    if (smartSearchResults) {
      for (const b of smartSearchResults as Block[]) {
        if (!ids.includes(b.id)) ids.push(b.id)
      }
    }
    return ids
  })()
  const visibleBlockIdsKey = visibleBlockIds.join(',')
  useEffect(() => {
    if (visibleBlockIds.length === 0) { setBlockProperties(new Map()); return }
    const supabase = createClient()
    supabase
      .from('entry_properties')
      .select('entry_id, property_value_id')
      .in('entry_id', visibleBlockIds)
      .then(({ data }) => {
        const map = new Map<string, Set<string>>()
        for (const row of (data ?? []) as { entry_id: string; property_value_id: string }[]) {
          const set = map.get(row.entry_id) ?? new Set()
          set.add(row.property_value_id)
          map.set(row.entry_id, set)
        }
        setBlockProperties(map)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleBlockIdsKey])

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
    const minOrder = blocks.reduce((m, b) => Math.min(m, b.sort_order, 0), 0)
    const newOrder = minOrder - 1
    const withOrder = { ...block, sort_order: newOrder }
    setBlocks(prev => {
      // Avoid duplicate if sync poll already added this block
      if (prev.some(b => b.id === block.id)) {
        return prev.map(b => b.id === block.id ? withOrder : b)
      }
      return [withOrder, ...prev]
    })
    // Always persist sort_order so it's never null
    const supabase = createClient()
    supabase.from('journal_blocks')
      .update({ sort_order: newOrder })
      .eq('id', block.id)
      .then(({ error }) => { if (error) console.error(error) })
  }

  function handleBlockUpdate(updated: Block) {
    setBlocks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
    setSmartSearchResults((prev) =>
      prev ? prev.map((b) => (b.id === updated.id ? updated : b)) : prev
    )
  }

  function handleBlockRemove(blockId: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId))
    setSmartSearchResults((prev) =>
      prev ? prev.filter((b) => b.id !== blockId) : prev
    )
  }

  function handleBlockArchived(block: Block) {
    setSmartSearchResults((prev) =>
      prev ? prev.filter((b) => b.id !== block.id) : prev
    )
  }

  function handleSplitBlock(newBlock: Block, updatedSourceBlock: Block) {
    setBlocks((prev) => {
      const withUpdatedSource = prev.map((b) =>
        b.id === updatedSourceBlock.id ? updatedSourceBlock : b
      )
      // Insert the new block just before the source block
      const sourceIdx = withUpdatedSource.findIndex((b) => b.id === updatedSourceBlock.id)
      if (sourceIdx === -1) return [...withUpdatedSource, newBlock]
      return [
        ...withUpdatedSource.slice(0, sourceIdx),
        newBlock,
        ...withUpdatedSource.slice(sourceIdx),
      ]
    })
  }

  function handleReorder(activeId: string, overId: string) {
    const sorted = [...sortedBlocks]
    const oldIdx = sorted.findIndex(b => b.id === activeId)
    const newIdx = sorted.findIndex(b => b.id === overId)
    if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return

    // Splice to get the new order
    const reordered = [...sorted]
    const [moved] = reordered.splice(oldIdx, 1)
    reordered.splice(newIdx, 0, moved)

    // Reassign sequential sort_order values for all visible blocks
    const updates: { id: string; sort_order: number }[] = []
    const updatedBlocks = new Map<string, number>()
    reordered.forEach((b, i) => {
      const newOrder = i + 1
      if (b.sort_order !== newOrder) {
        updates.push({ id: b.id, sort_order: newOrder })
      }
      updatedBlocks.set(b.id, newOrder)
    })

    // Update local state
    setBlocks(prev => prev.map(b => {
      const newOrder = updatedBlocks.get(b.id)
      return newOrder !== undefined ? { ...b, sort_order: newOrder } : b
    }))

    // Persist all changed sort_orders
    if (updates.length > 0) {
      const supabase = createClient()
      for (const { id, sort_order } of updates) {
        supabase.from('journal_blocks')
          .update({ sort_order })
          .eq('id', id)
          .then(({ error }) => { if (error) console.error(error) })
      }
    }
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

  // Filter blocks by active property filters.
  // Within a property: OR (block matches if it has ANY selected value for that property).
  // Across properties: AND (block must satisfy every property that has selections).
  // Workspace-scoped properties only apply to blocks from that workspace — blocks from
  // other workspaces pass through (aren't excluded by a property they don't have).
  const filteredBlocks = activePropertyFilters.size > 0
    ? (() => {
        const allProps = isGlobalView ? allProperties : propertiesForWorkspace(activeWorkspaceId)
        // Group selected filter value IDs by their parent property, including workspace scope
        const byProperty = new Map<string, { valueIds: string[]; includeNone: boolean; allValueIds: string[]; workspaceId: string | null }>()
        Array.from(activePropertyFilters).forEach(valueId => {
          // Handle "none::<propertyId>" pseudo-filters
          if (valueId.startsWith('none::')) {
            const propId = valueId.slice(6)
            const prop = allProps.find(p => p.id === propId)
            if (prop) {
              const existing = byProperty.get(propId)
              if (existing) { existing.includeNone = true }
              else { byProperty.set(propId, { valueIds: [], includeNone: true, allValueIds: prop.values.map(v => v.id), workspaceId: prop.workspace_id }) }
            }
            return
          }
          for (const prop of allProps) {
            if (prop.values.some(v => v.id === valueId)) {
              const existing = byProperty.get(prop.id)
              if (existing) {
                existing.valueIds.push(valueId)
              } else {
                byProperty.set(prop.id, { valueIds: [valueId], includeNone: false, allValueIds: prop.values.map(v => v.id), workspaceId: prop.workspace_id })
              }
              break
            }
          }
        })
        return blocks.filter(b => {
          const applied = blockProperties.get(b.id)
          const groups = Array.from(byProperty.values())
          return groups.every(({ valueIds, includeNone, allValueIds, workspaceId }) => {
            // If this is a workspace-scoped property and the block is from a different workspace,
            // this filter doesn't apply — the block passes through
            if (workspaceId !== null && b.workspace_id !== workspaceId) return true
            // Check if block has none of this property's values
            const hasNone = !applied || !allValueIds.some(vid => applied.has(vid))
            if (includeNone && hasNone) return true
            // Block must have at least one of the selected values for this property
            if (valueIds.length === 0) return false
            if (!applied) return false
            return valueIds.some(vid => applied.has(vid))
          })
        })
      })()
    : blocks

  // Derive sorted blocks for rendering
  const sortedBlocks = sortMode === 'manual'
    ? [...filteredBlocks].sort((a, b) => a.sort_order - b.sort_order
        || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    : sortMode === 'due_date'
    ? (() => {
        const tasks = filteredBlocks.filter(b => b.entry_type === 'task')
        const infos = filteredBlocks.filter(b => b.entry_type !== 'task')
        tasks.sort((a, b) => {
          const aDate = a.due_date ? new Date(a.due_date).getTime() : Infinity
          const bDate = b.due_date ? new Date(b.due_date).getTime() : Infinity
          if (aDate !== bDate) return aDate - bDate
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        })
        infos.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        return [...tasks, ...infos]
      })()
    : [...filteredBlocks].sort((a, b) => {
        switch (sortMode) {
          case 'created_asc':
            return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
              || (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
          case 'modified_desc':
            return (new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
              || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          case 'modified_asc':
            return (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
              || (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          default: // created_desc
            return (new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              || (new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        }
      })

  // Apply client-side filters to smart search results so UI filter toggles take effect
  const filteredSmartResults = (() => {
    if (!smartSearchResults) return null
    let results = smartSearchResults as Block[]
    // Entry type filter
    if (filterEntryTypes.size > 0 && filterEntryTypes.size < 2) {
      results = results.filter(b => filterEntryTypes.has(b.entry_type ?? 'info'))
    }
    // Status filter
    if (filterStatuses.size > 0) {
      results = results.filter(b => filterStatuses.has(b.status))
    }
    // Created date range filters
    if (filterDateFrom) {
      const from = filterDateFrom + 'T00:00:00'
      results = results.filter(b => b.created_at >= from)
    }
    if (filterDateTo) {
      const to = filterDateTo + 'T23:59:59'
      results = results.filter(b => b.created_at <= to)
    }
    // Modified date range filters
    if (filterModifiedFrom) {
      const from = filterModifiedFrom + 'T00:00:00'
      results = results.filter(b => b.updated_at >= from)
    }
    if (filterModifiedTo) {
      const to = filterModifiedTo + 'T23:59:59'
      results = results.filter(b => b.updated_at <= to)
    }
    // Due date range filters
    if (filterDueFrom) {
      const from = filterDueFrom + 'T00:00:00'
      results = results.filter(b => (b.due_date ?? '') >= from)
    }
    if (filterDueTo) {
      const to = filterDueTo + 'T23:59:59'
      results = results.filter(b => (b.due_date ?? '') <= to && b.due_date != null)
    }
    // Property filters: OR within property, AND across properties, workspace-scoped
    if (activePropertyFilters.size > 0) {
      const allProps = isGlobalView ? allProperties : propertiesForWorkspace(activeWorkspaceId)
      const byProperty = new Map<string, { valueIds: string[]; includeNone: boolean; allValueIds: string[]; workspaceId: string | null }>()
      Array.from(activePropertyFilters).forEach(valueId => {
        if (valueId.startsWith('none::')) {
          const propId = valueId.slice(6)
          const prop = allProps.find(p => p.id === propId)
          if (prop) {
            const existing = byProperty.get(propId)
            if (existing) { existing.includeNone = true }
            else { byProperty.set(propId, { valueIds: [], includeNone: true, allValueIds: prop.values.map(v => v.id), workspaceId: prop.workspace_id }) }
          }
          return
        }
        for (const prop of allProps) {
          if (prop.values.some(v => v.id === valueId)) {
            const existing = byProperty.get(prop.id)
            if (existing) { existing.valueIds.push(valueId) }
            else { byProperty.set(prop.id, { valueIds: [valueId], includeNone: false, allValueIds: prop.values.map(v => v.id), workspaceId: prop.workspace_id }) }
            break
          }
        }
      })
      results = results.filter(b => {
        const applied = blockProperties.get(b.id)
        const groups = Array.from(byProperty.values())
        return groups.every(({ valueIds, includeNone, allValueIds, workspaceId }) => {
          if (workspaceId !== null && b.workspace_id !== workspaceId) return true
          const hasNone = !applied || !allValueIds.some(vid => applied.has(vid))
          if (includeNone && hasNone) return true
          if (valueIds.length === 0) return false
          if (!applied) return false
          return valueIds.some(vid => applied.has(vid))
        })
      })
    }
    return results
  })()

  // ── Top bar colors ──────────────────────────────────────
  const barBg = activeScheme?.primary ?? '#FFFFFF'
  const barText = activeScheme?.textOnColor ?? '#1C1917'

  // Sync PWA title bar color with workspace scheme
  useEffect(() => {
    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      document.head.appendChild(meta)
    }
    meta.content = barBg
  }, [barBg])
  // For icon buttons in the top bar, derive a semi-transparent hover layer
  const btnInactiveClass = activeScheme
    ? 'hover:bg-white/10'
    : 'text-[#78716C] hover:bg-amber-50 hover:text-amber-700'

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header
        className="h-14 border-b flex items-center justify-between px-3 sm:px-6 flex-shrink-0 transition-colors duration-200 relative"
        style={{
          backgroundColor: barBg,
          color: barText,
          borderColor: activeScheme ? 'transparent' : '#E5E0D0',
        }}
      >
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          {/* Workspace switcher */}
          <div className="relative" ref={switcherContainerRef}>
          <button
            onClick={() => setSwitcherOpen(prev => !prev)}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${activeScheme ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
          >
            {isGlobalView ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <span className="text-sm font-medium text-gray-600">{selectedWsIds ? 'Selected Workspaces' : 'All Workspaces'}</span>
              </>
            ) : (
              <>
                {activeWorkspace?.emoji && <span className="w-6 h-6 rounded-full flex items-center justify-center text-sm flex-shrink-0" style={{ backgroundColor: activeScheme?.muted ?? '#F3F4F6' }}>{activeWorkspace.emoji}</span>}
                <span className="text-sm font-medium truncate max-w-[80px] sm:max-w-none">{activeWorkspace?.name}</span>
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
              onSelect={(id) => {
                if (id) {
                  // Selecting a specific workspace — keep select mode and selections intact
                  setActiveWorkspace(id)
                  setSwitcherOpen(false)
                } else {
                  // "All/Selected Workspaces" clicked — switch to global view with current selections
                  setActiveWorkspace(null)
                }
              }}
              onNewWorkspace={() => { setSwitcherOpen(false); setCreateModalOpen(true) }}
              onEditWorkspace={(ws) => { setSwitcherOpen(false); setEditingWorkspace(ws); setCreateModalOpen(true) }}
              onClose={() => setSwitcherOpen(false)}
              containerRef={switcherContainerRef}
              onReorder={reorderWorkspaces}
              selectMode={wsSelectMode}
              selectedIds={selectedWsIds}
              onToggleSelectMode={() => {
                if (wsSelectMode) {
                  // Turning off: remember selections, show all
                  rememberedWsIdsRef.current = selectedWsIds
                  setWsSelectMode(false)
                  setSelectedWsIds(null)
                } else {
                  // Turning on: restore prior selections
                  setWsSelectMode(true)
                  setSelectedWsIds(rememberedWsIdsRef.current)
                  setActiveWorkspace(null)
                }
              }}
              onToggleWsSelection={(wsId) => {
                setSelectedWsIds(prev => {
                  // If null (all selected), initialize with all IDs then toggle
                  const allIds = new Set(workspaces.map(w => w.id))
                  const current = prev ?? allIds
                  const next = new Set(current)
                  if (next.has(wsId)) {
                    // Don't allow unchecking the last one
                    if (next.size <= 1) return prev
                    next.delete(wsId)
                  } else {
                    next.add(wsId)
                  }
                  // If all are selected again, go back to null (all)
                  if (next.size === workspaces.length) return null
                  return next
                })
              }}
            />
          )}
          </div>
        </div>

        {/* PDA wordmark — true-centered */}
        <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-1.5 pointer-events-none" style={{ color: barText }}>
          <PdaIcon width={30} height={30} />
          <div className="flex flex-col gap-0">
            <span
              className="text-sm font-semibold leading-[1.2]"
              style={{ color: barText }}
            >
              PDA
            </span>
            <span
              className="text-[11px] leading-[1.2] opacity-60"
              style={{ color: barText }}
            >
              capture everything, organize later
            </span>
          </div>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0 ml-1">
          {/* Send Report (desktop only) */}
          <button
            onClick={() => setReportOpen(true)}
            title="Send report"
            className={`hidden sm:block p-1.5 rounded-lg transition-colors ${btnInactiveClass}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </button>
          {/* People button (desktop only) */}
          <button
            onClick={() => setPeopleModalOpen(true)}
            title="People"
            className={`hidden sm:block p-1.5 rounded-lg transition-colors ${btnInactiveClass}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </button>
          {/* User / Account button (desktop only) */}
          <button
            onClick={() => setPrefsOpen(true)}
            title="Account settings"
            className={`hidden sm:block p-1 rounded-lg transition-colors ${btnInactiveClass}`}
          >
            <div className="w-7 h-7 rounded-full bg-[#FEF3C7] flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-medium text-[#92400E]">
                {(displayName || email || '?')[0].toUpperCase()}
              </span>
            </div>
          </button>
          {/* Mobile overflow menu (three-dot) */}
          <div className="relative sm:hidden">
            <button
              onClick={() => setMobileMenuOpen(prev => !prev)}
              title="More options"
              className={`p-1.5 rounded-lg transition-colors ${btnInactiveClass}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
            {mobileMenuOpen && createPortal(
              <div className="fixed inset-0 z-[29]" onClick={() => setMobileMenuOpen(false)} />,
              document.body
            )}
            {mobileMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-[#E5E0D0] rounded-lg shadow-xl py-1 w-max">
                <button
                  onClick={() => { setReportOpen(true); setMobileMenuOpen(false) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-[#FFFEF7] whitespace-nowrap"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  Send Report
                </button>
                <button
                  onClick={() => { setPeopleModalOpen(true); setMobileMenuOpen(false) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-[#FFFEF7] whitespace-nowrap"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  People
                </button>
                <div className="border-t border-[#E5E0D0] my-1" />
                <button
                  onClick={() => { setPrefsOpen(true); setMobileMenuOpen(false) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-[#FFFEF7] whitespace-nowrap"
                >
                  <div className="w-5 h-5 rounded-full bg-[#FEF3C7] flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-medium text-[#92400E]">
                      {(displayName || email || '?')[0].toUpperCase()}
                    </span>
                  </div>
                  Account Settings
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Unified search & filter panel ── */}
      <div
        className="border-b px-3 sm:px-6 py-2.5 flex-shrink-0 transition-colors duration-200"
        style={{
          backgroundColor: activeScheme ? activeScheme.muted : '#FDFCF7',
          borderColor: activeScheme ? 'transparent' : '#E5E0D0',
        }}
      >
        {/* Row 1: Sort + Properties + search box + toggles */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* Sort dropdown — left side */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setSortDropdownOpen(prev => !prev)}
                onKeyDown={(e) => { if (e.key === 'Escape' && sortDropdownOpen) { e.stopPropagation(); setSortDropdownOpen(false) } }}
                title="Sort options"
                className={`p-1 rounded-lg transition-colors flex items-center gap-1 ${sortMode === 'manual' ? 'text-gray-400 hover:text-gray-600' : 'text-amber-700'}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M3 12h12M3 18h6" />
                </svg>
                {sortMode === 'manual' ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <circle cx="9" cy="6" r="2" /><circle cx="15" cy="6" r="2" />
                    <circle cx="9" cy="12" r="2" /><circle cx="15" cy="12" r="2" />
                    <circle cx="9" cy="18" r="2" /><circle cx="15" cy="18" r="2" />
                  </svg>
                ) : sortMode === 'due_date' ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                ) : sortMode.startsWith('created') ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                )}
                {sortMode !== 'manual' && sortMode !== 'due_date' && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    {sortMode.endsWith('_desc') ? (
                      <path d="M12 4v16M5 13l7 7 7-7" />
                    ) : (
                      <path d="M12 20V4M5 11l7-7 7 7" />
                    )}
                  </svg>
                )}
              </button>
              {sortDropdownOpen && createPortal(
                <div className="fixed inset-0 z-[29]" onClick={() => setSortDropdownOpen(false)} />,
                document.body
              )}
              {sortDropdownOpen && (
                <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-[#E5E0D0] rounded-lg shadow-xl py-1 w-max">
                  {[
                    { mode: 'created_desc' as SortMode, label: 'Date Created — Newest First' },
                    { mode: 'created_asc' as SortMode, label: 'Date Created — Oldest First' },
                    { mode: 'modified_desc' as SortMode, label: 'Date Modified — Newest First' },
                    { mode: 'modified_asc' as SortMode, label: 'Date Modified — Oldest First' },
                    { mode: 'due_date' as SortMode, label: 'Due Date' },
                    { mode: 'manual' as SortMode, label: 'Manual (drag to reorder)' },
                  ].map(({ mode, label }) => (
                    <button
                      key={mode}
                      onClick={() => { saveSortMode(mode); setSortDropdownOpen(false) }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                        sortMode === mode
                          ? 'bg-amber-50 text-amber-800 font-medium'
                          : 'text-gray-700 hover:bg-[#FFFEF7]'
                      }`}
                    >
                      <span className="flex items-center gap-0.5 flex-shrink-0 w-[22px]">
                        {mode === 'manual' ? (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                            <circle cx="9" cy="6" r="2" /><circle cx="15" cy="6" r="2" />
                            <circle cx="9" cy="12" r="2" /><circle cx="15" cy="12" r="2" />
                            <circle cx="9" cy="18" r="2" /><circle cx="15" cy="18" r="2" />
                          </svg>
                        ) : mode === 'due_date' ? (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                        ) : (
                          <>
                            {mode.startsWith('created') ? (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                              </svg>
                            ) : (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                              </svg>
                            )}
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              {mode.endsWith('_desc') ? (
                                <path d="M12 4v16M5 13l7 7 7-7" />
                              ) : (
                                <path d="M12 20V4M5 11l7-7 7 7" />
                              )}
                            </svg>
                          </>
                        )}
                      </span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Expand/Collapse feed toggle */}
            <button
              onClick={() => {
                const next = !feedCollapsed
                setFeedCollapsed(next)
                localStorage.setItem(FEED_COLLAPSED_KEY, String(next))
              }}
              title={feedCollapsed ? 'Click to expand cards' : 'Click to collapse cards'}
              className={`flex-shrink-0 p-1 rounded-lg transition-colors ${feedCollapsed ? 'text-gray-400 hover:text-gray-600' : 'text-amber-700'}`}
            >
              {feedCollapsed ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
            {/* Manage Properties button — before property pills */}
            <button
              onClick={() => setPropsManagerOpen(true)}
              title="Manage properties"
              className="flex-shrink-0 p-1 rounded-lg transition-colors text-gray-400 hover:text-gray-600"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
            </button>
            {/* Property filter pills */}
            <div className="flex-1 min-w-0">
              {(() => {
                // In global/multi-workspace view, show all properties; in single workspace, show that workspace's
                const allProps = isGlobalView
                  ? allProperties
                  : propertiesForWorkspace(activeWorkspaceId)
                const props = advancedOpen
                  ? allProps
                  : allProps.filter(p => p.pinned_in_filter_bar)
                return props.length > 0 ? (
                  <PropertyFilterBar
                    properties={props}
                    activeFilters={activePropertyFilters}
                    onToggleFilter={togglePropertyFilter}
                    onClearFilters={clearPropertyFilters}
                    showPinToggle={advancedOpen}
                    onTogglePin={advancedOpen ? async (propertyId, pinned) => {
                      const supabase = createClient()
                      await supabase.from('properties').update({ pinned_in_filter_bar: pinned }).eq('id', propertyId)
                    } : undefined}
                  />
                ) : null
              })()}
            </div>
          </div>
          {/* Search input + toggles */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:flex-none sm:w-64">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={searchMode === 'smart' ? "Search\u2026 (Ctrl+K)" : "Filter\u2026 (Ctrl+K)"}
                className={`w-full pl-7 pr-7 py-1 text-xs rounded-md border outline-none transition-colors text-gray-900 placeholder-gray-400 bg-white ${smartSearchLoading ? 'animate-pulse' : ''}`}
                style={{
                  borderColor: smartSearchLoading ? '#F59E0B' : (hasActiveSearch ? '#F59E0B' : '#E5E0D0'),
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setSearchText(''); searchInputRef.current?.blur() }
                  if (e.key === 'Enter') { setDebouncedSearch(searchText); setSearchNonce(n => n + 1) }
                }}
              />
              {searchText && (
                <button
                  onClick={() => setSearchText('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              )}
            </div>
            {/* Expand/collapse filters toggle */}
            <button
              onClick={toggleAdvanced}
              className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-gray-600 transition-colors"
              title={advancedOpen ? 'Collapse filters' : 'Expand filters'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
              </svg>
            </button>
            {/* Focus panel toggle */}
            <button
              onClick={togglePanel}
              title={panelOpen ? 'Close focus panel' : 'Open focus panel'}
              className={`flex-shrink-0 p-1 rounded-lg transition-colors ${panelOpen ? 'text-amber-700' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="15" y1="3" x2="15" y2="21" />
              </svg>
            </button>
          </div>
        </div>

        {/* Row 2 (expanded): Type, Status, Date, Search mode, Clear filters */}
        {advancedOpen && (
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap text-[11px] mt-2.5 pt-2.5 border-t border-[#EDE9DB]">
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400 font-medium">Type:</span>
              {([['info', 'Info'], ['task', 'Task']] as const).map(([t, label]) => (
                <button key={t} onClick={() => setFilterEntryTypes(prev => {
                  const next = new Set(prev)
                  if (next.has(t)) { if (next.size > 1) next.delete(t) } else next.add(t)
                  return next
                })}
                  className={`px-2 py-0.5 rounded-full border text-[11px] font-medium transition-all ${filterEntryTypes.has(t) ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400 font-medium">Status:</span>
              {([['active', 'Open', ''], ['archived', 'Archived', 'Includes completed tasks'], ['deleted', 'Deleted', '']] as const).map(([s, label, tip]) => (
                <button key={s} onClick={() => setFilterStatuses(prev => {
                  const next = new Set(prev)
                  if (next.has(s)) { if (next.size > 1) next.delete(s) } else next.add(s)
                  return next
                })}
                  title={tip || undefined}
                  className={`px-2 py-0.5 rounded-full border text-[11px] font-medium transition-all ${filterStatuses.has(s) ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  {label}
                </button>
              ))}
            </div>
            {/* Assignee filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400 font-medium">Assignee:</span>
              <select
                value={filterAssignee ?? ''}
                onChange={(e) => setFilterAssignee(e.target.value || null)}
                className={`px-2 py-0.5 rounded-full border text-[11px] font-medium transition-all cursor-pointer outline-none ${
                  filterAssignee ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <option value="">Any</option>
                <option value="me">Me</option>
                <option value="others">All Others</option>
                <option disabled>──────────</option>
                {peopleList.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            {/* Date range filters */}
            {([
              { label: 'Created', fromId: 'filter-date-from', toId: 'filter-date-to', fromVal: filterDateFrom, toVal: filterDateTo, setFrom: setFilterDateFrom, setTo: setFilterDateTo, showWhen: null },
              { label: 'Modified', fromId: 'filter-mod-from', toId: 'filter-mod-to', fromVal: filterModifiedFrom, toVal: filterModifiedTo, setFrom: setFilterModifiedFrom, setTo: setFilterModifiedTo, showWhen: null },
              { label: 'Start', fromId: 'filter-start-from', toId: 'filter-start-to', fromVal: filterStartFrom, toVal: filterStartTo, setFrom: setFilterStartFrom, setTo: setFilterStartTo, showWhen: null },
              { label: 'Due', fromId: 'filter-due-from', toId: 'filter-due-to', fromVal: filterDueFrom, toVal: filterDueTo, setFrom: setFilterDueFrom, setTo: setFilterDueTo, showWhen: null },
              { label: 'Archived / Done', fromId: 'filter-arch-from', toId: 'filter-arch-to', fromVal: filterArchivedFrom, toVal: filterArchivedTo, setFrom: setFilterArchivedFrom, setTo: setFilterArchivedTo, showWhen: 'archived' as const },
              { label: 'Deleted', fromId: 'filter-del-from', toId: 'filter-del-to', fromVal: filterDeletedFrom, toVal: filterDeletedTo, setFrom: setFilterDeletedFrom, setTo: setFilterDeletedTo, showWhen: 'deleted' as const },
            ] as const).filter(({ showWhen }) => !showWhen || filterStatuses.has(showWhen)).map(({ label, fromId, toId, fromVal, toVal, setFrom, setTo }) => {
              const invalid = !!(fromVal && toVal && fromVal > toVal)
              return (
              <div key={label} className="flex items-center gap-1.5">
                <span className="text-gray-400 font-medium">{label}:</span>
                <div className="relative flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { (document.getElementById(fromId) as HTMLInputElement)?.showPicker?.() }}
                    className={`cursor-pointer ${invalid ? 'text-red-400' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  </button>
                  <input
                    id={fromId}
                    type="date"
                    value={fromVal}
                    onChange={(e) => setFrom(e.target.value)}
                    className="absolute inset-0 opacity-0 w-full h-full pointer-events-none"
                    tabIndex={-1}
                  />
                  <span
                    className={`text-[11px] cursor-pointer select-none ${invalid ? 'text-red-500 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
                    onClick={() => { (document.getElementById(fromId) as HTMLInputElement)?.showPicker?.() }}
                  >
                    {fromVal
                      ? formatDatePart(new Date(fromVal + 'T00:00:00'), dateFormat)
                      : <span className="text-gray-300">from</span>
                    }
                  </span>
                  {fromVal && (
                    <button onClick={() => setFrom('')} className="p-0.5 text-gray-300 hover:text-red-400 transition-colors">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  )}
                </div>
                <span className={invalid ? 'text-red-300' : 'text-gray-300'}>–</span>
                <div className="relative flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { (document.getElementById(toId) as HTMLInputElement)?.showPicker?.() }}
                    className={`cursor-pointer ${invalid ? 'text-red-400' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  </button>
                  <input
                    id={toId}
                    type="date"
                    value={toVal}
                    onChange={(e) => setTo(e.target.value)}
                    className="absolute inset-0 opacity-0 w-full h-full pointer-events-none"
                    tabIndex={-1}
                  />
                  <span
                    className={`text-[11px] cursor-pointer select-none ${invalid ? 'text-red-500 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
                    onClick={() => { (document.getElementById(toId) as HTMLInputElement)?.showPicker?.() }}
                  >
                    {toVal
                      ? formatDatePart(new Date(toVal + 'T00:00:00'), dateFormat)
                      : <span className="text-gray-300">to</span>
                    }
                  </span>
                  {toVal && (
                    <button onClick={() => setTo('')} className="p-0.5 text-gray-300 hover:text-red-400 transition-colors">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  )}
                </div>
              </div>
              )
            })}
            {/* Search mode toggle */}
            <div className="flex items-center bg-gray-100 rounded-md p-0.5">
              <button
                type="button"
                onClick={() => setSearchMode('smart')}
                title="AI-powered search: understands intent, synonyms, and natural language queries"
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  searchMode === 'smart'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Smart
              </button>
              <button
                type="button"
                onClick={() => setSearchMode('exact')}
                title="Exact text match: finds entries containing the precise words you type"
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  searchMode === 'exact'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Exact
              </button>
            </div>
            {hasNonDefaultFilters && (
              <button onClick={() => { setFilterEntryTypes(new Set(['info', 'task'])); setFilterStatuses(new Set(['active'])); setFilterDateFrom(''); setFilterDateTo(''); setFilterModifiedFrom(''); setFilterModifiedTo(''); setFilterDueFrom(''); setFilterDueTo(''); setFilterStartFrom(''); setFilterStartTo(''); setFilterArchivedFrom(''); setFilterArchivedTo(''); setFilterDeletedFrom(''); setFilterDeletedTo(''); setFilterAssignee(null) }}
                className="text-[11px] text-gray-400 hover:text-gray-600 underline">
                Clear
              </button>
            )}
          </div>
        )}

        {/* Hidden filters indicator (when collapsed + filters active) */}
        {!advancedOpen && hasNonDefaultFilters && (() => {
          let count = 0
          if (filterEntryTypes.size < 2) count++
          if (filterStatuses.size !== 1 || !filterStatuses.has('active')) count++
          if (filterDateFrom) count++
          if (filterDateTo) count++
          if (filterModifiedFrom) count++
          if (filterModifiedTo) count++
          if (filterDueFrom) count++
          if (filterDueTo) count++
          if (filterArchivedFrom) count++
          if (filterArchivedTo) count++
          if (filterDeletedFrom) count++
          if (filterDeletedTo) count++
          if (filterAssignee) count++
          return (
            <div className="flex items-center gap-2 text-[11px] text-amber-700 mt-2 pt-2 border-t border-[#EDE9DB]">
              <span>{count} hidden filter{count !== 1 ? 's' : ''} applied</span>
              <button
                onClick={() => { setFilterEntryTypes(new Set(['info', 'task'])); setFilterStatuses(new Set(['active'])); setFilterDateFrom(''); setFilterDateTo(''); setFilterModifiedFrom(''); setFilterModifiedTo(''); setFilterDueFrom(''); setFilterDueTo(''); setFilterStartFrom(''); setFilterStartTo(''); setFilterArchivedFrom(''); setFilterArchivedTo(''); setFilterDeletedFrom(''); setFilterDeletedTo(''); setFilterAssignee(null) }}
                className="text-amber-600 hover:text-amber-800 underline"
              >
                Clear all filters
              </button>
            </div>
          )
        })()}

        {/* Row 3: Search results status (when active search) */}
        {debouncedSearch && (
          <div className="flex items-center gap-2 text-xs text-gray-500 mt-2 pt-2 border-t border-[#EDE9DB]">
            {searchMode === 'smart' ? (
              smartSearchLoading ? (
                <span>Searching&hellip;</span>
              ) : filteredSmartResults ? (
                <>
                  <span>{filteredSmartResults.length} result{filteredSmartResults.length !== 1 ? 's' : ''} for &ldquo;{debouncedSearch}&rdquo;</span>
                  {aiParsedInfo?.reasoning && (
                    <span className="text-[10px] text-gray-400 italic ml-1">&mdash; {aiParsedInfo.reasoning}</span>
                  )}
                  <button onClick={() => setSearchText('')} className="text-amber-600 hover:text-amber-800 underline ml-auto">Clear search</button>
                </>
              ) : null
            ) : (
              loading ? (
                <span>Searching&hellip;</span>
              ) : (
                <>
                  <span>{blocks.length} result{blocks.length !== 1 ? 's' : ''} for &ldquo;{debouncedSearch}&rdquo;</span>
                  <button onClick={() => setSearchText('')} className="text-amber-600 hover:text-amber-800 underline ml-auto">Clear search</button>
                </>
              )
            )}
          </div>
        )}
      </div>

      {/* API key missing banner */}
      {apiKeyMissing && !apiKeyBannerDismissed && (
        <div className="bg-amber-50 border-b border-amber-200 px-3 sm:px-6 py-2.5 flex items-center gap-3 flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
          </svg>
          <p className="text-xs text-amber-800 flex-1">
            AI features require an Anthropic API key. Add yours in Settings to get started.
          </p>
          <button
            onClick={() => { setPrefsOpen(true); setApiKeyBannerDismissed(true) }}
            className="text-xs font-medium text-amber-700 hover:text-amber-900 whitespace-nowrap px-2 py-1 rounded hover:bg-amber-100 transition-colors"
          >
            Go to Settings
          </button>
          <button
            onClick={() => setApiKeyBannerDismissed(true)}
            className="text-amber-400 hover:text-amber-600 flex-shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div
          className="flex-1 overflow-y-auto min-w-0 transition-colors duration-200"
          style={{ backgroundColor: isGlobalView ? '#FAFAF8' : (activeScheme?.muted ?? '#FAFAF8') }}
        >
          <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-4">
            <ContextFilter
              contexts={contexts}
              active={contextFilter}
              onChange={setContextFilter}
            />

            <JournalBlock
              userId={userId}
              contextId={contextFilter}
              onSaved={handleNewBlock}
              autosaveInterval={autosaveInterval}
              formattingVisible={formattingVisible}
              onToggleFormatting={toggleFormatting}
              people={peopleList}
              activePropertyFilters={activePropertyFilters}
            />

            <BlockFeed
              blocks={searchMode === 'smart' && filteredSmartResults ? filteredSmartResults : sortedBlocks}
              loading={searchMode === 'smart' ? smartSearchLoading : switching || !initialised}
              hasMore={searchMode === 'smart' && filteredSmartResults ? false : hasMore}
              onLoadMore={loadMore}
              onBlockUpdate={handleBlockUpdate}
              onBlockRemove={handleBlockRemove}
              onBlockArchived={handleBlockArchived}
              onSplitBlock={handleSplitBlock}
              sortMode={searchMode === 'smart' && filteredSmartResults ? 'created_desc' : sortMode}
              onReorder={handleReorder}
              autosaveInterval={autosaveInterval}
              formattingVisible={formattingVisible}
              onToggleFormatting={toggleFormatting}
              blockProperties={blockProperties}
              onBlockPropertiesChanged={handleBlockPropertiesChanged}
              searchHighlight={(aiParsedInfo?.searchTerms || debouncedSearch) || undefined}
              similarityScores={searchMode === 'smart' ? smartSearchScores : undefined}
              matchedChunks={searchMode === 'smart' ? smartSearchChunks : undefined}
              people={peopleList}
              feedCollapsed={feedCollapsed}
              collapseLines={feedCollapseLines}
              hasActiveFilters={
                !!debouncedSearch ||
                activePropertyFilters.size > 0 ||
                !!contextFilter ||
                filterEntryTypes.size < 2 ||
                !(filterStatuses.size === 1 && filterStatuses.has('active')) ||
                !!filterDateFrom || !!filterDateTo ||
                !!filterModifiedFrom || !!filterModifiedTo ||
                !!filterDueFrom || !!filterDueTo ||
                !!filterStartFrom || !!filterStartTo ||
                !!filterArchivedFrom || !!filterArchivedTo ||
                !!filterDeletedFrom || !!filterDeletedTo ||
                !!filterAssignee
              }
              totalUnfilteredCount={blocks.length}
              onClearAllFilters={() => {
                setSearchText('')
                setDebouncedSearch('')
                setActivePropertyFilters(new Set())
                setContextFilter(null)
                setFilterEntryTypes(new Set(['info', 'task']))
                setFilterStatuses(new Set(['active']))
                setFilterDateFrom('')
                setFilterDateTo('')
                setFilterModifiedFrom('')
                setFilterModifiedTo('')
                setFilterDueFrom('')
                setFilterDueTo('')
                setFilterStartFrom('')
                setFilterStartTo('')
                setFilterArchivedFrom('')
                setFilterArchivedTo('')
                setFilterDeletedFrom('')
                setFilterDeletedTo('')
                setFilterAssignee('')
                localStorage.removeItem(FILTERS_KEY)
              }}
              doneLoading={initialised && !switching && !loading}
            />

          </div>
        </div>

        {panelOpen && (
          <RightPanel
            userId={userId}
            refreshKey={blocks.length}
            onClose={() => setPanelOpen(false)}
            activePropertyFilters={activePropertyFilters}
            onTaskClick={async (blockId) => {
              let el = document.getElementById(`block-${blockId}`)
              if (!el) {
                // Block not yet loaded — fetch it and inject into the list
                const supabase = createClient()
                const { data } = await supabase
                  .from('journal_blocks')
                  .select('*')
                  .eq('id', blockId)
                  .single()
                if (data) {
                  setBlocks((prev) => {
                    if (prev.some(b => b.id === blockId)) return prev
                    // Insert in chronological order (descending by created_at)
                    const idx = prev.findIndex(b => b.created_at < data.created_at)
                    if (idx === -1) return [...prev, data as Block]
                    const next = [...prev]
                    next.splice(idx, 0, data as Block)
                    return next
                  })
                  // Wait for React to render the new block
                  await new Promise(r => setTimeout(r, 50))
                  el = document.getElementById(`block-${blockId}`)
                }
              }
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                el.classList.add('ring-2', 'ring-amber-400')
                setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400'), 1500)
              }
            }}
          />
        )}
      </div>

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
          onDeleted={async (_deletedId, targetId) => {
            await Promise.all([refreshWorkspaces(), refetchProperties()])
            setActiveWorkspace(targetId)
            setCreateModalOpen(false)
            setEditingWorkspace(null)
          }}
        />
      )}

      <UserPreferencesPanel
        email={email}
        displayName={displayName}
        userId={userId}
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        onSyncIntervalChange={(s) => setSyncInterval(Math.max(MIN_SYNC_INTERVAL, s))}
        feedCollapseLines={feedCollapseLines}
        onFeedCollapseLinesChange={(lines) => setFeedCollapseLines(lines)}
      />

      <PeopleModal open={peopleModalOpen} onClose={() => { setPeopleModalOpen(false); fetchPeople() }} userId={userId} />

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
  containerRef,
  onReorder,
  selectMode,
  selectedIds,
  onToggleSelectMode,
  onToggleWsSelection,
}: {
  workspaces: Workspace[]
  activeId: string | null
  onSelect: (id: string | null) => void
  onNewWorkspace: () => void
  onEditWorkspace: (ws: Workspace) => void
  onClose: () => void
  containerRef?: React.RefObject<HTMLDivElement | null>
  onReorder: (fromIndex: number, toIndex: number) => void
  selectMode: boolean
  selectedIds: Set<string> | null
  onToggleSelectMode: () => void
  onToggleWsSelection: (wsId: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      // Ignore clicks inside the dropdown or the trigger container (so toggle works)
      if (ref.current && ref.current.contains(target)) return
      if (containerRef?.current && containerRef.current.contains(target)) return
      onClose()
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
      className="absolute top-full left-0 mt-1 min-w-64 w-max max-w-sm bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50"
    >
      <div className={`flex items-center px-3 py-2 transition-colors ${
        activeId === null && !selectMode ? 'bg-amber-50 text-amber-800' : activeId === null && selectMode ? 'bg-amber-50/50 text-amber-800' : 'text-gray-900 hover:bg-gray-50'
      }`}>
        <button
          onClick={() => { onSelect(null); onClose() }}
          className="flex items-center gap-3 flex-1 text-sm text-left"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-gray-400">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span className="flex-1">{selectMode ? 'Selected Workspaces' : 'All Workspaces'}</span>
        </button>
        <div className="flex items-center bg-gray-100 rounded-md p-0.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => { if (!selectMode) onToggleSelectMode() }}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              selectMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Select
          </button>
          <button
            onClick={() => { if (selectMode) onToggleSelectMode() }}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              !selectMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            All
          </button>
        </div>
      </div>

      {workspaces.length > 0 && <div className="h-px bg-gray-100 my-1" />}

      {workspaces.map((ws, i) => {
        const scheme = workspaceColorSchemes.find(s => s.key === ws.color_scheme)
        return (
          <div
            key={ws.id}
            className={`flex items-center group/ws ${dropIndex === i && dragIndex !== null && dragIndex !== i ? 'border-t-2 border-amber-400' : ''}`}
            draggable
            onDragStart={(e) => {
              setDragIndex(i)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDropIndex(i)
            }}
            onDragLeave={() => setDropIndex(null)}
            onDrop={(e) => {
              e.preventDefault()
              if (dragIndex !== null && dragIndex !== i) {
                onReorder(dragIndex, i)
              }
              setDragIndex(null)
              setDropIndex(null)
            }}
            onDragEnd={() => { setDragIndex(null); setDropIndex(null) }}
            style={dragIndex === i ? { opacity: 0.4 } : undefined}
          >
            {/* Drag handle */}
            <div className="pl-1.5 pr-0 py-2 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 opacity-0 group-hover/ws:opacity-100 transition-opacity flex-shrink-0">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="8" cy="4" r="2" /><circle cx="16" cy="4" r="2" />
                <circle cx="8" cy="12" r="2" /><circle cx="16" cy="12" r="2" />
                <circle cx="8" cy="20" r="2" /><circle cx="16" cy="20" r="2" />
              </svg>
            </div>
            <button
              onClick={() => onSelect(ws.id)}
              className={`flex-1 flex items-center gap-3 pl-1 pr-3 py-2 text-sm text-left transition-colors ${
                !selectMode && activeId === ws.id ? 'bg-amber-50 text-amber-800' : 'text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-sm" style={{ backgroundColor: workspaceColorSchemes.find(s => s.key === ws.color_scheme)?.muted ?? '#F3F4F6' }}>{ws.emoji || '\u2022'}</span>
              <span className="flex-1 truncate">
                {ws.name}
                {ws.is_default && <span className="text-[10px] text-gray-400 ml-1">(Default)</span>}
              </span>
              {selectMode ? (
                <span
                  onClick={(e) => { e.stopPropagation(); onToggleWsSelection(ws.id) }}
                  className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer"
                  style={{
                    borderColor: scheme?.primary ?? '#D1D5DB',
                    backgroundColor: (!selectedIds || selectedIds.has(ws.id)) ? (scheme?.primary ?? '#6B7280') : 'transparent',
                  }}
                >
                  {(!selectedIds || selectedIds.has(ws.id)) && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </span>
              ) : scheme && (
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={splitSchemeStyle(scheme)}
                />
              )}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onEditWorkspace(ws) }}
              className="px-2 py-1 text-[10px] text-gray-400 hover:text-amber-600 opacity-100 sm:opacity-0 group-hover/ws:opacity-100 transition-opacity"
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
  onDeleted,
  editingWorkspace,
  allWorkspaces,
}: {
  userId: string
  onClose: () => void
  onCreated: (ws: Workspace) => void
  onDeleted?: (deletedId: string, targetId: string) => void
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const currentDefault = allWorkspaces?.find(w => w.is_default && w.id !== editingWorkspace?.id)
  const otherWorkspaces = allWorkspaces?.filter(w => w.id !== editingWorkspace?.id) ?? []
  const inputRef = useRef<HTMLInputElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Close emoji picker on click outside (composedPath crosses shadow DOM boundaries)
  // Also handles modal backdrop dismiss — we use native listeners because React portal
  // events bubble through the React tree, making React onMouseDown unreliable.
  const modalRef = useRef<HTMLDivElement>(null)
  const showEmojiPickerRef = useRef(showEmojiPicker)
  showEmojiPickerRef.current = showEmojiPicker
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const path = e.composedPath()
      const insideEmojiPicker = path.some(el =>
        (el as HTMLElement).tagName === 'EM-EMOJI-PICKER' ||
        (emojiPickerRef.current && el === emojiPickerRef.current)
      )
      if (insideEmojiPicker) return // always ignore clicks inside emoji picker

      const insideEmojiButton = emojiButtonRef.current && path.includes(emojiButtonRef.current)
      if (showEmojiPickerRef.current && !insideEmojiButton) {
        setShowEmojiPicker(false)
        return
      }

      // If click is outside the modal white box, close the modal
      const insideModal = modalRef.current && path.includes(modalRef.current)
      if (!insideModal) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])


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
          sort_order: (allWorkspaces ?? []).reduce((max, w) => Math.max(max, w.sort_order ?? 0), 0) + 1,
        })
        .select('*')
        .single()
      if (error || !data) { console.error(error); setSaving(false); return }
      onCreated(data as Workspace)
    }
  }

  async function handleDelete() {
    if (!editingWorkspace || !deleteTargetId || deleting) return
    setDeleting(true)
    const supabase = createClient()

    // Move all entries to target workspace
    const { error: moveBlocksErr } = await supabase
      .from('journal_blocks')
      .update({ workspace_id: deleteTargetId })
      .eq('workspace_id', editingWorkspace.id)
    if (moveBlocksErr) { console.error(moveBlocksErr); setDeleting(false); return }

    // Move workspace-scoped properties, renaming on collision
    const { data: srcProps } = await supabase
      .from('properties')
      .select('id, name')
      .eq('workspace_id', editingWorkspace.id)
    const { data: destProps } = await supabase
      .from('properties')
      .select('id, name, workspace_id')
      .or(`workspace_id.eq.${deleteTargetId},workspace_id.is.null`)
    const destNames = new Set((destProps ?? []).map(p => p.name.toLowerCase()))
    for (const prop of (srcProps ?? [])) {
      const updates: Record<string, string> = { workspace_id: deleteTargetId }
      if (destNames.has(prop.name.toLowerCase())) {
        updates.name = `${prop.name} (From ${editingWorkspace.name})`
      }
      const { error } = await supabase.from('properties').update(updates).eq('id', prop.id)
      if (error) { console.error(error); setDeleting(false); return }
    }

    // If this was the default workspace, make the target the default
    if (editingWorkspace.is_default) {
      await supabase.from('workspaces').update({ is_default: true }).eq('id', deleteTargetId)
    }

    // Delete the workspace
    const { error: deleteErr } = await supabase
      .from('workspaces')
      .delete()
      .eq('id', editingWorkspace.id)
    if (deleteErr) { console.error(deleteErr); setDeleting(false); return }

    onDeleted?.(editingWorkspace.id, deleteTargetId)
  }

  const selectedScheme = workspaceColorSchemes.find(s => s.key === colorScheme)!

  return (
    <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4">
      <div
        ref={modalRef}
        className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col overflow-visible"
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
                  style={splitSchemeStyle(s)}
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

        {/* Delete workspace link */}
        {isEditing && otherWorkspaces.length > 0 && (
          <div className="px-5 pb-1">
            <button
              onClick={() => { setDeleteTargetId(otherWorkspaces[0]?.id ?? null); setShowDeleteConfirm(true) }}
              className="text-xs text-red-400 hover:text-red-600 transition-colors"
            >
              Delete this workspace...
            </button>
          </div>
        )}

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
          style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div ref={emojiPickerRef} style={{ borderRadius: 12, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
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
                autoFocus={true}
              />
            </Suspense>
          </div>
        </div>,
        document.body
      )}

      {showDeleteConfirm && editingWorkspace && createPortal(
        <div className="fixed inset-0 bg-black/40 z-[100000] flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowDeleteConfirm(false) }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm" onMouseDown={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Delete &ldquo;{editingWorkspace.name}&rdquo;?</p>
                <p className="text-xs text-gray-500 mt-1">
                  This cannot be undone. All entries and custom properties will be moved to the workspace you choose below.
                </p>
              </div>
            </div>

            <div className="px-5 pb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">Move everything to:</label>
              <select
                value={deleteTargetId ?? ''}
                onChange={(e) => setDeleteTargetId(e.target.value)}
                className="w-full px-3 py-1.5 text-sm text-gray-900 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-red-300"
              >
                {otherWorkspaces.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.emoji ? `${w.emoji} ` : ''}{w.name}{w.is_default ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={!deleteTargetId || deleting}
                className="px-4 py-1.5 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting...' : 'Delete Workspace'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
