-- Allow the same property name in different workspaces.
-- Drop the old user-wide unique constraint on (user_id, name).
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_user_id_name_key;

-- Add a unique index on (user_id, workspace_id, name) using COALESCE
-- so that NULL workspace_id (global) is treated as a distinct value.
CREATE UNIQUE INDEX properties_user_workspace_name_key
  ON properties (user_id, COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'), name);
