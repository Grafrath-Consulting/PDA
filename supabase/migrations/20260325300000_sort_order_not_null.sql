-- Backfill all null sort_order values with sequential floats ordered by created_at desc
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY created_at DESC
         ) AS rn
  FROM journal_blocks
  WHERE sort_order IS NULL
)
UPDATE journal_blocks jb
SET sort_order = r.rn
FROM ranked r
WHERE jb.id = r.id;

-- Also fix any Infinity or NaN values
UPDATE journal_blocks
SET sort_order = 0
WHERE sort_order = 'Infinity' OR sort_order = '-Infinity' OR sort_order = 'NaN';

-- Set remaining nulls to 0 as safety net
UPDATE journal_blocks SET sort_order = 0 WHERE sort_order IS NULL;

-- Make sort_order NOT NULL with default 0
ALTER TABLE journal_blocks ALTER COLUMN sort_order SET NOT NULL;
ALTER TABLE journal_blocks ALTER COLUMN sort_order SET DEFAULT 0;
