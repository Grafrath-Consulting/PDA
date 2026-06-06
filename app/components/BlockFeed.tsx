'use client'

import { useState, useEffect, useRef, Fragment } from 'react'
import { Block } from '../types'
import { JournalBlock } from './JournalBlock'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragEndEvent, DragStartEvent, DragOverlay,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Props {
  blocks: Block[]
  pinnedBlocks?: Block[]
  loading: boolean
  hasMore: boolean
  onLoadMore: () => void
  onBlockUpdate: (block: Block) => void
  onBlockRemove: (blockId: string) => void
  onBlockArchived?: (block: Block) => void
  onSplitBlock: (newBlock: Block, updatedSourceBlock: Block) => void
  sortMode: 'created_desc' | 'created_asc' | 'modified_desc' | 'modified_asc' | 'due_date' | 'manual' | 'property'
  onReorder: (activeId: string, overId: string) => void
  autosaveInterval?: number
  formattingVisible: boolean
  onToggleFormatting: () => void
  blockProperties?: Map<string, Set<string>>
  onBlockPropertiesChanged?: (blockId: string, newIds: Set<string>) => void
  // Cards pulled into the feed via an in-app card link. Rendered below their
  // source card (sourceId), or at the top when sourceId is null.
  pulledInCards?: { sourceId: string | null; block: Block }[]
  onPulledInUpdate?: (block: Block) => void
  onPulledInRemove?: (blockId: string) => void
  searchHighlight?: string | string[]
  similarityScores?: Record<string, number>
  matchedChunks?: Record<string, string>
  people?: { id: string; name: string }[]
  feedCollapsed?: boolean
  collapseLines?: number
  hasActiveFilters?: boolean
  totalUnfilteredCount?: number
  onClearAllFilters?: () => void
  doneLoading?: boolean
}

function SortableBlock({
  block,
  isDragActive,
  children,
}: {
  block: Block
  isDragActive: boolean
  children: React.ReactNode
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="relative group/sortable">
      {!isDragActive && (
        <div
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          className="absolute -left-6 top-1/2 -translate-y-1/2 z-10 w-5 h-8 flex items-center justify-center rounded text-gray-300 hover:text-gray-400 cursor-grab active:cursor-grabbing opacity-0 group-hover/sortable:opacity-100 transition-opacity"
        >
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
            <circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/>
            <circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/>
            <circle cx="3" cy="13" r="1.5"/><circle cx="7" cy="13" r="1.5"/>
          </svg>
        </div>
      )}
      {children}
    </div>
  )
}

