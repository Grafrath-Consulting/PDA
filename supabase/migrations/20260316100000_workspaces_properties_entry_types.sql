-- ============================================================
-- Migration: Workspaces, entry types, properties, and archive
-- ============================================================

-- ============================================================
-- 1. NEW TABLE: workspaces
-- ============================================================

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  emoji text,
  color_scheme text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table workspaces enable row level security;

create policy "Users can view own workspaces" on workspaces
  for select using (auth.uid() = user_id);
create policy "Users can insert own workspaces" on workspaces
  for insert with check (auth.uid() = user_id);
create policy "Users can update own workspaces" on workspaces
  for update using (auth.uid() = user_id);
create policy "Users can delete own workspaces" on workspaces
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 2. NEW TABLE: properties (tag definitions, Asana-style)
-- ============================================================

create table properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  workspace_id uuid references workspaces on delete set null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table properties enable row level security;

create policy "Users can view own properties" on properties
  for select using (auth.uid() = user_id);
create policy "Users can insert own properties" on properties
  for insert with check (auth.uid() = user_id);
create policy "Users can update own properties" on properties
  for update using (auth.uid() = user_id);
create policy "Users can delete own properties" on properties
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 3. NEW TABLE: property_values
-- ============================================================

create table property_values (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties on delete cascade,
  label text not null,
  color text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table property_values enable row level security;

create policy "Users can view own property values" on property_values
  for select using (exists (
    select 1 from properties p
    where p.id = property_values.property_id
    and p.user_id = auth.uid()
  ));
create policy "Users can insert own property values" on property_values
  for insert with check (exists (
    select 1 from properties p
    where p.id = property_values.property_id
    and p.user_id = auth.uid()
  ));
create policy "Users can update own property values" on property_values
  for update using (exists (
    select 1 from properties p
    where p.id = property_values.property_id
    and p.user_id = auth.uid()
  ));
create policy "Users can delete own property values" on property_values
  for delete using (exists (
    select 1 from properties p
    where p.id = property_values.property_id
    and p.user_id = auth.uid()
  ));

-- ============================================================
-- 4. ALTER journal_blocks: add new columns
-- ============================================================

-- workspace_id (nullable — null means unassigned)
alter table journal_blocks
  add column workspace_id uuid references workspaces on delete set null;

-- entry_type: 'info' or 'task'
alter table journal_blocks
  add column entry_type text not null default 'info';

-- owner_id: optional delegation to a person
alter table journal_blocks
  add column owner_id uuid references people on delete set null;

-- due_date and due_date_type
alter table journal_blocks
  add column due_date date,
  add column due_date_type text;

-- archived_at timestamp
alter table journal_blocks
  add column archived_at timestamptz;

-- Evolve the status column from block_status_enum to text.
-- Step 1: Add the new text column
alter table journal_blocks
  add column entry_status text not null default 'active';

-- Step 2: Migrate existing enum values to the new column
update journal_blocks set entry_status = case status
  when 'archived' then 'archived'
  else 'active'  -- both 'unprocessed' and 'partially_handled' map to 'active'
end;

-- Step 3: Drop the index that references the old status column
drop index if exists journal_blocks_active_idx;

-- Step 4: Drop the old enum column and rename the new one
alter table journal_blocks drop column status;
alter table journal_blocks rename column entry_status to status;

-- Step 5: Recreate the partial index using the new text column
create index journal_blocks_active_idx
  on journal_blocks (user_id, created_at desc)
  where deleted_at is null and status != 'archived';

-- Step 6: Drop the now-unused enum type
drop type block_status_enum;

-- Backfill archived_at for blocks already in archived status
update journal_blocks
  set archived_at = updated_at
  where status = 'archived' and archived_at is null;

-- Constraint: due_date_type must be 'hard' or 'soft' when present
alter table journal_blocks
  add constraint journal_blocks_due_date_type_check
  check (due_date_type is null or due_date_type in ('hard', 'soft'));

-- Constraint: entry_type must be 'info' or 'task'
alter table journal_blocks
  add constraint journal_blocks_entry_type_check
  check (entry_type in ('info', 'task'));

-- Constraint: status must be one of the allowed values
alter table journal_blocks
  add constraint journal_blocks_status_check
  check (status in ('active', 'complete', 'archived'));

-- ============================================================
-- 5. NEW JOIN TABLE: entry_properties
-- ============================================================

create table entry_properties (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references journal_blocks on delete cascade,
  property_value_id uuid not null references property_values on delete cascade,
  created_at timestamptz not null default now(),
  unique (entry_id, property_value_id)
);

alter table entry_properties enable row level security;

create policy "Users can view own entry properties" on entry_properties
  for select using (exists (
    select 1 from journal_blocks b
    where b.id = entry_properties.entry_id
    and b.user_id = auth.uid()
  ));
create policy "Users can insert own entry properties" on entry_properties
  for insert with check (exists (
    select 1 from journal_blocks b
    where b.id = entry_properties.entry_id
    and b.user_id = auth.uid()
  ));
create policy "Users can update own entry properties" on entry_properties
  for update using (exists (
    select 1 from journal_blocks b
    where b.id = entry_properties.entry_id
    and b.user_id = auth.uid()
  ));
create policy "Users can delete own entry properties" on entry_properties
  for delete using (exists (
    select 1 from journal_blocks b
    where b.id = entry_properties.entry_id
    and b.user_id = auth.uid()
  ));

-- ============================================================
-- 6. SEED: starter properties for every existing user
-- ============================================================

do $$
declare
  u record;
  priority_id uuid;
  context_id uuid;
begin
  for u in select id from auth.users loop
    -- Priority property
    insert into properties (user_id, workspace_id, name)
    values (u.id, null, 'Priority')
    returning id into priority_id;

    insert into property_values (property_id, label, color, sort_order) values
      (priority_id, 'High',   'red',   0),
      (priority_id, 'Medium', 'amber', 1),
      (priority_id, 'Low',    'green', 2);

    -- Context property
    insert into properties (user_id, workspace_id, name)
    values (u.id, null, 'Context')
    returning id into context_id;

    insert into property_values (property_id, label, color, sort_order) values
      (context_id, 'Office',   null, 0),
      (context_id, 'Home',     null, 1),
      (context_id, 'Anywhere', null, 2);
  end loop;
end;
$$;
