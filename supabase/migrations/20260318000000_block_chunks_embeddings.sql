-- Enable pgvector if not already enabled
create extension if not exists vector;

-- Chunk-level embeddings table
create table if not exists block_chunks (
  id          uuid default gen_random_uuid() primary key,
  block_id    uuid references journal_blocks(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  chunk_index integer not null,
  chunk_text  text not null,
  embedding   vector(512),
  created_at  timestamptz default now(),
  unique(block_id, chunk_index)
);

alter table block_chunks enable row level security;
create policy "Users access own chunks"
  on block_chunks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Index for fast similarity search
create index if not exists block_chunks_embedding_idx
  on block_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Supabase RPC for similarity search
create or replace function match_chunks(
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
language sql stable
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
