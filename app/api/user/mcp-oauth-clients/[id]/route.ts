import { createClient } from '@/lib/supabase/server'

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('mcp_oauth_clients')
    .delete()
    .eq('id', params.id)

  if (error) {
    console.error('[mcp-oauth-clients] delete error:', error)
    return Response.json({ error: 'Failed to revoke client' }, { status: 500 })
  }
  return Response.json({ ok: true })
}
