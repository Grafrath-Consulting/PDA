-- Add 'held' to the task_status check constraint
-- Held sits between 'not_started' and 'in_progress' for paused work
-- where the due date should be retained but ignored on the focus panel.

alter table journal_blocks
  drop constraint journal_blocks_task_status_check;

alter table journal_blocks
  add constraint journal_blocks_task_status_check
  check (task_status in ('not_started', 'held', 'in_progress', 'done'));
