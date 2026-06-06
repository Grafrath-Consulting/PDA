-- Card headers (Apple Notes style): the first line of a multi-line card renders
-- as a header (bold + slightly larger + a faint divider). This flag stores the
-- per-card intent; the actual styling is gated on the card being multi-line and
-- is applied purely via CSS (no content mutation), so toggling is reversible.
ALTER TABLE journal_blocks
  ADD COLUMN IF NOT EXISTS header_enabled boolean NOT NULL DEFAULT true;

-- Backfill: new cards default to header-on, but for EXISTING cards only treat as
-- a header those whose first block already starts bold (the user has manually
-- bolded many first lines). Everything else stays plain until toggled on.
UPDATE journal_blocks
SET header_enabled = false
WHERE content IS NULL
   OR content !~* '^\s*<(p|h[1-6])[^>]*>\s*<(strong|b)\b';
