-- Append-only log of attachment add/delete events per block

create table attachment_events (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references journal_blocks on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  event_type text not null check (event_type in ('added', 'deleted')),
  filename text not null,
  file_size bigint,
  created_at timestamptz not null default now()
);

alter table attachment_events enable row level security;

create policy "Users can view own attachment events" on attachment_events
  for select using (auth.uid() = user_id);
create policy "Users can insert own attachment events" on attachment_events
  for insert with check (auth.uid() = user_id);
