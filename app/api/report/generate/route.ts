import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUserApiKey } from '@/lib/get-user-ai-config'
import { formatDueDate, zonedToUtcIso, zonedDateStr } from '@/lib/date-format'
import type { DateFormatOption, TimeFormatOption } from '@/lib/date-format'
import { REPORT_SUMMARY_DEFAULT_PROMPT } from '@/lib/ai-prompts'

function stripHTML(html: string | null): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(text: string, max = 200): string {
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd() + '…'
}

function formatDue(date: string | null, type: string | null, dateFmt: DateFormatOption, timeFmt: TimeFormatOption, tz: string): string {
  if (!date) return ''
  const label = formatDueDate(date, dateFmt, timeFmt, tz)
  return type === 'deadline' ? `${label} (deadline)` : label
}

function formatDateHeader(date: string): string {
  return new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
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

interface PersonRow { id: string; name: string }

interface RequestBody {
  workspaceId?: string | null // legacy single-workspace
  workspaceIds?: string[] | null // new multi-workspace
  dateFrom?: string
  dateTo?: string
  includeAiSummary?: boolean
  summaryOnly?: boolean
  templateName?: string
  entryTypeFilter?: string | null
  statusFilter?: string | null
}

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: RequestBody
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const today = new Date().toISOString().split('T')[0]
  const dateFrom = body.dateFrom || today
  const dateTo = body.dateTo || today

  // Support both legacy single workspace and new multi-workspace
  const wsIds: string[] = body.workspaceIds ?? (body.workspaceId ? [body.workspaceId] : [])
  const filterByWs = wsIds.length > 0

  const { data: profileData } = await supabase.from('profiles').select('date_format, time_format, timezone').eq('id', user.id).single()
  const userDateFmt = (profileData?.date_format ?? 'MM/DD/YYYY') as DateFormatOption
  const userTimeFmt = (profileData?.time_format ?? '12h') as TimeFormatOption
  const userTz = (profileData?.timezone as string | undefined) ?? 'UTC'
  // Local-day bounds (in the user's zone) as true-UTC instants for querying.
  const fromBound = zonedToUtcIso(dateFrom, '00:00:00', userTz)
  const toBound = zonedToUtcIso(dateTo, '23:59:59', userTz)
  const todayStartBound = zonedToUtcIso(zonedDateStr(new Date().toISOString(), userTz), '00:00:00', userTz)

  const { data: peopleData } = await supabase.from('people').select('id, name').eq('user_id', user.id)
  const people = (peopleData ?? []) as PersonRow[]
  const personName = (id: string | null): string => {
    if (!id) return 'Me'
    return people.find(p => p.id === id)?.name ?? 'Me'
  }

  // Resolve workspace names
  const { data: allWsData } = await supabase.from('workspaces').select('id, name').eq('user_id', user.id)
  const wsNameMap = new Map((allWsData ?? []).map((w: { id: string; name: string }) => [w.id, w.name]))
  const wsName = (id: string | null): string => (id ? wsNameMap.get(id) : null) ?? 'Unassigned'
  let wsLabel = 'All Workspaces'
  if (filterByWs) {
    wsLabel = wsIds.map(id => wsNameMap.get(id) ?? id).join(', ')
  }

  // Group blocks by workspace, preserving order within each group
  function groupByWorkspace(blocks: BlockRow[]): { name: string; items: BlockRow[] }[] {
    const map: Record<string, BlockRow[]> = {}
    const order: string[] = []
    for (const b of blocks) {
      const name = wsName(b.workspace_id)
      if (!map[name]) { map[name] = []; order.push(name) }
      map[name].push(b)
    }
    return order.map(name => ({ name, items: map[name] }))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyFilters(q: any) {
    if (filterByWs) q = q.in('workspace_id', wsIds)
    if (body.entryTypeFilter) q = q.eq('entry_type', body.entryTypeFilter)
    return q
  }

  // Query A — Top open priorities (High priority active tasks)
  let priorityTasks: BlockRow[] = []
  if (!body.summaryOnly || body.includeAiSummary) {
    const { data: priorityProp } = await supabase.from('properties').select('id').eq('user_id', user.id).eq('name', 'Priority').maybeSingle()
    if (priorityProp) {
      const { data: highVal } = await supabase.from('property_values').select('id').eq('property_id', priorityProp.id).eq('label', 'High').maybeSingle()
      if (highVal) {
        const { data: entries } = await supabase.from('entry_properties').select('entry_id').eq('property_value_id', highVal.id)
        const blockIds = (entries ?? []).map(e => (e as { entry_id: string }).entry_id)
        if (blockIds.length > 0) {
          let q = supabase.from('journal_blocks')
            .select('id, content, entry_type, status, task_status, owner_id, due_date, due_date_type, workspace_id')
            .eq('user_id', user.id).eq('entry_type', 'task').eq('status', 'active').is('deleted_at', null)
            .in('id', blockIds).order('due_date', { ascending: true, nullsFirst: false }).limit(10)
          q = applyFilters(q)
          const { data } = await q
          priorityTasks = (data ?? []) as BlockRow[]
        }
      }
    }
  }

  // Query B — Worked on in date range (also needed for AI summary)
  let workedOn: BlockRow[] = []
  if (!body.summaryOnly || body.includeAiSummary) {
    let q = supabase.from('journal_blocks')
      .select('id, content, entry_type, status, task_status, owner_id, due_date, due_date_type, workspace_id')
      .eq('user_id', user.id).eq('is_scratch', false).is('deleted_at', null)
      .or(`created_at.gte.${fromBound},updated_at.gte.${fromBound}`)
      .lte('created_at', toBound)
      .order('created_at', { ascending: false }).limit(30)
    if (body.statusFilter) q = q.eq('status', body.statusFilter)
    else q = q.neq('status', 'archived')
    q = applyFilters(q)
    const { data } = await q
    workedOn = (data ?? []) as BlockRow[]
  }

  // Query C — Completed in date range
  let completed: BlockRow[] = []
  if (!body.summaryOnly || body.includeAiSummary) {
    let q = supabase.from('journal_blocks')
      .select('id, content, entry_type, status, task_status, owner_id, due_date, due_date_type, workspace_id')
      .eq('user_id', user.id).eq('entry_type', 'task').is('deleted_at', null)
      // The card UI marks tasks done via task_status; MCP may still write status='complete'.
      .or('status.eq.complete,task_status.eq.done')
      .gte('updated_at', fromBound).lte('updated_at', toBound)
      .order('updated_at', { ascending: false }).limit(20)
    q = applyFilters(q)
    const { data } = await q
    completed = (data ?? []) as BlockRow[]
  }

  // Query D — Past due
  let pastDue: BlockRow[] = []
  if (!body.summaryOnly || body.includeAiSummary) {
    let q = supabase.from('journal_blocks')
      .select('id, content, entry_type, status, task_status, owner_id, due_date, due_date_type, workspace_id')
      .eq('user_id', user.id).eq('entry_type', 'task').eq('status', 'active').is('deleted_at', null)
      .lt('due_date', todayStartBound).order('due_date', { ascending: true }).limit(20)
    q = applyFilters(q)
    const { data } = await q
    pastDue = (data ?? []) as BlockRow[]
  }

  // Build text report
  const sections: string[] = []
  const dateLabel = dateFrom === dateTo
    ? formatDateHeader(dateFrom)
    : `${formatDateHeader(dateFrom)} – ${formatDateHeader(dateTo)}`

  const reportTitle = body.templateName?.trim() || 'Report'
  sections.push(`${reportTitle} — ${dateLabel}`)
  sections.push(wsLabel)
  sections.push('')

  // AI Summary (if requested)
  if (body.includeAiSummary) {
    // Collect all content for summarization
    const allBlocks = [...priorityTasks, ...workedOn, ...completed, ...pastDue]
    const uniqueBlocks = Array.from(new Map(allBlocks.map(b => [b.id, b])).values())
    const contentText = uniqueBlocks.map(b => stripHTML(b.content)).filter(Boolean).join('\n')

    if (contentText.trim()) {
      try {
        const apiKey = await getUserApiKey(user.id)
        if (apiKey) {
          // Fetch user's custom report summary prompt (if any)
          const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
          const { data: promptOverride } = await svc
            .from('user_prompt_templates')
            .select('prompt_text')
            .eq('user_id', user.id)
            .eq('prompt_key', 'report_summary')
            .maybeSingle()
          const reportPrompt = promptOverride?.prompt_text ?? REPORT_SUMMARY_DEFAULT_PROMPT

          const Anthropic = (await import('@anthropic-ai/sdk')).default
          const client = new Anthropic({ apiKey })
          const msg = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            messages: [{
              role: 'user',
              content: `${reportPrompt}\n\n${contentText.slice(0, 4000)}`,
            }],
          })
          const summary = msg.content[0].type === 'text' ? msg.content[0].text : ''
          sections.push('SUMMARY')
          sections.push(summary)
          sections.push('')
        }
      } catch {
        // AI summary failed silently — continue without it
      }
    }
  }

  if (!body.summaryOnly) {
    if (body.includeAiSummary) {
      sections.push('————————————————————————————————')
      sections.push('')
      sections.push('DETAIL')
      sections.push('')
    }
    if (priorityTasks.length > 0) {
      sections.push('TOP PRIORITIES')
      for (const { name: ws, items } of groupByWorkspace(priorityTasks)) {
        sections.push(`[${ws}]`)
        for (const t of items) {
          sections.push(`• ${truncate(stripHTML(t.content))} — Owner: ${personName(t.owner_id)}${t.due_date ? ` — Due: ${formatDue(t.due_date, t.due_date_type, userDateFmt, userTimeFmt, userTz)}` : ''}`)
        }
      }
      sections.push('')
    }

    if (workedOn.length > 0) {
      sections.push('WORKED ON')
      for (const { name: ws, items } of groupByWorkspace(workedOn)) {
        sections.push(`[${ws}]`)
        for (const w of items) {
          sections.push(`• ${truncate(stripHTML(w.content))}`)
        }
      }
      sections.push('')
    }

    if (completed.length > 0) {
      sections.push('COMPLETED')
      for (const { name: ws, items } of groupByWorkspace(completed)) {
        sections.push(`[${ws}]`)
        for (const c of items) {
          sections.push(`• ${truncate(stripHTML(c.content))} — Owner: ${personName(c.owner_id)}`)
        }
      }
      sections.push('')
    }

    if (pastDue.length > 0) {
      sections.push('PAST DUE')
      for (const { name: ws, items } of groupByWorkspace(pastDue)) {
        sections.push(`[${ws}]`)
        for (const p of items) {
          sections.push(`• ${truncate(stripHTML(p.content))} — Due: ${formatDue(p.due_date, p.due_date_type, userDateFmt, userTimeFmt, userTz)} — Owner: ${personName(p.owner_id)}`)
        }
      }
      sections.push('')
    }

    if (priorityTasks.length === 0 && workedOn.length === 0 && completed.length === 0 && pastDue.length === 0) {
      sections.push('No activity for this period.')
      sections.push('')
    }
  }

  const report = sections.join('\n')
  const subject = `${reportTitle} — ${dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`}`

  return Response.json({ report, subject })
}
