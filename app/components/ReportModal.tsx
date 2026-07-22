'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspace } from '@/context/WorkspaceContext'
import { useDateFormat } from '@/context/DateFormatContext'
import { zonedDateStr } from '@/lib/date-format'
import { getScheme } from '@/constants/workspaceColorSchemes'

interface ReportTemplate {
  id: string
  name: string
  date_range_type: string
  date_from: string | null
  date_to: string | null
  workspace_ids: string[]
  include_ai_summary: boolean
  summary_only: boolean
  recipient_emails: string[]
  entry_type_filter: string | null
  status_filter: string | null
}

const DATE_RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_7', label: 'Last 7 days' },
  { value: 'last_30', label: 'Last 30 days' },
  { value: 'last_90', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
] as const

// Today's calendar date in the user's zone — the server interprets the
// range strings as dates in the profile timezone, so UTC dates are wrong
// for evening use west of UTC.
function zonedTodayStr(timeZone: string): string {
  return zonedDateStr(new Date().toISOString(), timeZone)
}

function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function resolveDateRange(type: string, timeZone: string, customFrom?: string | null, customTo?: string | null): { from: string; to: string } {
  const today = zonedTodayStr(timeZone)
  switch (type) {
    case 'yesterday': {
      const y = shiftDateStr(today, -1)
      return { from: y, to: y }
    }
    case 'last_7':
      return { from: shiftDateStr(today, -6), to: today }
    case 'last_30':
      return { from: shiftDateStr(today, -29), to: today }
    case 'last_90':
      return { from: shiftDateStr(today, -89), to: today }
    case 'custom':
      return { from: customFrom ?? today, to: customTo ?? today }
    default: // today
      return { from: today, to: today }
  }
}

type Step = 'menu' | 'config' | 'preview'

interface Props { userId: string; onClose: () => void }

