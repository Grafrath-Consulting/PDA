import { createClient } from '@/lib/supabase/server'
import { generateClientCredentials } from '@/lib/mcp/oauth'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('mcp_oauth_clients')
    .select('id, label, client_id, redirect_uris, created_at, last_used_at, revoked_at')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[mcp-oauth-clients] list error:', error)
    return Response.json({ error: 'Failed to load clients' }, { status: 500 })
  }
  return Response.json({ clients: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let label: string
  let redirectUris: string[]
  try {
    const body = await request.json()
    label = typeof body?.label === 'string' ? body.label.trim() : ''
    if (!label) return Response.json({ error: 'Missing label' }, { status: 400 })
    if (label.length > 80) return Response.json({ error: 'Label too long' }, { status: 400 })
    redirectUris = Array.isArray(body?.redirectUris) ? body.redirectUris.filter((u: unknown) => typeof u === 'string' && u.trim()) : []
    if (redirectUris.length === 0) return Response.json({ error: 'At least one redirect URI is required' }, { status: 400 })
    for (const u of redirectUris) {
      try {
        const parsed = new URL(u)
        if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
          return Response.json({ error: 'Redirect URIs must use https (localhost is allowed for testing)' }, { status: 400 })
        }
      } catch {
        return Response.json({ error: `Invalid redirect URI: ${u}` }, { status: 400 })
      }
    }
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { clientId, clientSecret, clientSecretHash } = generateClientCredentials()

  const { data, error } = await supabase
    .from('mcp_oauth_clients')
    .insert({
      user_id: user.id,
      label,
      client_id: clientId,
      client_secret_hash: clientSecretHash,
      redirect_uris: redirectUris,
    })
    .select('id, label, client_id, redirect_uris, created_at')
    .single()

  if (error || !data) {
    console.error('[mcp-oauth-clients] create error:', error)
    return Response.json({ error: 'Failed to create client' }, { status: 500 })
  }

  // client_secret is shown exactly once.
  return Response.json({ ...data, client_secret: clientSecret })
}
