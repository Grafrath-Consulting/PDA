'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Block } from '../types'

interface Props {
  userId: string
  contextId: string | null
  onSaved: (block: Block) => void
}

export function Composer({ userId, contextId, onSaved }: Props) {
  const [content, setContent] = useState('')
  const [active, setActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus on mount so the user can start typing immediately
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const save = useCallback(async () => {
    const text = content.trim()
    if (!text || saving) return

    setSaving(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('journal_blocks')
      .insert({
        user_id: userId,
        context_id: contextId ?? null,
        content: text,
        status: 'unprocessed',
      })
      .select()
      .single()

    setSaving(false)
    if (error) { console.error(error); return }
    setContent('')
    setActive(false)
    // Re-focus after saving so the user can keep typing
    requestAnimationFrame(() => textareaRef.current?.focus())
    if (data) onSaved(data as Block)
  }, [content, saving, userId, contextId, onSaved])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      save()
    }
    if (e.key === 'Escape') {
      setActive(false)
      setContent('')
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  return (
    <div
      className={`bg-white rounded-xl border transition-all shadow-sm ${
        active ? 'border-indigo-200 shadow-md' : 'border-gray-100'
      }`}
    >
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setActive(true)}
        onBlur={() => { if (!content.trim()) setActive(false) }}
        placeholder="What's on your mind? Press Ctrl+Enter to save."
        rows={active ? 4 : 2}
        className="w-full resize-none px-4 pt-4 pb-2 text-sm text-gray-800 placeholder-gray-300 bg-transparent outline-none rounded-xl"
        style={{ minHeight: active ? '100px' : '60px' }}
      />

      {active && (
        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          <span className="text-xs text-gray-400">Ctrl+Enter to save · Esc to cancel</span>
          <button
            onClick={save}
            disabled={!content.trim() || saving}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}
