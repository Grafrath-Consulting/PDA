-- =============================================================================
-- Public release hardening (2026-07-22)
--
--   1. Explicit Data API grants for every table. Starting 2026-10-30 Supabase
--      no longer auto-grants Data API access to tables in `public`, so a fresh
--      project provisioned from this migration chain would return 42501 on
--      every supabase-js call. Idempotent and harmless on older projects.
--   2. Missing indexes on the two hottest paths: the block_versions lookup in
--      the handle_block_update trigger, and journal_blocks.workspace_id
--      (feed filter + FK cascade on workspace delete).
--   3. entry_properties insert/update policies now also verify ownership of
--      the referenced property_value (FK validation bypasses RLS, so without
--      this a caller could attach another user's value to their own entry).
--   4. Drop indexes that duplicate implicit UNIQUE-constraint indexes.
--   5. Revoke RPC EXECUTE on the scratchpad SECURITY DEFINER trigger
--      functions, matching 20260513000000 (lints 0028/0029).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Data API grants (RLS still scopes every row to its owner)
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.profiles              to authenticated, service_role;
grant select, insert, update, delete on public.contexts              to authenticated, service_role;
grant select, insert, update, delete on public.journal_blocks        to authenticated, service_role;
grant select, insert, update, delete on public.block_versions        to authenticated, service_role;
grant select, insert, update, delete on public.projects              to authenticated, service_role;
grant select, insert, update, delete on public.tasks                 to authenticated, service_role;
grant select, insert, update, delete on public.people                to authenticated, service_role;
grant select, insert, update, delete on public.attachments           to authenticated, service_role;
grant select, insert, update, delete on public.tags                  to authenticated, service_role;
grant select, insert, update, delete on public.taggings              to authenticated, service_role;
grant select, insert, update, delete on public.workspaces            to authenticated, service_role;
grant select, insert, update, delete on public.properties            to authenticated, service_role;
grant select, insert, update, delete on public.property_values       to authenticated, service_role;
grant select, insert, update, delete on public.entry_properties      to authenticated, service_role;
grant select, insert, update, delete on public.attachment_events     to authenticated, service_role;
grant select, insert, update, delete on public.user_ai_config        to authenticated, service_role;
grant select, insert, update, delete on public.user_prompt_templates to authenticated, service_role;
grant select, insert, update, delete on public.block_chunks          to authenticated, service_role;
grant select, insert, update, delete on public.report_templates      to authenticated, service_role;
grant select, insert, update, delete on public.mcp_tokens            to authenticated, service_role;
grant select, insert, update, delete on public.mcp_oauth_clients     to authenticated, service_role;
grant select, insert, update, delete on public.mcp_oauth_codes       to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Missing indexes
-- ---------------------------------------------------------------------------

-- Serves the latest-version lookup in handle_block_update (fires on every
-- content-changing save) and the history modal query.
create index if not exists block_versions_block_id_edited_at_idx
  on public.block_versions (block_id, edited_at desc);

-- Serves the feed filter (workspace + status) and, via its leading column,
-- the FK cascade scan when a workspace is deleted.
create index if not exists journal_blocks_workspace_status_idx
  on public.journal_blocks (workspace_id, status);

-- ---------------------------------------------------------------------------
-- 3. entry_properties: verify property_value ownership on write
-- ---------------------------------------------------------------------------

drop policy if exists "Users can insert own entry properties" on public.entry_properties;
create policy "Users can insert own entry properties" on public.entry_properties
  for insert with check (
    exists (
      select 1 from journal_blocks b
      where b.id = entry_properties.entry_id
      and b.user_id = (select auth.uid())
    )
    and exists (
      select 1 from property_values pv
      join properties p on p.id = pv.property_id
      where pv.id = entry_properties.property_value_id
      and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can update own entry properties" on public.entry_properties;
create policy "Users can update own entry properties" on public.entry_properties
  for update using (
    exists (
      select 1 from journal_blocks b
      where b.id = entry_properties.entry_id
      and b.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from journal_blocks b
      where b.id = entry_properties.entry_id
      and b.user_id = (select auth.uid())
    )
    and exists (
      select 1 from property_values pv
      join properties p on p.id = pv.property_id
      where pv.id = entry_properties.property_value_id
      and p.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Drop duplicates of implicit UNIQUE indexes
-- ---------------------------------------------------------------------------

drop index if exists public.mcp_tokens_token_hash_idx;
drop index if exists public.mcp_oauth_clients_client_id_idx;
drop index if exists public.mcp_oauth_codes_code_hash_idx;

-- ---------------------------------------------------------------------------
-- 5. Revoke RPC EXECUTE on scratchpad trigger functions (lints 0028/0029)
-- ---------------------------------------------------------------------------

revoke execute on function public.create_workspace_scratchpad() from public, anon, authenticated;
revoke execute on function public.protect_scratch_block()       from public, anon, authenticated;
revoke execute on function public.prevent_scratch_delete()      from public, anon, authenticated;
revoke execute on function public.prevent_scratch_properties()  from public, anon, authenticated;
