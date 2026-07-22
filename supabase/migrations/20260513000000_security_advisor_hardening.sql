-- =============================================================================
-- Security Advisor hardening (2026-05-13)
--
-- Addresses warnings from Supabase's Security Advisor:
--   * lint 0011: function search_path mutable
--   * lints 0028 / 0029: SECURITY DEFINER functions callable via /rest/v1/rpc
--
-- Not addressed here:
--   * `vector` extension installed in public — moving it requires rewriting
--     every vector(N) reference; left in place intentionally.
--   * Leaked password protection — dashboard toggle, not a migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on functions flagged by lint 0011
-- ---------------------------------------------------------------------------

-- Trigger function: stamps completed_at when status flips to/from 'complete'
create or replace function public.set_completed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'complete' and (old.status is null or old.status <> 'complete') then
    new.completed_at = now();
  elsif new.status <> 'complete' and old.status = 'complete' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

-- RPC: pgvector similarity search (called from /api/ai/search).
-- `public` is on the search_path because the vector extension lives there.
create or replace function public.match_chunks(
  query_embedding vector(512),
  match_user_id   uuid,
  match_threshold float default 0.3,
  match_count     int default 40
)
returns table (
  block_id    uuid,
  chunk_index int,
  chunk_text  text,
  similarity  float
)
language sql
stable
set search_path = public
as $$
  select
    bc.block_id,
    bc.chunk_index,
    bc.chunk_text,
    1 - (bc.embedding <=> query_embedding) as similarity
  from block_chunks bc
  where bc.user_id = match_user_id
    and bc.embedding is not null
    and 1 - (bc.embedding <=> query_embedding) > match_threshold
  order by bc.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- 2. Revoke RPC EXECUTE on SECURITY DEFINER trigger functions (lints 0028/0029)
--    These are invoked by triggers, never by API callers, so they should not
--    be reachable through /rest/v1/rpc/<fn>.
-- ---------------------------------------------------------------------------

revoke execute on function public.handle_new_user()     from public, anon, authenticated;
revoke execute on function public.handle_block_update() from public, anon, authenticated;

-- rls_auto_enable exists only on the original project (created outside the
-- migration chain); guard the revoke so fresh databases don't fail on 42883.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
