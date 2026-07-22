import { createClient } from '@/lib/supabase/server'
import { getUserApiKey } from '@/lib/get-user-ai-config'

export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let apiKey: string | null
  try {
    apiKey = await getUserApiKey(user.id)
  } catch (err) {
    console.error('[ai-test] Failed to read API key:', err)
    return Response.json({ error: 'Your stored API key could not be read. Re-enter it in Settings → AI.' }, { status: 402 })
  }
  if (!apiKey) {
    return Response.json({ error: 'no_api_key', message: 'No API key configured.' }, { status: 402 })
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      const msg = errBody?.error?.message ?? `API returned ${res.status}`
      return Response.json({ error: msg }, { status: 200 })
    }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[ai-test] Connection error:', err)
    return Response.json({ error: 'Connection failed' }, { status: 200 })
  }
}
