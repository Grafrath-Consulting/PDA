import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { TOKEN_PREFIX, hashToken } from './tokens'

// The MCP server runs outside any user JWT context, so it uses the service-role
// client and scopes every query manually with .eq('user_id', userId). RLS does
// NOT protect these routes — the user_id filter in each tool query does.
let cached: SupabaseClient | null = null
export function getServiceClient(): SupabaseClient {
  if (cached) return cached
  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  return cached
}

export class McpAuthError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const LAST_USED_THROTTLE_MS = 60_000

export async function validateBearer(req: Request): Promise<{ userId: string; tokenId: string }> {
  const header = req.headers.get('authorization') ?? ''
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!raw || !raw.startsWith(TOKEN_PREFIX)) {
    throw new McpAuthError(401, 'Missing or malformed bearer token')
  }

  const svc = getServiceClient()
  const { data, error } = await svc
    .from('mcp_tokens')
    .select('id, user_id, revoked_at, expires_at, last_used_at')
    .eq('token_hash', hashToken(raw))
    .maybeSingle()

  if (error || !data) throw new McpAuthError(401, 'Invalid token')
  if (data.revoked_at) throw new McpAuthError(401, 'Token revoked')
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    throw new McpAuthError(401, 'Token expired')
  }

  // Throttle last_used_at writes; fire-and-forget.
  const stale = !data.last_used_at || Date.now() - new Date(data.last_used_at).getTime() > LAST_USED_THROTTLE_MS
  if (stale) {
    svc.from('mcp_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)
      .then(() => {}, () => {})
  }

  return { userId: data.user_id, tokenId: data.id }
}
