import { createClient } from '@/lib/supabase/server'
import { getServiceClient } from '@/lib/mcp/auth'
import { generateAuthCode } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const AUTH_CODE_TTL_MS = 60_000 // 1 minute

function errorRedirect(redirectUri: string | null, error: string, description: string, state: string | null): Response {
  if (redirectUri) {
    const u = new URL(redirectUri)
    u.searchParams.set('error', error)
    u.searchParams.set('error_description', description)
    if (state) u.searchParams.set('state', state)
    return Response.redirect(u.toString(), 302)
  }
  return Response.json({ error, error_description: description }, { status: 400 })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const params = url.searchParams
  const responseType = params.get('response_type')
  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  const state = params.get('state')
  const codeChallenge = params.get('code_challenge')
  const codeChallengeMethod = params.get('code_challenge_method') ?? 'S256'
  const scope = params.get('scope')

  if (responseType !== 'code') {
    return errorRedirect(redirectUri, 'unsupported_response_type', 'Only response_type=code is supported.', state)
  }
  if (!clientId) {
    return Response.json({ error: 'invalid_request', error_description: 'client_id is required' }, { status: 400 })
  }
  if (!redirectUri) {
    return Response.json({ error: 'invalid_request', error_description: 'redirect_uri is required' }, { status: 400 })
  }
  if (!codeChallenge) {
    return errorRedirect(redirectUri, 'invalid_request', 'code_challenge is required (PKCE)', state)
  }
  if (codeChallengeMethod !== 'S256') {
    return errorRedirect(redirectUri, 'invalid_request', 'Only S256 code_challenge_method is supported', state)
  }

  // Resolve and validate the client. The redirect_uri must be in the registered
  // allow-list to prevent open-redirect abuse.
  const svc = getServiceClient()
  const { data: client } = await svc
    .from('mcp_oauth_clients')
    .select('client_id, user_id, redirect_uris, revoked_at')
    .eq('client_id', clientId)
    .maybeSingle()

  if (!client || client.revoked_at) {
    return Response.json({ error: 'invalid_client', error_description: 'Unknown or revoked client' }, { status: 400 })
  }
  const allowedUris: string[] = client.redirect_uris ?? []
  if (allowedUris.length > 0 && !allowedUris.includes(redirectUri)) {
    // Show error inline (NOT via redirect) when redirect_uri is unregistered —
    // redirecting an unverified URI is itself a vulnerability.
    return Response.json({ error: 'invalid_request', error_description: 'redirect_uri is not registered for this client' }, { status: 400 })
  }

  // The user must be authenticated as the client's owner. If they're not
  // signed in, send them through /login and come back here.
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const next = url.pathname + url.search
    const loginUrl = new URL('/login', url.origin)
    loginUrl.searchParams.set('next', next)
    return Response.redirect(loginUrl.toString(), 302)
  }
  if (user.id !== client.user_id) {
    return errorRedirect(redirectUri, 'access_denied', 'You are not authorized to grant access for this client', state)
  }

  // Auto-approve. v2 can render a consent screen here.
  const { raw, hash } = generateAuthCode()
  const { error } = await svc.from('mcp_oauth_codes').insert({
    code_hash: hash,
    client_id: clientId,
    user_id: user.id,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scope: scope ?? null,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
  })
  if (error) {
    console.error('[oauth/authorize] insert error:', error)
    return errorRedirect(redirectUri, 'server_error', 'Failed to issue authorization code', state)
  }

  const finalRedirect = new URL(redirectUri)
  finalRedirect.searchParams.set('code', raw)
  if (state) finalRedirect.searchParams.set('state', state)
  return Response.redirect(finalRedirect.toString(), 302)
}
