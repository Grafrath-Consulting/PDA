import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { embedQuery } from '@/lib/voyage'

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

  let query: string, threshold: number, limit: number, workspaceId: string | null
  try {
    const body = await request.json()
    query = body?.query
    if (!query || typeof query !== 'string' || !query.trim()) {
      return Response.json({ error: 'Missing query' }, { status: 400 })
    }
    threshold = body?.threshold ?? 0.28
    limit = body?.limit ?? 20
    workspaceId = body?.workspaceId ?? null
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const queryEmbedding = await embedQuery(query.trim())

    const svc = getServiceSupabase()
    const { data: chunks, error: rpcError } = await svc.rpc('match_chunks', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_user_id: user.id,
      match_threshold: threshold,
      match_count: limit * 3,
    })

    if (rpcError) {
      console.error('[ai-search] RPC error:', rpcError)
      return Response.json({ error: 'Search failed' }, { status: 500 })
    }

    // Deduplicate by block_id, keeping highest similarity and its chunk text
    const blockScores = new Map<string, number>()
    const blockMatchedChunks = new Map<string, string>()
    for (const chunk of (chunks ?? [])) {
      const existing = blockScores.get(chunk.block_id)
      if (!existing || chunk.similarity > existing) {
        blockScores.set(chunk.block_id, chunk.similarity)
        blockMatchedChunks.set(chunk.block_id, chunk.chunk_text)
      }
    }

    // Sort by similarity descending, take top N
    const ranked = Array.from(blockScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)

    if (ranked.length === 0) {
      return Response.json({ results: [], scores: {} })
    }

    const blockIds = ranked.map(([id]) => id)

    // Fetch full block rows
    let blockQuery = svc
      .from('journal_blocks')
      .select('*')
      .in('id', blockIds)
      .eq('user_id', user.id)
      .is('deleted_at', null)

    if (workspaceId) {
      blockQuery = blockQuery.eq('workspace_id', workspaceId)
    }

    const { data: blocks } = await blockQuery

    // Preserve similarity ranking
    const blockMap = new Map((blocks ?? []).map(b => [b.id, b]))
    const results = blockIds
      .map(id => blockMap.get(id))
      .filter(Boolean)

    const scores: Record<string, number> = {}
    const matchedChunks: Record<string, string> = {}
    for (const [id, score] of ranked) {
      scores[id] = score
      const chunkText = blockMatchedChunks.get(id)
      if (chunkText) matchedChunks[id] = chunkText
    }

    return Response.json({ results, scores, matchedChunks })
  } catch (err) {
    console.error('[ai-search] Error:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Search failed' }, { status: 500 })
  }
}
