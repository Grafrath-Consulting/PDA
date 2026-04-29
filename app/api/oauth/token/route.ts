import { getServiceClient } from '@/lib/mcp/auth'
import { generateToken, hashToken } from '@/lib/mcp/tokens'
import { verifyPkceS256, constantTimeEqual } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACCESS_TOKEN_TTL_DAYS = 30

function err(error: string, description: string, status = 400) {
  return Response.json({ error, error_description: description }, { status })
}

// Parse client credentials from either Basic auth or POST body.
function readClientCreds(req: Request, body: URLSearchParams): { clientId: string; clientSecret: string } | null {
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8')
      const [id, ...rest] = decoded.split(':')
      const secret = rest.join(':')
      if (id && secret) return { clientId: decodeURIComponent(id), clientSecret: decodeURIComponent(secret) }
    } catch { /* fall through */ }
  }
  const id = body.get('client_id')
  const secret = body.get('client_secret')
  if (id && secret) return { clientId: id, clientSecret: secret }
  return null
}

export async function POST(request: Request) {
  let body: URLSearchParams
  try {
    const text = await request.text()
    body = new URLSearchParams(text)
  } catch {
    return err('invalid_request', 'Body must be application/x-www-form-urlencoded')
  }

  const grantType = body.get('grant_type')
  if (grantType !== 'authorization_code') {
    return err('unsupported_grant_type', 'Only authorization_code is supported')
  }

  const code = body.get('code')
  const redirectUri = body.get('redirect_uri')
  const codeVerifier = body.get('code_verifier')
  if (!code || !redirectUri || !codeVerifier) {
    return err('invalid_request', 'code, redirect_uri, and code_verifier are required')
  }

  const creds = readClientCreds(request, body)
  if (!creds) return err('invalid_client', 'Client credentials missing', 401)

  const svc = getServiceClient()

  // Look up the client and verify the secret.
  const { data: client } = await svc
    .from('mcp_oauth_clients')
    .select('client_id, client_secret_hash, user_id, revoked_at')
    .eq('client_id', creds.clientId)
    .maybeSingle()
  if (!client || client.revoked_at) return err('invalid_client', 'Unknown or revoked client', 401)
  if (!constantTimeEqual(client.client_secret_hash, hashToken(creds.clientSecret))) {
    return err('invalid_client', 'Bad client secret', 401)
  }

  // Look up the authorization code by hash. One-shot: mark as used immediately.
  const codeHash = hashToken(code)
  const { data: codeRow } = await svc
    .from('mcp_oauth_codes')
    .select('id, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at, used_at')
    .eq('code_hash', codeHash)
    .maybeSingle()

  if (!codeRow) return err('invalid_grant', 'Code not found')
  if (codeRow.used_at) return err('invalid_grant', 'Code already used')
  if (new Date(codeRow.expires_at) < new Date()) return err('invalid_grant', 'Code expired')
  if (codeRow.client_id !== creds.clientId) return err('invalid_grant', 'Code was issued to a different client')
  if (codeRow.redirect_uri !== redirectUri) return err('invalid_grant', 'redirect_uri mismatch')
  if (codeRow.code_challenge_method !== 'S256') return err('invalid_grant', 'Unsupported PKCE method')
  if (!verifyPkceS256(codeVerifier, codeRow.code_challenge)) return err('invalid_grant', 'PKCE verification failed')

  await svc.from('mcp_oauth_codes').update({ used_at: new Date().toISOString() }).eq('id', codeRow.id)

  // Issue an access token. Reuses mcp_tokens so /api/mcp's bearer lookup
  // doesn't have to special-case OAuth-issued tokens.
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
  const { raw, hash, displayPrefix } = generateToken()
  const { error: tokenInsertErr } = await svc.from('mcp_tokens').insert({
    user_id: codeRow.user_id,
    label: `OAuth — ${creds.clientId.slice(0, 20)}…`,
    token_hash: hash,
    token_prefix: displayPrefix,
    expires_at: expiresAt.toISOString(),
    client_id: creds.clientId,
  })
  if (tokenInsertErr) {
    console.error('[oauth/token] token insert error:', tokenInsertErr)
    return err('server_error', 'Failed to issue access token', 500)
  }

  // Touch last_used_at on the client for activity tracking.
  svc.from('mcp_oauth_clients')
    .update({ last_used_at: new Date().toISOString() })
    .eq('client_id', creds.clientId)
    .then(() => {}, () => {})

  return Response.json({
    access_token: raw,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60,
    scope: codeRow.scope ?? 'mcp',
  })
}
