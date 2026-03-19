alter table properties
  add column if not exists pinned_in_filter_bar boolean not null default false;
