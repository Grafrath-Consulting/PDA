'use client'

import { useState, useEffect, useRef } from 'react'
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
  loading: boolean
  hasMore: boolean
  onLoadMore: () => void
  onBlockUpdate: (block: Block) => void
  onBlockRemove: (blockId: string) => void
  onBlockArchived?: (block: Block) => void
  onSplitBlock: (newBlock: Block, updatedSourceBlock: Block) => void
  sortMode: 'created_desc' | 'manual'
  onReorder: (activeId: string, overId: string) => void
  autosaveInterval?: number
  formattingVisible: boolean
  onToggleFormatting: () => void
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
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-[#E5E0D0] h-24 animate-pulse" />
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

  function renderBlock(block: Block) {
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
      />
    )
  }

  return (
    <>
      {sortMode === 'manual' ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {blocks.map((block) => (
                <SortableBlock key={block.id} block={block} isDragActive={!!activeBlock}>
                  {renderBlock(block)}
                </SortableBlock>
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
        <div className="space-y-3">
          {blocks.map((block) => renderBlock(block))}
        </div>
      )}

      <div ref={sentinelRef} className="h-4" />

      {!hasMore && blocks.length > 0 && (
        <p className="text-center text-xs text-gray-300 py-4">No more entries</p>
      )}
    </>
  )
}
