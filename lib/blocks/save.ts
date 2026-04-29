import { SupabaseClient } from '@supabase/supabase-js'
import { embedBlock } from './embed'

export interface CreateBlockInput {
  userId: string
  workspaceId: string
  content: string                // HTML or plain text; stored as-is
  entryType?: 'info' | 'task'
  propertyValueIds?: string[]
}

export interface CreatedBlock {
  id: string
  workspace_id: string
  content: string
  entry_type: string
  status: string
  created_at: string
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

  const { data: block, error } = await svc
    .from('journal_blocks')
    .insert({
      user_id: input.userId,
      workspace_id: input.workspaceId,
      content: input.content,
      status: 'active',
      entry_type: entryType,
    })
    .select('id, workspace_id, content, entry_type, status, created_at')
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
