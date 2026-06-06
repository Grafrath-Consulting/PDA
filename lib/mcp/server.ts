import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { SupabaseClient } from '@supabase/supabase-js'
import { getServiceClient } from './auth'
import { createBlockFromMcp, updateBlockFromMcp } from '@/lib/blocks/save'
import { embedQuery } from '@/lib/voyage'
import { versionString } from '@/lib/version'

// Server-side HTML → plain text. Strips tags only; deliberately tiny.
function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  return html.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Project a raw journal_blocks row (as returned by the save helpers) into the
// same clean shape the read tools emit: HTML stripped to a `text` field, never
// a raw `content` field. Keeps every tool's block shape identical.
function projectBlock(block: {
  id: string
  workspace_id: string
  content: string | null
  entry_type: string
  status: string
  created_at: string
  task_status?: string | null
  due_date?: string | null
  due_date_type?: string | null
  start_date?: string | null
  via_mcp?: boolean
}) {
  return {
    id: block.id,
    workspace_id: block.workspace_id,
    entry_type: block.entry_type,
    status: block.status,
    created_at: block.created_at,
    task_status: block.task_status ?? null,
    due_date: block.due_date ?? null,
    due_date_type: block.due_date_type ?? null,
    start_date: block.start_date ?? null,
    via_mcp: block.via_mcp ?? false,
    text: htmlToText(block.content),
  }
}

function ok(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  }
}

function err(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  }
}

interface ToolDeps {
  svc: SupabaseClient
  userId: string
}

function registerListWorkspaces(server: McpServer, deps: ToolDeps) {
  server.registerTool('list_workspaces', {
    description:
      'List the user\'s workspaces. Call this before create_block so you can ask the user which workspace to put the entry in. Each workspace also has a permanent "scratchpad" card (scratch_block_id) — a free-form note that cannot be archived, deleted, moved, typed, or tagged. Edit it with update_scratchpad, not update_block.',
    inputSchema: {},
  }, async () => {
    const { data, error } = await deps.svc
      .from('workspaces')
      .select('id, name, emoji, color_scheme, is_default, sort_order')
      .eq('user_id', deps.userId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) return err(error.message)

    // Attach each workspace's scratchpad block id.
    const { data: scratch } = await deps.svc
      .from('journal_blocks')
      .select('id, workspace_id')
      .eq('user_id', deps.userId)
      .eq('is_scratch', true)
    const scratchByWs = new Map((scratch ?? []).map((s: { id: string; workspace_id: string }) => [s.workspace_id, s.id]))
    const workspaces = (data ?? []).map((w: { id: string }) => ({ ...w, scratch_block_id: scratchByWs.get(w.id) ?? null }))
    return ok({ workspaces })
  })
}

function registerListProperties(server: McpServer, deps: ToolDeps) {
  server.registerTool('list_properties', {
    description:
      'List custom properties (tags) the user has defined, with their possible values. Pass workspace_id to limit to properties for that workspace plus global properties. Call before create_block when the user wants to tag the entry.',
    inputSchema: {
      workspace_id: z.string().uuid().optional().describe('Optional workspace to scope properties to. Global properties are always included.'),
    },
  }, async ({ workspace_id }) => {
    let q = deps.svc
      .from('properties')
      .select('id, name, workspace_id, sort_order, property_values(id, label, color, sort_order, archived)')
      .eq('user_id', deps.userId)
      .eq('archived', false)
      .order('sort_order', { ascending: true })

    if (workspace_id) {
      q = q.or(`workspace_id.eq.${workspace_id},workspace_id.is.null`)
    }

    const { data, error } = await q
    if (error) return err(error.message)

    const properties = (data ?? []).map((p: { id: string; name: string; workspace_id: string | null; property_values: { id: string; label: string; color: string | null; archived: boolean }[] }) => ({
      id: p.id,
      name: p.name,
      workspace_id: p.workspace_id,
      values: (p.property_values ?? [])
        .filter(v => !v.archived)
        .map(v => ({ id: v.id, label: v.label, color: v.color })),
    }))
    return ok({ properties })
  })
}

