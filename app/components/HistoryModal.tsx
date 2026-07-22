'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sanitizeHtml } from '@/lib/sanitize'
import { BlockVersion } from '../types'

interface AttachmentEvent {
  id: string
  event_type: 'added' | 'deleted'
  filename: string
  file_size: number | null
  created_at: string
}

type TimelineEntry =
  | { kind: 'version'; data: BlockVersion; ts: number }
  | { kind: 'attachment'; data: AttachmentEvent; ts: number }

interface Props {
  blockId: string
  onClose: () => void
  onRevert: (content: string) => void
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function HistoryModal({ blockId, onClose, onRevert }: Props) {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase
        .from('block_versions')
        .select('*')
        .eq('block_id', blockId)
        .order('edited_at', { ascending: false }),
      supabase
        .from('attachment_events')
        .select('*')
        .eq('block_id', blockId)
        .order('created_at', { ascending: false }),
    ]).then(([versionsRes, eventsRes]) => {
      const versions: TimelineEntry[] = ((versionsRes.data ?? []) as BlockVersion[]).map(v => ({
        kind: 'version',
        data: v,
        ts: new Date(v.edited_at).getTime(),
      }))
      const events: TimelineEntry[] = ((eventsRes.data ?? []) as AttachmentEvent[]).map(e => ({
        kind: 'attachment',
        data: e,
        ts: new Date(e.created_at).getTime(),
      }))
      const merged = [...versions, ...events].sort((a, b) => b.ts - a.ts)
      setTimeline(merged)
      setLoading(false)
    })
  }, [blockId])

  return (
    <div
      className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[70vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E0D0]">
          <h3 className="text-sm font-semibold text-gray-900">Edit History</h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading && (
            <div className="space-y-3">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-16 bg-[#FFFEF7] rounded-lg animate-pulse" />
              ))}
            </div>
          )}

          {!loading && timeline.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No history for this block.</p>
          )}

          {timeline.map((entry, i) => {
            if (entry.kind === 'version') {
              const v = entry.data
              return (
                <div key={v.id} className="border-b border-gray-50 last:border-0 pb-4 last:pb-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs text-gray-400" suppressHydrationWarning>{formatDate(v.edited_at)}</span>
                    {i === timeline.length - 1 && entry.kind === 'version' && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">oldest saved</span>
                    )}
                    <button
                      onClick={() => v.content && onRevert(v.content)}
                      disabled={!v.content}
                      className="ml-auto text-xs text-amber-600 hover:text-amber-800 hover:bg-amber-50 px-2 py-0.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Revert to this
                    </button>
                  </div>
                  {v.content
                    ? <div className="tiptap-content text-gray-700" dangerouslySetInnerHTML={{ __html: sanitizeHtml(v.content) }} />
                    : <p className="text-gray-300 italic text-sm">(empty)</p>
                  }
                </div>
              )
            }

            // Attachment event
            const evt = entry.data
            const isDeleted = evt.event_type === 'deleted'
            return (
              <div
                key={evt.id}
                className={`flex items-center gap-3 border-b border-gray-50 last:border-0 pb-3 last:pb-0 ${
                  isDeleted ? 'opacity-60' : ''
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isDeleted ? 'bg-red-50 text-red-400' : 'bg-blue-50 text-blue-500'
                }`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700">
                    <span className="font-medium">{evt.filename}</span>
                    {' '}
                    <span className={isDeleted ? 'text-red-500' : 'text-green-600'}>
                      {isDeleted ? 'deleted' : 'attached'}
                    </span>
                    {evt.file_size ? <span className="text-gray-400 ml-1">({formatSize(evt.file_size)})</span> : null}
                  </p>
                  <p className="text-xs text-gray-400" suppressHydrationWarning>{formatDate(evt.created_at)}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
