import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { embedQuery } from '@/lib/voyage'
import { getUserApiKey, getUserPrompt } from '@/lib/get-user-ai-config'
import { parseSearchQuery, type ParsedSearchQuery } from '@/lib/parse-search-query'

function getServiceSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )
}

interface SmartSearchBody {
  query: string
  workspaceId?: string | null
  limit?: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = any

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let query: string, workspaceId: string | null, limit: number
  try {
    const body: SmartSearchBody = await request.json()
    query = body?.query
    if (!query || typeof query !== 'string' || !query.trim()) {
      return Response.json({ error: 'Missing query' }, { status: 400 })
    }
    workspaceId = body?.workspaceId ?? null
    limit = body?.limit ?? 30
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const trimmedQuery = query.trim()
  const svc = getServiceSupabase()
  const hasVoyage = !!process.env.VOYAGE_API_KEY
  const wordCount = trimmedQuery.split(/\s+/).length
  const isNaturalLanguage = wordCount >= 3

  try {
    // Check for Claude API key (needed for AI parsing)
    const claudeKey = isNaturalLanguage ? await getUserApiKey(user.id) : null

    // Fetch available properties for AI context (only if we'll use Claude)
    let properties: { name: string; values: string[] }[] = []
    if (claudeKey) {
      const { data: props } = await svc
        .from('properties')
        .select('name, property_values:property_values(label)')
        .eq('user_id', user.id)
      properties = (props ?? []).map((p: { name: string; property_values: { label: string }[] }) => ({
        name: p.name,
        values: (p.property_values ?? []).map((v: { label: string }) => v.label),
      }))
    }

    // Run searches in parallel
    const [exactResult, semanticResult, aiParseResult] = await Promise.allSettled([
      // 1. Exact ilike search
      runExactSearch(svc, user.id, trimmedQuery, workspaceId, limit),
      // 2. Semantic search (if Voyage configured)
      hasVoyage ? runSemanticSearch(svc, user.id, trimmedQuery, workspaceId, limit) : Promise.resolve(null),
      // 3. AI query parsing (if Claude key + natural language)
      claudeKey ? parseSearchQuery({
        query: trimmedQuery,
        apiKey: claudeKey,
        currentDate: new Date().toISOString().split('T')[0],
        systemPrompt: await getUserPrompt(user.id, 'smart_search'),
        properties,
      }) : Promise.resolve(null),
    ])

    const exactBlocks: Block[] = exactResult.status === 'fulfilled' ? (exactResult.value ?? []) : []
    const semanticData = semanticResult.status === 'fulfilled' ? semanticResult.value : null
    const aiParsed: ParsedSearchQuery | null = aiParseResult.status === 'fulfilled' ? aiParseResult.value : null

    // If AI parsing extracted filters or refined search terms, run a filtered exact search
    let aiFilteredBlocks: Block[] = []
    if (aiParsed && (hasExtractedFilters(aiParsed) || (aiParsed.searchTerms && aiParsed.searchTerms !== trimmedQuery))) {
      const searchTerms = aiParsed.searchTerms || trimmedQuery
      aiFilteredBlocks = await runFilteredExactSearch(svc, user.id, searchTerms, workspaceId, aiParsed, properties, limit)
    }

    // Merge all results
    const merged = new Map<string, { block: Block; score: number; matchedChunk?: string }>()

    // AI-filtered exact matches — score by word-match density, not a flat 1.0
    const aiWords = aiParsed?.searchTerms ? extractSearchWords(aiParsed.searchTerms) : []
    for (const block of aiFilteredBlocks) {
      let matchScore = 0.5
      if (aiWords.length > 1) {
        const content = (block.content ?? '').toLowerCase()
        const matchCount = aiWords.filter(w => {
          const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
          return re.test(content)
        }).length
        matchScore = 0.3 + (0.5 * matchCount / aiWords.length)
      }
      merged.set(block.id, { block, score: matchScore })
    }

    // Semantic matches get their similarity score
    if (semanticData) {
      for (const [blockId, similarity] of Object.entries(semanticData.scores)) {
        const existing = merged.get(blockId)
        if (existing) {
          // Boost if also in semantic results
          existing.score = Math.max(existing.score, similarity as number)
          if (semanticData.matchedChunks[blockId]) {
            existing.matchedChunk = semanticData.matchedChunks[blockId]
          }
        } else {
          const block = semanticData.blockMap.get(blockId)
          if (block) {
            merged.set(blockId, {
              block,
              score: similarity as number,
              matchedChunk: semanticData.matchedChunks[blockId],
            })
          }
        }
      }
    }

    // Plain exact matches — score based on how many search words they match
    const queryWords = extractSearchWords(trimmedQuery)
    for (const block of exactBlocks) {
      if (!merged.has(block.id)) {
        let matchScore = 0.15
        if (queryWords.length > 1) {
          const content = (block.content ?? '').toLowerCase()
          const matchCount = queryWords.filter(w => content.includes(w)).length
          matchScore = 0.1 + (0.15 * matchCount / queryWords.length)
        }
        merged.set(block.id, { block, score: matchScore })
      }
    }

    // Sort by score descending, take top candidates
    let sorted = Array.from(merged.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)

    // LLM re-ranking: ask Claude to score relevance of top candidates
    if (claudeKey && sorted.length > 1) {
      const reranked = await rerankWithLLM(trimmedQuery, sorted, claudeKey)
      if (reranked) sorted = reranked
    }

    const results = sorted.map(([, v]) => v.block)
    const scores: Record<string, number> = {}
    const matchedChunks: Record<string, string> = {}
    for (const [id, v] of sorted) {
      scores[id] = v.score
      if (v.matchedChunk) matchedChunks[id] = v.matchedChunk
    }

    return Response.json({
      results,
      scores,
      matchedChunks,
      aiParsed: aiParsed ? {
        searchTerms: aiParsed.searchTerms,
        filters: {
          dateFrom: aiParsed.dateFrom,
          dateTo: aiParsed.dateTo,
          entryTypes: aiParsed.entryTypes,
          statuses: aiParsed.statuses,
          propertyValues: aiParsed.propertyValues,
        },
        reasoning: aiParsed.reasoning,
      } : null,
    })
  } catch (err) {
    console.error('[smart-search] Error:', err)
    return Response.json({ error: 'Search failed' }, { status: 500 })
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim()
}

const RERANK_MAX_CANDIDATES = 15
const RERANK_SNIPPET_LENGTH = 300

async function rerankWithLLM(
  query: string,
  candidates: [string, { block: Block; score: number; matchedChunk?: string }][],
  apiKey: string,
): Promise<typeof candidates | null> {
  try {
    // Only re-rank the top candidates to keep latency reasonable
    const toRerank = candidates.slice(0, RERANK_MAX_CANDIDATES)
    const entries = toRerank.map(([, v], i) => {
      const text = stripHtml(v.block.content ?? '')
      const snippet = text.length > RERANK_SNIPPET_LENGTH
        ? text.slice(0, RERANK_SNIPPET_LENGTH) + '...'
        : text
      return `[${i}] ${snippet}`
    })

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: `You are a search relevance judge. Given a search query and numbered journal entries, rate each entry's relevance to the query from 0.0 (completely irrelevant) to 1.0 (directly answers the query). Consider semantic meaning, not just keyword overlap. Return ONLY a JSON object: {"scores": [0.9, 0.1, ...]} with one score per entry, in order.`,
        messages: [{ role: 'user', content: `Query: "${query}"\n\nEntries:\n${entries.join('\n\n')}` }],
      }),
    })

    if (!res.ok) return null

    const data = await res.json()
    const text = data.content?.[0]?.type === 'text' ? data.content[0].text : null
    if (!text) return null

    const jsonStr = text.replace(/^```json?\s*/, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(jsonStr)
    const llmScores: number[] = parsed.scores

    if (!Array.isArray(llmScores) || llmScores.length !== toRerank.length) return null

    // Apply LLM confidence scores — blend with existing score
    for (let i = 0; i < toRerank.length; i++) {
      const [, v] = toRerank[i]
      const llmScore = Math.max(0, Math.min(1, llmScores[i]))
      // LLM score dominates (70%), retrieval score provides tiebreaking (30%)
      v.score = llmScore * 0.7 + v.score * 0.3
    }

    // Re-sort all candidates (re-ranked ones + any beyond the re-rank window)
    const rerankedSet = new Set(toRerank.map(([id]) => id))
    const rest = candidates.filter(([id]) => !rerankedSet.has(id))
    const all = [...toRerank, ...rest]
    all.sort((a, b) => b[1].score - a[1].score)

    return all
  } catch (err) {
    console.error('[smart-search] LLM re-ranking error:', err)
    return null
  }
}

function hasExtractedFilters(parsed: ParsedSearchQuery): boolean {
  return !!(parsed.dateFrom || parsed.dateTo || parsed.entryTypes || parsed.statuses || parsed.propertyValues)
}

const STOP_WORDS = new Set([
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them', 'their',
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'can', 'may', 'might', 'shall', 'must',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about',
  'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between',
  'if', 'then', 'than', 'when', 'where', 'how', 'what', 'which', 'who', 'whom',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'only', 'own', 'same', 'too', 'very', 'just',
  'find', 'show', 'list', 'get', 'search', 'look', 'give',
])

function extractSearchWords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/['']/g, "'")
    .split(/\s+/)
    .map(w => w.replace(/^[^a-z0-9]+|[^a-z0-9']+$/gi, ''))
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w.replace(/'s$/, '')))
}

function wordFilter(w: string): string {
  // Strip PostgREST filter delimiters so a word can't corrupt the .or() group
  const word = w.replace(/[,()"\\]/g, '')
  if (word.length <= 4) {
    // Use PostgreSQL word-boundary regex for short words to avoid
    // "mom" matching "moment", "to" matching "tomorrow", etc.
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return `content.imatch.\\y${escaped}\\y`
  }
  return `content.ilike.%${word}%`
}

function buildOrFilter(words: string[]): string {
  return words.map(wordFilter).join(',')
}

async function runExactSearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  userId: string,
  query: string,
  workspaceId: string | null,
  limit: number,
): Promise<Block[]> {
  const words = extractSearchWords(query)

  let q = svc
    .from('journal_blocks')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('is_scratch', false)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  // Use OR-matching on individual words for multi-word queries
  if (words.length > 1) {
    q = q.or(buildOrFilter(words))
  } else if (words.length === 1) {
    q = q.or(wordFilter(words[0]))
  } else {
    q = q.ilike('content', `%${query}%`)
  }

  if (workspaceId) q = q.eq('workspace_id', workspaceId)

  const { data } = await q
  return data ?? []
}

async function runSemanticSearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  userId: string,
  query: string,
  workspaceId: string | null,
  limit: number,
): Promise<{
  scores: Record<string, number>
  matchedChunks: Record<string, string>
  blockMap: Map<string, Block>
} | null> {
  try {
    const queryEmbedding = await embedQuery(query)

    const { data: chunks, error } = await svc.rpc('match_chunks', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_user_id: userId,
      match_threshold: 0.28,
      match_count: limit * 3,
    })

    if (error || !chunks) return null

    // Deduplicate by block_id
    const blockScores = new Map<string, number>()
    const blockChunks = new Map<string, string>()
    for (const chunk of chunks) {
      const existing = blockScores.get(chunk.block_id)
      if (!existing || chunk.similarity > existing) {
        blockScores.set(chunk.block_id, chunk.similarity)
        blockChunks.set(chunk.block_id, chunk.chunk_text)
      }
    }

    const ranked = Array.from(blockScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)

    if (ranked.length === 0) return { scores: {}, matchedChunks: {}, blockMap: new Map<string, Block>() }

    const blockIds = ranked.map(([id]) => id)
    let blockQuery = svc
      .from('journal_blocks')
      .select('*')
      .in('id', blockIds)
      .eq('user_id', userId)
      .eq('is_scratch', false)
      .is('deleted_at', null)

    if (workspaceId) blockQuery = blockQuery.eq('workspace_id', workspaceId)

    const { data: blocks } = await blockQuery
    const blockMap = new Map<string, Block>((blocks ?? []).map((b: Block) => [b.id, b]))

    const scores: Record<string, number> = {}
    const matchedChunks: Record<string, string> = {}
    for (const [id, score] of ranked) {
      if (blockMap.has(id)) {
        scores[id] = score
        const chunk = blockChunks.get(id)
        if (chunk) matchedChunks[id] = chunk
      }
    }

    return { scores, matchedChunks, blockMap }
  } catch (err) {
    console.error('[smart-search] Semantic search error:', err)
    return null
  }
}

async function runFilteredExactSearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  userId: string,
  searchTerms: string,
  workspaceId: string | null,
  parsed: ParsedSearchQuery,
  properties: { name: string; values: string[] }[],
  limit: number,
): Promise<Block[]> {
  let q = svc
    .from('journal_blocks')
    .select('*')
    .eq('user_id', userId)
    .eq('is_scratch', false)
    .order('created_at', { ascending: false })
    .limit(limit)

  // Soft deletion is tracked by deleted_at, not status — exclude deleted rows
  // unless the parsed query explicitly asked for the Deleted bucket.
  const wantsDeleted = parsed.statuses?.includes('deleted') ?? false
  if (!wantsDeleted) q = q.is('deleted_at', null)

  if (workspaceId) q = q.eq('workspace_id', workspaceId)

  // Apply search terms if present — use OR matching on individual words
  if (searchTerms) {
    const words = extractSearchWords(searchTerms)
    if (words.length > 1) {
      q = q.or(buildOrFilter(words))
    } else if (words.length === 1) {
      q = q.ilike('content', `%${words[0]}%`)
    } else {
      q = q.ilike('content', `%${searchTerms}%`)
    }
  }

  // Apply date filters
  if (parsed.dateFrom) {
    q = q.gte('created_at', parsed.dateFrom + 'T00:00:00')
  }
  if (parsed.dateTo) {
    q = q.lte('created_at', parsed.dateTo + 'T23:59:59')
  }

  // Apply entry type filter
  if (parsed.entryTypes && parsed.entryTypes.length > 0) {
    q = q.in('entry_type', parsed.entryTypes)
  }

  // Apply status filter
  if (parsed.statuses && parsed.statuses.length > 0) {
    const dbStatuses: string[] = []
    for (const s of parsed.statuses) {
      if (s === 'active') dbStatuses.push('active')
      if (s === 'archived') dbStatuses.push('archived', 'complete')
    }
    if (wantsDeleted && dbStatuses.length > 0) {
      q = q.or(`and(status.in.(${dbStatuses.join(',')}),deleted_at.is.null),deleted_at.not.is.null`)
    } else if (wantsDeleted) {
      q = q.not('deleted_at', 'is', null)
    } else if (dbStatuses.length > 0) {
      q = q.in('status', dbStatuses)
    }
  } else {
    q = q.eq('status', 'active')
  }

  const { data: blocks } = await q

  // If property values were extracted, filter by them client-side
  if (parsed.propertyValues && parsed.propertyValues.length > 0 && blocks && blocks.length > 0) {
    // Resolve property value labels to IDs
    const targetLabels = new Set(parsed.propertyValues.map(v => v.toLowerCase()))
    const targetValueIds = new Set<string>()
    for (const prop of properties) {
      // We need the actual value IDs — fetch them
      const { data: pvs } = await svc
        .from('property_values')
        .select('id, label')
        .in('property_id', (await svc.from('properties').select('id').eq('user_id', userId).eq('name', prop.name)).data?.map((p: { id: string }) => p.id) ?? [])
      for (const pv of (pvs ?? [])) {
        if (targetLabels.has(pv.label.toLowerCase())) {
          targetValueIds.add(pv.id)
        }
      }
    }

    if (targetValueIds.size > 0) {
      const blockIds = blocks.map((b: Block) => b.id)
      const { data: entryProps } = await svc
        .from('entry_properties')
        .select('block_id, property_value_id')
        .in('block_id', blockIds)
        .in('property_value_id', Array.from(targetValueIds))

      const matchingBlockIds = new Set((entryProps ?? []).map((ep: { block_id: string }) => ep.block_id))
      return blocks.filter((b: Block) => matchingBlockIds.has(b.id))
    }
  }

  return blocks ?? []
}
