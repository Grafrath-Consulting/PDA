'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Block } from '../types'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function thirtyDaysAgo() {
  return new Date(Date.now() - THIRTY_DAYS_MS).toISOString()
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

interface Props {
  userId: string
  onRestored: (block: Block) => void
}

export function ArchivedSection({ userId, onRestored }: Props) {
  const [open, setOpen] = useState(false)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

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
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) as Block[]

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
    <div className="mt-6 pt-6 border-t border-gray-100">
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
                <div key={i} className="h-16 bg-gray-50 rounded-xl animate-pulse" />
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
                    : 'bg-gray-50 border-gray-100'
                }`}
              >
                <div className="flex items-start gap-3">
                  {block.content
                    ? <div className="tiptap-content text-sm text-gray-500 break-words leading-relaxed flex-1 min-w-0" dangerouslySetInnerHTML={{ __html: block.content }} />
                    : <p className="italic text-gray-300 text-sm flex-1 min-w-0">Empty</p>
                  }
                  <button
                    onClick={() => (isDeleted ? restore(block) : unarchive(block))}
                    className="flex-shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 mt-0.5 transition-colors"
                  >
                    {isDeleted ? 'Restore' : 'Unarchive'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  {isDeleted
                    ? `Deleted · ${formatDate(block.deleted_at!)}`
                    : `Archived · ${formatDate(block.created_at)}`}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
