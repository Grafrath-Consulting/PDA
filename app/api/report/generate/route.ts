import { createClient } from '@/lib/supabase/server'

function stripHTML(html: string | null): string {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function truncate(text: string, max = 200): string {
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd() + '…'
}

function formatDue(date: string | null, type: string | null): string {
  if (!date) return ''
  const label = new Date(date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return type === 'hard' ? `${label} (hard)` : label
}

function formatDateHeader(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

interface BlockRow {
  id: string
  content: string | null
  entry_type: string
  status: string
  owner_id: string | null
  due_date: string | null
  due_date_type: string | null
  workspace_id: string | null
}

interface PersonRow {
  id: string
  name: string
}

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { workspaceId?: string | null; dateFrom?: string; dateTo?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  const dateFrom = body.dateFrom || today
  const dateTo = body.dateTo || today
  const wsId = body.workspaceId ?? null

  // Fetch people for owner name resolution
  const { data: peopleData } = await supabase
    .from('people')
    .select('id, name')
    .eq('user_id', user.id)
  const people = (peopleData ?? []) as PersonRow[]
  const personName = (id: string | null): string => {
    if (!id) return 'Me'
    return people.find(p => p.id === id)?.name ?? 'Me'
  }

  // Fetch workspace name for the header
  let wsName = 'All Workspaces'
  if (wsId) {
    const { data: ws } = await supabase.from('workspaces').select('name').eq('id', wsId).single()
    if (ws) wsName = ws.name
  }

  // Query A — Top open priorities (High priority active tasks)
  // First find the "Priority" property's "High" value ID for this user
  let priorityTasks: BlockRow[] = []
  const { data: priorityProp } = await supabase
    .from('properties')
    .select('id')
    .eq('user_id', user.id)
    .eq('name', 'Priority')
    .maybeSingle()

  if (priorityProp) {
    const { data: highVal } = await supabase
      .from('property_values')
      .select('id')
      .eq('property_id', priorityProp.id)
      .eq('label', 'High')
      .maybeSingle()

    if (highVal) {
      // Get block IDs that have the High priority value
      const { data: entries } = await supabase
        .from('entry_properties')
        .select('entry_id')
        .eq('property_value_id', highVal.id)

      const blockIds = (entries ?? []).map(e => (e as { entry_id: string }).entry_id)

      if (blockIds.length > 0) {
        let q = supabase
          .from('journal_blocks')
          .select('id, content, entry_type, status, owner_id, due_date, due_date_type, workspace_id')
          .eq('user_id', user.id)
          .eq('entry_type', 'task')
          .eq('status', 'active')
          .is('deleted_at', null)
          .in('id', blockIds)
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(10)
        if (wsId) q = q.eq('workspace_id', wsId)
        const { data } = await q
        priorityTasks = (data ?? []) as BlockRow[]
      }
    }
  }

  // Query B — Worked on today (created or updated in the date range)
  let workedOnQuery = supabase
    .from('journal_blocks')
    .select('id, content, entry_type, status, owner_id, due_date, due_date_type, workspace_id')
    .eq('user_id', user.id)
    .neq('status', 'archived')
    .is('deleted_at', null)
    .or(`created_at.gte.${dateFrom}T00:00:00,updated_at.gte.${dateFrom}T00:00:00`)
    .lte('created_at', dateTo + 'T23:59:59')
    .order('created_at', { ascending: false })
    .limit(30)
  if (wsId) workedOnQuery = workedOnQuery.eq('workspace_id', wsId)
  const { data: workedOnData } = await workedOnQuery
  const workedOn = (workedOnData ?? []) as BlockRow[]

  // Query C — Completed today
  let completedQuery = supabase
    .from('journal_blocks')
    .select('id, content, entry_type, status, owner_id, due_date, due_date_type, workspace_id')
    .eq('user_id', user.id)
    .eq('entry_type', 'task')
    .eq('status', 'complete')
    .is('deleted_at', null)
    .gte('updated_at', dateFrom + 'T00:00:00')
    .lte('updated_at', dateTo + 'T23:59:59')
    .order('updated_at', { ascending: false })
    .limit(20)
  if (wsId) completedQuery = completedQuery.eq('workspace_id', wsId)
  const { data: completedData } = await completedQuery
  const completed = (completedData ?? []) as BlockRow[]

  // Query D — Past due
  let pastDueQuery = supabase
    .from('journal_blocks')
    .select('id, content, entry_type, status, owner_id, due_date, due_date_type, workspace_id')
    .eq('user_id', user.id)
    .eq('entry_type', 'task')
    .eq('status', 'active')
    .is('deleted_at', null)
    .lt('due_date', today)
    .order('due_date', { ascending: true })
    .limit(20)
  if (wsId) pastDueQuery = pastDueQuery.eq('workspace_id', wsId)
  const { data: pastDueData } = await pastDueQuery
  const pastDue = (pastDueData ?? []) as BlockRow[]

  // Format the report
  const sections: string[] = []

  const dateLabel = dateFrom === dateTo
    ? formatDateHeader(dateFrom)
    : `${formatDateHeader(dateFrom)} – ${formatDateHeader(dateTo)}`

  sections.push(`END OF DAY REPORT — ${dateLabel}`)
  sections.push(wsName)
  sections.push('')

  if (priorityTasks.length > 0) {
    sections.push('TOP PRIORITIES')
    for (const t of priorityTasks) {
      const line = `• ${truncate(stripHTML(t.content))} — Owner: ${personName(t.owner_id)}${t.due_date ? ` — Due: ${formatDue(t.due_date, t.due_date_type)}` : ''}`
      sections.push(line)
    }
    sections.push('')
  }

  if (workedOn.length > 0) {
    sections.push('WORKED ON TODAY')
    for (const w of workedOn) {
      sections.push(`• ${truncate(stripHTML(w.content))}`)
    }
    sections.push('')
  }

  if (completed.length > 0) {
    sections.push('COMPLETED TODAY')
    for (const c of completed) {
      sections.push(`• ${truncate(stripHTML(c.content))} — Owner: ${personName(c.owner_id)}`)
    }
    sections.push('')
  }

  if (pastDue.length > 0) {
    sections.push('PAST DUE')
    for (const p of pastDue) {
      sections.push(`• ${truncate(stripHTML(p.content))} — Due: ${formatDue(p.due_date, p.due_date_type)} — Owner: ${personName(p.owner_id)}`)
    }
    sections.push('')
  }

  if (priorityTasks.length === 0 && workedOn.length === 0 && completed.length === 0 && pastDue.length === 0) {
    sections.push('No activity for this period.')
    sections.push('')
  }

  const report = sections.join('\n')
  const subject = `EOD Report — ${dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`} — ${wsName}`

  return Response.json({ report, subject })
}
