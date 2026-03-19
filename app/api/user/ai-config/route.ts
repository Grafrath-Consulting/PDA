import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { encryptApiKey } from '@/lib/ai-key-crypto'

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
  const { data } = await svc
    .from('user_ai_config')
    .select('api_key_hint, encrypted_api_key')
    .eq('user_id', user.id)
    .maybeSingle()

  return Response.json({
    configured: !!data?.encrypted_api_key,
    hint: data?.api_key_hint ?? null,
  })
}

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let apiKey: string
  try {
    const body = await request.json()
    apiKey = body?.apiKey
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return Response.json({ error: 'Missing apiKey' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  apiKey = apiKey.trim()

  if (!apiKey.startsWith('sk-')) {
    return Response.json({ error: 'API key should start with "sk-"' }, { status: 400 })
  }

  const encrypted = encryptApiKey(apiKey)
  const hint = `sk-...${apiKey.slice(-4)}`

  const svc = getServiceSupabase()
  const { error } = await svc
    .from('user_ai_config')
    .upsert({
      user_id: user.id,
      encrypted_api_key: encrypted,
      api_key_hint: hint,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) {
    console.error('[ai-config] Upsert error:', error)
    return Response.json({ error: 'Failed to save API key' }, { status: 500 })
  }

  return Response.json({ ok: true, hint })
}

export async function DELETE() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = getServiceSupabase()
  await svc
    .from('user_ai_config')
    .upsert({
      user_id: user.id,
      encrypted_api_key: null,
      api_key_hint: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  return Response.json({ ok: true })
}
