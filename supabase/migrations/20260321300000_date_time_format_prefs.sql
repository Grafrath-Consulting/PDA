-- Add date and time format preferences to profiles
alter table profiles
  add column date_format text not null default 'MM/DD/YYYY',
  add column time_format text not null default '12h';

-- date_format: 'MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'
-- time_format: '12h', '24h'
