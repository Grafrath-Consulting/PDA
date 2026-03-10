-- Enums
create type task_type_enum as enum ('my_task', 'delegated', 'waiting_on');
create type task_status_enum as enum ('open', 'in_progress', 'blocked', 'done', 'cancelled');
create type priority_enum as enum ('critical', 'high', 'medium', 'low');
create type project_status_enum as enum ('active', 'on_hold', 'completed', 'cancelled');
create type entity_type_enum as enum ('block', 'task', 'project');

-- profiles
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar_url text,
  email text,
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;

-- contexts
create table contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  color text,
  icon text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
alter table contexts enable row level security;

-- journal_blocks
create table journal_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  context_id uuid references contexts on delete set null,
  content text,
  content_html text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_archived boolean not null default false,
  pinned boolean not null default false,
  position integer not null default 0
);
alter table journal_blocks enable row level security;

-- block_versions
create table block_versions (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references journal_blocks on delete cascade,
  content text,
  content_html text,
  edited_at timestamptz not null default now()
);
alter table block_versions enable row level security;

-- projects
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  context_id uuid references contexts on delete set null,
  name text not null,
  description text,
  status project_status_enum not null default 'active',
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table projects enable row level security;

-- tasks
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  context_id uuid references contexts on delete set null,
  project_id uuid references projects on delete set null,
  title text not null,
  body text,
  status task_status_enum not null default 'open',
  task_type task_type_enum not null default 'my_task',
  priority priority_enum not null default 'medium',
  assignee_id uuid references auth.users on delete set null,
  due_date date,
  target_date date,
  is_hard_deadline boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table tasks enable row level security;

-- people
create table people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  email text,
  company text,
  notes text,
  created_at timestamptz not null default now()
);
alter table people enable row level security;

-- attachments
create table attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  block_id uuid references journal_blocks on delete cascade,
  task_id uuid references tasks on delete cascade,
  project_id uuid references projects on delete cascade,
  file_name text not null,
  file_path text not null,
  file_size bigint,
  mime_type text,
  created_at timestamptz not null default now()
);
alter table attachments enable row level security;

-- tags
create table tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  color text
);
alter table tags enable row level security;

-- taggings
create table taggings (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references tags on delete cascade,
  entity_type entity_type_enum not null,
  entity_id uuid not null
);
alter table taggings enable row level security;

-- ============================================================
-- RLS Policies
-- ============================================================

-- profiles
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- contexts
create policy "Users can view own contexts" on contexts for select using (auth.uid() = user_id);
create policy "Users can insert own contexts" on contexts for insert with check (auth.uid() = user_id);
create policy "Users can update own contexts" on contexts for update using (auth.uid() = user_id);
create policy "Users can delete own contexts" on contexts for delete using (auth.uid() = user_id);

-- journal_blocks
create policy "Users can view own blocks" on journal_blocks for select using (auth.uid() = user_id);
create policy "Users can insert own blocks" on journal_blocks for insert with check (auth.uid() = user_id);
create policy "Users can update own blocks" on journal_blocks for update using (auth.uid() = user_id);
create policy "Users can delete own blocks" on journal_blocks for delete using (auth.uid() = user_id);

-- block_versions: accessible if user owns the parent block
create policy "Users can view own block versions" on block_versions for select
  using (exists (select 1 from journal_blocks b where b.id = block_versions.block_id and b.user_id = auth.uid()));
create policy "Users can insert own block versions" on block_versions for insert
  with check (exists (select 1 from journal_blocks b where b.id = block_versions.block_id and b.user_id = auth.uid()));

-- projects
create policy "Users can view own projects" on projects for select using (auth.uid() = user_id);
create policy "Users can insert own projects" on projects for insert with check (auth.uid() = user_id);
create policy "Users can update own projects" on projects for update using (auth.uid() = user_id);
create policy "Users can delete own projects" on projects for delete using (auth.uid() = user_id);

-- tasks
create policy "Users can view own tasks" on tasks for select using (auth.uid() = user_id);
create policy "Users can insert own tasks" on tasks for insert with check (auth.uid() = user_id);
create policy "Users can update own tasks" on tasks for update using (auth.uid() = user_id);
create policy "Users can delete own tasks" on tasks for delete using (auth.uid() = user_id);

-- people
create policy "Users can view own people" on people for select using (auth.uid() = user_id);
create policy "Users can insert own people" on people for insert with check (auth.uid() = user_id);
create policy "Users can update own people" on people for update using (auth.uid() = user_id);
create policy "Users can delete own people" on people for delete using (auth.uid() = user_id);

-- attachments
create policy "Users can view own attachments" on attachments for select using (auth.uid() = user_id);
create policy "Users can insert own attachments" on attachments for insert with check (auth.uid() = user_id);
create policy "Users can delete own attachments" on attachments for delete using (auth.uid() = user_id);

-- tags
create policy "Users can view own tags" on tags for select using (auth.uid() = user_id);
create policy "Users can insert own tags" on tags for insert with check (auth.uid() = user_id);
create policy "Users can update own tags" on tags for update using (auth.uid() = user_id);
create policy "Users can delete own tags" on tags for delete using (auth.uid() = user_id);

-- taggings: accessible if user owns the tag
create policy "Users can view own taggings" on taggings for select
  using (exists (select 1 from tags t where t.id = taggings.tag_id and t.user_id = auth.uid()));
create policy "Users can insert own taggings" on taggings for insert
  with check (exists (select 1 from tags t where t.id = taggings.tag_id and t.user_id = auth.uid()));
create policy "Users can delete own taggings" on taggings for delete
  using (exists (select 1 from tags t where t.id = taggings.tag_id and t.user_id = auth.uid()));

-- ============================================================
-- Trigger: auto-create profile on signup
-- ============================================================

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- Trigger: save block_version on journal_block update
-- ============================================================

create or replace function handle_block_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.content is distinct from new.content or old.content_html is distinct from new.content_html then
    insert into block_versions (block_id, content, content_html, edited_at)
    values (old.id, old.content, old.content_html, now());
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger on_block_updated
  before update on journal_blocks
  for each row execute procedure handle_block_update();