function registerCreateBlock(server: McpServer, deps: ToolDeps) {
  server.registerTool('create_block', {
    description:
      'Create a new journal entry (a "block") in the user\'s PDA. workspace_id is required — call list_workspaces first and ask the user which one to use. property_value_ids is optional; call list_properties to get available tag values. The task_*, due_*, and start_date fields are only honored when entry_type is "task".',
    inputSchema: {
      content: z.string().min(1).describe('The body of the entry. Plain text or simple HTML; line breaks become paragraphs.'),
      workspace_id: z.string().uuid().describe('UUID of the workspace, from list_workspaces.'),
      entry_type: z.enum(['info', 'task']).optional().describe('"info" (default) for notes, "task" for actionable items.'),
      property_value_ids: z.array(z.string().uuid()).optional().describe('UUIDs of property values to attach as tags, from list_properties.'),
      task_status: z.enum(['not_started', 'held', 'in_progress', 'done']).optional().describe('Task progress (defaults to "not_started"). "held" pauses a task and excludes it from the focus panel\'s due/upcoming lists. Only used when entry_type is "task".'),
      due_date: z.string().datetime({ offset: true }).nullable().optional().describe('ISO 8601 timestamp with timezone, e.g. "2026-05-15T17:00:00-05:00". Only used when entry_type is "task".'),
      due_date_type: z.enum(['deadline', 'target']).nullable().optional().describe('"deadline" (hard) or "target" (soft). Only meaningful when due_date is set.'),
      start_date: z.string().datetime({ offset: true }).nullable().optional().describe('ISO 8601 timestamp with timezone for when the task should begin. Only used when entry_type is "task".'),
    },
  }, async ({ content, workspace_id, entry_type, property_value_ids, task_status, due_date, due_date_type, start_date }) => {
    // Promote plain-text input to minimal HTML so it renders in the TipTap editor.
    const html = content.trim().startsWith('<')
      ? content
      : `<p>${content.split(/\n{2,}/).map(p => p.replace(/\n/g, '<br>')).join('</p><p>')}</p>`

    const result = await createBlockFromMcp(deps.svc, {
      userId: deps.userId,
      workspaceId: workspace_id,
      content: html,
      entryType: entry_type,
      propertyValueIds: property_value_ids,
      taskStatus: task_status,
      dueDate: due_date,
      dueDateType: due_date_type,
      startDate: start_date,
    })
    if (!result.ok) return err(result.error)
    return ok({ block: projectBlock(result.block) })
  })
}

function registerUpdateBlock(server: McpServer, deps: ToolDeps) {
  server.registerTool('update_block', {
    description:
      'Edit an existing journal entry. Use this to: change content, mark a task as in_progress or done (task_status), set or clear a due date, or archive/restore a block (status). Only the fields you pass are updated; omit fields you want to leave alone. Pass null to clear an optional field. Do not use this on a scratchpad card (it cannot be archived/typed/etc.) — use update_scratchpad instead.',
    inputSchema: {
      id: z.string().uuid().describe('Block UUID, from search_blocks, get_block, or create_block.'),
      content: z.string().min(1).optional().describe('New body. Plain text or simple HTML; line breaks become paragraphs. Re-fires the semantic search index.'),
      task_status: z.enum(['not_started', 'held', 'in_progress', 'done']).optional().describe('Task progress. Use "held" to pause (hides from the focus panel without losing the due date), or "done" to mark complete.'),
      due_date: z.string().datetime({ offset: true }).nullable().optional().describe('ISO 8601 timestamp with timezone, or null to clear.'),
      due_date_type: z.enum(['deadline', 'target']).nullable().optional().describe('"deadline" (hard) or "target" (soft), or null to clear.'),
      start_date: z.string().datetime({ offset: true }).nullable().optional().describe('ISO 8601 timestamp with timezone, or null to clear.'),
      status: z.enum(['active', 'archived', 'complete']).optional().describe('"archived" hides the block from the active feed. "active" restores it. "complete" marks it done at the block level (separate from task_status).'),
    },
  }, async ({ id, content, task_status, due_date, due_date_type, start_date, status }) => {
    const result = await updateBlockFromMcp(deps.svc, {
      userId: deps.userId,
      blockId: id,
      content,
      taskStatus: task_status,
      dueDate: due_date,
      dueDateType: due_date_type,
      startDate: start_date,
      status,
    })
    if (!result.ok) return err(result.error)
    return ok({ block: projectBlock(result.block) })
  })
}

