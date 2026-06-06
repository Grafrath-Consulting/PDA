-- journal_blocks.workspace_id is ON DELETE CASCADE, so deleting a workspace
-- cascades into deleting its scratchpad. The original prevent_scratch_delete
-- trigger blocked ALL scratch deletes, which would make any workspace with a
-- scratchpad impossible to delete. Allow the delete when the parent workspace is
-- itself gone (a cascade) — only block direct deletes while the workspace exists.
CREATE OR REPLACE FUNCTION prevent_scratch_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF old.is_scratch AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = old.workspace_id) THEN
    RAISE EXCEPTION 'scratchpad: cannot be deleted';
  END IF;
  RETURN old;
END;
$$;
