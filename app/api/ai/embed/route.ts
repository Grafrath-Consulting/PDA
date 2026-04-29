import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { embedBlock } from '@/lib/blocks/embed'

function getServiceSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )
}

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let blockId: string
  try {
    const body = await request.json()
    blockId = body?.blockId
    if (!blockId) return Response.json({ error: 'Missing blockId' }, { status: 400 })
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const result = await embedBlock(getServiceSupabase(), blockId, user.id)
  if (!result.ok) {
    const status = result.error === 'block_not_found' ? 404 : 200
    return Response.json(result, { status })
  }
  return Response.json(result)
}