function registerSearchBlocks(server: McpServer, deps: ToolDeps) {
  server.registerTool('search_blocks', {
    description:
      'Search the user\'s journal entries. Use mode="semantic" (default) for conceptual matches across topic/meaning. Use mode="text" for literal substring matches. Returns ranked blocks with snippets.',
    inputSchema: {
      query: z.string().min(1).describe('What to search for.'),
      mode: z.enum(['semantic', 'text']).optional().describe('"semantic" (default) or "text".'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results, default 10.'),
      workspace_id: z.string().uuid().optional().describe('Optional workspace filter.'),
    },
  }, async ({ query, mode, limit, workspace_id }) => {
    const m = mode ?? 'semantic'
    const lim = limit ?? 10

    if (m === 'semantic') {
      if (!process.env.VOYAGE_API_KEY) return err('embedding_not_configured')

      const queryEmbedding = await embedQuery(query.trim())
      const { data: chunks, error: rpcError } = await deps.svc.rpc('match_chunks', {
        query_embedding: JSON.stringify(queryEmbedding),
        match_user_id: deps.userId,
        match_threshold: 0.28,
        match_count: lim * 3,
      })
      if (rpcError) return err(rpcError.message)

      const blockScores = new Map<string, number>()
      const blockMatchedChunks = new Map<string, string>()
      for (const chunk of (chunks ?? []) as { block_id: string; similarity: number; chunk_text: string }[]) {
        const existing = blockScores.get(chunk.block_id)
        if (!existing || chunk.similarity > existing) {
          blockScores.set(chunk.block_id, chunk.similarity)
          blockMatchedChunks.set(chunk.block_id, chunk.chunk_text)
        }
      }
      const ranked = Array.from(blockScores.entries()).sort((a, b) => b[1] - a[1]).slice(0, lim)
      if (ranked.length === 0) return ok({ results: [] })

      let blockQuery = deps.svc
        .from('journal_blocks')
        .select('id, content, entry_type, status, workspace_id, created_at')
        .in('id', ranked.map(([id]) => id))
        .eq('user_id', deps.userId)
        .eq('is_scratch', false)
        .is('deleted_at', null)
      if (workspace_id) blockQuery = blockQuery.eq('workspace_id', workspace_id)

      const { data: blocks } = await blockQuery
      const blockMap = new Map((blocks ?? []).map(b => [b.id, b]))
      const results = ranked
        .map(([id, score]) => {
          const b = blockMap.get(id)
          if (!b) return null
          return {
            id: b.id,
            workspace_id: b.workspace_id,
            entry_type: b.entry_type,
            status: b.status,
            created_at: b.created_at,
            text: htmlToText(b.content),
            matched_chunk: blockMatchedChunks.get(id) ?? null,
            similarity: Number(score.toFixed(3)),
          }
        })
        .filter(Boolean)
      return ok({ results })
    }

    // text mode — case-insensitive substring on content (HTML)
    let q = deps.svc
      .from('journal_blocks')
      .select('id, content, entry_type, status, workspace_id, created_at')
      .eq('user_id', deps.userId)
      .eq('is_scratch', false)
      .is('deleted_at', null)
      .ilike('content', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(lim)
    if (workspace_id) q = q.eq('workspace_id', workspace_id)

    const { data, error } = await q
    if (error) return err(error.message)

    const results = (data ?? []).map(b => ({
      id: b.id,
      workspace_id: b.workspace_id,
      entry_type: b.entry_type,
      status: b.status,
      created_at: b.created_at,
      text: htmlToText(b.content),
    }))
    return ok({ results })
  })
}

function registerGetBlock(server: McpServer, deps: ToolDeps) {
  server.registerTool('get_block', {
    description:
      'Fetch a single journal entry by ID, including its tags. Use this after search_blocks when you want full context on a specific result.',
    inputSchema: {
      id: z.string().uuid().describe('Block UUID, from search_blocks or create_block.'),
    },
  }, async ({ id }) => {
    const { data: block, error } = await deps.svc
      .from('journal_blocks')
      .select('id, content, entry_type, status, workspace_id, created_at, task_status, due_date, owner_id, entry_properties(property_value_id, property_values(id, label, properties(name)))')
      .eq('id', id)
      .eq('user_id', deps.userId)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) return err(error.message)
    if (!block) return err('block_not_found')

    // Supabase types nested relationships as arrays even for to-one joins, so
    // normalise: take the first element of each nested array.
    type EntryProp = { property_values: unknown }
    const properties = ((block.entry_properties ?? []) as EntryProp[]).map(ep => {
      const pv = Array.isArray(ep.property_values) ? ep.property_values[0] : ep.property_values
      const pvObj = pv as { id?: string; label?: string; properties?: unknown } | null
      const propRef = pvObj && (Array.isArray(pvObj.properties) ? pvObj.properties[0] : pvObj.properties)
      return {
        property: (propRef as { name?: string } | null)?.name,
        value: pvObj?.label,
        value_id: pvObj?.id,
      }
    })

    return ok({
      block: {
        id: block.id,
        workspace_id: block.workspace_id,
        entry_type: block.entry_type,
        status: block.status,
        task_status: block.task_status,
        due_date: block.due_date,
        owner_id: block.owner_id,
        created_at: block.created_at,
        text: htmlToText(block.content),
        properties,
      },
    })
  })
}

function registerUpdateScratchpad(server: McpServer, deps: ToolDeps) {
  server.registerTool('update_scratchpad', {
    description:
      'Edit a workspace\'s permanent scratchpad card — a free-form note that is always visible and cannot be archived, deleted, moved, typed, or tagged. Use mode="append" to add to the existing note (default) or mode="replace" to overwrite it. Get scratch_block_id / workspace_id from list_workspaces.',
    inputSchema: {
      workspace_id: z.string().uuid().describe('UUID of the workspace whose scratchpad to edit, from list_workspaces.'),
      content: z.string().min(1).describe('Text to write. Plain text or simple HTML; line breaks become paragraphs.'),
      mode: z.enum(['append', 'replace']).optional().describe('"append" (default) adds to the existing note; "replace" overwrites it.'),
    },
  }, async ({ workspace_id, content, mode }) => {
    const { data: scratch } = await deps.svc
      .from('journal_blocks')
      .select('id, content')
      .eq('user_id', deps.userId)
      .eq('workspace_id', workspace_id)
      .eq('is_scratch', true)
      .maybeSingle()
    if (!scratch) return err('scratchpad_not_found')

    const htmlify = (s: string) => s.trim().startsWith('<')
      ? s
      : `<p>${s.split(/\n{2,}/).map(p => p.replace(/\n/g, '<br>')).join('</p><p>')}</p>`
    const addition = htmlify(content)
    const newContent = (mode ?? 'append') === 'append'
      ? `${scratch.content ?? ''}${addition}`
      : addition

    const result = await updateBlockFromMcp(deps.svc, {
      userId: deps.userId,
      blockId: scratch.id,
      content: newContent,
    })
    if (!result.ok) return err(result.error)
    return ok({ block: projectBlock(result.block) })
  })
}

export function buildMcpServer(userId: string): McpServer {
  const server = new McpServer(
    { name: 'pda', version: versionString() },
    { capabilities: { tools: {} } }
  )
  const deps: ToolDeps = { svc: getServiceClient(), userId }
  registerListWorkspaces(server, deps)
  registerListProperties(server, deps)
  registerCreateBlock(server, deps)
  registerUpdateBlock(server, deps)
  registerSearchBlocks(server, deps)
  registerGetBlock(server, deps)
  registerUpdateScratchpad(server, deps)
  return server
}
