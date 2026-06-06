-- Per-workspace scratchpad card.
--
-- Each workspace gets exactly one permanent, always-visible "scratchpad" block.
-- It reuses the journal_blocks base (so future card features apply to it too) but
-- is excluded from the normal feed/search/pinned queries and rendered in its own
-- collapsible section. It cannot be archived, completed, deleted, moved between
-- workspaces, pinned, typed (info/task), or given properties. These invariants
-- are enforced here at the DB level so they hold for the UI, the MCP server, and
-- any direct SQL.

ALTER TABLE journal_blocks
  ADD COLUMN IF NOT EXISTS is_scratch boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scratch_collapsed boolean NOT NULL DEFAULT false;

-- At most one scratchpad per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS one_scratch_per_workspace
  ON journal_blocks(workspace_id)
  WHERE is_scratch;

-- Backfill: create a scratchpad for every existing workspace that lacks one.
INSERT INTO journal_blocks (user_id, workspace_id, content, status, entry_type, is_scratch)
SELECT w.user_id, w.id, '', 'active', 'info', true
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM journal_blocks b
  WHERE b.workspace_id = w.id AND b.is_scratch
);

-- Auto-create a scratchpad whenever a workspace is created (covers the UI modal,
-- the MCP server, and direct SQL — every creation path).
CREATE OR REPLACE FUNCTION create_workspace_scratchpad()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO journal_blocks (user_id, workspace_id, content, status, entry_type, is_scratch)
  VALUES (new.user_id, new.id, '', 'active', 'info', true)
  ON CONFLICT DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_workspace_created_scratchpad ON workspaces;
CREATE TRIGGER on_workspace_created_scratchpad
  AFTER INSERT ON workspaces
  FOR EACH ROW EXECUTE PROCEDURE create_workspace_scratchpad();

-- Guard: reject illegal mutations of a scratchpad. Content/draft/header/collapse
-- edits are allowed; lifecycle, type, move, pin, and the is_scratch flag are not.
CREATE OR REPLACE FUNCTION protect_scratch_block()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF old.is_scratch THEN
    IF new.is_scratch IS DISTINCT FROM old.is_scratch THEN
      RAISE EXCEPTION 'scratchpad: is_scratch is immutable';
    END IF;
    IF new.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'scratchpad: cannot change status (no archive/complete)';
    END IF;
    IF new.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'scratchpad: cannot be deleted';
    END IF;
    IF new.entry_type IS DISTINCT FROM old.entry_type THEN
      RAISE EXCEPTION 'scratchpad: cannot change entry_type';
    END IF;
    IF new.workspace_id IS DISTINCT FROM old.workspace_id THEN
      RAISE EXCEPTION 'scratchpad: cannot move between workspaces';
    END IF;
    IF new.pinned THEN
      RAISE EXCEPTION 'scratchpad: cannot be pinned';
    END IF;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS protect_scratch_block_update ON journal_blocks;
CREATE TRIGGER protect_scratch_block_update
  BEFORE UPDATE ON journal_blocks
  FOR EACH ROW EXECUTE PROCEDURE protect_scratch_block();

CREATE OR REPLACE FUNCTION prevent_scratch_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF old.is_scratch THEN
    RAISE EXCEPTION 'scratchpad: cannot be deleted';
  END IF;
  RETURN old;
END;
$$;

DROP TRIGGER IF EXISTS prevent_scratch_delete_trg ON journal_blocks;
CREATE TRIGGER prevent_scratch_delete_trg
  BEFORE DELETE ON journal_blocks
  FOR EACH ROW EXECUTE PROCEDURE prevent_scratch_delete();

-- Guard: scratchpads cannot have properties (tags).
CREATE OR REPLACE FUNCTION prevent_scratch_properties()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM journal_blocks b WHERE b.id = new.entry_id AND b.is_scratch) THEN
    RAISE EXCEPTION 'scratchpad: cannot have properties';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS prevent_scratch_properties_trg ON entry_properties;
CREATE TRIGGER prevent_scratch_properties_trg
  BEFORE INSERT ON entry_properties
  FOR EACH ROW EXECUTE PROCEDURE prevent_scratch_properties();
