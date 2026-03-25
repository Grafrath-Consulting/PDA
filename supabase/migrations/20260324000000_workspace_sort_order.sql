-- Add sort_order column to workspaces for user-defined ordering
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Backfill: order by created_at ascending
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC) AS rn
  FROM workspaces
)
UPDATE workspaces
SET sort_order = ranked.rn
FROM ranked
WHERE workspaces.id = ranked.id;
