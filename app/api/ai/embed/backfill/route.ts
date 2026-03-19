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

export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.VOYAGE_API_KEY) {
    return Response.json({ ok: false, error: 'embedding_not_configured' })
  }

  const svc = getServiceSupabase()

  // Find blocks that have no chunks yet
  const { data: allBlocks } = await svc
    .from('journal_blocks')
    .select('id, content')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(500)

  if (!allBlocks || allBlocks.length === 0) {
    return Response.json({ processed: 0, skipped: 0 })
  }

  // Find which blocks already have chunks
  const { data: existingChunks } = await svc
    .from('block_chunks')
    .select('block_id')
    .in('block_id', allBlocks.map(b => b.id))

  const hasChunks = new Set((existingChunks ?? []).map(c => c.block_id))
  const toProcess = allBlocks.filter(b => !hasChunks.has(b.id))

  let processed = 0
  let skipped = 0

  for (const block of toProcess) {
    try {
      const chunks = chunkText(block.content ?? '')
      if (chunks.length === 0) { skipped++; continue }

      const embeddings = await embedTexts(chunks)

      const rows = chunks.map((text, i) => ({
        block_id: block.id,
        user_id: user.id,
        chunk_index: i,
        chunk_text: text,
        embedding: JSON.stringify(embeddings[i]),
      }))
      await svc.from('block_chunks').insert(rows)
      processed++
    } catch (err) {
      console.error(`[backfill] Error processing block ${block.id}:`, err)
      skipped++
    }
  }

  return Response.json({ processed, skipped, alreadyIndexed: hasChunks.size })
}
