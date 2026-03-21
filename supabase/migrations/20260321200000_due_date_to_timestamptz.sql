-- Convert due_date from date to timestamptz
-- Existing date values get time set to 23:59:59 (no time specified = end of day)
alter table journal_blocks
  alter column due_date type timestamptz
  using (due_date::timestamp + interval '23 hours 59 minutes 59 seconds');

-- Update due_date_type constraint: hard/soft → deadline/target
alter table journal_blocks
  drop constraint journal_blocks_due_date_type_check;

update journal_blocks set due_date_type = 'deadline' where due_date_type = 'hard';
update journal_blocks set due_date_type = 'target' where due_date_type = 'soft';

alter table journal_blocks
  add constraint journal_blocks_due_date_type_check
  check (due_date_type is null or due_date_type in ('deadline', 'target'));
