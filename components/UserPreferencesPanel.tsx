'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AiSettingsPanel } from '@/app/components/AiSettingsPanel'
import { McpSettingsPanel } from '@/app/components/McpSettingsPanel'
import { useDateFormat } from '@/context/DateFormatContext'
import type { DateFormatOption, TimeFormatOption } from '@/lib/date-format'
import { versionString, buildDateString } from '@/lib/version'

interface Props {
  email: string
  displayName: string
  userId: string
  open: boolean
  onClose: () => void
  onAutosaveChange?: (seconds: number) => void
  onSyncIntervalChange?: (seconds: number) => void
  feedCollapseLines?: number
  onFeedCollapseLinesChange?: (lines: number) => void
}

const INTERVAL_OPTIONS = [
  { value: 15, label: '15 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
]

const SYNC_INTERVAL_OPTIONS = [
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 15, label: '15 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
]

const DATE_FORMAT_OPTIONS: { value: DateFormatOption; label: string; example: string }[] = [
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY', example: '03/21/2026' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY', example: '21/03/2026' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD', example: '2026-03-21' },
  { value: 'Mon DD, YYYY', label: 'Mon DD, YYYY', example: 'Mar 21, 2026' },
]

const TIME_FORMAT_OPTIONS: { value: TimeFormatOption; label: string; example: string }[] = [
  { value: '12h', label: '12-hour', example: '2:30 PM' },
  { value: '24h', label: '24-hour', example: '14:30' },
]

const selectClass = "w-full text-sm text-gray-800 border border-[#E5E0D0] rounded-lg px-3 py-2 bg-white outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-300 transition-colors"

const COLLAPSE_LINE_OPTIONS = [
  { value: 5, label: '5 lines' },
  { value: 8, label: '8 lines' },
  { value: 10, label: '10 lines' },
  { value: 15, label: '15 lines' },
  { value: 20, label: '20 lines' },
  { value: 30, label: '30 lines' },
]

export function UserPreferencesPanel({ email, displayName, userId, open, onClose, onAutosaveChange, onSyncIntervalChange, feedCollapseLines: feedCollapseLinesFromProps, onFeedCollapseLinesChange }: Props) {
  const [autosaveInterval, setAutosaveInterval] = useState(30)
  const [syncInterval, setSyncInterval] = useState(60)
  const [collapseLines, setCollapseLines] = useState(feedCollapseLinesFromProps ?? 10)
  const [saving, setSaving] = useState(false)
  const { dateFormat, timeFormat, setDateFormat, setTimeFormat } = useDateFormat()

  useEffect(() => {
    if (feedCollapseLinesFromProps != null) setCollapseLines(feedCollapseLinesFromProps)
  }, [feedCollapseLinesFromProps])

  useEffect(() => {
    if (!open) return
    const supabase = createClient()
    supabase
      .from('profiles')
      .select('autosave_interval_seconds, sync_interval_seconds')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (data?.autosave_interval_seconds) {
          setAutosaveInterval(data.autosave_interval_seconds)
        }
        if (data?.sync_interval_seconds) {
          setSyncInterval(data.sync_interval_seconds)
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

  async function handleSyncIntervalChange(value: number) {
    setSyncInterval(value)
    setSaving(true)
    const supabase = createClient()
    await supabase
      .from('profiles')
      .update({ sync_interval_seconds: value })
      .eq('id', userId)
    setSaving(false)
    onSyncIntervalChange?.(value)
  }

  async function handleCollapseLinesChange(value: number) {
    setCollapseLines(value)
    setSaving(true)
    const supabase = createClient()
    await supabase
      .from('profiles')
      .update({ feed_collapse_lines: value })
      .eq('id', userId)
    setSaving(false)
    onFeedCollapseLinesChange?.(value)
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed left-0 top-0 bottom-0 w-full max-w-[432px] bg-white border-r border-[#E5E0D0] shadow-xl z-50 flex flex-col animate-slide-in-left">
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
          {/* App info */}
          <div className="bg-gray-50 rounded-lg px-4 py-3 text-center">
            <p className="text-sm font-semibold text-gray-700">PDA</p>
            <p className="text-xs text-gray-500">{versionString()}</p>
            <p className="text-[10px] text-gray-400">Built {buildDateString()}</p>
          </div>

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

          {/* AI section */}
          <AiSettingsPanel userId={userId} />

          {/* MCP section */}
          <McpSettingsPanel />

          {/* Preferences section */}
          <section>
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Preferences</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Date format</label>
                <select
                  value={dateFormat}
                  onChange={(e) => setDateFormat(e.target.value as DateFormatOption)}
                  className={selectClass}
                >
                  {DATE_FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.example})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Time format</label>
                <select
                  value={timeFormat}
                  onChange={(e) => setTimeFormat(e.target.value as TimeFormatOption)}
                  className={selectClass}
                >
                  {TIME_FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.example})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Autosave interval</label>
                <select
                  value={autosaveInterval}
                  onChange={(e) => handleIntervalChange(Number(e.target.value))}
                  disabled={saving}
                  className={selectClass}
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
              <div>
                <label className="text-xs text-gray-500 block mb-1">Sync interval</label>
                <select
                  value={syncInterval}
                  onChange={(e) => handleSyncIntervalChange(Number(e.target.value))}
                  disabled={saving}
                  className={selectClass}
                >
                  {SYNC_INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  How often to check for changes made on other devices.
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Card collapse threshold</label>
                <select
                  value={collapseLines}
                  onChange={(e) => handleCollapseLinesChange(Number(e.target.value))}
                  disabled={saving}
                  className={selectClass}
                >
                  {COLLAPSE_LINE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  Cards longer than this are collapsed in the feed when collapse mode is active.
                </p>
              </div>
            </div>
          </section>

          {/* Sign out */}
          <section>
            <button
              onClick={async () => {
                const supabase = createClient()
                await supabase.auth.signOut()
                window.location.href = '/login'
              }}
              className="w-full text-sm text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg py-2 transition-colors"
            >
              Sign Out
            </button>
          </section>
        </div>
      </div>
    </>
  )
}
