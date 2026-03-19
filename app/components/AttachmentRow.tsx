'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ImageLightbox } from './ImageLightbox'

// Signed URL expiry: 24 hours.
// Future improvement: regenerate signed URLs on page focus (via visibilitychange event)
// if we tighten security requirements and shorten the expiry window.
const SIGNED_URL_EXPIRY = 86400 // 24 hours in seconds

export interface Attachment {
  id: string
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  thumbnail_path: string | null
}

function isImage(mime: string | null): boolean {
  return !!mime && mime.startsWith('image/')
}

function fileIcon(mime: string | null) {
  if (mime?.startsWith('video/')) return '🎬'
  if (mime?.startsWith('audio/')) return '🎵'
  if (mime?.includes('pdf')) return '📄'
  if (mime?.includes('spreadsheet') || mime?.includes('excel') || mime?.includes('csv')) return '📊'
  if (mime?.includes('presentation') || mime?.includes('powerpoint')) return '📽'
  if (mime?.includes('word') || mime?.includes('document')) return '📝'
  if (mime?.includes('zip') || mime?.includes('compress') || mime?.includes('tar')) return '📦'
  return '📎'
}

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface Props {
  attachments: Attachment[]
  onDelete: (attachmentId: string, filePath: string) => void
  readOnly?: boolean
}

// Module-level cache so signed URLs survive component remounts
const urlCache = new Map<string, { url: string; expires: number }>()
const CACHE_MARGIN = 60_000 // refresh 1 minute before expiry

function getCachedUrl(key: string): string | null {
  const entry = urlCache.get(key)
  if (entry && entry.expires > Date.now() + CACHE_MARGIN) return entry.url
  return null
}

function setCachedUrl(key: string, url: string) {
  urlCache.set(key, { url, expires: Date.now() + SIGNED_URL_EXPIRY * 1000 })
}

