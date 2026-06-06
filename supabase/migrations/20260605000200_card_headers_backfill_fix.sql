-- The initial header backfill only matched cards where <strong>/<b> was the
-- immediate first child of the first block. Many manually-bolded first lines wrap
-- the bold in other tags first (e.g. <p><u><strong>…) and were missed. Upgrade
-- any still-off card whose FIRST block contains a bold tag anywhere. One-directional
-- (only flips false→true) so it never clobbers a card the user already toggled.
UPDATE journal_blocks
SET header_enabled = true
WHERE NOT is_scratch
  AND header_enabled = false
  AND content IS NOT NULL
  AND (regexp_match(content, '^\s*<(?:p|h[1-6]|li)[^>]*>(.*?)</(?:p|h[1-6]|li)>'))[1] ~* '<(strong|b)\b';
