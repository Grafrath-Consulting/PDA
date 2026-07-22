import { createClient } from '@/lib/supabase/server'
import { getServiceClient } from '@/lib/mcp/auth'
import { generateAuthCode, createConsentNonce, verifyConsentNonce } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const AUTH_CODE_TTL_MS = 60_000 // 1 minute

type AuthParams = {
  responseType: string | null
  clientId: string | null
  redirectUri: string | null
  state: string | null
  codeChallenge: string | null
  codeChallengeMethod: string
  scope: string | null
}

type ClientRow = {
  client_id: string
  user_id: string
  label: string
  redirect_uris: string[] | null
  revoked_at: string | null
}

function inlineError(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status })
}

// Only ever called with a redirect_uri already validated against the client's
// registered allow-list — RFC 6749 §4.1.2.1 forbids redirecting to an
// unverified URI.
function errorRedirect(redirectUri: string, error: string, description: string, state: string | null): Response {
  let u: URL
  try {
    u = new URL(redirectUri)
  } catch {
    return inlineError(error, description)
  }
  u.searchParams.set('error', error)
  u.searchParams.set('error_description', description)
  if (state) u.searchParams.set('state', state)
  return Response.redirect(u.toString(), 302)
}

// Validate everything that can be checked without a session. Until the
// redirect_uri is confirmed against the registered allow-list, every failure
// is returned inline (NOT via redirect); after that point redirect delivery
// is safe.
async function validateAuthRequest(p: AuthParams): Promise<{ ok: true; client: ClientRow } | { ok: false; res: Response }> {
  if (!p.clientId) {
    return { ok: false, res: inlineError('invalid_request', 'client_id is required') }
  }
  if (!p.redirectUri) {
    return { ok: false, res: inlineError('invalid_request', 'redirect_uri is required') }
  }

  const svc = getServiceClient()
  const { data: client } = await svc
    .from('mcp_oauth_clients')
    .select('client_id, user_id, label, redirect_uris, revoked_at')
    .eq('client_id', p.clientId)
    .maybeSingle()

  if (!client || client.revoked_at) {
    return { ok: false, res: inlineError('invalid_client', 'Unknown or revoked client') }
  }

  // Fail closed: an empty registered list rejects every redirect_uri.
  const allowedUris: string[] = client.redirect_uris ?? []
  if (!allowedUris.includes(p.redirectUri)) {
    return { ok: false, res: inlineError('invalid_request', 'redirect_uri is not registered for this client') }
  }

  if (p.responseType !== 'code') {
    return { ok: false, res: errorRedirect(p.redirectUri, 'unsupported_response_type', 'Only response_type=code is supported.', p.state) }
  }
  if (!p.codeChallenge) {
    return { ok: false, res: errorRedirect(p.redirectUri, 'invalid_request', 'code_challenge is required (PKCE)', p.state) }
  }
  if (p.codeChallengeMethod !== 'S256') {
    return { ok: false, res: errorRedirect(p.redirectUri, 'invalid_request', 'Only S256 code_challenge_method is supported', p.state) }
  }

  return { ok: true, client }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function consentPage(clientLabel: string, p: AuthParams, nonce: string): Response {
  const fields: Array<[string, string]> = [
    ['response_type', p.responseType ?? ''],
    ['client_id', p.clientId ?? ''],
    ['redirect_uri', p.redirectUri ?? ''],
    ['code_challenge', p.codeChallenge ?? ''],
    ['code_challenge_method', p.codeChallengeMethod],
    ['nonce', nonce],
  ]
  if (p.state) fields.push(['state', p.state])
  if (p.scope) fields.push(['scope', p.scope])

  const hiddenInputs = fields
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('\n      ')

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize access</title>
</head>
<body style="margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f5f5f4;color:#1c1917;display:flex;min-height:100vh;align-items:center;justify-content:center;">
  <main style="background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:32px;max-width:400px;width:calc(100% - 48px);box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <h1 style="margin:0 0 12px;font-size:20px;">Authorize access</h1>
    <p style="margin:0 0 8px;line-height:1.5;"><strong>${escapeHtml(clientLabel)}</strong> is requesting access to your journal.</p>
    <p style="margin:0 0 24px;font-size:13px;color:#78716c;">Scope: ${escapeHtml(p.scope ?? 'mcp')}</p>
    <form method="POST" action="/api/oauth/authorize" style="display:flex;gap:12px;margin:0;">
      ${hiddenInputs}
      <button type="submit" name="decision" value="approve" style="flex:1;padding:10px 16px;border:none;border-radius:8px;background:#1c1917;color:#fff;font-size:14px;cursor:pointer;">Approve</button>
      <button type="submit" name="decision" value="deny" style="flex:1;padding:10px 16px;border:1px solid #d6d3d1;border-radius:8px;background:#fff;color:#1c1917;font-size:14px;cursor:pointer;">Deny</button>
    </form>
  </main>
</body>
</html>`
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // The consent page must never render in a frame (clickjacking).
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const params = url.searchParams
  const p: AuthParams = {
    responseType: params.get('response_type'),
    clientId: params.get('client_id'),
    redirectUri: params.get('redirect_uri'),
    state: params.get('state'),
    codeChallenge: params.get('code_challenge'),
    codeChallengeMethod: params.get('code_challenge_method') ?? 'S256',
    scope: params.get('scope'),
  }

  const validated = await validateAuthRequest(p)
  if (!validated.ok) return validated.res
  const client = validated.client

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
    return errorRedirect(p.redirectUri!, 'access_denied', 'You are not authorized to grant access for this client', p.state)
  }

  // Never mint a code on a bare GET — render a consent form whose approval
  // POSTs back here with a signed nonce.
  const nonce = createConsentNonce(user.id, client.client_id, p.redirectUri!)
  return consentPage(client.label, p, nonce)
}

export async function POST(request: Request) {
  let form: URLSearchParams
  try {
    form = new URLSearchParams(await request.text())
  } catch {
    return inlineError('invalid_request', 'Body must be application/x-www-form-urlencoded')
  }

  const p: AuthParams = {
    responseType: form.get('response_type'),
    clientId: form.get('client_id'),
    redirectUri: form.get('redirect_uri'),
    state: form.get('state') || null,
    codeChallenge: form.get('code_challenge'),
    codeChallengeMethod: form.get('code_challenge_method') || 'S256',
    scope: form.get('scope') || null,
  }

  // Re-validate everything — the form fields are as untrusted as query params.
  const validated = await validateAuthRequest(p)
  if (!validated.ok) return validated.res
  const client = validated.client

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return inlineError('access_denied', 'Not signed in', 401)
  }
  if (user.id !== client.user_id) {
    return errorRedirect(p.redirectUri!, 'access_denied', 'You are not authorized to grant access for this client', p.state)
  }

  const nonce = form.get('nonce') ?? ''
  if (!verifyConsentNonce(nonce, user.id, client.client_id, p.redirectUri!)) {
    return inlineError('invalid_request', 'Consent expired or invalid — restart the authorization flow')
  }

  if (form.get('decision') !== 'approve') {
    return errorRedirect(p.redirectUri!, 'access_denied', 'The user denied the authorization request', p.state)
  }

  const svc = getServiceClient()
  const { raw, hash } = generateAuthCode()
  const { error } = await svc.from('mcp_oauth_codes').insert({
    code_hash: hash,
    client_id: client.client_id,
    user_id: user.id,
    redirect_uri: p.redirectUri,
    code_challenge: p.codeChallenge,
    code_challenge_method: p.codeChallengeMethod,
    scope: p.scope,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
  })
  if (error) {
    console.error('[oauth/authorize] insert error:', error)
    return errorRedirect(p.redirectUri!, 'server_error', 'Failed to issue authorization code', p.state)
  }

  const finalRedirect = new URL(p.redirectUri!)
  finalRedirect.searchParams.set('code', raw)
  if (p.state) finalRedirect.searchParams.set('state', p.state)
  return Response.redirect(finalRedirect.toString(), 302)
}
