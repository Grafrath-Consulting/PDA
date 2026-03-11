-- Add autosave interval preference to profiles
alter table profiles
  add column if not exists autosave_interval_seconds integer not null default 30;
