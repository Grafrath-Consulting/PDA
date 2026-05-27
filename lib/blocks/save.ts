import { SupabaseClient } from '@supabase/supabase-js'
import { embedBlock } from './embed'

// MCP clients send wall-clock-with-offset timestamps like "T23:59:00-05:00"
// to express "end of day" / "no specific time". Normalise those to the
// canonical UTC-literal sentinel so detection works in any viewer's zone.
// (See isDueDateOnly / isStartDateOnly in lib/date-format.ts.)
function normaliseDueDate(iso: string | null | undefined): string | null | undefined {
  if (iso == null) return iso
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  if (d.getUTCHours() === 23 && d.getUTCMinutes() === 59) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T23:59:59.000Z`
  }
  return iso
}

function normaliseStartDate(iso: string | null | undefined): string | null | undefined {
  if (iso == null) return iso
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T00:00:00.000Z`
  }
  return iso
}

export interface CreateBlockInput {
  userId: string
  workspaceId: string
  content: string                // HTML or plain text; stored as-is
  entryType?: 'info' | 'task'
  propertyValueIds?: string[]
  // Task-only fields. Ignored unless entryType === 'task'.
  taskStatus?: 'not_started' | 'in_progress' | 'done'
  dueDate?: string | null        // ISO 8601 timestamp
  dueDateType?: 'deadline' | 'target' | null
  startDate?: string | null      // ISO 8601 timestamp
}

export interface CreatedBlock {
  id: string
  workspace_id: string
  content: string
  entry_type: string
  status: string
  created_at: string
  task_status?: string
  due_date?: string | null
  due_date_type?: string | null
  start_date?: string | null
  via_mcp?: boolean
}

// Server-side block insert for non-UI contexts (MCP server, future API surfaces).
// Caller passes a service-role client; we verify workspace ownership manually
// since we're outside the user's RLS context.
export async function createBlockFromMcp(
  svc: SupabaseClient,
  input: CreateBlockInput
): Promise<{ ok: true; block: CreatedBlock } | { ok: false; error: string }> {
  const entryType = input.entryType ?? 'info'

  // Verify the workspace belongs to this user before inserting.
  const { data: ws } = await svc
    .from('workspaces')
    .select('id')
    .eq('id', input.workspaceId)
    .eq('user_id', input.userId)
    .maybeSingle()
  if (!ws) return { ok: false, error: 'workspace_not_found' }

  const taskFields = entryType === 'task' ? {
    task_status: input.taskStatus ?? 'not_started',
    due_date: normaliseDueDate(input.dueDate) ?? null,
    due_date_type: input.dueDateType ?? null,
    start_date: normaliseStartDate(input.startDate) ?? null,
  } : {}

  const { data: block, error } = await svc
    .from('journal_blocks')
    .insert({
      user_id: input.userId,
      workspace_id: input.workspaceId,
      content: input.content,
      status: 'active',
      entry_type: entryType,
      via_mcp: true,
      ...taskFields,
    })
    .select('id, workspace_id, content, entry_type, status, created_at, task_status, due_date, due_date_type, start_date, via_mcp')
    .single()

  if (error || !block) {
    console.error('[createBlockFromMcp] insert error:', error)
    return { ok: false, error: 'insert_failed' }
  }

  // Attach properties. Only accept values that resolve to a property the user owns.
  if (input.propertyValueIds && input.propertyValueIds.length > 0) {
    const { data: validValues } = await svc
      .from('property_values')
      .select('id, property_id, properties!inner(user_id)')
      .in('id', input.propertyValueIds)
      .eq('properties.user_id', input.userId)

    const validIds = new Set((validValues ?? []).map((v: { id: string }) => v.id))
    const rows = input.propertyValueIds
      .filter(id => validIds.has(id))
      .map(pvId => ({ entry_id: block.id, property_value_id: pvId }))

    if (rows.length > 0) {
      await svc.from('entry_properties').insert(rows)
    }
  }

  // Fire-and-forget embed. Failures must never break the save.
  embedBlock(svc, block.id, input.userId).catch(() => {})

  return { ok: true, block: block as CreatedBlock }
}

export interface UpdateBlockInput {
  userId: string
  blockId: string
  content?: string
  taskStatus?: 'not_started' | 'in_progress' | 'done'
  dueDate?: string | null
  dueDateType?: 'deadline' | 'target' | null
  startDate?: string | null
  status?: 'active' | 'archived' | 'complete'
}

export async function updateBlockFromMcp(
  svc: SupabaseClient,
  input: UpdateBlockInput
): Promise<{ ok: true; block: CreatedBlock } | { ok: false; error: string }> {
  // Verify ownership before any update.
  const { data: existing } = await svc
    .from('journal_blocks')
    .select('id, user_id')
    .eq('id', input.blockId)
    .eq('user_id', input.userId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!existing) return { ok: false, error: 'block_not_found' }

  // Build the patch from only the fields the caller actually provided.
  const patch: Record<string, unknown> = {}
  let contentChanged = false
  if (input.content !== undefined) {
    const html = input.content.trim().startsWith('<')
      ? input.content
      : `<p>${input.content.split(/\n{2,}/).map(p => p.replace(/\n/g, '<br>')).join('</p><p>')}</p>`
    patch.content = html
    contentChanged = true
  }
  if (input.taskStatus !== undefined) patch.task_status = input.taskStatus
  if (input.dueDate !== undefined) patch.due_date = normaliseDueDate(input.dueDate)
  if (input.dueDateType !== undefined) patch.due_date_type = input.dueDateType
  if (input.startDate !== undefined) patch.start_date = normaliseStartDate(input.startDate)
  if (input.status !== undefined) {
    patch.status = input.status
    // Mirror the client save flow: keep is_archived in sync with status.
    patch.is_archived = input.status === 'archived'
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: 'no_fields_to_update' }

  // Stamp the block as MCP-touched on every MCP-driven update.
  patch.via_mcp = true

  const { data: block, error } = await svc
    .from('journal_blocks')
    .update(patch)
    .eq('id', input.blockId)
    .select('id, workspace_id, content, entry_type, status, created_at, task_status, due_date, due_date_type, start_date, via_mcp')
    .single()

  if (error || !block) {
    console.error('[updateBlockFromMcp] update error:', error)
    return { ok: false, error: 'update_failed' }
  }

  if (contentChanged) {
    embedBlock(svc, block.id, input.userId).catch(() => {})
  }

  return { ok: true, block: block as CreatedBlock }
}