export function BlockFeed({
  blocks,
  pinnedBlocks,
  loading,
  hasMore,
  onLoadMore,
  onBlockUpdate,
  onBlockRemove,
  onBlockArchived,
  onSplitBlock,
  sortMode,
  onReorder,
  autosaveInterval = 30,
  formattingVisible,
  onToggleFormatting,
  blockProperties,
  onBlockPropertiesChanged,
  pulledInCards,
  onPulledInUpdate,
  onPulledInRemove,
  searchHighlight,
  similarityScores,
  matchedChunks,
  people,
  feedCollapsed,
  collapseLines,
  hasActiveFilters,
  totalUnfilteredCount,
  onClearAllFilters,
  doneLoading,
}: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [activeBlock, setActiveBlock] = useState<Block | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: { distance: 8 }
  }))

  function handleDragStart(event: DragStartEvent) {
    const block = blocks.find(b => b.id === String(event.active.id))
    setActiveBlock(block ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveBlock(null)
    const { active, over } = event
    if (over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id))
    }
  }

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
      <div className="space-y-[14px]">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-[#E5E0D0] h-24 animate-pulse" />
        ))}
      </div>
    )
  }

  if (blocks.length === 0 && (pinnedBlocks?.length ?? 0) === 0) {
    // If filters/search reduced results to zero but there are blocks in the workspace
    if (hasActiveFilters && (totalUnfilteredCount ?? 0) > 0) {
      return (
        <div className="text-center py-16">
          <p className="text-sm text-gray-400">Nothing to show due to filters.</p>
          {onClearAllFilters && (
            <button onClick={onClearAllFilters} className="mt-2 text-sm text-amber-600 hover:text-amber-700 underline">
              Clear filters
            </button>
          )}
        </div>
      )
    }
    // Only show "Nothing here yet" if we've confirmed loading is done
    // (doneLoading is explicitly passed — not just !loading which can be stale)
    if (doneLoading) {
      return (
        <div className="text-center py-16 text-sm text-gray-400">
          Nothing here yet. Write something above.
        </div>
      )
    }
    // Still loading or transitioning — show nothing (new entry card is above)
    return null
  }

  function renderBlock(block: Block) {
    const blockHighlight = searchHighlight

    return (
      <JournalBlock
        key={block.id}
        block={block}
        onUpdate={onBlockUpdate}
        onRemove={onBlockRemove}
        onBlockArchived={onBlockArchived}
        onSplitBlock={onSplitBlock}
        autosaveInterval={autosaveInterval}
        formattingVisible={formattingVisible}
        onToggleFormatting={onToggleFormatting}
        appliedPropertyIds={blockProperties?.get(block.id)}
        onPropertyChanged={onBlockPropertiesChanged ? (ids) => onBlockPropertiesChanged(block.id, ids) : undefined}
        similarityScore={similarityScores?.[block.id]}
        searchHighlight={blockHighlight}
        matchedChunk={matchedChunks?.[block.id]}
        people={people}
        feedCollapsed={feedCollapsed}
        collapseLines={collapseLines}
      />
    )
  }

  // Cards pulled into the feed via an in-app link, rendered indented below their
  // source card (or at the top when sourceId is null), bypassing filters/sort.
  function renderPulled(sourceId: string | null) {
    const items = (pulledInCards ?? []).filter(p => p.sourceId === sourceId)
    if (items.length === 0) return null
    return items.map((p) => (
      <div key={`pulled-${p.block.id}`} className="ml-4 border-l-2 border-amber-300 pl-3">
        <JournalBlock
          block={p.block}
          onUpdate={(b) => onPulledInUpdate?.(b)}
          onRemove={(id) => onPulledInRemove?.(id)}
          onSplitBlock={() => {}}
          autosaveInterval={autosaveInterval}
          formattingVisible={formattingVisible}
          onToggleFormatting={onToggleFormatting}
          appliedPropertyIds={blockProperties?.get(p.block.id)}
          people={people}
          feedCollapsed={feedCollapsed}
          collapseLines={collapseLines}
        />
      </div>
    ))
  }

  return (
    <>
      {/* Pulled-in cards with no source (deep link / cross-workspace) render at top */}
      {renderPulled(null) && (
        <div className="space-y-[14px] mb-[14px]">{renderPulled(null)}</div>
      )}

      {/* Pinned cards — always at the top, below the new-entry card. Ignore filters, search, and sort. */}
      {(pinnedBlocks?.length ?? 0) > 0 && (
        <div className="space-y-[14px] mb-[14px]">
          {pinnedBlocks!.map((block) => (
            <Fragment key={block.id}>
              {renderBlock(block)}
              {renderPulled(block.id)}
            </Fragment>
          ))}
        </div>
      )}

      {sortMode === 'manual' ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-[14px]">
              {blocks.map((block) => (
                <Fragment key={block.id}>
                  <SortableBlock block={block} isDragActive={!!activeBlock}>
                    {renderBlock(block)}
                  </SortableBlock>
                  {renderPulled(block.id)}
                </Fragment>
              ))}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeBlock && (
              <div className="opacity-90 shadow-xl rounded-xl">
                {renderBlock(activeBlock)}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="space-y-[14px]">
          {blocks.map((block) => (
            <Fragment key={block.id}>
              {renderBlock(block)}
              {renderPulled(block.id)}
            </Fragment>
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-4" />

      {!hasMore && blocks.length > 0 && (
        <p className="text-center text-xs text-gray-300 py-4">No more entries</p>
      )}
    </>
  )
}
