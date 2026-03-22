'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'

interface Person {
  id: string
  user_id: string
  name: string
  email: string | null
  company: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  userId: string
}

export function PeopleModal({ open, onClose, userId }: Props) {
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [addingNew, setAddingNew] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  const fetchPeople = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase.from('people').select('*').eq('user_id', userId).order('name')
    setPeople((data ?? []) as Person[])
    setLoading(false)
  }, [userId])

  useEffect(() => {
    if (open) { setLoading(true); fetchPeople() }
  }, [open, fetchPeople])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={modalRef}
        className="relative bg-white rounded-xl shadow-xl w-full max-w-[560px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E0D0]">
          <h2 className="text-lg font-semibold text-gray-900">People</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading ? (
            <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
          ) : people.length === 0 && !addingNew ? (
            <p className="text-sm text-gray-400 py-4 text-center">No people yet. Add someone to get started.</p>
          ) : (
            <div className="space-y-1">
              {people.map((p) => (
                <PersonRow key={p.id} person={p} onUpdated={fetchPeople} onRemoved={(id) => setPeople(prev => prev.filter(x => x.id !== id))} />
              ))}
            </div>
          )}
          {addingNew && (
            <AddPersonForm
              userId={userId}
              onSaved={(p) => { setPeople(prev => [...prev, p].sort((a, b) => a.name.localeCompare(b.name))); setAddingNew(false) }}
              onCancel={() => setAddingNew(false)}
            />
          )}
        </div>

        {/* Footer */}
        {!addingNew && (
          <div className="px-6 py-3 border-t border-[#E5E0D0]">
            <button
              onClick={() => setAddingNew(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add Person
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ── Person Row ────────────────────────────────────────────────────────

function PersonRow({ person, onUpdated, onRemoved }: { person: Person; onUpdated: () => void; onRemoved: (id: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [name, setName] = useState(person.name)
  const [email, setEmail] = useState(person.email ?? '')
  const [company, setCompany] = useState(person.company ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('people').update({ name: name.trim(), email: email.trim() || null, company: company.trim() || null }).eq('id', person.id)
    setSaving(false)
    setEditing(false)
    onUpdated()
  }

  async function remove() {
    const supabase = createClient()
    await supabase.from('people').delete().eq('id', person.id)
    onRemoved(person.id)
  }

  if (editing) {
    return (
      <div className="border border-[#E5E0D0] rounded-lg p-3 space-y-2 bg-[#FDFCF7]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 outline-none focus:border-amber-400" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 outline-none focus:border-amber-400" />
        <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company (optional)" className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 outline-none focus:border-amber-400" />
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!name.trim() || saving} className="px-3 py-1 text-xs font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors">Save</button>
          <button onClick={() => { setEditing(false); setName(person.name); setEmail(person.email ?? ''); setCompany(person.company ?? '') }} className="px-3 py-1 text-xs font-medium rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#FDFCF7] group transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{person.name}</p>
        {(person.email || person.company) && (
          <p className="text-xs text-gray-400 truncate">{[person.email, person.company].filter(Boolean).join(' · ')}</p>
        )}
      </div>
      {confirming ? (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[11px] text-red-600 font-medium">Delete?</span>
          <button onClick={remove} className="px-2 py-0.5 text-[11px] font-medium rounded bg-red-500 text-white hover:bg-red-600">Yes</button>
          <button onClick={() => setConfirming(false)} className="px-2 py-0.5 text-[11px] font-medium rounded bg-gray-100 text-gray-600 hover:bg-gray-200">No</button>
        </div>
      ) : (
        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setEditing(true)} title="Edit" className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
          </button>
          <button onClick={() => setConfirming(true)} title="Remove" className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
          </button>
        </div>
      )}
    </div>
  )
}

// ── Add Person Form ───────────────────────────────────────────────────

function AddPersonForm({ userId, onSaved, onCancel }: { userId: string; onSaved: (p: Person) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    const supabase = createClient()
    const { data, error } = await supabase.from('people').insert({ user_id: userId, name: name.trim(), email: email.trim() || null, company: company.trim() || null }).select().single()
    if (error) { console.error(error); setSaving(false); return }
    onSaved(data as Person)
  }

  return (
    <div className="border border-amber-200 rounded-lg p-3 space-y-2 bg-amber-50/50 mt-2">
      <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name *" className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 outline-none focus:border-amber-400" onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 outline-none focus:border-amber-400" onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
      <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company (optional)" className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 outline-none focus:border-amber-400" onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={!name.trim() || saving} className="px-3 py-1 text-xs font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors">Save</button>
        <button onClick={onCancel} className="px-3 py-1 text-xs font-medium rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">Cancel</button>
      </div>
    </div>
  )
}
