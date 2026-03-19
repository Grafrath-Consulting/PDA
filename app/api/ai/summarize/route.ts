import { createClient } from '@/lib/supabase/server'
import { getUserApiKey, getUserPrompt } from '@/lib/get-user-ai-config'

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let text: string
  try {
    const body = await request.json()
    text = body?.text
    if (!text || typeof text !== 'string' || !text.trim()) {
      return Response.json({ error: 'Missing text' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const apiKey = await getUserApiKey(user.id)
  if (!apiKey) {
    return Response.json({ error: 'no_api_key', message: 'No API key configured. Add your Anthropic API key in Settings \u2192 AI.' }, { status: 402 })
  }

  const systemPrompt = await getUserPrompt(user.id, 'summarize')

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
        max_tokens: 512,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: text,
          },
        ],
      }),
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      console.error('[summarize] Anthropic error:', res.status, JSON.stringify(errBody))
      const msg = errBody?.error?.message ?? 'Summarization failed'
      return Response.json({ error: true, message: msg }, { status: res.status })
    }

    const data = await res.json()
    const summary =
      data.content[0]?.type === 'text' ? data.content[0].text : text

    return Response.json({ summary })
  } catch (err: unknown) {
    console.error('Summarize API error:', err)
    const apiErr = err as { status?: number; error?: { error?: { message?: string } } }
    const message = apiErr?.error?.error?.message
      ?? (err instanceof Error ? err.message : 'Summarization failed')
    const status = apiErr?.status ?? 500
    return Response.json({ error: true, message }, { status })
  }
}
