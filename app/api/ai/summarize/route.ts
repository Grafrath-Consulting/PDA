import { createClient } from '@/lib/supabase/server'
import { getUserApiKey, getUserPrompt } from '@/lib/get-user-ai-config'

// Models sometimes wrap HTML output in a markdown code fence and emit empty
// list items / stacked line breaks. Strip those so the rich text renders clean.
function sanitizeSummaryHtml(raw: string): string {
  let html = raw.trim()

  // Strip a leading/trailing markdown code fence (```html ... ``` or ``` ... ```)
  const fenceMatch = html.match(/^```(?:html)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fenceMatch) {
    html = fenceMatch[1].trim()
  } else {
    // Fall back to stripping stray fence markers anywhere in the text
    html = html.replace(/```html/gi, '').replace(/```/g, '').trim()
  }

  // Drop empty list items: <li></li>, <li> </li>, <li><br></li>
  html = html.replace(/<li>(?:\s|<br\s*\/?>|&nbsp;)*<\/li>/gi, '')

  // Drop empty paragraphs
  html = html.replace(/<p>(?:\s|<br\s*\/?>|&nbsp;)*<\/p>/gi, '')

  // Drop empty lists left behind once their items were removed
  html = html.replace(/<(ul|ol)>\s*<\/\1>/gi, '')

  // Collapse runs of consecutive <br> into a single one
  html = html.replace(/(?:<br\s*\/?>\s*){2,}/gi, '<br>')

  // Collapse excessive whitespace between tags
  html = html.replace(/>\s{2,}</g, '> <')

  return html.trim()
}

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

  let apiKey: string | null
  try {
    apiKey = await getUserApiKey(user.id)
  } catch (err) {
    console.error('[summarize] Failed to read API key:', err)
    return Response.json({ error: 'key_decrypt_failed', message: 'Your stored API key could not be read. Re-enter it in Settings \u2192 AI.' }, { status: 402 })
  }
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
    const rawSummary =
      data.content[0]?.type === 'text' ? data.content[0].text : text
    const summary = sanitizeSummaryHtml(rawSummary)

    return Response.json({ summary })
  } catch (err: unknown) {
    console.error('Summarize API error:', err)
    return Response.json({ error: true, message: 'Summarization failed' }, { status: 500 })
  }
}
