# PDA — Personal Digital Assistant

A personal digital assistant web app built with **Next.js 14** and **Supabase**, powered by Claude AI via the Anthropic SDK.

## Tech Stack

- **Next.js 14** (App Router, TypeScript)
- **Tailwind CSS** — utility-first styling
- **Supabase** — database, auth, and storage (`@supabase/supabase-js`, `@supabase/ssr`)
- **Anthropic SDK** — Claude AI integration (`@anthropic-ai/sdk`)

## Getting Started

1. Clone the repo and install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in your credentials:

   ```bash
   cp .env.example .env.local
   ```

3. Run the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Your Supabase anon/public key |
| `SUPABASE_SECRET_KEY` | Your Supabase service role key (server-side only) |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |

## Database Migrations

SQL migration files live in `supabase/migrations/`. Apply them via the Supabase CLI:

```bash
supabase db push
```
