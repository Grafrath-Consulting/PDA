'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useProperties, Property, PropertyValue } from '@/context/PropertiesContext'
import { useWorkspace, Workspace } from '@/context/WorkspaceContext'
import { getScheme } from '@/constants/workspaceColorSchemes'
import propertyColors, { PROPERTY_COLOR_KEYS, getPropertyColor } from '@/constants/propertyColors'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragEndEvent, DragStartEvent, DragOverlay,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const VALUE_COLORS = PROPERTY_COLOR_KEYS

function randomColor(usedColors?: (string | null)[]): string {
  if (usedColors && usedColors.length > 0) {
    const used = new Set(usedColors.filter(Boolean))
    const available = VALUE_COLORS.filter(c => !used.has(c))
    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)]
    }
  }
  return VALUE_COLORS[Math.floor(Math.random() * VALUE_COLORS.length)]
}

interface Props {
  open: boolean
  onClose: () => void
  userId: string
}

function SortablePropertyRow({
  property,
  workspaces,
  onChanged,
  isDragActive,
}: {
  property: Property
  workspaces: Workspace[]
  onChanged: () => void
  isDragActive: boolean
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: property.id })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="relative group/sortable">
      {!isDragActive && (
        <div
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          className="absolute -left-6 top-1/2 -translate-y-1/2 z-10 w-5 h-8 flex items-center justify-center rounded text-gray-300 hover:text-gray-400 cursor-grab active:cursor-grabbing opacity-0 group-hover/sortable:opacity-100 transition-opacity"
        >
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
            <circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/>
            <circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/>
            <circle cx="3" cy="13" r="1.5"/><circle cx="7" cy="13" r="1.5"/>
          </svg>
        </div>
      )}
      <PropertyRow property={property} workspaces={workspaces} onChanged={onChanged} />
    </div>
  )
}

