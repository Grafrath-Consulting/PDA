-- Add sort_order to properties for user-defined ordering
ALTER TABLE properties ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Backfill: order alphabetically by name within each user
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY name ASC) AS rn
  FROM properties
)
UPDATE properties
SET sort_order = ranked.rn
FROM ranked
WHERE properties.id = ranked.id;
