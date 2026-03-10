import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const anthropic = new Anthropic()

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

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `Condense the following text into a concise summary that preserves all key information. Return only the summary, no preamble.\n\n${text}`,
      },
    ],
  })

  const summary =
    message.content[0]?.type === 'text' ? message.content[0].text : text

  return Response.json({ summary })
}
