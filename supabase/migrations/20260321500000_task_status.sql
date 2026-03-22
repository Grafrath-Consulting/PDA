-- Add task_status column for granular task progress tracking
-- Values: 'not_started', 'in_progress', 'done'
-- Separate from block status ('active'/'complete'/'archived') which tracks lifecycle

alter table journal_blocks
  add column task_status text not null default 'not_started';

-- Backfill: completed tasks → 'done'
update journal_blocks
  set task_status = 'done'
  where entry_type = 'task' and status = 'complete';

-- Backfill: open tasks → randomly 'not_started' or 'in_progress'
update journal_blocks
  set task_status = case when random() < 0.5 then 'not_started' else 'in_progress' end
  where entry_type = 'task' and status = 'active';

alter table journal_blocks
  add constraint journal_blocks_task_status_check
  check (task_status in ('not_started', 'in_progress', 'done'));
