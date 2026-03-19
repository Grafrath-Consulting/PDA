-- Remove all exact-content duplicates per block, keeping only the earliest.
DELETE FROM block_versions
WHERE id NOT IN (
  SELECT DISTINCT ON (block_id, content) id
  FROM block_versions
  ORDER BY block_id, content, edited_at ASC
);
