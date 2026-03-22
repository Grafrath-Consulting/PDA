import { createClient } from '@/lib/supabase/server'

function stripHTML(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function extractSnippet(plainText: string, query: string, maxLen = 160): string {
  if (!plainText) return ''
  const lower = plainText.toLowerCase()
  const qLower = query.toLowerCase()
  const idx = lower.indexOf(qLower)
  if (idx === -1) return plainText.slice(0, maxLen) + (plainText.length > maxLen ? '…' : '')

  const start = Math.max(0, idx - 40)
  const end = Math.min(plainText.length, idx + query.length + 100)
  let snippet = ''
  if (start > 0) snippet += '…'
  snippet += plainText.slice(start, end)
  if (end < plainText.length) snippet += '…'
  return snippet
}

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    query: string
    mode?: 'exact' | 'semantic'
    statuses?: string[]
    entryTypes?: string[]
    workspaceId?: string | null
    dateFrom?: string | null
    dateTo?: string | null
  }

  try {
    body = await request.json()
    if (!body.query || typeof body.query !== 'string' || !body.query.trim()) {
      return Response.json({ error: 'Missing query' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const query = body.query.trim()

  // Build query — ILIKE on content column (HTML stored, tags won't match search terms)
  const includeDeleted = body.statuses?.includes('deleted')
  let q = supabase
    .from('journal_blocks')
    .select('id, content, entry_type, status, task_status, workspace_id, created_at, due_date, due_date_type, owner_id')
    .eq('user_id', user.id)
    .ilike('content', `%${query}%`)
    .order('created_at', { ascending: false })
    .limit(20)

  // Only exclude deleted rows if "deleted" isn't in the requested statuses
  if (!includeDeleted) {
    q = q.is('deleted_at', null)
  }

  // Status filter — if specific statuses are given (not all 3), filter to those
  if (body.statuses && body.statuses.length > 0 && body.statuses.length < 3) {
    const dbStatuses: string[] = []
    if (body.statuses.includes('active')) dbStatuses.push('active')
    if (body.statuses.includes('archived')) dbStatuses.push('archived', 'complete')
    q = q.in('status', dbStatuses)
  }

  // Entry type filter
  const types = body.entryTypes ?? []
  const hasInfo = types.includes('info')
  const hasTaskMine = types.includes('task_mine')
  const hasTaskOthers = types.includes('task_others')
  const allTypes = types.length === 0 || (hasInfo && hasTaskMine && hasTaskOthers)

  if (!allTypes) {
    if (hasInfo && !hasTaskMine && !hasTaskOthers) {
      q = q.eq('entry_type', 'info')
    } else if (!hasInfo && (hasTaskMine || hasTaskOthers)) {
      q = q.eq('entry_type', 'task')
      if (hasTaskMine && !hasTaskOthers) {
        q = q.or(`owner_id.eq.${user.id},owner_id.is.null`)
      } else if (hasTaskOthers && !hasTaskMine) {
        q = q.not('owner_id', 'is', null).neq('owner_id', user.id)
      }
    } else if (hasInfo && (hasTaskMine || hasTaskOthers)) {
      // info + some tasks — can't do entry_type filter, post-filter tasks by owner
      if (hasTaskMine && !hasTaskOthers) {
        q = q.or(`entry_type.eq.info,and(entry_type.eq.task,or(owner_id.eq.${user.id},owner_id.is.null))`)
      } else if (hasTaskOthers && !hasTaskMine) {
        q = q.or(`entry_type.eq.info,and(entry_type.eq.task,owner_id.neq.${user.id},owner_id.not.is.null)`)
      }
    }
  }

  // Workspace filter
  if (body.workspaceId) {
    q = q.eq('workspace_id', body.workspaceId)
  }

  // Date range
  if (body.dateFrom) {
    q = q.gte('created_at', body.dateFrom + 'T00:00:00')
  }
  if (body.dateTo) {
    q = q.lte('created_at', body.dateTo + 'T23:59:59')
  }

  const { data, error } = await q

  if (error) {
    console.error('[search] Supabase error:', error)
    return Response.json({ error: 'Search failed' }, { status: 500 })
  }

  const results = (data ?? []).map((row: Record<string, unknown>) => {
    const plainText = stripHTML((row.content as string) ?? '')
    return {
      id: row.id,
      snippet: extractSnippet(plainText, query),
      entry_type: row.entry_type,
      status: row.status,
      workspace_id: row.workspace_id,
      created_at: row.created_at,
    }
  })

  return Response.json({ results })
}
