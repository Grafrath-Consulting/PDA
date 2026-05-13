-- =============================================================================
-- Migration template — copy this when creating a new migration.
--
-- Filename: YYYYMMDDHHMMSS_short_description.sql  (e.g. 20261101120000_add_widgets.sql)
-- Note: The leading underscore on _TEMPLATE.sql keeps this file out of the
-- migration runner (CLI matches `^[0-9]+_.*\.sql$`). Do NOT remove the prefix.
--
-- WHY EXPLICIT GRANTS:
--   Starting 2026-10-30, Supabase no longer auto-grants Data API access to new
--   tables in the `public` schema. Without the grants below, supabase-js and
--   PostgREST will return error 42501 for any new table. Existing tables keep
--   their current grants — this only matters for tables created from now on.
-- =============================================================================

-- 1. Create the table
create table public.example_table (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  -- ...columns...
  created_at timestamptz not null default now()
);

-- 2. Enable row-level security (always)
alter table public.example_table enable row level security;

-- 3. Grant Data API access
--    Drop the `anon` grant unless the table should be readable when logged out.
grant select, insert, update, delete on public.example_table to authenticated;
grant select, insert, update, delete on public.example_table to service_role;
-- grant select on public.example_table to anon;

-- 4. Add RLS policies (rows are invisible until at least one policy matches)
create policy "owner can read"
  on public.example_table
  for select to authenticated
  using (auth.uid() = user_id);

create policy "owner can write"
  on public.example_table
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "owner can update"
  on public.example_table
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "owner can delete"
  on public.example_table
  for delete to authenticated
  using (auth.uid() = user_id);
