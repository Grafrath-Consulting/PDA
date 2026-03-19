-- Add report recipient preferences

-- Per-workspace preferred recipients (array of people.id values)
alter table workspaces
  add column report_recipients uuid[] not null default '{}';

-- Global report recipients (for "All Workspaces" reports)
alter table profiles
  add column global_report_recipients uuid[] not null default '{}';
