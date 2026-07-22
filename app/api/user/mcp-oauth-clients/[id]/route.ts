import { createClient } from '@/lib/supabase/server'
import { getServiceClient } from '@/lib/mcp/auth'

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS scopes the lookup to the caller's own clients.
  const { data: client, error: lookupErr } = await supabase
    .from('mcp_oauth_clients')
    .select('client_id')
    .eq('id', params.id)
    .maybeSingle()
  if (lookupErr) {
    console.error('[mcp-oauth-clients] lookup error:', lookupErr)
    return Response.json({ error: 'Failed to revoke client' }, { status: 500 })
  }
  if (!client) return Response.json({ error: 'Not found' }, { status: 404 })

  // Revoking a client must also invalidate everything minted through it,
  // before the client row goes away: access tokens (covered by the user's
  // DELETE policy on mcp_tokens) and outstanding auth codes (mcp_oauth_codes
  // has no user policies, so the service client is required).
  const { error: tokensErr } = await supabase
    .from('mcp_tokens')
    .delete()
    .eq('client_id', client.client_id)
  if (tokensErr) {
    console.error('[mcp-oauth-clients] token revoke error:', tokensErr)
    return Response.json({ error: 'Failed to revoke client' }, { status: 500 })
  }

  const { error: codesErr } = await getServiceClient()
    .from('mcp_oauth_codes')
    .delete()
    .eq('client_id', client.client_id)
    .eq('user_id', user.id)
  if (codesErr) {
    console.error('[mcp-oauth-clients] code revoke error:', codesErr)
    return Response.json({ error: 'Failed to revoke client' }, { status: 500 })
  }

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
