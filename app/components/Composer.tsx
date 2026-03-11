'use client'

import { useState, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { Block } from '../types'
import type { TipTapEditorHandle } from './TipTapEditor'

const TipTapEditor = dynamic(() => import('./TipTapEditor').then(m => m.TipTapEditor), { ssr: false })

interface Props {
  userId: string
  contextId: string | null
  onSaved: (block: Block) => void
}

export function Composer({ userId, contextId, onSaved }: Props) {
  const [active, setActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<TipTapEditorHandle>(null)
  // Track whether content is non-empty to enable/disable save button
  const [hasContent, setHasContent] = useState(false)

  const save = useCallback(async () => {
    if (!editorRef.current || saving) return
    const html = editorRef.current.getHTML()
    const text = editorRef.current.getText().trim()
    if (!text) return

    setSaving(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('journal_blocks')
      .insert({
        user_id: userId,
        context_id: contextId ?? null,
        content: html,
        status: 'unprocessed',
      })
      .select()
      .single()

    setSaving(false)
    if (error) { console.error(error); return }
    editorRef.current.clear()
    setHasContent(false)
    setActive(false)
    requestAnimationFrame(() => editorRef.current?.focus())
    if (data) onSaved(data as Block)
  }, [saving, userId, contextId, onSaved])

  function handleChange(html: string) {
    // Check if there's meaningful text content
    const div = document.createElement('div')
    div.innerHTML = html
    const text = (div.textContent ?? '').trim()
    setHasContent(!!text)
    if (text && !active) setActive(true)
  }

  return (
    <div
      className={`bg-white rounded-xl border transition-all shadow-sm ${
        active ? 'border-indigo-200 shadow-md' : 'border-gray-100'
      }`}
    >
      <div
        className="px-4 pt-4 pb-2"
        onFocus={() => setActive(true)}
      >
        <TipTapEditor
          ref={editorRef}
          placeholder="What's on your mind? Press Ctrl+Enter to save."
          autoFocus
          onSubmit={save}
          onChange={handleChange}
          minHeight={active ? '100px' : '60px'}
        />
      </div>

      {active && (
        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          <span className="text-xs text-gray-400">Ctrl+Enter to save · Esc to cancel</span>
          <button
            onClick={save}
            disabled={!hasContent || saving}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}
