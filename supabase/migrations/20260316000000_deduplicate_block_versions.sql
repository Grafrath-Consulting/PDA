-- One-time cleanup: remove duplicate consecutive block_versions with the same content.
-- Keeps the earliest version in each run of identical content.
DELETE FROM block_versions
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      content,
      lag(content) OVER (PARTITION BY block_id ORDER BY edited_at) AS prev_content
    FROM block_versions
  ) sub
  WHERE content IS NOT DISTINCT FROM prev_content
);
