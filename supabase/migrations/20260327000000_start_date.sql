-- Add start date/time to journal blocks
alter table journal_blocks add column if not exists start_date timestamptz;