export function ReportModal({ userId, onClose }: Props) {
  const { workspaces, activeWorkspaceId } = useWorkspace()
  const { timezone } = useDateFormat()

  const [step, setStep] = useState<Step>('menu')
  const [templates, setTemplates] = useState<ReportTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)

  // Config state
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [dateRangeType, setDateRangeType] = useState('today')
  const [customFrom, setCustomFrom] = useState(() => zonedTodayStr(timezone))
  const [customTo, setCustomTo] = useState(() => zonedTodayStr(timezone))
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Set<string>>(new Set())
  const [includeAiSummary, setIncludeAiSummary] = useState(false)
  const [summaryOnly, setSummaryOnly] = useState(false)
  const [entryTypeFilter, setEntryTypeFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)

  // Preview state
  const [report, setReport] = useState('')
  const [subject, setSubject] = useState('')
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load templates
  useEffect(() => {
    const supabase = createClient()
    supabase.from('report_templates')
      .select('*')
      .eq('user_id', userId)
      .order('name')
      .then(({ data }) => {
        setTemplates((data ?? []) as ReportTemplate[])
        setLoadingTemplates(false)
      })
  }, [userId])

  function loadTemplate(tpl: ReportTemplate) {
    setTemplateId(tpl.id)
    setTemplateName(tpl.name)
    setDateRangeType(tpl.date_range_type)
    if (tpl.date_from) setCustomFrom(tpl.date_from)
    if (tpl.date_to) setCustomTo(tpl.date_to)
    setSelectedWorkspaces(new Set(tpl.workspace_ids))
    setIncludeAiSummary(tpl.include_ai_summary)
    setSummaryOnly(tpl.summary_only)
    setEntryTypeFilter(tpl.entry_type_filter)
    setStatusFilter(tpl.status_filter)
    setStep('config')
  }

  function startNew() {
    setTemplateId(null)
    setTemplateName('')
    setDateRangeType('today')
    setCustomFrom(zonedTodayStr(timezone))
    setCustomTo(zonedTodayStr(timezone))
    setSelectedWorkspaces(activeWorkspaceId ? new Set([activeWorkspaceId]) : new Set())
    setIncludeAiSummary(false)
    setSummaryOnly(false)
    setEntryTypeFilter(null)
    setStatusFilter(null)
    setStep('config')
  }

  async function saveTemplate() {
    const supabase = createClient()
    const payload = {
      user_id: userId,
      name: templateName.trim() || 'Untitled Report',
      date_range_type: dateRangeType,
      date_from: dateRangeType === 'custom' ? customFrom : null,
      date_to: dateRangeType === 'custom' ? customTo : null,
      workspace_ids: Array.from(selectedWorkspaces),
      include_ai_summary: includeAiSummary,
      summary_only: summaryOnly,
      recipient_emails: [],
      entry_type_filter: entryTypeFilter,
      status_filter: statusFilter,
    }
    if (templateId) {
      await supabase.from('report_templates').update(payload).eq('id', templateId)
    } else {
      const { data } = await supabase.from('report_templates').insert(payload).select('id').single()
      if (data) setTemplateId(data.id)
    }
    // Refresh templates list
    const { data: all } = await supabase.from('report_templates').select('*').eq('user_id', userId).order('name')
    setTemplates((all ?? []) as ReportTemplate[])
  }

  async function deleteTemplate() {
    if (!templateId || !window.confirm('Delete this template?')) return
    const supabase = createClient()
    await supabase.from('report_templates').delete().eq('id', templateId)
    setTemplates(prev => prev.filter(t => t.id !== templateId))
    setTemplateId(null)
    setStep('menu')
  }

  async function generateReport() {
    setGenerating(true)
    setError(null)
    try {
      const { from, to } = resolveDateRange(dateRangeType, timezone, customFrom, customTo)
      const wsIds = Array.from(selectedWorkspaces)
      const res = await fetch('/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceIds: wsIds.length > 0 ? wsIds : null,
          dateFrom: from,
          dateTo: to,
          includeAiSummary,
          summaryOnly,
          entryTypeFilter,
          statusFilter,
          templateName,
        }),
      })
      if (!res.ok) { setError('Failed to generate report'); return }
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

  async function copyToClipboard() {
    const text = subject ? `${subject}\n\n${report}` : report
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function downloadReport() {
    const text = subject ? `${subject}\n\n${report}` : report
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(templateName || 'Report').replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toLocaleDateString('en-CA')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function toggleWorkspace(wsId: string) {
    setSelectedWorkspaces(prev => {
      const next = new Set(prev)
      if (next.has(wsId)) next.delete(wsId)
      else next.add(wsId)
      return next
    })
  }

  const inputClass = 'w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-300'
  const btnPrimary = 'px-4 py-1.5 text-sm text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40'
  const btnSecondary = 'px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors'

  return (
    <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[85vh]" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">
            {step === 'menu' && 'Make Report'}
            {step === 'config' && (templateId ? templateName || 'Edit Report' : 'New Report')}
            {step === 'preview' && 'Preview Report'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* ── Step: Menu (template selection) ────────────── */}
        {step === 'menu' && (
          <div className="px-5 py-4 space-y-2 overflow-y-auto">
            <button onClick={startNew} className="w-full flex items-center gap-3 px-3 py-3 text-sm text-left text-gray-700 hover:bg-amber-50 rounded-lg transition-colors border border-dashed border-gray-300">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              New Report
            </button>

            {loadingTemplates && <div className="h-12 bg-gray-50 rounded-lg animate-pulse" />}

            {!loadingTemplates && templates.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide pt-2">Templates</p>
                {templates.map(tpl => (
                  <button
                    key={tpl.id}
                    onClick={() => loadTemplate(tpl)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-left text-gray-700 hover:bg-gray-50 rounded-lg transition-colors border border-gray-200"
                  >
                    <div>
                      <p className="font-medium">{tpl.name}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {DATE_RANGES.find(r => r.value === tpl.date_range_type)?.label ?? tpl.date_range_type}
                        {tpl.workspace_ids.length > 0 && ` · ${tpl.workspace_ids.length} workspace${tpl.workspace_ids.length > 1 ? 's' : ''}`}
                        {tpl.include_ai_summary && ' · AI summary'}
                      </p>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── Step: Config ───────────────────────────────── */}
        {step === 'config' && (
          <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
            {/* Template name */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Report Name</label>
              <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Weekly Standup" className={inputClass} />
            </div>

            {/* Date range */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date Range</label>
              <select value={dateRangeType} onChange={(e) => setDateRangeType(e.target.value)} className={inputClass}>
                {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              {dateRangeType === 'custom' && (
                <div className="flex gap-3 mt-2">
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={`flex-1 ${inputClass}`} />
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={`flex-1 ${inputClass}`} />
                </div>
              )}
            </div>

            {/* Workspaces multi-select */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Workspaces</label>
              <div className="flex flex-wrap gap-1.5">
                {workspaces.map(ws => {
                  const scheme = getScheme(ws.color_scheme)
                  const sel = selectedWorkspaces.has(ws.id)
                  return (
                    <button
                      key={ws.id}
                      onClick={() => toggleWorkspace(ws.id)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border transition-all ${
                        sel ? 'border-amber-400 ring-1 ring-amber-300 shadow-sm' : 'border-gray-200 hover:border-gray-300'
                      }`}
                      style={{ backgroundColor: sel ? (scheme?.primary ?? '#6B7280') : '#F9FAFB', color: sel ? (scheme?.textOnColor ?? '#FFF') : '#6B7280' }}
                    >
                      {ws.emoji && <span className="text-xs">{ws.emoji}</span>}
                      {ws.name}
                    </button>
                  )
                })}
                {workspaces.length === 0 && <p className="text-xs text-gray-400">No workspaces</p>}
              </div>
              {selectedWorkspaces.size === 0 && <p className="text-[10px] text-gray-400 mt-1">All workspaces included</p>}
            </div>

            {/* Filters */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">Entry Type</label>
                <select value={entryTypeFilter ?? ''} onChange={(e) => setEntryTypeFilter(e.target.value || null)} className={inputClass}>
                  <option value="">All</option>
                  <option value="task">Tasks only</option>
                  <option value="info">Notes only</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                <select value={statusFilter ?? ''} onChange={(e) => setStatusFilter(e.target.value || null)} className={inputClass}>
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="complete">Complete</option>
                </select>
              </div>
            </div>

            {/* Report content options */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">Include</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAiSummary}
                  onChange={(e) => {
                    // Don't allow unchecking if it's the only one checked
                    if (!e.target.checked && summaryOnly) return
                    setIncludeAiSummary(e.target.checked)
                  }}
                  className="rounded border-gray-300 text-amber-600 focus:ring-amber-300"
                />
                <span className="text-sm text-gray-700">AI Summary</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!summaryOnly}
                  onChange={(e) => {
                    // Don't allow unchecking if it's the only one checked
                    if (!e.target.checked && !includeAiSummary) return
                    setSummaryOnly(!e.target.checked)
                  }}
                  className="rounded border-gray-300 text-amber-600 focus:ring-amber-300"
                />
                <span className="text-sm text-gray-700">Detailed Entries</span>
              </label>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        )}

        {/* ── Step: Preview ──────────────────────────────── */}
        {step === 'preview' && (
          <div className="px-5 py-4 space-y-3 flex-1 flex flex-col overflow-hidden">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
              <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
            </div>
            <div className="flex-1 min-h-0">
              <label className="block text-xs font-medium text-gray-500 mb-1">Report (editable)</label>
              <textarea
                ref={textareaRef}
                value={report}
                onChange={(e) => setReport(e.target.value)}
                className="w-full h-full min-h-[200px] px-3 py-2 text-xs text-gray-900 font-mono border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-300 resize-none"
              />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────── */}
        {(
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
            {step === 'menu' && (
              <>
                <button onClick={onClose} className={btnSecondary}>Cancel</button>
                <div />
              </>
            )}

            {step === 'config' && (
              <>
                <div className="flex items-center gap-2">
                  <button onClick={() => setStep('menu')} className={btnSecondary}>Back</button>
                  {templateId && (
                    <button onClick={deleteTemplate} className="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors">Delete</button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={saveTemplate} className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
                    {templateId ? 'Update Template' : 'Save as Template'}
                  </button>
                  <button onClick={generateReport} disabled={generating} className={btnPrimary}>
                    {generating ? 'Generating…' : 'Generate'}
                  </button>
                </div>
              </>
            )}

            {step === 'preview' && (
              <>
                <button onClick={() => { setStep('config'); setError(null) }} className={btnSecondary}>Back</button>
                <div className="flex items-center gap-2">
                  <button onClick={downloadReport} className={btnSecondary}>
                    Download
                  </button>
                  <button onClick={copyToClipboard} className={btnPrimary}>
                    {copied ? 'Copied!' : 'Copy to Clipboard'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
