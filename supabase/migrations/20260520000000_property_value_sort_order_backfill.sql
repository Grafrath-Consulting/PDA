-- Give property values a stable, user-orderable sequence.
-- Seed sort_order from the current alphabetical-by-label display so values
-- don't visibly jump the first time the new drag-to-reorder UI loads.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY property_id ORDER BY label ASC) AS rn
  FROM property_values
)
UPDATE property_values pv
SET sort_order = ranked.rn
FROM ranked
WHERE pv.id = ranked.id;
