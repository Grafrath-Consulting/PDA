'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { Block } from '../types'
import type { TipTapEditorHandle } from './TipTapEditor'

const TipTapEditor = dynamic(() => import('./TipTapEditor').then(m => m.TipTapEditor), { ssr: false })

interface Props {
  userId: string
  contextId: string | null
  onSaved: (block: Block) => void
  autosaveInterval?: number
}

export function Composer({ userId, contextId, onSaved, autosaveInterval = 30 }: Props) {
  const [active, setActive] = useState(false)
  const editorRef = useRef<TipTapEditorHandle>(null)
  const savingRef = useRef(false)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // For the Composer, autosave creates a draft block then clears.
  // We track whether we have unsaved content for the autosave.
  const hasDraftRef = useRef(false)

  function clearAutosaveTimer() {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }

  // Cleanup timer on unmount
  useEffect(() => clearAutosaveTimer, [])

  const save = useCallback(async () => {
    if (!editorRef.current || savingRef.current) return
    const html = editorRef.current.getHTML()
    const text = editorRef.current.getText().trim()
    if (!text) return

    savingRef.current = true
    clearAutosaveTimer()
    hasDraftRef.current = false

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

    savingRef.current = false
    if (error) { console.error(error); return }
    editorRef.current.clear()
    setActive(false)
    requestAnimationFrame(() => editorRef.current?.focus())
    if (data) onSaved(data as Block)
  }, [userId, contextId, onSaved])

  function handleChange() {
    const text = editorRef.current?.getText().trim() ?? ''
    hasDraftRef.current = !!text
    if (text && !active) setActive(true)
    if (!text) { setActive(false); clearAutosaveTimer(); return }

    // Reset autosave timer on every keystroke
    clearAutosaveTimer()
    autosaveTimerRef.current = setTimeout(() => {
      // Autosave for Composer = commit the block (same as explicit save)
      save()
    }, autosaveInterval * 1000)
  }

  function handleBlur() {
    if (!editorRef.current) return
    const text = editorRef.current.getText().trim()
    if (!text) { setActive(false); return }
    save()
  }

  return (
    <div
      className={`bg-white rounded-xl border transition-all shadow-sm ${
        active ? 'border-indigo-200 shadow-md' : 'border-gray-100'
      }`}
    >
      <div
        className="px-4 pt-3 pb-1"
        onFocus={() => setActive(true)}
        onBlur={(e) => {
          // Only trigger blur save if focus left the composer entirely
          const parent = e.currentTarget
          requestAnimationFrame(() => {
            if (!parent.contains(document.activeElement)) handleBlur()
          })
        }}
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

      {/* Bottom bar — matches BlockCard layout */}
      <div className="flex items-center justify-between px-4 pb-2 pt-1">
        <span className="text-xs text-gray-400">New Entry</span>
        {active && (
          <span className="text-xs text-gray-400">Ctrl+Enter to save · click outside to save</span>
        )}
      </div>
    </div>
  )
}
