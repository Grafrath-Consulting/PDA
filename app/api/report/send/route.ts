import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

// Build an RFC 2822 email and base64url-encode it for Gmail API
function buildRawEmail(to: string[], subject: string, body: string, from: string): string {
  const toHeader = to.join(', ')
  const message = [
    `From: ${from}`,
    `To: ${toHeader}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].join('\r\n')

  // Base64url encode (Gmail API requirement)
  const encoded = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return encoded
}

async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string } | null> {
  // Google OAuth token endpoint
  // Client ID and secret must be configured as env vars for server-side refresh.
  // These are the same credentials used in Supabase's Google OAuth provider config.
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('[report/send] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — cannot refresh token')
    return null
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    console.error('[report/send] Token refresh failed:', res.status, await res.text())
    return null
  }

  return res.json()
}

async function sendViaGmail(accessToken: string, rawEmail: string): Promise<Response> {
  return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: rawEmail }),
  })
}

export async function POST(request: Request) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { to: string[]; subject: string; body: string }
  try {
    body = await request.json()
    if (!body.to?.length || !body.subject || !body.body) {
      return Response.json({ error: 'Missing required fields (to, subject, body)' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Retrieve the user's Google provider tokens from auth.users using the service role key.
  // Supabase stores provider_token (access token) and provider_refresh_token when
  // the Google OAuth provider is configured with "Store provider tokens" enabled.
  const serviceKey = process.env.SUPABASE_SECRET_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) {
    return Response.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const adminClient = createClient(supabaseUrl, serviceKey)
  const { data: authUser, error: authErr } = await adminClient.auth.admin.getUserById(user.id)

  if (authErr || !authUser?.user) {
    console.error('[report/send] Failed to fetch auth user:', authErr)
    return Response.json({ error: 'Failed to retrieve user auth data' }, { status: 500 })
  }

  // Extract provider tokens from user identities
  const googleIdentity = authUser.user.identities?.find(i => i.provider === 'google')
  // Provider tokens may be stored in identity_data or at the top level of the user object.
  // Cast through unknown to access these dynamic fields safely.
  const userData = authUser.user as unknown as Record<string, unknown>
  const identityData = (googleIdentity?.identity_data ?? {}) as Record<string, unknown>
  let accessToken: string | null = (identityData.provider_token as string | null)
    ?? (userData.provider_token as string | null)
    ?? null
  const refreshToken: string | null = (userData.provider_refresh_token as string | null)
    ?? null

  if (!accessToken && !refreshToken) {
    return Response.json({
      error: 'Gmail access not available. Please re-authorize with Gmail permissions enabled.',
      code: 'GMAIL_NOT_AUTHORIZED',
    }, { status: 403 })
  }

  const senderEmail = user.email ?? 'noreply@example.com'
  const rawEmail = buildRawEmail(body.to, body.subject, body.body, senderEmail)

  // Attempt to send, refresh token on 401, retry once
  if (accessToken) {
    const res = await sendViaGmail(accessToken, rawEmail)
    if (res.ok) {
      return Response.json({ success: true })
    }

    // If 401 (expired), try refreshing
    if (res.status === 401 && refreshToken) {
      const refreshed = await refreshGoogleToken(refreshToken)
      if (refreshed?.access_token) {
        accessToken = refreshed.access_token
        const retryRes = await sendViaGmail(accessToken, rawEmail)
        if (retryRes.ok) {
          return Response.json({ success: true })
        }
        const errBody = await retryRes.text()
        console.error('[report/send] Gmail retry failed:', retryRes.status, errBody)
        return Response.json({ error: 'Failed to send email after token refresh' }, { status: 502 })
      }
    }

    // Non-401 error or refresh failed
    const errBody = await res.text().catch(() => '')
    console.error('[report/send] Gmail send failed:', res.status, errBody)
    if (res.status === 403) {
      return Response.json({
        error: 'Gmail send permission not granted. Please re-authorize with the gmail.send scope.',
        code: 'GMAIL_SCOPE_MISSING',
      }, { status: 403 })
    }
    return Response.json({ error: 'Failed to send email' }, { status: 502 })
  }

  // No access token but have refresh token — try refreshing
  if (refreshToken) {
    const refreshed = await refreshGoogleToken(refreshToken)
    if (refreshed?.access_token) {
      const res = await sendViaGmail(refreshed.access_token, rawEmail)
      if (res.ok) {
        return Response.json({ success: true })
      }
      const errBody = await res.text()
      console.error('[report/send] Gmail send after refresh failed:', res.status, errBody)
      return Response.json({ error: 'Failed to send email' }, { status: 502 })
    }
    return Response.json({
      error: 'Unable to refresh Gmail access token. Please re-authorize.',
      code: 'GMAIL_REFRESH_FAILED',
    }, { status: 403 })
  }

  return Response.json({ error: 'Gmail access not available' }, { status: 403 })
}