export function AttachmentRow({ attachments, onDelete, readOnly }: Props) {
  const [lightboxSrc, setLightboxSrc] = useState<{ src: string; alt: string } | null>(null)
  // thumbUrls: for image thumbnails (small previews)
  // fullUrls: for non-image files and lightbox (fetched on demand)
  const [thumbUrls, setThumbUrls] = useState<Map<string, string>>(new Map())
  const [fullUrls, setFullUrls] = useState<Map<string, string>>(new Map())
  const fetchingRef = useRef<Set<string>>(new Set())

  // Generate signed URLs for thumbnails (images) and full files (non-images)
  useEffect(() => {
    const missing = attachments.filter(a => {
      const key = a.thumbnail_path ? `thumb:${a.id}` : `full:${a.id}`
      if (fetchingRef.current.has(key)) return false
      if (isImage(a.mime_type) && a.thumbnail_path) return !thumbUrls.has(a.id) && !getCachedUrl(`thumb:${a.id}`)
      return !fullUrls.has(a.id) && !getCachedUrl(`full:${a.id}`)
    })
    if (missing.length === 0) {
      // Populate from cache on mount
      const newThumbs = new Map(thumbUrls)
      const newFulls = new Map(fullUrls)
      let changed = false
      for (const a of attachments) {
        if (isImage(a.mime_type) && a.thumbnail_path && !newThumbs.has(a.id)) {
          const cached = getCachedUrl(`thumb:${a.id}`)
          if (cached) { newThumbs.set(a.id, cached); changed = true }
        }
        if (!newFulls.has(a.id)) {
          const cached = getCachedUrl(`full:${a.id}`)
          if (cached) { newFulls.set(a.id, cached); changed = true }
        }
      }
      if (changed) { setThumbUrls(newThumbs); setFullUrls(newFulls) }
      return
    }

    for (const a of missing) {
      const key = (isImage(a.mime_type) && a.thumbnail_path) ? `thumb:${a.id}` : `full:${a.id}`
      fetchingRef.current.add(key)
    }

    const supabase = createClient()
    Promise.all(
      missing.map(async (a) => {
        // For images with thumbnails, fetch the thumbnail URL for preview
        const path = (isImage(a.mime_type) && a.thumbnail_path) ? a.thumbnail_path : a.file_path
        const kind: 'thumb' | 'full' = (isImage(a.mime_type) && a.thumbnail_path) ? 'thumb' : 'full'
        const { data } = await supabase.storage
          .from('attachments')
          .createSignedUrl(path, SIGNED_URL_EXPIRY)
        const url = data?.signedUrl ?? ''
        if (url) setCachedUrl(`${kind}:${a.id}`, url)
        return { id: a.id, url, kind }
      })
    ).then((entries) => {
      const newThumbs = new Map(thumbUrls)
      const newFulls = new Map(fullUrls)
      for (const { id, url, kind } of entries) {
        if (kind === 'thumb') newThumbs.set(id, url)
        else newFulls.set(id, url)
      }
      setThumbUrls(newThumbs)
      setFullUrls(newFulls)
      for (const a of missing) {
        const key = (isImage(a.mime_type) && a.thumbnail_path) ? `thumb:${a.id}` : `full:${a.id}`
        fetchingRef.current.delete(key)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments])

  if (attachments.length === 0) return null

  // Get the display URL for an attachment (thumbnail for images, full for others)
  function displayUrl(a: Attachment): string | null {
    if (isImage(a.mime_type) && a.thumbnail_path) return thumbUrls.get(a.id) ?? getCachedUrl(`thumb:${a.id}`)
    return fullUrls.get(a.id) ?? getCachedUrl(`full:${a.id}`)
  }

  // Get or fetch the full-resolution URL for lightbox / download
  async function getFullUrl(a: Attachment): Promise<string | null> {
    const cached = fullUrls.get(a.id) ?? getCachedUrl(`full:${a.id}`)
    if (cached) return cached
    const supabase = createClient()
    const { data } = await supabase.storage.from('attachments').createSignedUrl(a.file_path, SIGNED_URL_EXPIRY)
    const url = data?.signedUrl ?? null
    if (url) {
      setCachedUrl(`full:${a.id}`, url)
      setFullUrls(prev => { const n = new Map(prev); n.set(a.id, url); return n })
    }
    return url
  }

  async function handleClick(a: Attachment) {
    if (isImage(a.mime_type)) {
      const url = await getFullUrl(a)
      if (url) setLightboxSrc({ src: url, alt: a.file_name })
    } else {
      const url = await getFullUrl(a)
      if (url) window.open(url, '_blank')
    }
  }

  function handleDelete(a: Attachment) {
    if (!window.confirm(`Delete "${a.file_name}"?`)) return
    onDelete(a.id, a.file_path)
  }

  return (
    <>
      {attachments.map((a) => {
          const url = displayUrl(a)
          if (isImage(a.mime_type)) {
            return (
              <div key={a.id} className="relative group/att">
                <button
                  title={a.file_name}
                  onClick={(e) => { e.stopPropagation(); handleClick(a) }}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                  className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200 hover:border-gray-400 transition-colors bg-gray-50 cursor-pointer"
                >
                  {url ? (
                    <img src={url} alt={a.file_name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full animate-pulse bg-gray-100" />
                  )}
                </button>
                {!readOnly && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(a) }}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity"
                  >
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
              </div>
            )
          }

          return (
            <div key={a.id} className="relative group/att">
              <button
                title={a.file_name}
                onClick={(e) => { e.stopPropagation(); handleClick(a) }}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 transition-colors bg-gray-50 max-w-[180px] cursor-pointer"
              >
                <span className="text-sm flex-shrink-0">{fileIcon(a.mime_type)}</span>
                <span className="text-[11px] text-gray-600 truncate">{a.file_name}</span>
                {a.file_size && <span className="text-[9px] text-gray-400 flex-shrink-0">{formatSize(a.file_size)}</span>}
              </button>
              {!readOnly && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(a) }}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity"
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              )}
            </div>
          )
      })}

      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc.src}
          alt={lightboxSrc.alt}
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </>
  )
}
