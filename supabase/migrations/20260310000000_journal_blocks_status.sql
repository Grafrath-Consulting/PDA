-- Add block status enum and soft-delete support to journal_blocks

create type block_status_enum as enum ('unprocessed', 'partially_handled', 'archived');

alter table journal_blocks
  add column status block_status_enum not null default 'unprocessed',
  add column deleted_at timestamptz default null;

-- Partial index for the common query pattern (active, non-deleted blocks per user)
create index journal_blocks_active_idx
  on journal_blocks (user_id, created_at desc)
  where deleted_at is null and status != 'archived';
