'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BlockVersion } from '../types'

interface Props {
  blockId: string
  onClose: () => void
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export function HistoryModal({ blockId, onClose }: Props) {
  const [versions, setVersions] = useState<BlockVersion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('block_versions')
      .select('*')
      .eq('block_id', blockId)
      .order('edited_at', { ascending: false })
      .then(({ data }) => {
        setVersions((data ?? []) as BlockVersion[])
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
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
                <div key={i} className="h-16 bg-gray-50 rounded-lg animate-pulse" />
              ))}
            </div>
          )}

          {!loading && versions.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No edit history for this block.</p>
          )}

          {versions.map((v, i) => (
            <div key={v.id} className="border-b border-gray-50 last:border-0 pb-4 last:pb-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs text-gray-400">{formatDate(v.edited_at)}</span>
                {i === 0 && (
                  <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">oldest saved</span>
                )}
              </div>
              {v.content
                ? <div className="tiptap-content text-sm text-gray-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: v.content }} />
                : <p className="text-gray-300 italic text-sm">(empty)</p>
              }
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
