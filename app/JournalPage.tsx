'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Block, Context } from './types'
import { JournalBlock } from './components/JournalBlock'
import { BlockFeed } from './components/BlockFeed'
import { ContextFilter } from './components/ContextFilter'
import { ArchivedSection, ArchivedSectionHandle } from './components/ArchivedSection'
import { RightPanel } from './components/RightPanel'

const PAGE_SIZE = 20
const PANEL_STORAGE_KEY = 'journal-panel-open'
const FORMATTING_VISIBLE_KEY = 'tiptap-toolbar-visible'
const DEFAULT_AUTOSAVE_INTERVAL = 30
const SORT_MODE_KEY = 'journal-sort-mode'

type SortMode = 'created_desc' | 'manual'

interface Props {
  userId: string
}

export function JournalPage({ userId }: Props) {
  const [blocks, setBlocks] = useState<Block[]>([])
  const [contexts, setContexts] = useState<Context[]>([])
  const [contextFilter, setContextFilter] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [initialised, setInitialised] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [autosaveInterval, setAutosaveInterval] = useState(DEFAULT_AUTOSAVE_INTERVAL)
  const [formattingVisible, setFormattingVisible] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem(SORT_MODE_KEY)
      if (cached === 'manual' || cached === 'created_desc') return cached
    }
    return 'created_desc'
  })

  const contextFilterRef = useRef(contextFilter)
  contextFilterRef.current = contextFilter
  const archiveRef = useRef<ArchivedSectionHandle>(null)

  useEffect(() => {
    const saved = localStorage.getItem(PANEL_STORAGE_KEY)
    if (saved !== null) setPanelOpen(saved === 'true')
    const fmt = localStorage.getItem(FORMATTING_VISIBLE_KEY)
    if (fmt === 'true') setFormattingVisible(true)
  }, [])

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

    const supabase = createClient()
    let query = supabase
      .from('journal_blocks')
      .select('*')
      .eq('user_id', userId)
      .neq('status', 'archived')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)

    if (contextFilterRef.current) {
      query = query.eq('context_id', contextFilterRef.current)
    }
    if (cursor) {
      query = query.lt('created_at', cursor)
    }

    const { data, error } = await query
    if (error) { console.error(error); setLoading(false); return }

    const rows = (data ?? []) as Block[]
    if (cursor) {
      setBlocks((prev) => [...prev, ...rows])
    } else {
      setBlocks(rows)
    }
    setHasMore(rows.length === PAGE_SIZE)
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
  }, [contextFilter])

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

  // Derive sorted blocks for rendering
  const sortedBlocks = sortMode === 'manual'
    ? [...blocks].sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity))
    : [...blocks].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="h-14 bg-white border-b border-[#E5E0D0] flex items-center justify-between px-6 flex-shrink-0">
        <h1 className="text-sm font-medium text-gray-900">Journal</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => saveSortMode('created_desc')}
            title="Sort by newest first"
            className={`p-1.5 rounded-lg transition-colors ${
              sortMode === 'created_desc'
                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                : 'text-[#78716C] hover:bg-amber-50 hover:text-amber-700'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <button
            onClick={() => saveSortMode('manual')}
            title="Manual sort (drag to reorder)"
            className={`p-1.5 rounded-lg transition-colors ${
              sortMode === 'manual'
                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                : 'text-[#78716C] hover:bg-amber-50 hover:text-amber-700'
            }`}
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
            className={`p-1.5 rounded-lg transition-colors ${
              panelOpen
                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                : 'text-[#78716C] hover:bg-amber-50 hover:text-amber-700'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto min-w-0">
          <div className="px-6 py-6 space-y-4">
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
            />

            <BlockFeed
              blocks={sortedBlocks}
              loading={loading && !initialised}
              hasMore={hasMore}
              onLoadMore={loadMore}
              onBlockUpdate={handleBlockUpdate}
              onBlockRemove={handleBlockRemove}
              onBlockArchived={handleBlockArchived}
              onSplitBlock={handleSplitBlock}
              sortMode={sortMode}
              onReorder={handleReorder}
              autosaveInterval={autosaveInterval}
              formattingVisible={formattingVisible}
              onToggleFormatting={toggleFormatting}
            />

            <ArchivedSection ref={archiveRef} userId={userId} onRestored={handleNewBlock} />
          </div>
        </div>

        {panelOpen && <RightPanel userId={userId} />}
      </div>
    </div>
  )
}
