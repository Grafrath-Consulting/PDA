'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SelectionAction } from '../types'

interface Project { id: string; name: string }

type Step = 'main' | 'project'

interface Props {
  position: { x: number; y: number }
  userId: string
  onClose: () => void
  onAction: (action: SelectionAction) => void
}

export function SelectionMenu({ position, userId, onClose, onAction }: Props) {
  const [step, setStep] = useState<Step>('main')
  const [projects, setProjects] = useState<Project[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)

  async function openProject() {
    setStep('project')
    if (projects.length > 0) return
    setLoadingProjects(true)
    const supabase = createClient()
    const { data } = await supabase.from('projects').select('id, name').eq('user_id', userId).neq('status', 'cancelled').order('name')
    setProjects(data ?? [])
    setLoadingProjects(false)
  }

  function act(action: SelectionAction) {
    onAction(action)
    onClose()
  }

  // Flip below the selection when near the top of the viewport to avoid clipping
  const MENU_HEIGHT_ESTIMATE = 260
  const flipDown = position.y < MENU_HEIGHT_ESTIMATE + 16
  const style: React.CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    transform: flipDown
      ? 'translate(-50%, 8px)'
      : 'translate(-50%, calc(-100% - 8px))',
    zIndex: 50,
  }

  return (
    <div
      style={style}
      className="bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-[176px]"
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
      onClick={(e) => e.stopPropagation()}
    >
      {step === 'main' && (
        <>
          <MenuSection>
            <Item onClick={() => act({ type: 'create_task', taskType: 'my_task' })}>
              <TaskIcon /> Create Task
            </Item>
<Item onClick={() => act({ type: 'create_task', taskType: 'waiting_on' })}>
              <WaitingIcon /> Waiting On
            </Item>
          </MenuSection>
          <Sep />
          <MenuSection>
            <Item onClick={() => act({ type: 'split_block' })}>
              <SplitIcon /> Split to Block
            </Item>
            <Item onClick={openProject}>
              <LinkIcon /> Link to Project…
            </Item>
            <Item onClick={() => act({ type: 'label_info' })}>
              <InfoIcon /> Label as Info
            </Item>
          </MenuSection>
          <Sep />
          <MenuSection>
            <Item onClick={() => act({ type: 'summarize' })}>
              <SparkleIcon /> AI Summarize
            </Item>
          </MenuSection>
        </>
      )}

      {step === 'project' && (
        <>
          <BackButton onClick={() => setStep('main')} />
          <p className="px-3 py-1 text-xs font-medium text-gray-400 uppercase tracking-wide">Link to project</p>
          {loadingProjects && <p className="px-3 py-2 text-xs text-gray-400">Loading…</p>}
          {!loadingProjects && projects.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400">No projects yet</p>
          )}
          {projects.map((p) => (
            <Item key={p.id} onClick={() => act({ type: 'link_project', projectId: p.id })}>
              {p.name}
            </Item>
          ))}
        </>
      )}
    </div>
  )
}

function MenuSection({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>
}

function Sep() {
  return <div className="h-px bg-gray-100 my-1" />
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 w-full"
    >
      ← Back
    </button>
  )
}

function Item({
  onClick,
  children,
  className = '',
}: {
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 text-left hover:bg-gray-50 transition-colors ${className}`}
    >
      {children}
    </button>
  )
}

// Icons
function TaskIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
}
function WaitingIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
}
function SplitIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><line x1="3" y1="12" x2="21" y2="12" /><polyline points="8 7 3 12 8 17" /><polyline points="16 7 21 12 16 17" /></svg>
}
function LinkIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
}
function InfoIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
}
function SparkleIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
}
