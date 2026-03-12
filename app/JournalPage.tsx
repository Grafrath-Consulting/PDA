'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Block, Context } from './types'
import { JournalBlock } from './components/JournalBlock'
import { BlockFeed } from './components/BlockFeed'
import { ContextFilter } from './components/ContextFilter'
import { ArchivedSection } from './components/ArchivedSection'
import { RightPanel } from './components/RightPanel'

const PAGE_SIZE = 20
const PANEL_STORAGE_KEY = 'journal-panel-open'
const FORMATTING_VISIBLE_KEY = 'tiptap-toolbar-visible'
const DEFAULT_AUTOSAVE_INTERVAL = 30

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

  const contextFilterRef = useRef(contextFilter)
  contextFilterRef.current = contextFilter

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

  // Fetch autosave preference
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('profiles')
      .select('autosave_interval_seconds')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (data?.autosave_interval_seconds) {
          setAutosaveInterval(data.autosave_interval_seconds)
        }
      })
  }, [userId])

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
    setBlocks((prev) => [block, ...prev])
  }

  function handleBlockUpdate(updated: Block) {
    setBlocks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
  }

  function handleBlockRemove(blockId: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId))
  }

  function handleSplitBlock(newBlock: Block) {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.created_at <= newBlock.created_at)
      if (idx === -1) return [...prev, newBlock]
      return [...prev.slice(0, idx), newBlock, ...prev.slice(idx)]
    })
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-6 flex-shrink-0">
        <h1 className="text-sm font-medium text-gray-900">Journal</h1>
        <button
          onClick={togglePanel}
          title={panelOpen ? 'Close focus panel' : 'Open focus panel'}
          className={`p-1.5 rounded-lg transition-colors ${
            panelOpen
              ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
              : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
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
              blocks={blocks}
              loading={loading && !initialised}
              hasMore={hasMore}
              onLoadMore={loadMore}
              onBlockUpdate={handleBlockUpdate}
              onBlockRemove={handleBlockRemove}
              onSplitBlock={handleSplitBlock}
              autosaveInterval={autosaveInterval}
              formattingVisible={formattingVisible}
              onToggleFormatting={toggleFormatting}
            />

            <ArchivedSection userId={userId} onRestored={handleNewBlock} />
          </div>
        </div>

        {panelOpen && <RightPanel userId={userId} />}
      </div>
    </div>
  )
}
