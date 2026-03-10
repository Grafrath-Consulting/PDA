'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Block, Context } from './types'
import { Composer } from './components/Composer'
import { BlockFeed } from './components/BlockFeed'
import { ContextFilter } from './components/ContextFilter'

const PAGE_SIZE = 20

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
  const contextFilterRef = useRef(contextFilter)
  contextFilterRef.current = contextFilter

  // Fetch contexts once
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

  // Initial load
  useEffect(() => {
    fetchBlocks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Re-fetch when filter changes
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
      <header className="h-14 bg-white border-b border-gray-100 flex items-center px-6 flex-shrink-0">
        <h1 className="text-sm font-medium text-gray-900">Journal</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          <ContextFilter
            contexts={contexts}
            active={contextFilter}
            onChange={setContextFilter}
          />

          <Composer
            userId={userId}
            contextId={contextFilter}
            onSaved={handleNewBlock}
          />

          <BlockFeed
            blocks={blocks}
            loading={loading && !initialised}
            hasMore={hasMore}
            onLoadMore={loadMore}
            onBlockUpdate={handleBlockUpdate}
            onBlockRemove={handleBlockRemove}
            onSplitBlock={handleSplitBlock}
          />
        </div>
      </div>
    </div>
  )
}
