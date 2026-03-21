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

### API Routes

- `/api/ai/summarize` — Claude summarization using per-user encrypted API key
- `/api/ai/embed` — Voyage AI chunk embedding (fire-and-forget on block save)
- `/api/ai/embed/backfill` — Batch embed all un-indexed blocks
- `/api/ai/search` — Semantic search via pgvector `match_chunks` RPC
- `/api/ai/test` — Validate user's API key
- `/api/search` — Full-text ilike search on journal_blocks
- `/api/user/ai-config` — CRUD for encrypted Anthropic API keys
- `/api/user/prompt-templates` — CRUD for custom AI prompt overrides
- `/api/report/generate` — End-of-day report from journal blocks
- `/api/report/send` — Send reports via Gmail OAuth

### Per-User AI Configuration

Users store their own Anthropic API key encrypted with AES-256-GCM (`lib/ai-key-crypto.ts`). The encryption secret is `AI_KEY_ENCRYPTION_SECRET` (server-only env var). AI routes fetch the key via `getUserApiKey()` from `lib/get-user-ai-config.ts` using the service-role client. Routes return `{ error: 'no_api_key' }` with status 402 when unconfigured.

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
```

## Database Schema (Key Tables)

- `journal_blocks` — content, status, entry_type, workspace_id, sort_order, deleted_at
- `block_versions` — content snapshots with edited_at timestamps
- `block_chunks` — chunk_text + vector(512) embedding for semantic search
- `workspaces` — name, emoji, color_scheme, is_default
- `properties` / `property_values` / `entry_properties` — custom tagging system
- `user_ai_config` — encrypted_api_key, api_key_hint
- `user_prompt_templates` — per-user AI prompt overrides

All tables use RLS (row-level security) scoped to `auth.uid()`.

## Important Constraints

- Never mutate TipTap's EditorContent DOM directly — use the highlight overlay layer pattern instead
- The `status` column on `journal_blocks` has a check constraint: `active`, `archived`, `complete`, `deleted`
- Decrypted API keys must never appear in client responses or client components
- Embedding failures must never break the block save flow (fire-and-forget with `.catch(() => {})`)
- `position: fixed` elements inside `overflow: hidden` containers may need `createPortal` to `document.body` to escape stacking contexts (see emoji picker pattern)
