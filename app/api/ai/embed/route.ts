import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { chunkText } from '@/lib/chunk-text'
import { embedTexts } from '@/lib/voyage'

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

  if (!process.env.VOYAGE_API_KEY) {
    return Response.json({ ok: false, error: 'embedding_not_configured' })
  }

  let blockId: string
  try {
    const body = await request.json()
    blockId = body?.blockId
    if (!blockId) return Response.json({ error: 'Missing blockId' }, { status: 400 })
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const svc = getServiceSupabase()
    const { data: block } = await svc
      .from('journal_blocks')
      .select('id, content, user_id')
      .eq('id', blockId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!block) return Response.json({ error: 'Block not found' }, { status: 404 })

    const chunks = chunkText(block.content ?? '')
    if (chunks.length === 0) {
      await svc.from('block_chunks').delete().eq('block_id', blockId)
      return Response.json({ ok: true, chunks: 0 })
    }

    const embeddings = await embedTexts(chunks)

    // Delete existing chunks for this block
    await svc.from('block_chunks').delete().eq('block_id', blockId)

    // Insert new chunks
    const rows = chunks.map((text, i) => ({
      block_id: blockId,
      user_id: user.id,
      chunk_index: i,
      chunk_text: text,
      embedding: JSON.stringify(embeddings[i]),
    }))
    await svc.from('block_chunks').insert(rows)

    return Response.json({ ok: true, chunks: chunks.length })
  } catch (err) {
    console.error('[embed] Error:', err)
    return Response.json({ ok: false, error: 'embedding_failed' })
  }
}
