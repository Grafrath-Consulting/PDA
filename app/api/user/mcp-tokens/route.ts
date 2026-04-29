import { createClient } from '@/lib/supabase/server'
import { generateToken } from '@/lib/mcp/tokens'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('mcp_tokens')
    .select('id, label, token_prefix, created_at, last_used_at, expires_at, revoked_at')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[mcp-tokens] list error:', error)
    return Response.json({ error: 'Failed to load tokens' }, { status: 500 })
  }

  return Response.json({ tokens: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let label: string
  let expiresAt: string | null = null
  try {
    const body = await request.json()
    label = typeof body?.label === 'string' ? body.label.trim() : ''
    if (!label) return Response.json({ error: 'Missing label' }, { status: 400 })
    if (label.length > 80) return Response.json({ error: 'Label too long' }, { status: 400 })
    if (typeof body?.expiresAt === 'string') expiresAt = body.expiresAt
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { raw, hash, displayPrefix } = generateToken()

  const { data, error } = await supabase
    .from('mcp_tokens')
    .insert({
      user_id: user.id,
      label,
      token_hash: hash,
      token_prefix: displayPrefix,
      expires_at: expiresAt,
    })
    .select('id, label, token_prefix, created_at, expires_at')
    .single()

  if (error || !data) {
    console.error('[mcp-tokens] create error:', error)
    return Response.json({ error: 'Failed to create token' }, { status: 500 })
  }

  // The raw token is returned exactly once. After this response it is gone.
  return Response.json({ ...data, token: raw })
}
