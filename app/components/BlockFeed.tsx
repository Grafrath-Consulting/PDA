'use client'

import { useEffect, useRef } from 'react'
import { Block } from '../types'
import { BlockCard } from './BlockCard'

interface Props {
  blocks: Block[]
  loading: boolean
  hasMore: boolean
  onLoadMore: () => void
  onBlockUpdate: (block: Block) => void
  onBlockRemove: (blockId: string) => void
  onSplitBlock: (newBlock: Block) => void
  autosaveInterval?: number
}

export function BlockFeed({
  blocks,
  loading,
  hasMore,
  onLoadMore,
  onBlockUpdate,
  onBlockRemove,
  onSplitBlock,
  autosaveInterval = 30,
}: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) onLoadMore()
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore])

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 h-24 animate-pulse" />
        ))}
      </div>
    )
  }

  if (blocks.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-gray-400">
        Nothing here yet. Write something above.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {blocks.map((block) => (
        <BlockCard
          key={block.id}
          block={block}
          onUpdate={onBlockUpdate}
          onRemove={onBlockRemove}
          onSplitBlock={onSplitBlock}
          autosaveInterval={autosaveInterval}
        />
      ))}

      <div ref={sentinelRef} className="h-4" />

      {!hasMore && blocks.length > 0 && (
        <p className="text-center text-xs text-gray-300 py-4">No more entries</p>
      )}
    </div>
  )
}
