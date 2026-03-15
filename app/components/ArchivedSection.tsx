'use client'

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Block } from '../types'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function thirtyDaysAgo() {
  return new Date(Date.now() - THIRTY_DAYS_MS).toISOString()
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

/** Sort key: deleted_at for deleted items, updated_at for archived items, falling back to created_at */
function actionTime(block: Block): number {
  const ts = block.deleted_at ?? block.updated_at ?? block.created_at
  return new Date(ts).getTime()
}

interface Props {
  userId: string
  onRestored: (block: Block) => void
}

export interface ArchivedSectionHandle {
  addBlock: (block: Block) => void
}

export const ArchivedSection = forwardRef<ArchivedSectionHandle, Props>(function ArchivedSection({ userId, onRestored }, ref) {
  const [open, setOpen] = useState(false)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Imperative API so JournalPage can push blocks here after archive/delete
  useImperativeHandle(ref, () => ({
    addBlock(block: Block) {
      setBlocks(prev => {
        if (prev.some(b => b.id === block.id)) return prev
        return [block, ...prev].sort(
          (a, b) => actionTime(b) - actionTime(a)
        )
      })
      setCount(prev => prev + 1)
    },
  }))

  // Fetch the total count on mount so the toggle button has a number
  useEffect(() => {
    const supabase = createClient()
    const cutoff = thirtyDaysAgo()

    Promise.all([
      supabase
        .from('journal_blocks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'archived')
        .is('deleted_at', null),
      supabase
        .from('journal_blocks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)
        .gte('deleted_at', cutoff),
    ]).then(([archived, deleted]) => {
      setCount((archived.count ?? 0) + (deleted.count ?? 0))
    })
  }, [userId])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const cutoff = thirtyDaysAgo()

    const [{ data: archived }, { data: deleted }] = await Promise.all([
      supabase
        .from('journal_blocks')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'archived')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('journal_blocks')
        .select('*')
        .eq('user_id', userId)
        .not('deleted_at', 'is', null)
        .gte('deleted_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    const combined = [...(archived ?? []), ...(deleted ?? [])]
      .sort((a, b) => actionTime(b) - actionTime(a)) as Block[]

    setBlocks(combined)
    setLoaded(true)
    setLoading(false)
  }

  function toggle() {
    if (!open) {
      if (!loaded) load()
      setOpen(true)
    } else {
      setOpen(false)
    }
  }

  function removeFromList(blockId: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId))
    setCount((prev) => Math.max(0, prev - 1))
  }

  async function unarchive(block: Block) {
    const supabase = createClient()
    await supabase
      .from('journal_blocks')
      .update({ status: 'unprocessed', is_archived: false })
      .eq('id', block.id)
    removeFromList(block.id)
    onRestored({ ...block, status: 'unprocessed', is_archived: false, deleted_at: null })
  }

  async function restore(block: Block) {
    const supabase = createClient()
    await supabase
      .from('journal_blocks')
      .update({ deleted_at: null, status: 'unprocessed', is_archived: false })
      .eq('id', block.id)
    removeFromList(block.id)
    onRestored({ ...block, status: 'unprocessed', is_archived: false, deleted_at: null })
  }

  if (count === 0) return null

  return (
    <div className="mt-6 pt-6 border-t border-[#E5E0D0]">
      <button
        onClick={toggle}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {open ? 'Hide Archived' : `Show Archived (${count})`}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {loading && (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-16 bg-[#FFFEF7] rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {!loading && blocks.length === 0 && (
            <p className="text-xs text-gray-400 py-2">Nothing here.</p>
          )}

          {blocks.map((block) => {
            const isDeleted = block.deleted_at !== null
            return (
              <div
                key={block.id}
                className={`rounded-xl border px-4 py-3 ${
                  isDeleted
                    ? 'bg-red-50 border-red-100'
                    : 'bg-[#FFFEF7] border-[#E5E0D0]'
                }`}
              >
                <div className="flex items-start gap-3">
                  {block.content
                    ? <div className="tiptap-content text-gray-500 break-words flex-1 min-w-0" dangerouslySetInnerHTML={{ __html: block.content }} />
                    : <p className="italic text-gray-300 text-sm flex-1 min-w-0">Empty</p>
                  }
                  <button
                    onClick={() => (isDeleted ? restore(block) : unarchive(block))}
                    className="flex-shrink-0 text-xs font-medium text-[#D97706] hover:text-[#92400E] mt-0.5 transition-colors"
                  >
                    {isDeleted ? 'Restore' : 'Unarchive'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  Created {formatDate(block.created_at)}
                  {block.updated_at !== block.created_at && (
                    <span> · Modified {formatDate(block.updated_at)}</span>
                  )}
                  {isDeleted
                    ? <span> · Deleted {formatDate(block.deleted_at!)}</span>
                    : <span> · Archived {formatDate(block.updated_at ?? block.created_at)}</span>
                  }
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
