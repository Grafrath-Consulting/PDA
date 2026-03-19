'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspace } from '@/context/WorkspaceContext'

interface Person {
  id: string
  name: string
  email: string | null
}

interface Props {
  userId: string
  onClose: () => void
}

export function ReportModal({ userId, onClose }: Props) {
  const { workspaces, activeWorkspaceId } = useWorkspace()

  const [step, setStep] = useState<'setup' | 'preview'>('setup')
  const [wsId, setWsId] = useState<string | null>(activeWorkspaceId)
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])

  // Recipients
  const [people, setPeople] = useState<Person[]>([])
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set())

  // Report content
  const [report, setReport] = useState('')
  const [subject, setSubject] = useState('')
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load people
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('people')
      .select('id, name, email')
      .eq('user_id', userId)
      .order('name')
      .then(({ data }) => setPeople((data ?? []) as Person[]))
  }, [userId])

  // Load saved recipients for the selected workspace
  useEffect(() => {
    loadSavedRecipients()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, userId])

  async function loadSavedRecipients() {
    const supabase = createClient()
    if (wsId) {
      const { data } = await supabase.from('workspaces').select('report_recipients').eq('id', wsId).single()
      if (data?.report_recipients) {
        setSelectedRecipients(new Set(data.report_recipients as string[]))
      } else {
        setSelectedRecipients(new Set())
      }
    } else {
      const { data } = await supabase.from('profiles').select('global_report_recipients').eq('id', userId).single()
      if (data?.global_report_recipients) {
        setSelectedRecipients(new Set(data.global_report_recipients as string[]))
      } else {
        setSelectedRecipients(new Set())
      }
    }
  }

  function toggleRecipient(personId: string) {
    setSelectedRecipients(prev => {
      const next = new Set(prev)
      if (next.has(personId)) next.delete(personId)
      else next.add(personId)
      return next
    })
  }

  async function generateReport() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: wsId, dateFrom, dateTo }),
      })
      if (!res.ok) {
        setError('Failed to generate report')
        return
      }
      const data = await res.json()
      setReport(data.report)
      setSubject(data.subject)
      setStep('preview')
    } catch {
      setError('Failed to generate report')
    } finally {
      setGenerating(false)
    }
  }

  async function sendReport() {
    const recipientEmails = Array.from(selectedRecipients)
      .map(id => people.find(p => p.id === id))
      .filter((p): p is Person => !!p && !!p.email)
      .map(p => p.email!)

    if (recipientEmails.length === 0) {
      setError('No recipients with email addresses selected')
      return
    }

    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/report/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipientEmails, subject, body: report }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data.code === 'GMAIL_NOT_AUTHORIZED' || data.code === 'GMAIL_SCOPE_MISSING') {
          setError('Gmail access not configured. Please ask your admin to enable the gmail.send OAuth scope in Supabase.')
        } else {
          setError(data.error ?? 'Failed to send report')
        }
        return
      }

      // Save recipients for next time
      await saveRecipientPreferences()
      setSuccess(true)
    } catch {
      setError('Failed to send report')
    } finally {
      setSending(false)
    }
  }

  async function saveRecipientPreferences() {
    const ids = Array.from(selectedRecipients)
    const supabase = createClient()
    if (wsId) {
      await supabase.from('workspaces').update({ report_recipients: ids }).eq('id', wsId)
    } else {
      await supabase.from('profiles').update({ global_report_recipients: ids }).eq('id', userId)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[85vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">
            {step === 'setup' ? 'End of Day Report' : 'Preview & Send'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Success state */}
        {success && (
          <div className="px-5 py-10 text-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-green-500 mb-3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <p className="text-sm font-medium text-gray-900">Report sent!</p>
            <p className="text-xs text-gray-400 mt-1">
              Sent to {Array.from(selectedRecipients).map(id => people.find(p => p.id === id)?.name).filter(Boolean).join(', ')}
            </p>
            <button onClick={onClose} className="mt-4 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Close</button>
          </div>
        )}

        {/* Step 1: Setup */}
        {!success && step === 'setup' && (
          <div className="px-5 py-4 space-y-4 overflow-y-auto">
            {/* Workspace selector */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Workspace</label>
              <select
                value={wsId ?? ''}
                onChange={(e) => setWsId(e.target.value || null)}
                className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-300"
              >
                <option value="">All Workspaces</option>
                {workspaces.map(w => <option key={w.id} value={w.id}>{w.emoji ? `${w.emoji} ` : ''}{w.name}</option>)}
              </select>
            </div>

            {/* Date range */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-300"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-300"
                />
              </div>
            </div>

            {/* Recipients */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Recipients</label>
              {people.length === 0 ? (
                <p className="text-xs text-gray-400">No people added yet. Add contacts in the People section.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {people.map(p => (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedRecipients.has(p.id)}
                        onChange={() => toggleRecipient(p.id)}
                        className="rounded border-gray-300 text-amber-600 focus:ring-amber-300"
                      />
                      <span className="text-sm text-gray-700 flex-1">{p.name}</span>
                      {p.email
                        ? <span className="text-xs text-gray-400 truncate max-w-[150px]">{p.email}</span>
                        : <span className="text-xs text-red-400">no email</span>
                      }
                    </label>
                  ))}
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        )}

        {/* Step 2: Preview */}
        {!success && step === 'preview' && (
          <div className="px-5 py-4 space-y-3 flex-1 flex flex-col overflow-hidden">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-300"
              />
            </div>
            <div className="flex-1 min-h-0">
              <label className="block text-xs font-medium text-gray-500 mb-1">Report (editable)</label>
              <textarea
                ref={textareaRef}
                value={report}
                onChange={(e) => setReport(e.target.value)}
                className="w-full h-full min-h-[250px] px-3 py-2 text-xs text-gray-900 font-mono border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-300 resize-none"
              />
            </div>
            <p className="text-[10px] text-gray-400">
              Sending to: {Array.from(selectedRecipients).map(id => {
                const p = people.find(pp => pp.id === id)
                return p ? `${p.name} <${p.email ?? 'no email'}>` : ''
              }).filter(Boolean).join(', ') || 'No recipients'}
            </p>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        )}

        {/* Footer actions */}
        {!success && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
            {step === 'preview' ? (
              <>
                <button
                  onClick={() => { setStep('setup'); setError(null) }}
                  className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={sendReport}
                  disabled={sending || selectedRecipients.size === 0}
                  className="px-4 py-1.5 text-sm text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40"
                >
                  {sending ? 'Sending…' : 'Send Report'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={generateReport}
                  disabled={generating}
                  className="px-4 py-1.5 text-sm text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40"
                >
                  {generating ? 'Generating…' : 'Generate Report'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
