import { SupabaseClient } from '@supabase/supabase-js'
import { chunkText } from '@/lib/chunk-text'
import { embedTexts } from '@/lib/voyage'

// Re-embed a block. Caller passes a service-role client because RLS-bypass is
// needed to update block_chunks. The userId is required so we can verify
// ownership and tag the chunk rows.
//
// Errors are logged but do not throw — callers should treat embedding as
// fire-and-forget. (See CLAUDE.md: embedding failures must never break saves.)
export async function embedBlock(
  svc: SupabaseClient,
  blockId: string,
  userId: string
): Promise<{ ok: true; chunks: number } | { ok: false; error: string }> {
  if (!process.env.VOYAGE_API_KEY) {
    return { ok: false, error: 'embedding_not_configured' }
  }

  try {
    const { data: block } = await svc
      .from('journal_blocks')
      .select('id, content, user_id')
      .eq('id', blockId)
      .eq('user_id', userId)
      .maybeSingle()

    if (!block) return { ok: false, error: 'block_not_found' }

    const chunks = chunkText(block.content ?? '')
    if (chunks.length === 0) {
      const { error: deleteError } = await svc.from('block_chunks').delete().eq('block_id', blockId)
      if (deleteError) {
        console.error('[embedBlock] chunk delete error:', deleteError)
        return { ok: false, error: 'chunk_delete_failed' }
      }
      return { ok: true, chunks: 0 }
    }

    // Embed first: old chunks are only removed once the new embeddings
    // exist, so a Voyage failure can never leave the block with no index.
    const embeddings = await embedTexts(chunks)

    const rows = chunks.map((text, i) => ({
      block_id: blockId,
      user_id: userId,
      chunk_index: i,
      chunk_text: text,
      embedding: JSON.stringify(embeddings[i]),
    }))

    const { error: deleteError } = await svc.from('block_chunks').delete().eq('block_id', blockId)
    if (deleteError) {
      console.error('[embedBlock] chunk delete error:', deleteError)
      return { ok: false, error: 'chunk_delete_failed' }
    }

    const { error: insertError } = await svc.from('block_chunks').insert(rows)
    if (insertError) {
      console.error('[embedBlock] chunk insert error:', insertError)
      return { ok: false, error: 'chunk_insert_failed' }
    }

    return { ok: true, chunks: chunks.length }
  } catch (err) {
    console.error('[embedBlock] Error:', err)
    return { ok: false, error: 'embedding_failed' }
  }
}
