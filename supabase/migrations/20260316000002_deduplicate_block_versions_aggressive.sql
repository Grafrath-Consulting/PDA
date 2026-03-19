-- Aggressive dedup: strip all HTML tags and whitespace, then keep only the
-- earliest version per block per normalized text content.
DELETE FROM block_versions
WHERE id NOT IN (
  SELECT DISTINCT ON (block_id, normalized)
    id
  FROM (
    SELECT
      id,
      block_id,
      edited_at,
      regexp_replace(
        regexp_replace(coalesce(content, ''), '<[^>]*>', '', 'g'),
        '\s+', '', 'g'
      ) AS normalized
    FROM block_versions
  ) sub
  ORDER BY block_id, normalized, edited_at ASC
);
