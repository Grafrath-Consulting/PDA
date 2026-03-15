-- Add sort_order column to journal_blocks
ALTER TABLE journal_blocks ADD COLUMN IF NOT EXISTS sort_order FLOAT;

-- Add journal_sort_mode to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS journal_sort_mode TEXT NOT NULL DEFAULT 'created_desc';

-- Backfill sort_order for existing active blocks.
-- Newest block gets sort_order = 1 (top of list), next = 2, etc.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY created_at DESC
         ) AS rn
  FROM journal_blocks
  WHERE deleted_at IS NULL AND status != 'archived'
)
UPDATE journal_blocks jb
SET sort_order = r.rn
FROM ranked r
WHERE jb.id = r.id;
