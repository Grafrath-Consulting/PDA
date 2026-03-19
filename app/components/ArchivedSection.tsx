'use client'

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Block } from '../types'

const PAGE_SIZE = 20
const LS_KEY = 'pda-archive-open'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

/** Strip HTML to plain text for preview */
function stripHTML(html: string | null): string {
  if (!html) return ''
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, '')
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent ?? ''
}

interface Props {
  userId: string
  activeWorkspaceId: string | null
  onRestored: (block: Block) => void
}

export interface ArchivedSectionHandle {
  addBlock: (block: Block) => void
}

export const ArchivedSection = forwardRef<ArchivedSectionHandle, Props>(
  function ArchivedSection({ userId, activeWorkspaceId, onRestored }, ref) {
    const [open, setOpen] = useState(false)

    // Hydrate from localStorage after mount to avoid SSR mismatch
    useEffect(() => {
      const saved = localStorage.getItem(LS_KEY)
      if (saved === 'true') { setOpen(true); if (!loaded) loadInitial() }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    const [blocks, setBlocks] = useState<Block[]>([])
    const [count, setCount] = useState(0)
    const [loading, setLoading] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(true)
    const [loaded, setLoaded] = useState(false)

    // Imperative API so JournalPage can push blocks here after archive
    useImperativeHandle(ref, () => ({
      addBlock(block: Block) {
        setBlocks(prev => {
          if (prev.some(b => b.id === block.id)) return prev
          return [block, ...prev]
        })
        setCount(prev => prev + 1)
      },
    }))

    // Build a workspace-scoped query for archived entries (not soft-deleted)
    const buildQuery = useCallback((supabase: ReturnType<typeof createClient>) => {
      let q = supabase
        .from('journal_blocks')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'archived')
        .is('deleted_at', null)
        .order('archived_at', { ascending: false, nullsFirst: false })

      if (activeWorkspaceId) {
        q = q.eq('workspace_id', activeWorkspaceId)
      }
      return q
    }, [userId, activeWorkspaceId])

    // Fetch count on mount and when workspace changes
    useEffect(() => {
      const supabase = createClient()
      let q = supabase
        .from('journal_blocks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'archived')
        .is('deleted_at', null)

      if (activeWorkspaceId) {
        q = q.eq('workspace_id', activeWorkspaceId)
      }

      q.then(({ count: c }) => setCount(c ?? 0))
    }, [userId, activeWorkspaceId])

    // Reset when workspace changes
    useEffect(() => {
      setBlocks([])
      setLoaded(false)
      setHasMore(true)
      if (open) loadInitial()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeWorkspaceId])

    async function loadInitial() {
      setLoading(true)
      const supabase = createClient()
      const { data } = await buildQuery(supabase).limit(PAGE_SIZE)
      const rows = (data ?? []) as Block[]
      setBlocks(rows)
      setHasMore(rows.length === PAGE_SIZE)
      setLoaded(true)
      setLoading(false)
    }

    async function loadMore() {
      if (loadingMore || !hasMore || blocks.length === 0) return
      setLoadingMore(true)

      // Cursor: archived_at of the last loaded entry
      const last = blocks[blocks.length - 1]
      const cursor = last.archived_at ?? last.updated_at ?? last.created_at

      const supabase = createClient()
      const { data } = await buildQuery(supabase)
        .lt('archived_at', cursor)
        .limit(PAGE_SIZE)

      const rows = (data ?? []) as Block[]
      setBlocks(prev => [...prev, ...rows])
      setHasMore(rows.length === PAGE_SIZE)
      setLoadingMore(false)
    }

    function toggle() {
      const next = !open
      setOpen(next)
      localStorage.setItem(LS_KEY, String(next))
      if (next && !loaded) loadInitial()
    }

    function removeFromList(blockId: string) {
      setBlocks(prev => prev.filter(b => b.id !== blockId))
      setCount(prev => Math.max(0, prev - 1))
    }

    async function restoreBlock(block: Block) {
      const supabase = createClient()
      await supabase
        .from('journal_blocks')
        .update({ status: 'active', is_archived: false, archived_at: null })
        .eq('id', block.id)
      removeFromList(block.id)
      onRestored({ ...block, status: 'active', is_archived: false, archived_at: null })
    }

    async function permanentDelete(block: Block) {
      if (!window.confirm('Permanently delete this entry? This cannot be undone.')) return
      const supabase = createClient()
      await supabase
        .from('journal_blocks')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', block.id)
      removeFromList(block.id)
    }

    return (
      <div className="mt-6 pt-6 border-t border-[#E5E0D0]">
        <button
          onClick={toggle}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          {open ? 'Hide archived' : `Show archived${count > 0 ? ` (${count})` : ''}`}
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
              <div className="text-center py-8">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-gray-300 mb-2">
                  <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
                </svg>
                <p className="text-sm text-gray-400">Nothing archived yet</p>
              </div>
            )}

            {blocks.map((block) => {
              const isCompletedTask = block.entry_type === 'task' && block.status === 'archived'
              const preview = stripHTML(block.content)
              return (
                <div
                  key={block.id}
                  className="rounded-xl border border-[#E5E0D0] bg-[#FFFEF7] px-4 py-3 opacity-60 hover:opacity-80 transition-opacity group"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Badge */}
                      <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mb-1 ${
                        isCompletedTask
                          ? 'bg-green-50 text-green-600'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {isCompletedTask ? 'Completed' : 'Archived'}
                      </span>
                      {preview
                        ? <p className="text-sm text-gray-500 line-clamp-2 break-words">{preview}</p>
                        : <p className="italic text-gray-300 text-sm">Empty</p>
                      }
                      <p className="text-[11px] text-gray-400 mt-1">
                        {block.archived_at
                          ? `Archived ${formatDate(block.archived_at)}`
                          : `Created ${formatDate(block.created_at)}`
                        }
                      </p>
                    </div>

                    {/* Actions — visible on hover */}
                    <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                      <button
                        onClick={() => restoreBlock(block)}
                        className="text-xs font-medium text-amber-600 hover:text-amber-800 transition-colors"
                      >
                        Restore
                      </button>
                      <span className="text-gray-200">·</span>
                      <button
                        onClick={() => permanentDelete(block)}
                        className="text-xs font-medium text-red-400 hover:text-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Load more */}
            {hasMore && blocks.length > 0 && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }
)
