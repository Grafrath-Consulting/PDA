# PDA — Personal Digital Assistant

A self-hostable, multi-workspace journaling app. Everything is a rich-text block in a feed, scoped to a workspace, with tasks, tagging, and search layered on top.

**Features**

- Rich-text journal blocks (TipTap editor) with autosave, version history, and attachments
- Tasks with progress status, due dates, and start dates alongside plain info entries
- Custom properties (tags with typed values) — global or per-workspace
- Full-text search plus semantic search (Voyage AI embeddings + pgvector), and an AI "smart search" that parses natural-language queries
- AI summarization using your own Anthropic API key, stored encrypted per-user
- End-of-day reports generated from your entries and sent via Gmail
- Built-in MCP server so AI assistants (Claude Code, claude.ai, etc.) can read and write your journal
- Per-workspace color themes, scratchpads, and saved view state

## Tech Stack

- **Next.js 14** (App Router, TypeScript)
- **Supabase** — Postgres, auth, and storage (`@supabase/supabase-js`, `@supabase/ssr`)
- **TipTap** — rich text editing
- **Tailwind CSS** — styling
- **Anthropic API** — summarization and query parsing (per-user keys)
- **Voyage AI** — embeddings for semantic search (pgvector)

## Getting Started

### 1. Clone and install

```bash
git clone <this-repo>
cd PDA
npm install
```

### 2. Create a Supabase project and apply migrations

Create a project at [supabase.com](https://supabase.com), then link it and push the schema:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

(If the CLI complains about a missing config file, run `npx supabase init` before `link`.)

The migrations create all tables, enable the `pgvector` extension, and create the private `attachments` storage bucket (20 MB file limit) — no manual dashboard steps are needed for those.

### 3. Set up Google sign-in

Google OAuth is the only sign-in method — the app will not be usable until the Google provider is configured:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth 2.0 client (type: Web application).
2. Add `https://<your-project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI.
3. In the Supabase dashboard under **Authentication → Providers → Google**, enable the provider and paste the client ID and secret.
4. Under **Authentication → URL Configuration**, add your app URL (e.g. `http://localhost:3000/**`) to the redirect allowlist.

For Gmail report sending (optional), additionally enable **Store provider tokens** on the Google provider, add the `https://www.googleapis.com/auth/gmail.send` scope, and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (the same credentials) in your env.

### 4. Configure environment variables

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/publishable key |
| `SUPABASE_SECRET_KEY` | Yes | Supabase service role key (server-only) |
| `AI_KEY_ENCRYPTION_SECRET` | Yes | Random secret used to encrypt per-user Anthropic API keys at rest (e.g. `openssl rand -hex 32`) |
| `VOYAGE_API_KEY` | Yes | Voyage AI key — powers semantic search and embedding |
| `VOYAGE_MODEL` | No | Voyage embedding model (default: `voyage-3-lite`) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID — only needed for Gmail report sending |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret — only needed for Gmail report sending |

There is no app-level `ANTHROPIC_API_KEY` — each user adds their own Anthropic key in the app (see below).

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with Google.

## AI Features

- **Anthropic key (per-user)**: add your Anthropic API key in **Settings → AI**. It is encrypted with AES-256-GCM (using `AI_KEY_ENCRYPTION_SECRET`) before storage and never sent to the browser. Summarization and smart-search query parsing use this key.
- **Semantic search**: runs on the app-level `VOYAGE_API_KEY`. New and edited blocks are embedded automatically on save.
- **Indexing existing entries**: entries created before semantic search was configured can be indexed with the **Rebuild search index** button in the AI settings panel (calls `/api/ai/embed/backfill`).

## MCP Server

The app exposes an MCP (Model Context Protocol) server at `/api/mcp` with tools to list workspaces and properties, create/update/get blocks, search the journal, and update workspace scratchpads.

Two ways to connect a client:

- **Personal access token**: create one in **Settings → MCP** and use it as a bearer token. Works for clients that accept token auth (e.g. Claude Code, Claude Desktop).
- **OAuth**: claude.ai (web) and ChatGPT don't accept bearer tokens, so create an **OAuth client** in **Settings → MCP** instead (the redirect URL defaults to claude.ai's callback). The app implements the authorization-code + PKCE flow, and clients auto-discover the endpoints via `/.well-known/oauth-authorization-server`.

## License

[MIT](LICENSE)
