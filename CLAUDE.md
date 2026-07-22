# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev          # Dev server (auto-bumps build number)
npm run dev:clean    # Dev server with .next cache cleared
npm run build        # Production build (auto-bumps build number)
npm run lint         # ESLint with Next.js rules
npm start            # Start production server
```

Build number is auto-incremented via `scripts/bump-build.js` which updates `lib/version.ts` from git commit count.

### Database Migrations

```bash
npx supabase db push                    # Push pending migrations to remote
npx supabase db diff -f <name>          # Generate migration from schema diff
```

Migrations live in `supabase/migrations/` with timestamp-prefixed filenames (`YYYYMMDDHHMMSS_name.sql`).

## Architecture

**Next.js 14 App Router** with Supabase (auth + Postgres + storage), TipTap rich text editor, and AI integrations (Anthropic Claude for summarization, Voyage AI for semantic search embeddings).

### Core Data Flow

The app is a multi-workspace journaling system. The primary entity is `journal_blocks` — rich text entries with status lifecycle (`active` → `archived`/`complete`/`deleted`), entry types (`info`/`task`), workspace scoping, and custom properties.

### Key Architectural Patterns

**Two Supabase clients**: `lib/supabase/client.ts` (browser, uses anon key) and `lib/supabase/server.ts` (server components/API routes, uses cookies for auth). Service-role access for admin operations uses `@supabase/supabase-js` directly with `SUPABASE_SECRET_KEY`.

**TipTap editor lifecycle**: Editors are always-mounted (never unmounted/remounted on focus changes). `editable` prop toggles between read-only and edit mode. Content is stored as HTML in `journal_blocks.content`. The `TipTapEditorHandle` ref provides imperative methods (`getHTML`, `setText`, `clear`, `focus`, `setContent`, `openLinkEditor`).

**Block save flow**: New entries use `saveNewEntry` (insert), existing blocks use `saveExistingBlock` (update with version history). Autosave fires silently after inactivity period. Block versions are written to `block_versions` before content updates. Fire-and-forget embedding requests (`/api/ai/embed`) run after every save.

**Search highlight layer**: When search is active, TipTapEditor renders a separate `<div className="tiptap-content">` overlay with highlighted HTML (from `lib/highlight-html.ts`) and hides the real EditorContent via `display:none`. This avoids mutating ProseMirror's managed DOM which causes IndexSizeError crashes. The overlay only appears when `showHighlightLayer` is true (content contains matches AND block is not in edit mode).

**Workspace theming**: Each workspace has a `color_scheme` key mapping to `constants/workspaceColorSchemes.ts`. Schemes define `primary` (top bar), `muted` (feed background, focused block background), `textOnColor` (top bar text), and `selectionColor`. The `activeScheme` from `WorkspaceContext` flows through to JournalPage header, feed area, and JournalBlock focused/border styles.

### Context Providers

Wrap the app in `page.tsx`:
- `WorkspaceProvider` — manages workspace list, active workspace, scheme lookup
- `PropertiesProvider` — manages custom properties with values, supports workspace-scoped and global properties
- `DateFormatProvider` — per-user date/time format and timezone preferences
- `ActionHistoryProvider` — undo/action history

### API Routes

- `/api/ai/summarize` — Claude summarization using per-user encrypted API key
- `/api/ai/embed` — Voyage AI chunk embedding (fire-and-forget on block save)
- `/api/ai/embed/backfill` — Batch embed all un-indexed blocks
- `/api/ai/search` — Semantic search via pgvector `match_chunks` RPC
- `/api/ai/test` — Validate user's API key
- `/api/search` — Full-text ilike search on journal_blocks
- `/api/smart-search` — LLM-assisted search: Claude (user's key) parses natural-language queries into filters, combined with Voyage semantic search
- `/api/user/ai-config` — CRUD for encrypted Anthropic API keys
- `/api/user/prompt-templates` — CRUD for custom AI prompt overrides
- `/api/report/generate` — End-of-day report from journal blocks
- `/api/report/send` — Send reports via Gmail OAuth
- `/api/mcp` — Streamable-HTTP MCP server (see MCP Server section)
- `/api/oauth/authorize` — OAuth 2.0 authorization endpoint (PKCE) for MCP clients
- `/api/oauth/token` — OAuth 2.0 token endpoint (authorization_code grant)
- `/api/user/mcp-tokens` + `/api/user/mcp-tokens/[id]` — Personal access token management
- `/api/user/mcp-oauth-clients` + `/api/user/mcp-oauth-clients/[id]` — OAuth client management
- `/.well-known/oauth-authorization-server` — RFC 8414 discovery metadata for OAuth clients
- `/.well-known/oauth-protected-resource` — RFC 9728 protected-resource metadata (advertised via `WWW-Authenticate` on 401s from `/api/mcp`)

### Per-User AI Configuration

Users store their own Anthropic API key encrypted with AES-256-GCM (`lib/ai-key-crypto.ts`). The encryption secret is `AI_KEY_ENCRYPTION_SECRET` (server-only env var). AI routes fetch the key via `getUserApiKey()` from `lib/get-user-ai-config.ts` using the service-role client. Routes return `{ error: 'no_api_key' }` with status 402 when unconfigured.

### MCP Server

`lib/mcp/` (`server.ts`, `auth.ts`, `oauth.ts`, `tokens.ts`) implements an MCP server at `/api/mcp` with seven tools: `list_workspaces`, `list_properties`, `create_block`, `update_block`, `get_block`, `search_blocks`, `update_scratchpad`. Two auth paths:

- **Personal access tokens** — created in Settings → MCP, stored SHA-256 hashed in `mcp_tokens`, validated by `validateBearer()` in `lib/mcp/auth.ts`
- **OAuth 2.0** — authorization-code + PKCE flow (`/api/oauth/authorize` + `/api/oauth/token`) for clients that don't accept bearer tokens (claude.ai, ChatGPT); user-registered clients live in `mcp_oauth_clients`, short-lived codes in `mcp_oauth_codes`, and successful exchanges mint an `mcp_tokens` row

**Critical invariant**: MCP requests run outside any user JWT context and use the service-role client, so RLS does NOT protect these paths. Every query in every MCP tool must be manually scoped with `.eq('user_id', userId)` from the validated token.

### Semantic Search Pipeline

1. On block save: `chunkText()` splits content into ~120-word overlapping windows
2. `embedTexts()` calls Voyage AI REST API to get 512-dim vectors
3. Chunks stored in `block_chunks` table with pgvector `vector(512)` column
4. Search: query embedded → `match_chunks` RPC (cosine similarity) → deduplicate by block_id → return ranked blocks with scores and matched chunk text

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL      # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Supabase anon/publishable key
SUPABASE_SECRET_KEY           # Service role key (server-only)
AI_KEY_ENCRYPTION_SECRET      # AES-256-GCM secret for API key encryption
VOYAGE_API_KEY                # Voyage AI key (app-level, not per-user)
VOYAGE_MODEL                  # Voyage model name (default: voyage-3-lite)
GOOGLE_CLIENT_ID              # Optional — Gmail token refresh in /api/report/send; must match the Supabase Google provider credentials
GOOGLE_CLIENT_SECRET          # Optional — pairs with GOOGLE_CLIENT_ID
```