export function PropertiesManager({ open, onClose, userId }: Props) {
  const { allProperties, refetch, reorderProperties } = useProperties()
  const { workspaces, activeWorkspaceId } = useWorkspace()
  const [creating, setCreating] = useState(false)
  const [activeProp, setActiveProp] = useState<Property | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  }))

  function handleDragStart(event: DragStartEvent) {
    const prop = allProperties.find(p => p.id === String(event.active.id))
    setActiveProp(prop ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveProp(null)
    const { active, over } = event
    if (over && active.id !== over.id) {
      const fromIndex = allProperties.findIndex(p => p.id === String(active.id))
      const toIndex = allProperties.findIndex(p => p.id === String(over.id))
      if (fromIndex !== -1 && toIndex !== -1) reorderProperties(fromIndex, toIndex)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="relative w-full max-w-[525px] bg-white shadow-xl flex flex-col h-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E0D0]">
          <h2 className="text-sm font-semibold text-gray-900">Properties</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pl-8 py-4 space-y-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={allProperties.map(p => p.id)} strategy={verticalListSortingStrategy}>
              {allProperties.map((prop) => (
                <SortablePropertyRow
                  key={prop.id}
                  property={prop}
                  workspaces={workspaces}
                  onChanged={refetch}
                  isDragActive={!!activeProp}
                />
              ))}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeProp && (
                <div className="opacity-90 shadow-xl rounded-lg">
                  <PropertyRow property={activeProp} workspaces={workspaces} onChanged={() => {}} />
                </div>
              )}
            </DragOverlay>
          </DndContext>

          {allProperties.length === 0 && !creating && (
            <p className="text-sm text-gray-400 text-center py-8">No properties yet.</p>
          )}

          {creating && (
            <NewPropertyForm
              userId={userId}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              allProperties={allProperties}
              onCreated={() => { setCreating(false); refetch() }}
              onCancel={() => setCreating(false)}
            />
          )}
        </div>

        {!creating && (
          <div className="px-5 py-3 border-t border-gray-100">
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors border border-dashed border-gray-300"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              New Property
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Individual property row ──────────────────────────────────────────

function PropertyRow({ property, workspaces, onChanged }: { property: Property; workspaces: Workspace[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(property.name)
  const [addingValue, setAddingValue] = useState(false)
  const [newValueLabel, setNewValueLabel] = useState('')
  const [newValueColor, setNewValueColor] = useState<string | null>(null)
  const [showNewColorPicker, setShowNewColorPicker] = useState(false)
  const [optimisticPinned, setOptimisticPinned] = useState(property.pinned_in_filter_bar)
  const [optimisticMulti, setOptimisticMulti] = useState(property.allow_multiple)
  const [optimisticArchived, setOptimisticArchived] = useState(property.archived)
  const newColorRef = useRef<HTMLDivElement>(null)

  // Sync optimistic state when property updates from server
  useEffect(() => {
    setOptimisticPinned(property.pinned_in_filter_bar)
  }, [property.pinned_in_filter_bar])
  useEffect(() => {
    setOptimisticMulti(property.allow_multiple)
  }, [property.allow_multiple])
  useEffect(() => {
    setOptimisticArchived(property.archived)
  }, [property.archived])

  useEffect(() => {
    if (!showNewColorPicker) return
    function handler(e: MouseEvent) {
      if (newColorRef.current && !newColorRef.current.contains(e.target as Node)) setShowNewColorPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showNewColorPicker])

  const scopeWorkspace = property.workspace_id
    ? workspaces.find(w => w.id === property.workspace_id) ?? null
    : null
  const scopeScheme = scopeWorkspace ? getScheme(scopeWorkspace.color_scheme) : null

  async function saveName() {
    if (!name.trim() || name === property.name) { setEditing(false); return }
    const supabase = createClient()
    await supabase.from('properties').update({ name: name.trim() }).eq('id', property.id)
    setEditing(false)
    onChanged()
  }

  async function addValue() {
    if (!newValueLabel.trim()) return
    const supabase = createClient()
    const maxSort = property.values.reduce((m, v) => Math.max(m, v.sort_order), -1)
    await supabase.from('property_values').insert({
      property_id: property.id,
      label: newValueLabel.trim(),
      color: newValueColor,
      sort_order: maxSort + 1,
    })
    setNewValueLabel('')
    setNewValueColor(null)
    setAddingValue(false)
    onChanged()
  }

  async function deleteProperty() {
    const isSeeded = property.name === 'Priority' || property.name === 'Context'
    const msg = isSeeded
      ? `"${property.name}" is a default property. Deleting it will remove it from all entries and cannot be undone. Are you sure?`
      : `Delete "${property.name}"? This will remove it from all entries.`
    if (!window.confirm(msg)) return
    const supabase = createClient()
    await supabase.from('properties').delete().eq('id', property.id)
    onChanged()
  }

  return (
    <div className={`border rounded-lg p-3 ${optimisticArchived ? 'border-dashed border-gray-300 opacity-70' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setName(property.name); setEditing(false) } }}
            className="text-sm font-medium text-gray-900 border border-gray-200 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-amber-300"
          />
        ) : (
          <button onClick={() => setEditing(true)} className="text-sm font-medium text-gray-900 hover:text-amber-700 transition-colors">
            {property.name}
          </button>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              const newVal = !optimisticPinned
              setOptimisticPinned(newVal)
              const supabase = createClient()
              await supabase.from('properties').update({ pinned_in_filter_bar: newVal }).eq('id', property.id)
              onChanged()
            }}
            title={optimisticPinned ? 'Remove from quick bar' : 'Show in quick bar'}
            className={`transition-colors ${optimisticPinned ? 'text-amber-500' : 'text-gray-300 hover:text-gray-400'}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={optimisticPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" />
            </svg>
          </button>
          <div className="flex items-center bg-gray-100 rounded-md p-0.5">
            <button
              onClick={async () => {
                if (!optimisticMulti) return
                setOptimisticMulti(false)
                const supabase = createClient()
                await supabase.from('properties').update({ allow_multiple: false }).eq('id', property.id)
                onChanged()
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                !optimisticMulti
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Single
            </button>
            <button
              onClick={async () => {
                if (optimisticMulti) return
                setOptimisticMulti(true)
                const supabase = createClient()
                await supabase.from('properties').update({ allow_multiple: true }).eq('id', property.id)
                onChanged()
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                optimisticMulti
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Multi
            </button>
          </div>
          <button
            onClick={async () => {
              const next = !optimisticArchived
              setOptimisticArchived(next)
              const supabase = createClient()
              await supabase.from('properties').update({ archived: next }).eq('id', property.id)
              onChanged()
            }}
            className={`transition-colors ${optimisticArchived ? 'text-amber-500' : 'text-gray-300 hover:text-gray-400'}`}
            title={optimisticArchived ? 'Unarchive property' : 'Archive property'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {optimisticArchived
                ? <><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></>
                : <><path d="M21 8V21H3V8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></>
              }
            </svg>
          </button>
          <button onClick={deleteProperty} className="text-gray-300 hover:text-red-500 transition-colors" title="Delete property">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 mb-2">
        {property.values.map((val) => (
          <ValueChip key={val.id} value={val} onChanged={onChanged} />
        ))}
      </div>

      {addingValue ? (
        <div className="flex items-center gap-1.5">
          <div className="relative" ref={newColorRef}>
            <button
              onClick={() => setShowNewColorPicker(!showNewColorPicker)}
              className="w-5 h-5 rounded-full flex-shrink-0 border border-gray-300"
              style={{ backgroundColor: newValueColor ? getPropertyColor(newValueColor).swatch : '#D1D5DB' }}
              title="Pick color"
            />
            {showNewColorPicker && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-1.5 grid grid-cols-8 gap-1 z-50 w-[180px]">
                <button
                  onClick={() => { setNewValueColor(null); setShowNewColorPicker(false) }}
                  className={`w-5 h-5 rounded-full border border-gray-300 ${!newValueColor ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
                  style={{ backgroundColor: '#F3F4F6' }}
                  title="No color"
                />
                {VALUE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => { setNewValueColor(c); setShowNewColorPicker(false) }}
                    className={`w-5 h-5 rounded-full ${newValueColor === c ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
                    style={{ backgroundColor: getPropertyColor(c).swatch }}
                  />
                ))}
              </div>
            )}
          </div>
          <input
            autoFocus
            value={newValueLabel}
            onChange={(e) => setNewValueLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addValue(); if (e.key === 'Escape') setAddingValue(false) }}
            placeholder="Value name"
            className="flex-1 min-w-0 text-xs text-gray-900 border border-gray-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-amber-300"
          />
          <button onClick={addValue} className="text-xs text-amber-600 hover:text-amber-800 font-medium flex-shrink-0">Add</button>
          <button onClick={() => setAddingValue(false)} className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0">Cancel</button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <button
            onClick={() => { setNewValueColor(randomColor(property.values.map(v => v.color))); setAddingValue(true) }}
            className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            + Add value
          </button>
          {scopeWorkspace ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
              style={{
                backgroundColor: scopeScheme?.primary ?? '#6B7280',
                color: scopeScheme?.textOnColor ?? '#FFFFFF',
              }}
            >
              {scopeWorkspace.emoji && <span className="w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] leading-none flex-shrink-0" style={{ backgroundColor: scopeScheme?.muted ?? '#F3F4F6' }}>{scopeWorkspace.emoji}</span>}
              {scopeWorkspace.name}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              Global
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Individual value chip (editable) ─────────────────────────────────

function ValueChip({ value, onChanged }: { value: PropertyValue; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(value.label)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const chipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showColorPicker) return
    function handler(e: MouseEvent) {
      if (chipRef.current && !chipRef.current.contains(e.target as Node)) setShowColorPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showColorPicker])

  async function saveLabel() {
    if (!label.trim() || label === value.label) { setEditing(false); return }
    const supabase = createClient()
    await supabase.from('property_values').update({ label: label.trim() }).eq('id', value.id)
    setEditing(false)
    onChanged()
  }

  async function setColor(color: string | null) {
    const supabase = createClient()
    await supabase.from('property_values').update({ color }).eq('id', value.id)
    setShowColorPicker(false)
    onChanged()
  }

  async function toggleArchived() {
    const supabase = createClient()
    await supabase.from('property_values').update({ archived: !value.archived }).eq('id', value.id)
    onChanged()
  }

  async function remove() {
    if (!window.confirm(`Remove "${value.label}"?`)) return
    const supabase = createClient()
    await supabase.from('property_values').delete().eq('id', value.id)
    onChanged()
  }

  const swatch = value.color ? getPropertyColor(value.color).swatch : '#D1D5DB'

  return (
    <div ref={chipRef} className={`relative group inline-flex items-center gap-1 bg-gray-50 border rounded px-1.5 py-0.5 ${
      value.archived ? 'border-dashed border-gray-300 opacity-60' : 'border-gray-200'
    }`}>
      <button
        onClick={() => setShowColorPicker(!showColorPicker)}
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: swatch }}
      />
      {editing ? (
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={saveLabel}
          onKeyDown={(e) => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') { setLabel(value.label); setEditing(false) } }}
          className="text-[11px] text-gray-900 bg-transparent border-none outline-none w-16"
        />
      ) : (
        <button onClick={() => setEditing(true)} className="text-[11px] text-gray-700 hover:text-gray-900">{value.label}</button>
      )}
      <button
        onClick={toggleArchived}
        title={value.archived ? 'Unarchive value' : 'Archive value'}
        className="text-gray-300 hover:text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5"
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {value.archived
            ? <><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></>
            : <><path d="M21 8V21H3V8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></>
          }
        </svg>
      </button>
      <button onClick={remove} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>

      {showColorPicker && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-1.5 grid grid-cols-8 gap-1 z-50 w-[180px]">
          <button
            onClick={() => setColor(null)}
            className={`w-5 h-5 rounded-full border border-gray-300 ${!value.color ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
            style={{ backgroundColor: '#F3F4F6' }}
            title="No color"
          />
          {VALUE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full ${value.color === c ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
              style={{ backgroundColor: getPropertyColor(c).swatch }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── New property form ────────────────────────────────────────────────

function NewPropertyForm({
  userId,
  workspaces,
  activeWorkspaceId,
  allProperties,
  onCreated,
  onCancel,
}: {
  userId: string
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  allProperties: Property[]
  onCreated: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState<string>(activeWorkspaceId ?? 'global')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    const targetWsId = scope === 'global' ? null : scope
    const duplicate = allProperties.some(p =>
      p.name.toLowerCase() === trimmed.toLowerCase() && p.workspace_id === targetWsId
    )
    if (duplicate) {
      setError('A property with this name already exists in this scope.')
      return
    }
    setSaving(true)
    const supabase = createClient()
    const { error: dbErr } = await supabase.from('properties').insert({
      user_id: userId,
      name: trimmed,
      workspace_id: scope === 'global' ? null : scope,
      sort_order: allProperties.reduce((max, p) => Math.max(max, p.sort_order ?? 0), 0) + 1,
    })
    if (dbErr) {
      setError(dbErr.message)
      setSaving(false)
      return
    }
    onCreated()
  }

  return (
    <div className="border border-amber-200 bg-amber-50/50 rounded-lg p-3 space-y-2">
      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Name</label>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel() }}
          placeholder="e.g. Priority, Status, Project"
          className="w-full text-sm text-gray-900 border border-gray-200 rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-amber-300"
        />
        {error && <p className="text-xs text-red-600 mt-0.5">{error}</p>}
      </div>
      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Scope</label>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="w-full text-xs text-gray-900 border border-gray-200 rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-amber-300 bg-white"
        >
          <option value="global">Global (all workspaces)</option>
          {workspaces.map(w => (
            <option key={w.id} value={w.id}>{w.name} only</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
          className="px-3 py-1 text-xs text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40"
        >
          {saving ? 'Creating...' : 'Create'}
        </button>
        <button onClick={onCancel} className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
      </div>
    </div>
  )
}
