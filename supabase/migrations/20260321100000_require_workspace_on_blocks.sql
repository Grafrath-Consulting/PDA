-- Assign any orphaned journal_blocks to the user's default workspace
update journal_blocks jb
set workspace_id = w.id
from workspaces w
where jb.workspace_id is null
  and w.user_id = jb.user_id
  and w.is_default = true;

-- Safety net: if any blocks still have no workspace (user has no default workspace),
-- create a default workspace for those users and assign.
-- First, insert default workspaces for users who have orphaned blocks but no default workspace.
insert into workspaces (user_id, name, emoji, is_default, color_scheme)
select distinct jb.user_id, 'Default', '📓', true, 'default'
from journal_blocks jb
where jb.workspace_id is null
  and not exists (
    select 1 from workspaces w
    where w.user_id = jb.user_id and w.is_default = true
  )
on conflict do nothing;

-- Now assign those remaining orphaned blocks
update journal_blocks jb
set workspace_id = w.id
from workspaces w
where jb.workspace_id is null
  and w.user_id = jb.user_id
  and w.is_default = true;

-- Drop the old foreign key and add a NOT NULL constraint with proper cascade
alter table journal_blocks
  alter column workspace_id set not null;

-- Replace the foreign key: drop old one, add new with on delete cascade
-- (deleting a workspace should delete its blocks, not orphan them)
alter table journal_blocks
  drop constraint if exists journal_blocks_workspace_id_fkey;

alter table journal_blocks
  add constraint journal_blocks_workspace_id_fkey
  foreign key (workspace_id) references workspaces(id) on delete cascade;