Without the `GOOGLE_*` vars, Gmail report sending works only until the Supabase-stored provider token expires.

## Database Schema (Key Tables)

- `journal_blocks` — content, status, entry_type, workspace_id, sort_order, deleted_at, task_status, due_date, start_date, is_scratch/scratch_collapsed, via_mcp
- `block_versions` — content snapshots with edited_at timestamps
- `block_chunks` — chunk_text + vector(512) embedding for semantic search
- `workspaces` — name, emoji, color_scheme, is_default, report_recipients
- `properties` / `property_values` / `entry_properties` — custom tagging system
- `user_ai_config` — encrypted_api_key, api_key_hint
- `user_prompt_templates` — per-user AI prompt overrides
- `mcp_tokens` — SHA-256 hashed MCP personal access tokens (revoked_at, expires_at, client_id)
- `mcp_oauth_clients` / `mcp_oauth_codes` — user-registered OAuth clients and short-lived PKCE authorization codes
- `report_templates` — saved report configurations (name, date range, filters, recipients) for one-click report runs
- `attachments` / `attachment_events` — block file attachments (storage bucket `attachments`) and their event log
- `profiles` — per-user preferences (autosave/sync intervals, date/time format, timezone, report recipients)
- Initial schema also created `contexts`, `people`, `tasks`, `projects`, `tags`, `taggings` — some still queried by app code

Task tracking is a two-axis model: `status` is the block lifecycle (`active`/`archived`/`complete`/`deleted`), while `task_status` is task progress with check constraint `not_started`, `held`, `in_progress`, `done`. Do not conflate them.

All tables use RLS (row-level security) scoped to `auth.uid()` — but RLS does not apply on MCP paths (see Important Constraints).

## Important Constraints

- Never mutate TipTap's EditorContent DOM directly — use the highlight overlay layer pattern instead
- MCP routes use the service-role client, so RLS does NOT protect them — every MCP tool query must be manually scoped with `.eq('user_id', userId)` from the validated token
- All HTML rendered via `dangerouslySetInnerHTML` must pass through `sanitizeHtml` from `lib/sanitize.ts` — block content can originate outside TipTap (MCP writes, AI responses) and is not safe to inject raw
- The `status` column on `journal_blocks` has a check constraint: `active`, `archived`, `complete`, `deleted`
- Decrypted API keys must never appear in client responses or client components
- Embedding failures must never break the block save flow (fire-and-forget with `.catch(() => {})`)
- `position: fixed` elements inside `overflow: hidden` containers may need `createPortal` to `document.body` to escape stacking contexts (see emoji picker pattern)
