import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { AI_PROMPT_DEFAULTS } from '@/lib/ai-prompts'

function getServiceSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )
}

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = getServiceSupabase()
  const { data: overrides } = await svc
    .from('user_prompt_templates')
    .select('prompt_key, prompt_text')
    .eq('user_id', user.id)

  const overrideMap = new Map(
    (overrides ?? []).map(o => [o.prompt_key, o.prompt_text])
  )

  const templates = Object.entries(AI_PROMPT_DEFAULTS).map(([key, def]) => ({
    key,
    label: def.label,
    description: def.description,
    promptText: overrideMap.get(key) ?? def.defaultPrompt,
    isCustom: overrideMap.has(key),
  }))

  return Response.json(templates)
}

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let key: string, promptText: string
  try {
    const body = await request.json()
    key = body?.key
    promptText = body?.promptText
    if (!key || !promptText || typeof key !== 'string' || typeof promptText !== 'string') {
      return Response.json({ error: 'Missing key or promptText' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!(key in AI_PROMPT_DEFAULTS)) {
    return Response.json({ error: 'Unknown prompt key' }, { status: 400 })
  }

  const svc = getServiceSupabase()
  const { error } = await svc
    .from('user_prompt_templates')
    .upsert({
      user_id: user.id,
      prompt_key: key,
      prompt_text: promptText.trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,prompt_key' })

  if (error) {
    console.error('[prompt-templates] Upsert error:', error)
    return Response.json({ error: 'Failed to save template' }, { status: 500 })
  }

  return Response.json({ ok: true })
}

export async function DELETE(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let key: string
  try {
    const body = await request.json()
    key = body?.key
    if (!key || typeof key !== 'string') {
      return Response.json({ error: 'Missing key' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const svc = getServiceSupabase()
  await svc
    .from('user_prompt_templates')
    .delete()
    .eq('user_id', user.id)
    .eq('prompt_key', key)

  return Response.json({ ok: true })
}
