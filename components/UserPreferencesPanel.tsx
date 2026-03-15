'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  email: string
  displayName: string
  userId: string
  open: boolean
  onClose: () => void
  onAutosaveChange?: (seconds: number) => void
}

const INTERVAL_OPTIONS = [
  { value: 15, label: '15 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
]

export function UserPreferencesPanel({ email, displayName, userId, open, onClose, onAutosaveChange }: Props) {
  const [autosaveInterval, setAutosaveInterval] = useState(30)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const supabase = createClient()
    supabase
      .from('profiles')
      .select('autosave_interval_seconds')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (data?.autosave_interval_seconds) {
          setAutosaveInterval(data.autosave_interval_seconds)
        }
      })
  }, [open, userId])

  async function handleIntervalChange(value: number) {
    setAutosaveInterval(value)
    setSaving(true)
    const supabase = createClient()
    await supabase
      .from('profiles')
      .update({ autosave_interval_seconds: value })
      .eq('id', userId)
    setSaving(false)
    onAutosaveChange?.(value)
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed left-0 top-0 bottom-0 w-72 bg-white border-r border-[#E5E0D0] shadow-xl z-50 flex flex-col animate-slide-in-left">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E0D0]">
          <h2 className="text-sm font-semibold text-gray-900">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Profile section */}
          <section>
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Profile</h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-500">Name</label>
                <p className="text-sm text-gray-800">{displayName || '—'}</p>
              </div>
              <div>
                <label className="text-xs text-gray-500">Email</label>
                <p className="text-sm text-gray-800">{email || '—'}</p>
              </div>
            </div>
          </section>

          {/* Preferences section */}
          <section>
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Preferences</h3>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Autosave interval</label>
              <select
                value={autosaveInterval}
                onChange={(e) => handleIntervalChange(Number(e.target.value))}
                disabled={saving}
                className="w-full text-sm text-gray-800 border border-[#E5E0D0] rounded-lg px-3 py-2 bg-white outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-300 transition-colors"
              >
                {INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Auto-saves content silently after this period of inactivity.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
