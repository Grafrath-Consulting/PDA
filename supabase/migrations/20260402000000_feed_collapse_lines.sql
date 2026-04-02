alter table profiles
  add column if not exists feed_collapse_lines integer not null default 10;
