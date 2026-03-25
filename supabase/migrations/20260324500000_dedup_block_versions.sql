-- Harden the trigger to skip inserting a version if the most recent
-- version for that block already has identical content.
CREATE OR REPLACE FUNCTION handle_block_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  latest_content text;
BEGIN
  IF old.content IS DISTINCT FROM new.content THEN
    SELECT content INTO latest_content
    FROM block_versions
    WHERE block_id = old.id
    ORDER BY edited_at DESC
    LIMIT 1;

    IF latest_content IS DISTINCT FROM old.content THEN
      INSERT INTO block_versions (block_id, content, content_html, edited_at)
      VALUES (old.id, old.content, old.content_html, now());
    END IF;
  END IF;
  new.updated_at = now();
  RETURN new;
END;
$$;

-- One-time cleanup: delete duplicate consecutive versions.
-- Keep only the earliest version in each run of identical content per block.
DELETE FROM block_versions
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      content,
      block_id,
      edited_at,
      LAG(content) OVER (PARTITION BY block_id ORDER BY edited_at) AS prev_content
    FROM block_versions
  ) sub
  WHERE content IS NOT DISTINCT FROM prev_content
);
