-- Per-user AI key storage (one row per user, key encrypted at app layer)
create table if not exists user_ai_config (
  user_id uuid references auth.users(id) on delete cascade primary key,
  encrypted_api_key text,       -- AES-256-GCM encrypted blob, null = not configured
  api_key_hint text,            -- e.g. "sk-...xK9q" for display only
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table user_ai_config enable row level security;
create policy "Users manage own AI config"
  on user_ai_config for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Per-user prompt template overrides
create table if not exists user_prompt_templates (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  prompt_key text not null,     -- e.g. 'summarize', 'search_semantic'
  prompt_text text not null,
  updated_at timestamptz default now(),
  unique(user_id, prompt_key)
);

alter table user_prompt_templates enable row level security;
create policy "Users manage own prompt templates"
  on user_prompt_templates for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
