-- Drop the existing check constraint and recreate with 'deleted' as valid value
alter table journal_blocks drop constraint if exists journal_blocks_status_check;
alter table journal_blocks add constraint journal_blocks_status_check
  check (status in ('active', 'archived', 'complete', 'deleted'));

-- Fix rows that have deleted_at set but wrong status
update journal_blocks
  set status = 'deleted'
  where deleted_at is not null
    and status != 'deleted';
