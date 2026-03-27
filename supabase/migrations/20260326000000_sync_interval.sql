-- Add sync polling interval preference to profiles
alter table profiles
  add column if not exists sync_interval_seconds integer not null default 60;
